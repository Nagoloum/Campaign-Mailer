import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createTokenCipher } from './encryption.js'
import { reencryptTokens } from './keyRotation.js'

const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

const OLD = crypto.randomBytes(32).toString('hex')
const NEW = crypto.randomBytes(32).toString('hex')
const oldCipher = createTokenCipher(OLD)
const newOnly = createTokenCipher(NEW)
const withPrevious = createTokenCipher(NEW, [OLD])

let pool: pg.Pool
const stamp = Date.now()
const ids = new Map<string, string>()

async function seed(tag: string, access: string | null, refresh: string | null) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email, google_access_token, google_refresh_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      `rotation-itest-${String(stamp)}-${tag}`,
      `rotation-${String(stamp)}-${tag}@example.test`,
      access,
      refresh,
    ],
  )
  const id = rows[0]?.id
  assert.ok(id)
  ids.set(tag, id)
}

async function tokensOf(tag: string) {
  const { rows } = await pool.query<{
    google_access_token: string | null
    google_refresh_token: string | null
  }>('SELECT google_access_token, google_refresh_token FROM users WHERE id = $1', [
    ids.get(tag),
  ])
  const row = rows[0]
  assert.ok(row)
  return row
}

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })

  await seed('old', oldCipher.encrypt('access-old'), oldCipher.encrypt('refresh-old'))
  await seed('current', newOnly.encrypt('access-current'), null)
  await seed(
    'foreign',
    createTokenCipher(crypto.randomBytes(32).toString('hex')).encrypt('x'),
    null,
  )
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query("DELETE FROM users WHERE google_id LIKE 'rotation-itest-%'")
  await pool.end()
})

describe(
  're-encrypting stored tokens',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('rewrites tokens under the new key, readable without the old one', async () => {
      const report = await reencryptTokens(pool, newOnly, withPrevious)

      // The shared development database holds other accounts too, encrypted
      // under the real key, which these test keys cannot read: only lower bounds.
      assert.ok(report.reencrypted >= 2)
      assert.ok(report.alreadyCurrent >= 1)
      assert.ok(report.unreadable >= 1)

      const rotated = await tokensOf('old')
      assert.ok(rotated.google_access_token && rotated.google_refresh_token)
      assert.equal(newOnly.decrypt(rotated.google_access_token), 'access-old')
      assert.equal(newOnly.decrypt(rotated.google_refresh_token), 'refresh-old')
    })

    it('leaves a token already under the new key as it was', async () => {
      const before = await tokensOf('current')
      await reencryptTokens(pool, newOnly, withPrevious)

      assert.deepEqual(await tokensOf('current'), before)
    })

    it('leaves a token no key can read untouched, rather than destroy it', async () => {
      const before = await tokensOf('foreign')
      await reencryptTokens(pool, newOnly, withPrevious)

      assert.deepEqual(await tokensOf('foreign'), before)
    })

    it('finds nothing left to rotate on a second run', async () => {
      await reencryptTokens(pool, newOnly, withPrevious)
      const again = await tokensOf('old')
      const report = await reencryptTokens(pool, newOnly, withPrevious)

      assert.deepEqual(await tokensOf('old'), again)
      assert.equal(typeof report.users, 'number')
    })
  },
)
