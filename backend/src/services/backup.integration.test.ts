import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import {
  BACKED_UP_TABLES,
  BACKUPS_KEPT,
  BACKUP_PREFIX,
  createBackup,
  pruneBackups,
  restoreBackup,
  type BackupStore,
} from './backup.js'

/**
 * The backup, and the restore that makes it worth having, against a real
 * PostgreSQL: data is written, every table is emptied, the copy is restored,
 * and the rows come back identical.
 *
 * All of it inside one transaction that locks the five tables and is rolled
 * back at the end. Emptying tables shared with the test files running beside
 * this one would take their rows away mid-test; holding the lock makes them
 * wait a couple of seconds instead, and leaves the schema as it was found.
 *
 * The store is in memory here. The same code runs against R2 in production,
 * and the restore procedure in docs/RUNBOOK.md calls the same function.
 */
const DATABASE_URL = process.env.DATABASE_URL
const enabled = Boolean(DATABASE_URL)

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

/** Runs the body in a transaction that owns the five tables, then undoes it. */
async function exclusively<T>(body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(
      `LOCK TABLE ${BACKED_UP_TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE`,
    )
    return await body(client)
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}

async function snapshot(client: pg.PoolClient) {
  const state: Record<string, unknown[]> = {}

  for (const table of BACKED_UP_TABLES) {
    const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY created_at, id`)
    // eslint-disable-next-line security/detect-object-injection -- a literal from BACKED_UP_TABLES
    state[table] = rows
  }

  return state
}

before(() => {
  if (enabled) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 })
  }
})

after(async () => {
  if (enabled) {
    await pool.end()
  }
})

describe(
  'the database backup',
  { skip: enabled ? false : 'DATABASE_URL is not set' },
  () => {
    it('copies the data, and puts it back exactly after everything is lost', async () => {
      await exclusively(async (client) => {
        const stamp = `backup-itest-${String(Date.now())}`
        const { rows: users } = await client.query<{ id: string }>(
          'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
          [stamp, `${stamp}@example.test`],
        )
        const userId = users[0]?.id
        assert.ok(userId)

        const { rows: campaigns } = await client.query<{ id: string }>(
          `INSERT INTO campaigns (user_id, name, subject) VALUES ($1, 'Sauvegarde', 'Objet')
           RETURNING id`,
          [userId],
        )
        const campaignId = campaigns[0]?.id
        const { rows: contacts } = await client.query<{ id: string }>(
          `INSERT INTO contacts (campaign_id, email, contact_name)
           VALUES ($1, 'ana@example.test', 'Ana') RETURNING id`,
          [campaignId],
        )
        await client.query(
          `INSERT INTO logs (campaign_id, contact_id, event_type, message)
           VALUES ($1, $2, 'sent', 'gmail-id')`,
          [campaignId, contacts[0]?.id],
        )
        await client.query(
          `INSERT INTO audit_events (actor_id, action, target_id)
           VALUES ($1, 'campaign.started', $2)`,
          [userId, campaignId],
        )

        const before = await snapshot(client)
        const { store } = memoryStore()
        const summary = await createBackup(client, store)

        assert.equal(summary.key.startsWith(BACKUP_PREFIX), true)
        assert.ok(summary.bytes > 0)
        assert.equal(summary.rows.users, before.users?.length)
        assert.equal(summary.rows.logs, before.logs?.length)

        // Everything is lost.
        await client.query(
          'TRUNCATE audit_events, logs, contacts, campaigns, users CASCADE',
        )
        assert.equal((await snapshot(client)).users?.length, 0)

        const restored = await restoreBackup(client, await store.get(summary.key))

        assert.deepEqual(restored, summary.rows)
        assert.deepEqual(
          await snapshot(client),
          before,
          'the restored rows differ from the originals',
        )
      })
    })

    it('refuses a backup naming a table it does not know, before emptying anything', async () => {
      await exclusively(async (client) => {
        const before = await snapshot(client)
        const body = gzipSync(
          Buffer.from(`${JSON.stringify({ table: 'secrets', row: { id: 1 } })}\n`),
        )

        await assert.rejects(restoreBackup(client, body), /unknown table/)
        assert.deepEqual(await snapshot(client), before)
      })
    })

    it('keeps the last copies and deletes the older ones', async () => {
      await exclusively(async (client) => {
        const { store, objects } = memoryStore()

        for (let day = 0; day < BACKUPS_KEPT + 3; day++) {
          await createBackup(client, store, new Date(Date.UTC(2026, 0, day + 1)))
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
    })
  },
)
