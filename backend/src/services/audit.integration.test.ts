import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createAuditLog } from './audit.js'

const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
const actors: string[] = []

const newActor = () => {
  const id = crypto.randomUUID()
  actors.push(id)
  return id
}

before(() => {
  if (enabled) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  }
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query('DELETE FROM audit_events WHERE actor_id = ANY($1::uuid[])', [actors])
  await pool.end()
})

describe('the audit log', { skip: enabled ? false : 'DATABASE_URL is not set' }, () => {
  it('records who did what to which campaign', async () => {
    const actor = newActor()
    const campaign = crypto.randomUUID()

    await createAuditLog(pool).record(actor, 'campaign.started', campaign)

    const { rows } = await pool.query<{ action: string; target_id: string }>(
      'SELECT action, target_id FROM audit_events WHERE actor_id = $1',
      [actor],
    )
    assert.deepEqual(rows, [{ action: 'campaign.started', target_id: campaign }])
  })

  it('keeps the record of a deletion without any account to point at', async () => {
    // No user row exists for this id, as after a deletion: no foreign key
    // refuses it.
    const actor = newActor()

    await createAuditLog(pool).record(actor, 'account.deleted')

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE actor_id = $1 AND action = 'account.deleted'",
      [actor],
    )
    assert.equal(rows[0]?.n, '1')
  })

  it('refuses an action outside the fixed list, at the database', async () => {
    await assert.rejects(
      pool.query(
        "INSERT INTO audit_events (actor_id, action) VALUES ($1, 'account.hacked')",
        [newActor()],
      ),
    )
  })

  it('never throws, even when the row cannot be written', async () => {
    const broken = {
      query: () => Promise.reject(new Error('database unreachable')),
    } as unknown as pg.Pool

    await assert.doesNotReject(
      createAuditLog(broken).record(newActor(), 'campaign.paused'),
    )
  })
})
