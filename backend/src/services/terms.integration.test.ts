import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createAuditLog } from './audit.js'
import { CURRENT_TERMS_VERSION, createTermsRepository } from './terms.js'
import { createUserRepository } from './users.js'

const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let userId: string
const stamp = Date.now()

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [`terms-itest-${String(stamp)}`, `terms-${String(stamp)}@example.test`],
  )
  const created = rows[0]
  assert.ok(created)
  userId = created.id
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query('DELETE FROM audit_events WHERE actor_id = $1', [userId])
  await pool.query("DELETE FROM users WHERE google_id LIKE 'terms-itest-%'")
  await pool.end()
})

describe(
  'accepting the terms',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('starts with no version accepted', async () => {
      const user = await createUserRepository(pool).findById(userId)
      assert.equal(user?.terms_version, null)
    })

    it('stores the version and when, and the session row carries it', async () => {
      await createTermsRepository(pool).accept(userId, CURRENT_TERMS_VERSION)

      const user = await createUserRepository(pool).findById(userId)
      assert.equal(user?.terms_version, CURRENT_TERMS_VERSION)

      const { rows } = await pool.query<{ terms_accepted_at: Date | null }>(
        'SELECT terms_accepted_at FROM users WHERE id = $1',
        [userId],
      )
      assert.ok(rows[0]?.terms_accepted_at instanceof Date)
    })

    it('lets the audit log keep the proof of acceptance', async () => {
      await createAuditLog(pool).record(userId, 'terms.accepted')

      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE actor_id = $1 AND action = 'terms.accepted'",
        [userId],
      )
      assert.equal(rows[0]?.n, '1')
    })
  },
)
