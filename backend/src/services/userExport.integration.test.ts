import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import { createTokenCipher } from './encryption.js'
import { buildUserExport, contactsToCsv } from './userExport.js'

/**
 * The right of access, against the real database: everything held about the
 * user is in the export, nothing belonging to anyone else is, and no credential
 * leaves in a file.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

let pool: pg.Pool
let userId: string
let otherUserId: string
const stamp = Date.now()
const cipher = createTokenCipher(crypto.randomBytes(32).toString('hex'))
const storedTokens: string[] = []

async function seedUser(tag: string): Promise<string> {
  const access = cipher.encrypt(`access-${tag}`)
  const refresh = cipher.encrypt(`refresh-${tag}`)
  storedTokens.push(access, refresh)

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (google_id, email, google_access_token, google_refresh_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`export-itest-${tag}`, `export-${tag}@example.test`, access, refresh],
  )
  const id = rows[0]?.id
  assert.ok(id)
  return id
}

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  userId = await seedUser(`${String(stamp)}-me`)
  otherUserId = await seedUser(`${String(stamp)}-other`)

  const campaign = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name, subject, body_html)
     VALUES ($1, 'Candidatures', 'Bonjour {{contact_name}}', '<p>Bonjour</p>') RETURNING id`,
    [userId],
  )
  const campaignId = campaign.rows[0]?.id
  assert.ok(campaignId)

  const contact = await pool.query<{ id: string }>(
    `INSERT INTO contacts (campaign_id, email, contact_name, status)
     VALUES ($1, '=cmd@exemple.fr', 'Zoé', 'sent') RETURNING id`,
    [campaignId],
  )
  await pool.query(
    "INSERT INTO logs (campaign_id, contact_id, event_type, message) VALUES ($1, $2, 'sent', 'msg-1')",
    [campaignId, contact.rows[0]?.id],
  )

  await pool.query(
    "INSERT INTO campaigns (user_id, name) VALUES ($1, 'Celle d’un autre')",
    [otherUserId],
  )
})

after(async () => {
  if (!enabled) {
    return
  }
  await pool.query("DELETE FROM users WHERE google_id LIKE 'export-itest-%'")
  await pool.end()
})

describe(
  'exporting a user’s data',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('holds the account, the campaigns, the contacts and the logs', async () => {
      const data = await buildUserExport(pool, userId)
      assert.ok(data)

      assert.equal(data.account.email, `export-${String(stamp)}-me@example.test`)
      assert.equal(data.campaigns.length, 1)

      const [campaign] = data.campaigns
      assert.ok(campaign)
      assert.equal(campaign.name, 'Candidatures')
      assert.equal(campaign.subject, 'Bonjour {{contact_name}}')
      assert.deepEqual(
        campaign.contacts.map((c) => [c.email, c.contactName, c.status]),
        [['=cmd@exemple.fr', 'Zoé', 'sent']],
      )
      assert.deepEqual(
        campaign.logs.map((l) => [l.event, l.contactEmail, l.message]),
        [['sent', '=cmd@exemple.fr', 'msg-1']],
      )
    })

    it('holds nothing that belongs to another user', async () => {
      const data = await buildUserExport(pool, userId)

      assert.ok(!JSON.stringify(data).includes('Celle d’un autre'))
    })

    it('never carries a Google token, not even encrypted', async () => {
      const serialised = JSON.stringify(await buildUserExport(pool, userId))

      for (const token of storedTokens) {
        assert.ok(!serialised.includes(token), 'an encrypted token reached the export')
      }
      assert.ok(!/access-|refresh-/.test(serialised))
    })

    it('returns nothing for an account that does not exist', async () => {
      assert.equal(await buildUserExport(pool, crypto.randomUUID()), null)
    })

    it('writes the contacts as a CSV a spreadsheet will not execute', async () => {
      const data = await buildUserExport(pool, userId)
      assert.ok(data)

      const csv = contactsToCsv(data)

      assert.ok(csv.startsWith('\uFEFF"campagne","adresse"'))
      assert.ok(csv.includes(`"Candidatures","'=cmd@exemple.fr","Zoé"`), csv)
    })
  },
)
