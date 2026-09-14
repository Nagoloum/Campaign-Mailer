import { HEARTBEAT_STALE_MS } from '../jobs/heartbeat.js'

/**
 * Whether the API can do its job right now, and how the sending side looks.
 *
 * Ready means the three things a request needs answer: the database, the
 * session store, and the queue a launch writes to. Each probe gets two seconds;
 * a dependency that hangs is as unavailable as one that refuses.
 *
 * The worker is reported, not required. The API still serves every page while
 * the worker is down, and a host that restarted the API because the worker
 * stopped would fix nothing. Its absence is an alert (roadmap #94), not a
 * reason to take the API out of rotation.
 */

export interface QueueDepth {
  waiting: number
  delayed: number
  active: number
  failed: number
}

export interface ReadinessProbes {
  database: () => Promise<void>
  sessionStore: () => Promise<void>
  queue: () => Promise<QueueDepth>
  /** When the worker last wrote its heartbeat, in epoch milliseconds. */
  workerHeartbeat: () => Promise<number | null>
}

type CheckState = 'ok' | 'failed'

export interface ReadinessReport {
  ready: boolean
  checks: { database: CheckState; sessionStore: CheckState; queue: CheckState }
  queue: QueueDepth | null
  worker: { alive: boolean; lastSeenSecondsAgo: number | null }
}

const PROBE_TIMEOUT_MS = 2_000

type Settled<T> = { ok: true; value: T } | { ok: false }

async function within<T>(
  probe: () => Promise<T>,
  timeoutMs: number,
): Promise<Settled<T>> {
  let timer: NodeJS.Timeout | undefined

  try {
    const value = await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Probe timed out'))
        }, timeoutMs)
      }),
    ])
    return { ok: true, value }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkReadiness(
  probes: ReadinessProbes,
  options: { now?: () => number; timeoutMs?: number } = {},
): Promise<ReadinessReport> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS

  // In parallel: the endpoint answers in the time of the slowest probe, not
  // the sum of them.
  const [database, sessionStore, queue, heartbeat] = await Promise.all([
    within(probes.database, timeoutMs),
    within(probes.sessionStore, timeoutMs),
    within(probes.queue, timeoutMs),
    within(probes.workerHeartbeat, timeoutMs),
  ])

  const now = options.now?.() ?? Date.now()
  const lastSeen = heartbeat.ok ? heartbeat.value : null

  return {
    ready: database.ok && sessionStore.ok && queue.ok,
    checks: {
      database: database.ok ? 'ok' : 'failed',
      sessionStore: sessionStore.ok ? 'ok' : 'failed',
      queue: queue.ok ? 'ok' : 'failed',
    },
    queue: queue.ok ? queue.value : null,
    worker: {
      alive: lastSeen !== null && now - lastSeen <= HEARTBEAT_STALE_MS,
      lastSeenSecondsAgo:
        lastSeen === null ? null : Math.max(0, Math.round((now - lastSeen) / 1000)),
    },
  }
}
