import { gunzipSync } from 'node:zlib'

import { closePool, pool } from '../db/pool.js'
import {
  BACKUP_PREFIX,
  createBackup,
  pruneBackups,
  restoreBackup,
  type BackupStore,
} from '../services/backup.js'
import { deleteObject, getObject, listKeys, putObject } from '../services/storage.js'

/**
 * The backups, by hand: what the runbook's restore procedure runs.
 *
 * Usage, from backend/:
 *   tsx src/scripts/backup.ts list
 *   tsx src/scripts/backup.ts inspect <key>
 *   tsx src/scripts/backup.ts restore <key> --yes
 *   tsx src/scripts/backup.ts create
 *
 * It acts on the database in DATABASE_URL and the bucket in S3_BUCKET, so the
 * environment decides which one; restoring asks for --yes because it replaces
 * every row of the five tables.
 */

const store: BackupStore = {
  put: putObject,
  get: getObject,
  list: listKeys,
  remove: deleteObject,
}

function countRows(body: Buffer): Record<string, number> {
  // A Map, not an object: the table name comes from the file being inspected.
  const counts = new Map<string, number>()

  for (const line of gunzipSync(body).toString('utf8').split('\n')) {
    if (line === '') {
      continue
    }
    const { table } = JSON.parse(line) as { table: string }
    counts.set(table, (counts.get(table) ?? 0) + 1)
  }

  return Object.fromEntries(counts)
}

async function main(): Promise<void> {
  const [command, key] = process.argv.slice(2)
  const confirmed = process.argv.includes('--yes')

  if (command === 'list') {
    const keys = await store.list(BACKUP_PREFIX)
    console.log(keys.length === 0 ? 'No backup yet.' : keys.join('\n'))
    return
  }

  if (command === 'create') {
    const summary = await createBackup(pool, store)
    console.log(`Written ${summary.key} (${String(summary.bytes)} bytes)`)
    console.table(summary.rows)
    const pruned = await pruneBackups(store)
    console.log(`Old copies deleted: ${String(pruned.length)}`)
    return
  }

  if (!key) {
    throw new Error('Usage: backup.ts <list|create|inspect <key>|restore <key> --yes>')
  }

  if (command === 'inspect') {
    console.table(countRows(await store.get(key)))
    return
  }

  if (command === 'restore') {
    if (!confirmed) {
      throw new Error(
        `Restoring ${key} replaces every row of the five tables. Add --yes to confirm.`,
      )
    }

    const restored = await restoreBackup(pool, await store.get(key))
    console.log(`Restored ${key}`)
    console.table(restored)
    return
  }

  throw new Error(`Unknown command: ${String(command)}`)
}

try {
  await main()
} finally {
  await closePool()
}
