import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'

import pg from 'pg'

import {
  PermanentSendError,
  TransientSendError,
  countSentToday,
  sendToContact,
  type SendEngineDeps,
  type SendGateway,
} from './sendEngine.js'
import { ReauthorizationRequiredError } from './tokenRefresh.js'

/**
 * The guarantees of the send engine, against a real PostgreSQL.
 *
 * Nothing here can be proved with a fake: the claim is one conditional UPDATE,
 * the last defence is a unique index, and the interesting cases are two
 * workers racing. A stub would only prove the code calls what it says it
 * calls.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let userId: string
let campaignId: string
const stamp = Date.now()

/** Records what the gateway was asked to send, and can be told to fail. */
function gatewayThat(behaviour: 'succeeds' | 'permanent' | 'transient' | 'drops') {
  const calls: string[] = []

  const gateway: SendGateway = {
    send: (_token, raw) => {
      calls.push(raw)

      if (behaviour === 'permanent') {
        return Promise.reject(new PermanentSendError('Recipient address rejected'))
      }
      if (behaviour === 'transient') {
        return Promise.reject(new TransientSendError('Gmail answered 503'))
      }
      if (behaviour === 'drops') {
        // What fetch throws when the socket closes: no status, no answer.
        return Promise.reject(new TypeError('fetch failed'))
      }

      return Promise.resolve(`msg-${String(calls.length)}`)
    },
  }

  return { gateway, calls }
}

function deps(
  gateway: SendGateway,
  overrides: Partial<SendEngineDeps> = {},
): SendEngineDeps {
  return {
    pool,
    gateway,
    getAccessToken: () => Promise.resolve('access-token'),
    compose: (contact) =>
      Promise.resolve({ raw: `raw-for-${contact.email}`, to: contact.email }),
    dailyLimit: 100,
    ...overrides,
  }
}

async function addContact(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO contacts (campaign_id, email) VALUES ($1, $2) RETURNING id',
    [campaignId, email],
  )
  const created = rows[0]
  assert.ok(created)
  return created.id
}

async function contactRow(id: string) {
  const { rows } = await pool.query<{
    status: string
    attempts: number
    claimed_at: Date | null
    error_message: string | null
  }>('SELECT status, attempts, claimed_at, error_message FROM contacts WHERE id = $1', [
    id,
  ])
  const row = rows[0]
  assert.ok(row)
  return row
}

async function sentLogCount(contactId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM logs WHERE contact_id = $1 AND event_type = 'sent'",
    [contactId],
  )
  return Number(rows[0]?.n ?? 0)
}

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 })

  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`send-itest-${stamp}`, `send-itest-${stamp}@example.test`],
  )
  const created = rows[0]
  assert.ok(created)
  userId = created.id
})

after(async () => {
  if (!enabled) {
    return
  }

  await pool.query("DELETE FROM users WHERE google_id LIKE 'send-itest-%'")
  await pool.end()
})

beforeEach(async () => {
  if (!enabled) {
    return
  }

  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO campaigns (user_id, name, status) VALUES ($1, $2, 'running') RETURNING id",
    [userId, `Envoi ${String(Date.now())}`],
  )
  const created = rows[0]
  assert.ok(created)
  campaignId = created.id
})

