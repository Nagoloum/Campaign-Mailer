import type { Pool, PoolClient } from 'pg'

import { ReauthorizationRequiredError } from './tokenRefresh.js'

/**
 * Sending one message, and writing down what happened.
 *
 * Read docs/send-engine.md before changing anything here. The rules below are
 * the ones that keep a contact from receiving the same email twice, and the
 * order of operations is the whole of the guarantee.
 */

/** How long a claim survives a worker that died holding it. A literal, interpolated into SQL. */
export const CLAIM_TIMEOUT = '10 minutes'

export type SendOutcome =
  | { kind: 'sent'; messageId: string }
  | { kind: 'skipped'; reason: 'not_claimable' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ambiguous' }
  | { kind: 'paused'; reason: string }

/** Anything Gmail answers that no retry can fix. */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentSendError'
  }
}

/**
 * Gmail answered, and the answer was "not now": a 429, a 5xx, a rate refusal.
 *
 * Only an explicit answer earns a retry. A socket that drops after the request
 * went out is not this: the message may have left, so it is ambiguous, and
 * ambiguous is never resent.
 */
export class TransientSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientSendError'
  }
}

const UNKNOWN_OUTCOME =
  'Envoi déjà tenté, issue inconnue. Relancez ce contact manuellement si nécessaire.'

export interface SendableContact {
  id: string
  campaign_id: string
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
  attempts: number
}

export interface SendGateway {
  /** Returns the id Gmail assigned. Throws PermanentSendError for a refusal that stands. */
  send(accessToken: string, raw: string): Promise<string>
}

export interface SendEngineDeps {
  pool: Pool
  gateway: SendGateway
  getAccessToken: (userId: string) => Promise<string>
  /** Builds the message. Injected so the engine stays testable without MIME. */
  compose: (contact: SendableContact) => Promise<{ raw: string; to: string }>
  /** The account's ceiling, below Gmail's own. */
  dailyLimit: number
}

/**
 * Takes the lease on a contact.
 *
 * One conditional statement decides who owns the send. No row back means
 * another worker holds it, or it is no longer pending: there is nothing to do
 * and nothing to report.
 */
export async function claimContact(
  client: PoolClient,
  contactId: string,
): Promise<SendableContact | null> {
  const { rows } = await client.query<SendableContact>(
    `UPDATE contacts
     SET claimed_at = now()
     WHERE id = $1
       AND status = 'pending'
       AND (claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_TIMEOUT}')
       -- A paused campaign keeps its delayed jobs in the queue. They must find
       -- nothing to do, in the same statement that would otherwise take the
       -- contact, so a pause cannot race a send that is about to start.
       AND EXISTS (
         SELECT 1 FROM campaigns
         WHERE campaigns.id = contacts.campaign_id AND campaigns.status = 'running'
       )
     RETURNING id, campaign_id, email, contact_name, company_name, salutation, attempts`,
    [contactId],
  )

  return rows[0] ?? null
}

/**
 * True when this contact was already handed to Gmail once and the outcome was
 * never written down.
 *
 * The only honest answer then is "unknown", and the policy is not to send
 * again: a missed email is recoverable by whoever notices, a duplicate is not.
 */
export function isAmbiguous(contact: SendableContact): boolean {
  return contact.attempts > 0
}

