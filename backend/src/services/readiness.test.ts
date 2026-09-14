import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HEARTBEAT_STALE_MS } from '../jobs/heartbeat.js'

import { checkReadiness, type ReadinessProbes } from './readiness.js'

const NOW = 1_700_000_000_000
const depth = { waiting: 2, delayed: 40, active: 1, failed: 0 }

function probes(overrides: Partial<ReadinessProbes> = {}): ReadinessProbes {
  return {
    database: () => Promise.resolve(),
    sessionStore: () => Promise.resolve(),
    queue: () => Promise.resolve(depth),
    workerHeartbeat: () => Promise.resolve(NOW - 60_000),
    ...overrides,
  }
}

const check = (overrides: Partial<ReadinessProbes> = {}, timeoutMs = 50) =>
  checkReadiness(probes(overrides), { now: () => NOW, timeoutMs })

describe('checkReadiness', () => {
  it('is ready when the database, the session store and the queue answer', async () => {
    const report = await check()

    assert.equal(report.ready, true)
    assert.deepEqual(report.checks, { database: 'ok', sessionStore: 'ok', queue: 'ok' })
    assert.deepEqual(report.queue, depth)
  })

  it('is not ready when the database refuses, and says which check failed', async () => {
    const report = await check({
      database: () => Promise.reject(new Error('ECONNREFUSED')),
    })

    assert.equal(report.ready, false)
    assert.equal(report.checks.database, 'failed')
    assert.equal(report.checks.queue, 'ok')
  })

  it('treats a probe that hangs as failed, within the timeout', async () => {
    const started = Date.now()
    const report = await check({ sessionStore: () => new Promise<void>(() => undefined) })

    assert.equal(report.checks.sessionStore, 'failed')
    assert.ok(Date.now() - started < 1_000, 'the endpoint waited on a hung dependency')
  })

  it('reports no queue depth when the queue is unreachable', async () => {
    const report = await check({ queue: () => Promise.reject(new Error('down')) })

    assert.equal(report.ready, false)
    assert.equal(report.queue, null)
  })

  it('reports a worker seen a minute ago as alive', async () => {
    const report = await check()

    assert.deepEqual(report.worker, { alive: true, lastSeenSecondsAgo: 60 })
  })

  it('reports a worker silent for longer than three beats as stopped', async () => {
    const report = await check({
      workerHeartbeat: () => Promise.resolve(NOW - HEARTBEAT_STALE_MS - 1),
    })

    assert.equal(report.worker.alive, false)
  })

  it('stays ready while the worker is down: the API still serves every page', async () => {
    const report = await check({ workerHeartbeat: () => Promise.resolve(null) })

    assert.equal(report.ready, true)
    assert.deepEqual(report.worker, { alive: false, lastSeenSecondsAgo: null })
  })
})
