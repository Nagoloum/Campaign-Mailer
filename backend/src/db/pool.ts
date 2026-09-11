import pg from 'pg'

import { env } from '../config/env.js'

/**
 * The connection pool the API and the workers share within a process.
 *
 * DATABASE_URL is the pooled Neon host, the one whose name carries `-pooler`.
 * Migrations use DATABASE_DIRECT_URL instead; see scripts/migrate.mjs.
 *
 * Neon's free plan suspends the compute after five minutes idle, so the first
 * query after a quiet spell pays a cold start. That is a development
 * characteristic, not a bug to work around here.
 */
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  // Well under Neon's own ceiling, and the API and the worker each open their
  // own pool.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (err) => {
  // An idle client failing is not fatal: the pool discards it and opens
  // another. Logging it keeps a recurring network problem visible.
  console.error('Idle database client error', err)
})

export async function closePool(): Promise<void> {
  await pool.end()
}
