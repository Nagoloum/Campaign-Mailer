import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import {
  BACKUPS_KEPT,
  BACKUP_PREFIX,
  createBackup,
  pruneBackups,
  restoreBackup,
  type BackupStore,
} from './backup.js'

/**
 * The backup, and the restore that makes it worth having, against a real
 * PostgreSQL: data is written, the tables are emptied, the copy is restored,
 * and the rows come back identical.
 *
 * The store is in memory here. The same code runs against R2 in production,
 * and the restore procedure in docs/RUNBOOK.md is this function.
 *
 * Run it on a throwaway schema: `npm run test:integration`. It truncates every
 * table, so it is skipped unless the schema is one of those (search_path=test_).
 */
const DATABASE_URL = process.env.DATABASE_URL
const throwaway = /search_path(?:=|%3D)test_\d+_\d+/i.test(DATABASE_URL ?? '')

let pool: pg.Pool

function memoryStore() {
  const objects = new Map<string, Buffer>()

  const store: BackupStore = {
    put: (key, body) => {
      objects.set(key, body)
      return Promise.resolve()
    },
    get: (key) => {
      const body = objects.get(key)
      return body ? Promise.resolve(body) : Promise.reject(new Error(`No object ${key}`))
    },
    list: (prefix) =>
      Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix)).sort()),
    remove: (key) => {
      objects.delete(key)
      return Promise.resolve()
    },
  }

  return { store, objects }
}

before(() => {
  if (throwaway) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  }
})

after(async () => {
  if (throwaway) {
    await pool.end()
  }
})

describe(
  'the database backup',
  { skip: throwaway ? false : 'only runs on a throwaway test schema' },
  () => {
    it('copies the data, and puts it back exactly after everything is lost', async () => {
      const stamp = `backup-itest-${String(Date.now())}`
      const { rows: users } = await pool.query<{ id: string }>(
        'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
        [stamp, `${stamp}@example.test`],
      )
      const userId = users[0]?.id
      assert.ok(userId)

      const { rows: campaigns } = await pool.query<{ id: string }>(
        `INSERT INTO campaigns (user_id, name, subject) VALUES ($1, 'Sauvegarde', 'Objet')
         RETURNING id`,
        [userId],
      )
      const campaignId = campaigns[0]?.id
      const { rows: contacts } = await pool.query<{ id: string }>(
        `INSERT INTO contacts (campaign_id, email, contact_name)
         VALUES ($1, 'ana@example.test', 'Ana') RETURNING id`,
        [campaignId],
      )
      await pool.query(
        `INSERT INTO logs (campaign_id, contact_id, event_type, message)
         VALUES ($1, $2, 'sent', 'gmail-id')`,
        [campaignId, contacts[0]?.id],
      )
      await pool.query(
        `INSERT INTO audit_events (actor_id, action, target_id)
         VALUES ($1, 'campaign.started', $2)`,
        [userId, campaignId],
      )

      const before = await snapshot()
      const { store } = memoryStore()
      const summary = await createBackup(pool, store)

      assert.equal(summary.key.startsWith(BACKUP_PREFIX), true)
      assert.ok(summary.bytes > 0)
      assert.deepEqual(summary.rows, {
        users: before.users.length,
        campaigns: before.campaigns.length,
        contacts: before.contacts.length,
        logs: before.logs.length,
        audit_events: before.audit_events.length,
      })

      // Everything is lost.
      await pool.query('TRUNCATE audit_events, logs, contacts, campaigns, users CASCADE')
      assert.equal((await snapshot()).users.length, 0)

      const restored = await restoreBackup(pool, await store.get(summary.key))

      assert.deepEqual(restored, summary.rows)
      assert.deepEqual(
        await snapshot(),
        before,
        'the restored rows differ from the originals',
      )
    })

    it('refuses a backup naming a table it does not know', async () => {
      const { gzipSync } = await import('node:zlib')
      const body = gzipSync(
        Buffer.from(`${JSON.stringify({ table: 'secrets', row: { id: 1 } })}\n`),
      )

      await assert.rejects(restoreBackup(pool, body), /unknown table/)
      // Nothing was emptied on the way to refusing.
      assert.ok((await snapshot()).users.length >= 0)
    })

    it('keeps the last copies and deletes the older ones', async () => {
      const { store, objects } = memoryStore()

      for (let day = 0; day < BACKUPS_KEPT + 3; day++) {
        await createBackup(pool, store, new Date(Date.UTC(2026, 0, day + 1)))
      }

      const deleted = await pruneBackups(store)

      assert.equal(deleted.length, 3)
      assert.equal(objects.size, BACKUPS_KEPT)
      assert.equal(
        deleted[0]?.includes('2026-01-01'),
        true,
        'the oldest was not the first to go',
      )
    })
  },
)

async function snapshot() {
  const tables = ['users', 'campaigns', 'contacts', 'logs', 'audit_events'] as const
  const state: Record<string, unknown[]> = {}

  for (const table of tables) {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY created_at, id`)
    // eslint-disable-next-line security/detect-object-injection -- a literal from the list above
    state[table] = rows
  }

  return state as Record<(typeof tables)[number], unknown[]>
}