describe('the send engine', { skip: enabled ? false : 'DATABASE_URL is not set' }, () => {
  it('sends once and records it', async () => {
    const contactId = await addContact('a@exemple.fr')
    const { gateway, calls } = gatewayThat('succeeds')

    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.deepEqual(outcome, { kind: 'sent', messageId: 'msg-1' })
    assert.equal(calls.length, 1)
    assert.equal((await contactRow(contactId)).status, 'sent')
    assert.equal(await sentLogCount(contactId), 1)
  })

  it('refuses a second job for a contact already sent', async () => {
    const contactId = await addContact('b@exemple.fr')
    const { gateway, calls } = gatewayThat('succeeds')

    await sendToContact(deps(gateway), { contactId, userId })
    const second = await sendToContact(deps(gateway), { contactId, userId })

    assert.deepEqual(second, { kind: 'skipped', reason: 'not_claimable' })
    assert.equal(calls.length, 1, 'Gmail was asked twice')
    assert.equal(await sentLogCount(contactId), 1)
  })

  it('sends once when two workers race for the same contact', async () => {
    // The case the whole design exists for. Both jobs start before either
    // finishes, which is what a redelivered job looks like.
    const contactId = await addContact('c@exemple.fr')
    const { gateway, calls } = gatewayThat('succeeds')

    const outcomes = await Promise.all([
      sendToContact(deps(gateway), { contactId, userId }),
      sendToContact(deps(gateway), { contactId, userId }),
      sendToContact(deps(gateway), { contactId, userId }),
    ])

    assert.equal(calls.length, 1, `Gmail was asked ${String(calls.length)} times`)
    assert.equal(outcomes.filter((o) => o.kind === 'sent').length, 1)
    assert.equal(outcomes.filter((o) => o.kind === 'skipped').length, 2)
    assert.equal(await sentLogCount(contactId), 1)
  })

  it('does not resend a contact whose outcome is unknown', async () => {
    // A worker killed between the Gmail call and the record leaves exactly
    // this: an attempt counted, no sent log, a stale claim. The message may
    // have gone out, so it is not sent again.
    const contactId = await addContact('d@exemple.fr')
    await pool.query(
      `UPDATE contacts SET attempts = 1, claimed_at = now() - interval '20 minutes'
         WHERE id = $1`,
      [contactId],
    )

    const { gateway, calls } = gatewayThat('succeeds')
    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.deepEqual(outcome, { kind: 'ambiguous' })
    assert.equal(calls.length, 0, 'a possibly-sent message was sent again')

    const row = await contactRow(contactId)
    assert.equal(row.status, 'failed')
    assert.match(row.error_message ?? '', /inconnue/)
  })

  it('reconsiders a contact whose claim expired before any send', async () => {
    // Same stale claim, but no attempt counted: nothing reached Gmail, so
    // this one is safe to take.
    const contactId = await addContact('e@exemple.fr')
    await pool.query(
      `UPDATE contacts SET claimed_at = now() - interval '20 minutes' WHERE id = $1`,
      [contactId],
    )

    const { gateway, calls } = gatewayThat('succeeds')
    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.equal(outcome.kind, 'sent')
    assert.equal(calls.length, 1)
  })

  it('leaves a freshly claimed contact alone', async () => {
    const contactId = await addContact('f@exemple.fr')
    await pool.query('UPDATE contacts SET claimed_at = now() WHERE id = $1', [contactId])

    const { gateway, calls } = gatewayThat('succeeds')
    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.equal(outcome.kind, 'skipped')
    assert.equal(calls.length, 0)
  })

  it('marks a refused address failed, without retrying it', async () => {
    const contactId = await addContact('g@exemple.fr')
    const { gateway } = gatewayThat('permanent')

    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.equal(outcome.kind, 'failed')
    const row = await contactRow(contactId)
    assert.equal(row.status, 'failed')
    assert.match(row.error_message ?? '', /Recipient address rejected/)
  })

  it('leaves a transient failure retryable, with nothing counted', async () => {
    const contactId = await addContact('h@exemple.fr')
    const { gateway } = gatewayThat('transient')

    await assert.rejects(() => sendToContact(deps(gateway), { contactId, userId }))

    const row = await contactRow(contactId)
    assert.equal(row.status, 'pending', 'a transient failure must not fail the contact')
    assert.equal(row.claimed_at, null, 'the claim must be released for the retry')
    assert.equal(row.attempts, 0, 'nothing reached Gmail, so nothing is counted')
  })

  it('treats a dropped connection as unknown, and never sends again', async () => {
    // The request may have reached Gmail before the socket closed. Retrying
    // would be a guess, and a wrong guess is a duplicate.
    const contactId = await addContact('h2@exemple.fr')
    const { gateway, calls } = gatewayThat('drops')

    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.deepEqual(outcome, { kind: 'ambiguous' })
    assert.equal(calls.length, 1)

    const row = await contactRow(contactId)
    assert.equal(row.status, 'failed')
    assert.equal(row.attempts, 1, 'the attempt stays counted')

    const retry = await sendToContact(deps(gatewayThat('succeeds').gateway), {
      contactId,
      userId,
    })
    assert.equal(retry.kind, 'skipped')
  })

  it('sends nothing for a campaign that was paused after planning', async () => {
    const contactId = await addContact('h3@exemple.fr')
    await pool.query("UPDATE campaigns SET status = 'paused' WHERE id = $1", [campaignId])
    const { gateway, calls } = gatewayThat('succeeds')

    const outcome = await sendToContact(deps(gateway), { contactId, userId })

    assert.equal(outcome.kind, 'skipped')
    assert.equal(calls.length, 0, 'a delayed job sent for a paused campaign')
    const row = await contactRow(contactId)
    assert.equal(row.status, 'pending')
    assert.equal(row.claimed_at, null)
  })

  it('releases the claim when the message cannot be built', async () => {
    const contactId = await addContact('h4@exemple.fr')
    const { gateway, calls } = gatewayThat('succeeds')

    await assert.rejects(() =>
      sendToContact(
        deps(gateway, { compose: () => Promise.reject(new Error('R2 unreachable')) }),
        { contactId, userId },
      ),
    )

    assert.equal(calls.length, 0)
    const row = await contactRow(contactId)
    assert.equal(row.claimed_at, null, 'the retry would be locked out')
    assert.equal(row.attempts, 0)
  })

  it('pauses rather than sending when the account ceiling is reached', async () => {
    const contactId = await addContact('i@exemple.fr')
    const { gateway, calls } = gatewayThat('succeeds')

    const outcome = await sendToContact(deps(gateway, { dailyLimit: 0 }), {
      contactId,
      userId,
    })

    assert.deepEqual(outcome, { kind: 'paused', reason: 'daily_limit_reached' })
    assert.equal(calls.length, 0)

    const row = await contactRow(contactId)
    assert.equal(row.status, 'pending', 'the day is full, the address is not wrong')
    assert.equal(row.claimed_at, null)
  })

  it('pauses rather than failing contacts when the token is gone', async () => {
    const contactId = await addContact('j@exemple.fr')
    const { gateway, calls } = gatewayThat('succeeds')

    const outcome = await sendToContact(
      deps(gateway, {
        getAccessToken: () =>
          Promise.reject(new ReauthorizationRequiredError('invalid_grant')),
      }),
      { contactId, userId },
    )

    assert.deepEqual(outcome, { kind: 'paused', reason: 'reauthorization_required' })
    assert.equal(calls.length, 0)
    assert.equal((await contactRow(contactId)).status, 'pending')
  })

  it('counts the day from the log rows', async () => {
    const before = await countSentToday(pool, userId)
    const contactId = await addContact('k@exemple.fr')
    const { gateway } = gatewayThat('succeeds')

    await sendToContact(deps(gateway), { contactId, userId })

    assert.equal(await countSentToday(pool, userId), before + 1)
  })

  it('completes the campaign when the last contact is sent', async () => {
    const first = await addContact('l@exemple.fr')
    const second = await addContact('m@exemple.fr')
    const { gateway } = gatewayThat('succeeds')

    await sendToContact(deps(gateway), { contactId: first, userId })

    const midway = await pool.query<{ status: string }>(
      'SELECT status FROM campaigns WHERE id = $1',
      [campaignId],
    )
    assert.equal(midway.rows[0]?.status, 'running', 'completed too early')

    await sendToContact(deps(gateway), { contactId: second, userId })

    const done = await pool.query<{ status: string; sent_count: number }>(
      'SELECT status, sent_count FROM campaigns WHERE id = $1',
      [campaignId],
    )
    const campaign = done.rows[0]
    assert.ok(campaign)
    assert.equal(campaign.status, 'completed')
    assert.equal(campaign.sent_count, 2)
  })

  it('keeps the counters equal to the rows', async () => {
    const sent = await addContact('n@exemple.fr')
    const refused = await addContact('o@exemple.fr')

    await sendToContact(deps(gatewayThat('succeeds').gateway), {
      contactId: sent,
      userId,
    })
    await sendToContact(deps(gatewayThat('permanent').gateway), {
      contactId: refused,
      userId,
    })

    const { rows } = await pool.query<{ sent_count: number; error_count: number }>(
      'SELECT sent_count, error_count FROM campaigns WHERE id = $1',
      [campaignId],
    )

    const counters = rows[0]
    assert.ok(counters)
    assert.equal(counters.sent_count, 1)
    assert.equal(counters.error_count, 1)
  })

  it('refuses a second sent log at the database, whatever the code does', async () => {
    // The last line of defence, exercised directly: if every check above were
    // removed, this is what would still stop a duplicate being recorded.
    const contactId = await addContact('p@exemple.fr')

    await pool.query(
      `INSERT INTO logs (campaign_id, contact_id, event_type) VALUES ($1, $2, 'sent')`,
      [campaignId, contactId],
    )

    await assert.rejects(
      pool.query(
        `INSERT INTO logs (campaign_id, contact_id, event_type) VALUES ($1, $2, 'sent')`,
        [campaignId, contactId],
      ),
    )
  })
})
