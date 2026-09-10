// Wrapper around the node-pg-migrate CLI.
//
// Two things it exists for.
//
// First, loading .env. node-pg-migrate 9 accepts --envPath but no longer ships
// dotenv, so the flag is silently inert and the CLI reports the variable as
// unset. Node's own loader does the job with no extra dependency.
//
// Second, refusing to run against the pooled connection. Migrations must use
// DATABASE_DIRECT_URL: the pooler runs in transaction mode and does not carry
// the session-level statements a migration issues. Pointed at the pooled host,
// a migration fails in a way that reads as a SQL problem rather than a
// connection one.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const ENV_FILE = '.env'

if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE)
}

const url = process.env.DATABASE_DIRECT_URL

if (!url) {
  console.error(
    `DATABASE_DIRECT_URL is not set.\n` +
      `Copy backend/.env.example to backend/.env and fill in the Neon direct\n` +
      `connection string, the one whose host does not carry "-pooler".`,
  )
  process.exit(1)
}

if (url.includes('-pooler.')) {
  console.error(
    `DATABASE_DIRECT_URL points at the pooled host.\n` +
      `Migrations need the direct connection: take the Neon connection string\n` +
      `whose host has no "-pooler" segment. DATABASE_URL keeps the pooled one.`,
  )
  process.exit(1)
}

// Resolve the CLI through the package rather than a relative path, so a
// non-hoisted install still finds it.
const require = createRequire(import.meta.url)
const pkgJson = require.resolve('node-pg-migrate/package.json')
const bin = path.join(path.dirname(pkgJson), 'bin', 'node-pg-migrate.js')

const args = [
  bin,
  '--database-url-var',
  'DATABASE_DIRECT_URL',
  '--migrations-dir',
  'migrations',
  '--migration-file-language',
  'sql',
  '--check-order',
  ...process.argv.slice(2),
]

const child = spawn(process.execPath, args, { stdio: 'inherit' })

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1))
})
