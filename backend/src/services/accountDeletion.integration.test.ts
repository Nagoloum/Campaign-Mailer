import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { deleteAccount, type AccountDeletionDeps } from './accountDeletion.js'
import { createTokenCipher } from './encryption.js'

/**
 * The Phase 6 definition of done, checked by query: after deletion, no row in
 * any table is attached to the user.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
const stamp = Date.now()
let counter = 0
const cipher = createTokenCipher(crypto.randomBytes(32).toString('hex'))

interface Seeded {
  userId: string
  campaignIds: string[]
}

async function seedAccount(refreshToken: string | null): Promise<Seeded> {
  counter += 1
  const tag = `${String(stamp)}-${String(counter)}`

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email, google_access_token, google_refresh_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      `deletion-itest-${tag}`,
      `deletion-${tag}@example.test`,
      cipher.encrypt('access-token-value'),
      refreshToken === null ? null : cipher.encrypt(refreshToken),
    ],
  )
  const userId = user.rows[0]?.id
  assert.ok(userId)

  const campaignIds: string[] = []

  for (const name of ['Une', 'Deux']) {
    const campaign = await pool.query<{ id: string }>(
      'INSERT INTO campaigns (user_id, name) VALUES ($1, $2) RETURNING id',
      [userId, name],
    )
    const campaignId = campaign.rows[0]?.id
    assert.ok(campaignId)
    campaignIds.push(campaignId)

    const contact = await pool.query<{ id: string }>(
      "INSERT INTO contacts (campaign_id, email, status) VALUES ($1, $2, 'sent') RETURNING id",
      [campaignId, `c-${name}@exemple.fr`],
    )
    await pool.query(
      "INSERT INTO logs (campaign_id, contact_id, event_type) VALUES ($1, $2, 'sent')",
      [campaignId, contact.rows[0]?.id],
    )
  }

  return { userId, campaignIds }
}

/** Every row, in every table, that still belongs to the user. */
async function remainingRows({ userId, campaignIds }: Seeded): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM users WHERE id = $1)
          + (SELECT count(*) FROM campaigns WHERE user_id = $1 OR id = ANY($2::uuid[]))
          + (SELECT count(*) FROM contacts WHERE campaign_id = ANY($2::uuid[]))
          + (SELECT count(*) FROM logs WHERE campaign_id = ANY($2::uuid[])) AS n`,
    [userId, campaignIds],
  )
  return Number(rows[0]?.n)
}

function deps(overrides: Partial<AccountDeletionDeps> = {}) {
  const revoked: string[] = []
  const purged: string[] = []
  const logged: string[] = []

  const built: AccountDeletionDeps = {
    pool,
    cipher,
    revokeGoogleToken: (token) => {
      revoked.push(token)
      return Promise.resolve()
    },
    deleteCampaignFiles: (campaignId) => {
      purged.push(campaignId)
      return Promise.resolve()
    },
    log: (message) => {
      logged.push(message)
    },
    ...overrides,
  }

  return { built, revoked, purged, logged }
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
  await pool.query("DELETE FROM users WHERE google_id LIKE 'deletion-itest-%'")
  await pool.end()
})

describe(
  'deleting an account',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('leaves no row attached to the user in any table', async () => {
      const seeded = await seedAccount('refresh-token-value')
      assert.ok((await remainingRows(seeded)) > 0)

      const { built } = deps()
      const report = await deleteAccount(built, seeded.userId)

      assert.deepEqual(report, { deleted: true, googleRevoked: true, filesPurged: true })
      assert.equal(await remainingRows(seeded), 0)
    })

    it('revokes the grant with the decrypted refresh token', async () => {
      const seeded = await seedAccount('refresh-token-value')
      const { built, revoked } = deps()

      await deleteAccount(built, seeded.userId)

      assert.deepEqual(revoked, ['refresh-token-value'])
    })

    it('falls back to the access token when no refresh token was stored', async () => {
      const seeded = await seedAccount(null)
      const { built, revoked } = deps()

      await deleteAccount(built, seeded.userId)

      assert.deepEqual(revoked, ['access-token-value'])
    })

    it('purges the files of every campaign', async () => {
      const seeded = await seedAccount('refresh-token-value')
      const { built, purged } = deps()

      await deleteAccount(built, seeded.userId)

      assert.deepEqual([...purged].sort(), [...seeded.campaignIds].sort())
    })

    it('deletes the data even when Google refuses the revocation, and says so', async () => {
      const seeded = await seedAccount('refresh-token-value')
      const { built, logged } = deps({
        revokeGoogleToken: () =>
          Promise.reject(new Error('Google revocation answered 503')),
      })

      const report = await deleteAccount(built, seeded.userId)

      assert.equal(report.deleted, true)
      assert.equal(report.googleRevoked, false)
      assert.equal(await remainingRows(seeded), 0)
      assert.equal(logged.length, 1)
    })

    it('never writes the token into the log when revocation fails', async () => {
      const seeded = await seedAccount('refresh-token-value')
      const details: string[] = []
      const { built } = deps({
        revokeGoogleToken: () => Promise.reject(new Error('socket hang up')),
        log: (message, detail) => {
          details.push(message, JSON.stringify(detail))
        },
      })

      await deleteAccount(built, seeded.userId)

      assert.ok(!details.join(' ').includes('refresh-token-value'))
    })

    it('deletes the data even when the storage purge fails, and says so', async () => {
      const seeded = await seedAccount('refresh-token-value')
      const { built } = deps({
        deleteCampaignFiles: () => Promise.reject(new Error('R2 unreachable')),
      })

      const report = await deleteAccount(built, seeded.userId)

      assert.equal(report.filesPurged, false)
      assert.equal(await remainingRows(seeded), 0)
    })

    it('reports nothing deleted for an account that is already gone', async () => {
      const { built, revoked } = deps()

      const report = await deleteAccount(built, crypto.randomUUID())

      assert.deepEqual(report, {
        deleted: false,
        googleRevoked: false,
        filesPurged: false,
      })
      assert.deepEqual(revoked, [])
    })
  },
)
