import { createHmac, randomUUID } from 'node:crypto'

import express from 'express'
import session from 'express-session'

import { createApp } from '../app.js'
import { env } from '../config/env.js'
import { SESSION_COOKIE_NAME } from '../config/session.js'
import { pool } from '../db/pool.js'
import { logger } from '../logger.js'
import { createComposer } from '../services/composer.js'
import { dispatchCampaign, type SendJobData } from '../services/dispatch.js'
import { sendToContact, type SendEngineDeps } from '../services/sendEngine.js'

/**
 * The API as the end-to-end tests run it (e2e/, roadmap #89).
 *
 * The real application, with the three things a browser test cannot reach
 * replaced: Google sign-in, Gmail, and the Redis queue.
 *
 * - POST /e2e/session creates an account and a session for it, and returns
 *   the cookie to set in the browser.
 * - Gmail is a fake that records who each message went to; GET /e2e/sent
 *   lists them.
 * - A launch runs the real planner, then the real send engine for each planned
 *   contact at once, rather than queuing them with their delays.
 *
 * Never part of the deployed application: index.ts does not import it, the
 * build excludes it, and it refuses to start unless NODE_ENV is test, E2E is 1
 * and the database is a throwaway test schema (scripts/withTestDatabase.mjs).
 */

const log = logger.child({ service: 'e2e' })

if (env.nodeEnv !== 'test' || process.env.E2E !== '1') {
  log.error('The end-to-end server runs only with NODE_ENV=test and E2E=1')
  process.exit(1)
}

// Accounts are created without a password here. That must only ever happen in
// a schema that is dropped when the run ends.
if (!/search_path(?:=|%3D)test_\d+_\d+/i.test(env.databaseUrl)) {
  log.error('The end-to-end server runs only on a test schema: use npm run test:e2e')
  process.exit(1)
}

const store = new session.MemoryStore()
const recipients: string[] = []

const composeMessage = createComposer({
  pool,
  readAttachment: () => Promise.reject(new Error('No attachment in the end-to-end run')),
})

// Sends run one after another, so the fake gateway knows which message it holds.
let composedFor = ''

const engine: SendEngineDeps = {
  pool,
  gateway: {
    send: () => {
      recipients.push(composedFor)
      return Promise.resolve(`e2e-${randomUUID()}`)
    },
  },
  getAccessToken: () => Promise.resolve('e2e-access-token'),
  compose: async (contact) => {
    const message = await composeMessage(contact)
    composedFor = message.to
    return message
  },
  dailyLimit: env.gmailDailyLimit,
}

/**
 * Half past eight UTC today: inside the default sending hours in Paris, winter
 * and summer, so a run at night does not find the campaign waiting for morning.
 */
function sendingHour(): Date {
  const at = new Date()
  at.setUTCHours(8, 30, 0, 0)
  return at
}

async function planAndSend(campaignId: string): Promise<void> {
  const queued: SendJobData[] = []
  const plan = {
    pool,
    accountLimit: env.gmailDailyLimit,
    now: sendingHour,
    enqueueSend: (job: SendJobData) => {
      queued.push(job)
      return Promise.resolve()
    },
  }

  await dispatchCampaign(plan, campaignId)

  // The delays between messages are ignored: the pace is the planner's, tested
  // on its own, and honouring it would make this run take minutes.
  for (const job of queued) {
    await sendToContact(engine, { contactId: job.contactId, userId: job.userId })
  }

  // Nothing left pending: this pass marks the campaign completed.
  await dispatchCampaign(plan, campaignId)
}

let sending = Promise.resolve()

const app = createApp({
  sessionStore: store,
  requestDispatch: (campaignId) => {
    // Answered at once, like the queue would be; the sends follow.
    sending = sending
      .then(() => planAndSend(campaignId))
      .catch((err: unknown) => {
        log.error({ err, campaignId }, 'End-to-end send failed')
      })
    return Promise.resolve()
  },
})

const outer = express()

outer.post('/e2e/session', (_req, res, next) => {
  void (async () => {
    const stamp = randomUUID()
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (google_id, email) VALUES ($1, $2) RETURNING id',
      [`e2e-${stamp}`, `e2e-${stamp}@example.test`],
    )
    const userId = rows[0]?.id

    if (!userId) {
      throw new Error('The end-to-end account was not created')
    }

    const sid = randomUUID()
    await new Promise<void>((resolve, reject) => {
      store.set(
        sid,
        {
          cookie: {
            originalMaxAge: 3_600_000,
            expires: new Date(Date.now() + 3_600_000),
            httpOnly: true,
            path: '/',
          },
          passport: { user: userId },
        } as unknown as session.SessionData,
        (err) => {
          if (err) {
            reject(err instanceof Error ? err : new Error('Session store failed'))
          } else {
            resolve()
          }
        },
      )
    })

    // Signed the way express-session signs its cookie.
    const signature = createHmac('sha256', env.sessionSecret)
      .update(sid)
      .digest('base64')
      .replace(/=+$/, '')

    res.json({
      name: SESSION_COOKIE_NAME,
      value: encodeURIComponent(`s:${sid}.${signature}`),
    })
  })().catch(next)
})

outer.get('/e2e/sent', (_req, res) => {
  res.json({ recipients })
})

outer.use(app)

outer.listen(env.port, '127.0.0.1', () => {
  log.info({ port: env.port }, 'End-to-end API listening')
})
