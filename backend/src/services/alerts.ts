import type { Queue } from 'bullmq'
import type { Pool } from 'pg'
import type { Logger } from 'pino'

import { HEARTBEAT_STALE_MS } from '../jobs/heartbeat.js'

/**
 * The three conditions that need a person: sends failing, a queue that no
 * longer moves, a worker that stopped.
 *
 * Each check is a pure function over a snapshot, so the thresholds are tested
 * without a clock, a queue or a database. An alert is logged at error level
 * with an `alert` field and sent to Sentry as its own issue, where an alert
 * rule turns it into an email (docs/RUNBOOK.md).
 *
 * Where each one runs is decided by cost, not convenience:
 * - the error rate reads the database, so it runs in the worker right after
 *   the fifteen-minute plan, while Neon is awake anyway;
 * - the worker and the queue are read from Redis by the API, since a stopped
 *   worker cannot report itself.
 */

export type AlertKind = 'send_error_rate' | 'queue_stuck' | 'worker_stopped'

export interface Alert {
  kind: AlertKind
  message: string
  details: Record<string, number>
}

export const ERROR_RATE_THRESHOLD = 0.05
export const ERROR_RATE_WINDOW_MS = 60 * 60 * 1000
/** Below this, one refusal out of three sends would read as 33 %. */
export const ERROR_RATE_MIN_ATTEMPTS = 10
/** A sleeping worker starts a due job within two and a half minutes. */
export const QUEUE_STUCK_AFTER_MS = 15 * 60 * 1000
/** While a condition lasts, it is notified again at this interval. */
export const ALERT_REPEAT_MS = 6 * 60 * 60 * 1000

const minutes = (ms: number) => Math.round(ms / 60_000)

export function sendErrorRateAlert(counts: {
  sent: number
  errors: number
}): Alert | null {
  const attempts = counts.sent + counts.errors

  if (attempts < ERROR_RATE_MIN_ATTEMPTS) {
    return null
  }

  const rate = counts.errors / attempts

  if (rate <= ERROR_RATE_THRESHOLD) {
    return null
  }

  return {
    kind: 'send_error_rate',
    message: `Send error rate at ${String(Math.round(rate * 100))} % over the last hour (${String(counts.errors)} of ${String(attempts)})`,
    details: {
      sent: counts.sent,
      errors: counts.errors,
      rate: Math.round(rate * 1000) / 1000,
    },
  }
}

/** When the job that should have started first was due, waiting or delayed alike. */
export interface QueueHealth {
  earliestDueAt: number | null
}

export function queueStuckAlert(health: QueueHealth, now: number): Alert | null {
  if (health.earliestDueAt === null) {
    return null
  }

  const overdueMs = now - health.earliestDueAt

  if (overdueMs <= QUEUE_STUCK_AFTER_MS) {
    return null
  }

  return {
    kind: 'queue_stuck',
    message: `Queue stuck: a job has been due for ${String(minutes(overdueMs))} minutes`,
    details: { overdueSeconds: Math.round(overdueMs / 1000) },
  }
}

export function workerStoppedAlert(lastSeen: number | null, now: number): Alert | null {
  if (lastSeen !== null && now - lastSeen <= HEARTBEAT_STALE_MS) {
    return null
  }

  return lastSeen === null
    ? { kind: 'worker_stopped', message: 'Worker stopped: no heartbeat', details: {} }
    : {
        kind: 'worker_stopped',
        message: `Worker stopped: last heartbeat ${String(minutes(now - lastSeen))} minutes ago`,
        details: { lastSeenSecondsAgo: Math.round((now - lastSeen) / 1000) },
      }
}

/**
 * Notifies when a condition starts, again every few hours while it lasts, and
 * once when it ends. Without it, a worker down overnight would send an email
 * every five minutes.
 */
export function createAlertTracker(repeatEveryMs = ALERT_REPEAT_MS) {
  const notifiedAt = new Map<AlertKind, number>()

  return {
    update(watched: readonly AlertKind[], active: readonly Alert[], now: number) {
      const notify: Alert[] = []

      for (const alert of active) {
        const last = notifiedAt.get(alert.kind)
        if (last === undefined || now - last >= repeatEveryMs) {
          notify.push(alert)
          notifiedAt.set(alert.kind, now)
        }
      }

      const resolved = watched.filter(
        (kind) => notifiedAt.has(kind) && !active.some((alert) => alert.kind === kind),
      )
      for (const kind of resolved) {
        notifiedAt.delete(kind)
      }

      return { notify, resolved }
    },
  }
}

export async function runAlertChecks(deps: {
  watched: readonly AlertKind[]
  checks: () => Promise<(Alert | null)[]>
  tracker: ReturnType<typeof createAlertTracker>
  log: Pick<Logger, 'error' | 'info'>
  report: (alert: Alert) => void
  now?: () => number
}): Promise<void> {
  const active = (await deps.checks()).filter((alert): alert is Alert => alert !== null)
  const { notify, resolved } = deps.tracker.update(
    deps.watched,
    active,
    (deps.now ?? Date.now)(),
  )

  for (const alert of notify) {
    deps.log.error({ alert: alert.kind, ...alert.details }, alert.message)
    deps.report(alert)
  }
  for (const kind of resolved) {
    deps.log.info({ alert: kind }, 'Alert resolved')
  }
}

/**
 * Sends and refusals recorded for a contact over the window. The campaign-level
 * error rows (a pause and its reason) have no contact and are not sends.
 */
export async function readSendCounts(
  pool: Pool,
  windowMs = ERROR_RATE_WINDOW_MS,
): Promise<{ sent: number; errors: number }> {
  const { rows } = await pool.query<{ sent: number; errors: number }>(
    `SELECT count(*) FILTER (WHERE event_type = 'sent')::int  AS sent,
            count(*) FILTER (WHERE event_type = 'error')::int AS errors
       FROM logs
      WHERE created_at > now() - make_interval(secs => $1)
        AND contact_id IS NOT NULL
        AND event_type IN ('sent', 'error')`,
    [windowMs / 1000],
  )

  return rows[0] ?? { sent: 0, errors: 0 }
}

/** Two reads: the oldest ready job and the earliest delayed one. */
export async function readQueueHealth(queue: Queue): Promise<QueueHealth> {
  const [waiting, delayed] = await Promise.all([
    queue.getJobs(['waiting', 'prioritized'], 0, 0, true),
    queue.getDelayed(0, 0),
  ])

  const dueTimes = [...waiting, ...delayed].map((job) => job.timestamp + job.delay)

  return { earliestDueAt: dueTimes.length > 0 ? Math.min(...dueTimes) : null }
}
