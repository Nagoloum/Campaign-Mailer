// Runs a command against a database of its own, then throws it away.
//
// The integration tests write users, campaigns and logs. Pointed at the
// development database, they share it with the owner's real account and with
// each other, and a cleanup that is one character too broad deletes someone
// else's rows. So each run gets a fresh schema:
//
//   1. CREATE SCHEMA test_<time>_<pid> on the direct connection;
//   2. every migration applied into it, which also proves they still apply
//      from nothing;
//   3. the command runs with DATABASE_URL and DATABASE_DIRECT_URL carrying
//      `options=-c search_path=<schema>`, so every connection, the pool's
//      included, reads and writes there and nowhere else;
//   4. DROP SCHEMA ... CASCADE, whether the command passed, failed or was
//      interrupted.
//
// A schema rather than a database: Neon's free plan limits databases, and a
// schema is created and dropped in milliseconds on the same compute.
//
// Usage: node scripts/withTestDatabase.mjs <command> [args...]

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

import pg from 'pg'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const [command, ...args] = process.argv.slice(2)

if (!command) {
  console.error('Usage: node scripts/withTestDatabase.mjs <command> [args...]')
  process.exit(2)
}

const directUrl = process.env.DATABASE_DIRECT_URL

if (!directUrl) {
  console.error(
    'DATABASE_DIRECT_URL is not set: there is no database to create a schema in.',
  )
  process.exit(1)
}

if (directUrl.includes('-pooler.')) {
  console.error(
    'DATABASE_DIRECT_URL points at the pooled host, which ignores search_path.',
  )
  process.exit(1)
}

// Generated here, never read from the environment: it is interpolated into
// CREATE and DROP statements, and only this shape may reach them.
const schema = `test_${String(Date.now())}_${String(process.pid)}`

/**
 * The connection string with every session placed in the test schema.
 * @param {string} url
 */
function inSchema(url) {
  const parsed = new URL(url)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  return parsed.toString()
}

/**
 * Waits for a child process and returns its exit code.
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<number>}
 */
function exitOf(child) {
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve(signal ? 1 : (code ?? 1))
    })
  })
}

/**
 * Quotes one argument for the shell line below. A glob such as
 * "src/**\/*.test.ts" must reach the test runner unexpanded.
 * @param {string} value
 */
function quote(value) {
  return /^[\w./:=@-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`
}

/**
 * Runs the command given on the command line.
 *
 * Through a shell, as one line: npm, npx and tsx are .cmd files on Windows,
 * which spawn cannot start directly, and passing an argument array to a shell
 * would concatenate it unescaped.
 * @param {NodeJS.ProcessEnv} env
 */
function runCommand(env) {
  const line = [command, ...args].map(quote).join(' ')
  return exitOf(spawn(line, { stdio: 'inherit', env, shell: true }))
}

const admin = new pg.Client({ connectionString: directUrl })
await admin.connect()

let dropped = false

async function dropSchema() {
  if (dropped) {
    return
  }
  dropped = true
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await admin.end()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void dropSchema().finally(() => process.exit(130))
  })
}

let exitCode = 1

try {
  await admin.query(`CREATE SCHEMA "${schema}"`)
  console.log(`Test schema ${schema} created`)

  // Node itself, without a shell: its path may hold a space.
  const migrated = await exitOf(
    spawn(process.execPath, ['scripts/migrate.mjs', 'up', '--schema', schema], {
      stdio: 'inherit',
    }),
  )

  if (migrated !== 0) {
    console.error('Migrations failed on the test schema')
  } else {
    exitCode = await runCommand({
      ...process.env,
      DATABASE_URL: inSchema(directUrl),
      DATABASE_DIRECT_URL: inSchema(directUrl),
    })
  }
} finally {
  await dropSchema()
  console.log(`Test schema ${schema} dropped`)
}

process.exit(exitCode)