export async function countSentToday(pool: Pool, userId: string): Promise<number> {
  // Counted from the log rows themselves rather than a running total, so a
  // half-failed write cannot inflate the allowance. A rolling 24 hours, as
  // Gmail counts, not a calendar day: midnight UTC would let 150 go out at
  // 23:00 and another 150 at 00:05.
  const { rows } = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM logs l
     JOIN campaigns c ON c.id = l.campaign_id
     WHERE c.user_id = $1
       AND l.event_type = 'sent'
       AND l.created_at >= now() - interval '24 hours'`,
    [userId],
  )

  return Number(rows[0]?.total ?? 0)
}

/**
 * Sends to one contact and records the outcome.
 *
 * The order matters more than anything else in this file:
 *
 * 1. claim, so no second worker proceeds
 * 2. refuse the ambiguous case rather than risk a duplicate
 * 3. count the attempt, immediately before the call and nowhere else, so a
 *    crash in the next step is recognisable afterwards
 * 4. send
 * 5. record, in one transaction with the counters
 */
export async function sendToContact(
  deps: SendEngineDeps,
  input: { contactId: string; userId: string },
): Promise<SendOutcome> {
  const client = await deps.pool.connect()

  let contact: SendableContact | null

  try {
    contact = await claimContact(client, input.contactId)
  } finally {
    client.release()
  }

  if (!contact) {
    return { kind: 'skipped', reason: 'not_claimable' }
  }

  if (isAmbiguous(contact)) {
    await recordFailure(deps.pool, contact, UNKNOWN_OUTCOME)
    return { kind: 'ambiguous' }
  }

  const sentToday = await countSentToday(deps.pool, input.userId)

  if (sentToday >= deps.dailyLimit) {
    // The contact keeps its place in the queue: it is the day that is full,
    // not the address that is wrong. The claim is released so tomorrow's plan
    // can take it.
    await releaseClaim(deps.pool, contact.id)
    return { kind: 'paused', reason: 'daily_limit_reached' }
  }

  let accessToken: string

  try {
    accessToken = await deps.getAccessToken(input.userId)
  } catch (err) {
    await releaseClaim(deps.pool, contact.id)

    if (err instanceof ReauthorizationRequiredError) {
      // Not a property of this contact. Failing contacts one at a time would
      // burn the list for a reason unrelated to any of them.
      return { kind: 'paused', reason: 'reauthorization_required' }
    }

    throw err
  }

  let raw: string

  try {
    ;({ raw } = await deps.compose(contact))
  } catch (err) {
    // Nothing reached Gmail yet: the attachment store was down, or the
    // template failed. Released so the retry is not locked out for ten minutes.
    await releaseClaim(deps.pool, contact.id)
    throw err
  }

  // Counted here and nowhere else. Everything after this point may have
  // reached Gmail.
  await deps.pool.query('UPDATE contacts SET attempts = attempts + 1 WHERE id = $1', [
    contact.id,
  ])

  let messageId: string

  try {
    messageId = await deps.gateway.send(accessToken, raw)
  } catch (err) {
    if (err instanceof PermanentSendError) {
      await recordFailure(deps.pool, contact, err.message)
      return { kind: 'failed', reason: err.message }
    }

    if (err instanceof TransientSendError) {
      // Gmail said "not now" in so many words. The claim is released so a
      // retry can take it, and the attempt is rolled back: the message never
      // left.
      await deps.pool.query(
        'UPDATE contacts SET claimed_at = NULL, attempts = attempts - 1 WHERE id = $1',
        [contact.id],
      )
      throw err
    }

    // No answer we can read: a dropped socket, a timeout. The request may have
    // reached Gmail, so this is the ambiguous case, recorded now rather than
    // discovered ten minutes later.
    await recordFailure(deps.pool, contact, UNKNOWN_OUTCOME)
    return { kind: 'ambiguous' }
  }

  await recordSent(deps.pool, contact, messageId)

  return { kind: 'sent', messageId }
}

async function releaseClaim(pool: Pool, contactId: string): Promise<void> {
  await pool.query('UPDATE contacts SET claimed_at = NULL WHERE id = $1', [contactId])
}

/**
 * One transaction: the log, the contact, and the campaign's counter.
 *
 * A count that disagrees with the rows is worse than no count, because it is
 * believed. The unique index on a `sent` log is the last word: if it fires,
 * this contact was already recorded and the transaction is abandoned.
 */
export async function recordSent(
  pool: Pool,
  contact: SendableContact,
  messageId: string,
): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO logs (campaign_id, contact_id, event_type, message)
       VALUES ($1, $2, 'sent', $3)`,
      [contact.campaign_id, contact.id, messageId],
    )

    await client.query(
      `UPDATE contacts SET status = 'sent', sent_at = now(), error_message = NULL
       WHERE id = $1`,
      [contact.id],
    )

    await client.query(
      `UPDATE campaigns
       SET sent_count = (
             SELECT count(*) FROM contacts WHERE campaign_id = $1 AND status = 'sent'
           )
       WHERE id = $1`,
      [contact.campaign_id],
    )

    await completeIfDone(client, contact.campaign_id)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function recordFailure(
  pool: Pool,
  contact: SendableContact,
  reason: string,
): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO logs (campaign_id, contact_id, event_type, message)
       VALUES ($1, $2, 'error', $3)`,
      [contact.campaign_id, contact.id, reason.slice(0, 1000)],
    )

    await client.query(
      `UPDATE contacts SET status = 'failed', error_message = $2, claimed_at = NULL
       WHERE id = $1`,
      [contact.id, reason.slice(0, 500)],
    )

    await client.query(
      `UPDATE campaigns
       SET error_count = (
             SELECT count(*) FROM contacts WHERE campaign_id = $1 AND status = 'failed'
           )
       WHERE id = $1`,
      [contact.campaign_id],
    )

    await completeIfDone(client, contact.campaign_id)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Moves a campaign to completed the moment nothing is left to send.
 *
 * Checked after each outcome rather than on a schedule, so the state is right
 * when it becomes true instead of up to a cron interval later.
 */
export async function completeIfDone(
  client: Pool | PoolClient,
  campaignId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE campaigns
     SET status = 'completed', completed_at = now()
     WHERE id = $1
       AND status = 'running'
       AND NOT EXISTS (
         SELECT 1 FROM contacts WHERE campaign_id = $1 AND status = 'pending'
       )`,
    [campaignId],
  )

  return (rowCount ?? 0) > 0
}

/**
 * Marks a contact failed when only its id is known: a job out of attempts.
 *
 * Only a contact still pending. One that was sent, or already failed through
 * another path, keeps the outcome it has.
 */
export async function recordFailureById(
  pool: Pool,
  contactId: string,
  reason: string,
): Promise<void> {
  const { rows } = await pool.query<SendableContact>(
    `SELECT id, campaign_id, email, contact_name, company_name, salutation, attempts
     FROM contacts WHERE id = $1 AND status = 'pending'`,
    [contactId],
  )
  const contact = rows[0]

  if (contact) {
    await recordFailure(pool, contact, reason)
  }
}

/** Pauses a campaign and says why, without touching its contacts. */
export async function pauseCampaign(
  pool: Pool,
  campaignId: string,
  reason: string,
): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE campaigns SET status = 'paused' WHERE id = $1 AND status = 'running'`,
      [campaignId],
    )

    await client.query(
      `INSERT INTO logs (campaign_id, event_type, message) VALUES ($1, 'error', $2)`,
      [campaignId, reason.slice(0, 1000)],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
