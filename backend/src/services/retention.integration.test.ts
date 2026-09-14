import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { purgeExpired } from './retention.js'

const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let campaignId: string
const actor = crypto.randomUUID()
const stamp = Date.now()

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })

  const user = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`retention-itest-${String(stamp)}`, `retention-${String(stamp)}@example.test`],
  )
  const campaign = await pool.query<{ id: string }>(
    "INSERT INTO campaigns (user_id, name) VALUES ($1, 'Rétention') RETURNING id",
    [user.rows[0]?.id],
  )
  const created = campaign.rows[0]
  assert.ok(created)
  campaignId = created.id

  for (const [message, age] of [
    ['thirteen-months', '13 months'],
    ['eleven-months', '11 months'],
    ['today', '0 days'],
  ] as const) {
    await pool.query(
      `INSERT INTO logs (campaign_id, event_type, message, created_at)
       VALUES ($1, 'error', $2, now() - $3::interval)`,
      [campaignId, message, age],
    )
    await pool.query(
      `INSERT INTO audit_events (actor_id, action, target_id, created_at)
       VALUES ($1, 'campaign.started', $2, now() - $3::interval)`,
      [actor, campaignId, age],
    )
  }
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query('DELETE FROM audit_events WHERE actor_id = $1', [actor])
  await pool.query("DELETE FROM users WHERE google_id LIKE 'retention-itest-%'")
  await pool.end()
})

describe(
  'the retention purge',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('removes send logs and audit events older than twelve months, and only those', async () => {
      const report = await purgeExpired(pool)

      assert.ok(report.logs >= 1)
      assert.ok(report.auditEvents >= 1)

      const logs = await pool.query<{ message: string }>(
        'SELECT message FROM logs WHERE campaign_id = $1 ORDER BY created_at',
        [campaignId],
      )
      assert.deepEqual(
        logs.rows.map((row) => row.message),
        ['eleven-months', 'today'],
      )

      const audit = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM audit_events WHERE actor_id = $1',
        [actor],
      )
      assert.equal(audit.rows[0]?.n, '2')
    })

    it('finds nothing more to remove when run again', async () => {
      const report = await purgeExpired(pool)

      const mine = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM logs WHERE campaign_id = $1',
        [campaignId],
      )
      assert.equal(mine.rows[0]?.n, '2')
      assert.equal(report.logs, 0)
    })
  },
)
