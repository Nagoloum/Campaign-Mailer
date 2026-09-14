import type { Redis } from 'ioredis'

/**
 * The worker's sign of life.
 *
 * A worker that has crashed looks, from the API, exactly like one with nothing
 * to do: no job moves either way. So it writes a timestamp to Redis on a timer
 * of its own, independent of the queue, and the readiness endpoint and the
 * alerts read how old it is.
 *
 * Every five minutes: one command each time, about 8 600 a month, a fraction of
 * what the sleeping worker already spends. The key expires on its own, so a
 * worker gone for good leaves no stale claim of being alive.
 */

export const HEARTBEAT_KEY = 'cm:worker:heartbeat'
export const HEARTBEAT_EVERY_MS = 5 * 60 * 1000

/** Three missed beats: long enough to ride out a redeploy, short enough to matter. */
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_EVERY_MS

export type HeartbeatStore = Pick<Redis, 'set' | 'get'>

export async function writeHeartbeat(
  store: HeartbeatStore,
  now: number = Date.now(),
): Promise<void> {
  await store.set(HEARTBEAT_KEY, String(now), 'EX', (2 * HEARTBEAT_STALE_MS) / 1000)
}

export async function readHeartbeat(store: HeartbeatStore): Promise<number | null> {
  const value = await store.get(HEARTBEAT_KEY)

  if (value === null) {
    return null
  }

  const at = Number(value)
  return Number.isFinite(at) ? at : null
}
