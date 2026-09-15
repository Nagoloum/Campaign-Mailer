import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { readSendCounts } from './alerts.js'

/**
 * The error rate query against a real PostgreSQL.
 *
 * The count is global, and other test files write logs at the same time. So
 * everything happens inside one REPEATABLE READ transaction that is rolled
 * back: the snapshot hides every other writer, the difference between the
 * count before and after this file's inserts is exact, and nothing is left in
 * the database.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool

before(() => {
  if (enabled) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 })
  }
})

after(async () => {
  if (enabled) {
    await pool.end()
  }
})

describe('readSendCounts', { skip: enabled ? false : 'DATABASE_URL is not set' }, () => {
  it('counts the last hour of sends and refusals, not pauses and not older rows', async () => {
    const client = await pool.connect()

    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      const asPool = client as unknown as pg.Pool
      const before = await readSendCounts(asPool)

      const stamp = `itest-alerts-${String(Date.now())}-${String(process.pid)}`
      const { rows: users } = await client.query<{ id: string }>(
        'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
        [stamp, `${stamp}@example.test`],
      )
      const { rows: campaigns } = await client.query<{ id: string }>(
        'INSERT INTO campaigns (user_id, name) VALUES ($1, $2) RETURNING id',
        [users[0]?.id, 'Alerts'],
      )
      const campaignId = campaigns[0]?.id
      const { rows: contacts } = await client.query<{ id: string }>(
        `INSERT INTO contacts (campaign_id, email)
           VALUES ($1, 'a@example.test'), ($1, 'b@example.test'), ($1, 'c@example.test')
           RETURNING id`,
        [campaignId],
      )
      const [sent, refused, old] = contacts.map((row) => row.id)

      await client.query(
        `INSERT INTO logs (campaign_id, contact_id, event_type, message, created_at) VALUES
             ($1, $2, 'sent',  'id-1',    now()),
             ($1, $3, 'error', 'refused', now()),
             ($1, $3, 'error', 'refused', now()),
             ($1, $4, 'sent',  'id-old',  now() - interval '2 hours'),
             ($1, NULL, 'error', 'campaign paused', now())`,
        [campaignId, sent, refused, old],
      )

      const afterInsert = await readSendCounts(asPool)

      assert.deepEqual(
        {
          sent: afterInsert.sent - before.sent,
          errors: afterInsert.errors - before.errors,
        },
        { sent: 1, errors: 2 },
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
