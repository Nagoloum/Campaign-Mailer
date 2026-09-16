import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { TARGETS, meetsTargets, readSuccessMetrics } from './metrics.js'

/**
 * The success criteria, measured against a real PostgreSQL.
 *
 * Everything happens inside one transaction that is rolled back, so the rows
 * this file counts are its own even while other test files write beside it,
 * and nothing is left behind.
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

describe(
  'the success metrics',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('counts the send error rate, and the delay to a first launch', async () => {
      const client = await pool.connect()

      try {
        // Emptying the tables inside the transaction holds the lock until the
        // rollback: a test file running beside this one waits its turn rather
        // than adding rows to these counts. The default isolation level, not
        // REPEATABLE READ, which refuses a truncate raced by another writer.
        //
        // Locked in the same order as backup.integration.test.ts. Two
        // transactions taking the same locks in opposite orders deadlock, and
        // PostgreSQL resolves that by killing one of them.
        await client.query('BEGIN')
        await client.query(
          'LOCK TABLE users, campaigns, contacts, logs, audit_events IN ACCESS EXCLUSIVE MODE',
        )
        await client.query(
          'TRUNCATE audit_events, logs, contacts, campaigns, users CASCADE',
        )

        const stamp = `metrics-itest-${String(Date.now())}`
        const { rows: users } = await client.query<{ id: string }>(
          `INSERT INTO users (google_id, email, created_at)
           VALUES ($1, $2, now() - interval '10 minutes') RETURNING id`,
          [stamp, `${stamp}@example.test`],
        )
        const userId = users[0]?.id
        const { rows: campaigns } = await client.query<{ id: string }>(
          `INSERT INTO campaigns (user_id, name, status) VALUES ($1, 'Mesures', 'running')
           RETURNING id`,
          [userId],
        )
        const campaignId = campaigns[0]?.id
        const { rows: contacts } = await client.query<{ id: string }>(
          `INSERT INTO contacts (campaign_id, email)
           VALUES ($1, 'a@example.test'), ($1, 'b@example.test'), ($1, 'c@example.test')
           RETURNING id`,
          [campaignId],
        )

        // Six minutes from the account to its first launch: over the five the
        // specification asks for.
        await client.query(
          `INSERT INTO audit_events (actor_id, action, target_id, created_at)
           VALUES ($1, 'campaign.started', $2, now() - interval '4 minutes')`,
          [userId, campaignId],
        )

        await client.query(
          `INSERT INTO logs (campaign_id, contact_id, event_type, message) VALUES
             ($1, $2, 'sent',  'id-1'),
             ($1, $3, 'sent',  'id-2'),
             ($1, $4, 'error', 'refused'),
             ($1, NULL, 'error', 'campaign paused')`,
          [campaignId, contacts[0]?.id, contacts[1]?.id, contacts[2]?.id],
        )

        const metrics = await readSuccessMetrics(client as unknown as pg.Pool)

        // The campaign-level row has no contact and is not a send.
        assert.deepEqual(metrics.last24h, { sent: 2, failed: 1, errorRate: 1 / 3 })
        assert.deepEqual(metrics.last7d, metrics.last24h)
        assert.equal(metrics.accounts, 1)
        assert.deepEqual(metrics.campaigns, { running: 1 })
        assert.equal(metrics.timeToFirstLaunch.accounts, 1)
        assert.equal(metrics.timeToFirstLaunch.medianSeconds, 6 * 60)

        assert.deepEqual(meetsTargets(metrics), { errorRate: false, firstLaunch: false })
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    })

    it('reports no data rather than a flattering zero on an empty account', async () => {
      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        await client.query(
          'LOCK TABLE users, campaigns, contacts, logs, audit_events IN ACCESS EXCLUSIVE MODE',
        )
        await client.query(
          'TRUNCATE audit_events, logs, contacts, campaigns, users CASCADE',
        )

        const metrics = await readSuccessMetrics(client as unknown as pg.Pool)

        assert.equal(metrics.last7d.errorRate, null)
        assert.equal(metrics.timeToFirstLaunch.medianSeconds, null)
        assert.deepEqual(meetsTargets(metrics), { errorRate: null, firstLaunch: null })
        assert.equal(TARGETS.errorRate, 0.02)
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    })
  },
)
