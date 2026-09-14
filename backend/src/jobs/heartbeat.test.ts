import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HEARTBEAT_KEY,
  HEARTBEAT_STALE_MS,
  readHeartbeat,
  writeHeartbeat,
  type HeartbeatStore,
} from './heartbeat.js'

function fakeStore(initial: string | null = null) {
  let value = initial
  const writes: unknown[][] = []

  const store = {
    set: (...args: unknown[]) => {
      writes.push(args)
      value = String(args[1])
      return Promise.resolve('OK')
    },
    get: () => Promise.resolve(value),
  } as unknown as HeartbeatStore

  return { store, writes }
}

describe('the worker heartbeat', () => {
  it('writes the time under one key, with an expiry', async () => {
    const { store, writes } = fakeStore()

    await writeHeartbeat(store, 1_700_000_000_000)

    assert.deepEqual(writes, [
      [HEARTBEAT_KEY, '1700000000000', 'EX', (2 * HEARTBEAT_STALE_MS) / 1000],
    ])
  })

  it('reads back the time it wrote', async () => {
    const { store } = fakeStore()

    await writeHeartbeat(store, 1_700_000_000_000)

    assert.equal(await readHeartbeat(store), 1_700_000_000_000)
  })

  it('reads nothing when no worker ever wrote one, or it expired', async () => {
    assert.equal(await readHeartbeat(fakeStore(null).store), null)
  })

  it('reads nothing from a value that is not a time', async () => {
    assert.equal(await readHeartbeat(fakeStore('not-a-number').store), null)
  })
})
