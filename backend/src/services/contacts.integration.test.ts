import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import type { ImportedContact } from './contactImport.js'
import { createContactRepository, type ContactRepository } from './contacts.js'

/**
 * The contact repository against a real PostgreSQL.
 *
 * Duplicates are decided by a unique index on the lower-cased address, the
 * campaign's counter is recomputed from the rows, and an import is written in
 * chunks: three behaviours that live in SQL, where a fake would only repeat
 * what the test assumes.
 *
 * Skipped when DATABASE_URL is absent. Rows are removed by their exact Google
 * id, so a file running beside this one keeps its own.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

const googleId = `itest-contacts-${String(Date.now())}-${String(process.pid)}`

let pool: pg.Pool
let contacts: ContactRepository
let campaignId: string
let otherCampaignId: string

const contact = (
  email: string,
  fields: Partial<Omit<ImportedContact, 'email'>> = {},
): ImportedContact => ({
  email,
  contact_name: null,
  company_name: null,
  salutation: null,
  line: 2,
  ...fields,
})

async function totalContacts(id: string): Promise<number> {
  const { rows } = await pool.query<{ total_contacts: number }>(
    'SELECT total_contacts FROM campaigns WHERE id = $1',
    [id],
  )
  return rows[0]?.total_contacts ?? -1
}

before(async () => {
  if (!enabled) {
    return
  }

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  contacts = createContactRepository(pool)

  const { rows: users } = await pool.query<{ id: string }>(
    'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
    [googleId, `${googleId}@example.test`],
  )
  const { rows: campaigns } = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (user_id, name) VALUES ($1, 'Contacts'), ($1, 'Other')
     RETURNING id`,
    [users[0]?.id],
  )
  assert.ok(campaigns[0] && campaigns[1])
  campaignId = campaigns[0].id
  otherCampaignId = campaigns[1].id
})

after(async () => {
  if (!enabled) {
    return
  }

  // The cascade takes the campaigns and the contacts with the account.
  await pool.query('DELETE FROM users WHERE google_id = $1', [googleId])
  await pool.end()
})

describe(
  'the contact repository',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('imports new contacts, skips an address already there in any case, and keeps the counter right', async () => {
      const first = await contacts.insertMany(campaignId, [
        contact('ana@example.test', { contact_name: 'Ana Lopez', company_name: 'Acme' }),
        contact('bob@example.test', { company_name: 'Globex' }),
      ])
      const second = await contacts.insertMany(campaignId, [
        contact('ANA@example.test'),
        contact('cleo@example.test', { contact_name: 'Cléo' }),
      ])

      assert.equal(first, 2)
      assert.equal(second, 1, 'the address differing only by case was imported twice')
      assert.equal(await totalContacts(campaignId), 3)
      assert.deepEqual(
        await contacts.existingEmails(campaignId),
        new Set(['ana@example.test', 'bob@example.test', 'cleo@example.test']),
      )
    })

    it('imports nothing from an empty list', async () => {
      assert.equal(await contacts.insertMany(campaignId, []), 0)
    })

    it('writes an import larger than one statement in full', async () => {
      const many = Array.from({ length: 501 }, (_, index) =>
        contact(`bulk-${String(index)}@example.test`),
      )

      assert.equal(await contacts.insertMany(otherCampaignId, many), 501)
      assert.equal(await totalContacts(otherCampaignId), 501)
    })

    it('searches an address, a name or a company, in any case, within one campaign', async () => {
      const search = async (term: string) =>
        (
          await contacts.list(campaignId, { search: term, limit: 10, offset: 0 })
        ).contacts.map((row) => row.email)

      assert.deepEqual(await search('LOPEZ'), ['ana@example.test'])
      assert.deepEqual(await search('globex'), ['bob@example.test'])
      assert.deepEqual(await search('cleo@'), ['cleo@example.test'])
      assert.deepEqual(
        await search('bulk-1'),
        [],
        'another campaign leaked into the search',
      )
    })

    it('pages through the contacts with the total of the whole list', async () => {
      const firstPage = await contacts.list(campaignId, { limit: 2, offset: 0 })
      const secondPage = await contacts.list(campaignId, { limit: 2, offset: 2 })

      assert.equal(firstPage.total, 3)
      assert.equal(firstPage.contacts.length, 2)
      assert.equal(secondPage.contacts.length, 1)
      assert.equal(
        new Set([...firstPage.contacts, ...secondPage.contacts].map((row) => row.id))
          .size,
        3,
      )
    })

    it('changes a status within its own campaign only, and filters by it', async () => {
      const {
        contacts: [bob],
      } = await contacts.list(campaignId, {
        search: 'bob@',
        limit: 1,
        offset: 0,
      })
      assert.ok(bob)

      assert.equal(
        await contacts.update(otherCampaignId, bob.id, { status: 'ignored' }),
        null,
      )
      assert.equal(await contacts.update(campaignId, bob.id, {}), null)
      assert.equal(
        (await contacts.update(campaignId, bob.id, { status: 'ignored' }))?.status,
        'ignored',
      )

      const ignored = await contacts.list(campaignId, {
        status: 'ignored',
        limit: 10,
        offset: 0,
      })
      assert.deepEqual(
        { total: ignored.total, emails: ignored.contacts.map((row) => row.email) },
        { total: 1, emails: ['bob@example.test'] },
      )
    })

    it('adds one contact, refuses a duplicate, and counts only what was added', async () => {
      const added = await contacts.add(campaignId, contact('dan@example.test'))

      assert.equal(added?.email, 'dan@example.test')
      assert.equal(added.status, 'pending')
      assert.equal(await contacts.add(campaignId, contact('DAN@example.test')), null)
      assert.equal(await totalContacts(campaignId), 4)
    })

    it('removes a contact from its own campaign only, and counts it', async () => {
      const {
        contacts: [dan],
      } = await contacts.list(campaignId, {
        search: 'dan@',
        limit: 1,
        offset: 0,
      })
      assert.ok(dan)

      assert.equal(await contacts.remove(otherCampaignId, dan.id), false)
      assert.equal(await contacts.remove(campaignId, dan.id), true)
      assert.equal(await contacts.remove(campaignId, dan.id), false)
      assert.equal(await totalContacts(campaignId), 3)
    })
  },
)
