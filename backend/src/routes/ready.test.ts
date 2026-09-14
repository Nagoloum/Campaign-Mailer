import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import type { ReadinessReport } from '../services/readiness.js'

import { createReadyRouter } from './ready.js'

let report: ReadinessReport
let baseUrl: string
let server: import('node:http').Server

const healthy: ReadinessReport = {
  ready: true,
  checks: { database: 'ok', sessionStore: 'ok', queue: 'ok' },
  queue: { waiting: 0, delayed: 12, active: 0, failed: 1 },
  worker: { alive: true, lastSeenSecondsAgo: 42 },
}

before(async () => {
  const app = express()
  app.use(
    '/ready',
    createReadyRouter(() => Promise.resolve(report)),
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve()
    })
  })
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

describe('GET /ready', () => {
  it('answers 200 with the report when the instance can serve', async () => {
    report = healthy
    const res = await fetch(`${baseUrl}/ready`)

    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), healthy)
  })

  it('answers 503 when a dependency is down, so a host can act on the status alone', async () => {
    report = {
      ...healthy,
      ready: false,
      checks: { ...healthy.checks, database: 'failed' },
    }

    const res = await fetch(`${baseUrl}/ready`)
    const body = (await res.json()) as ReadinessReport

    assert.equal(res.status, 503)
    assert.equal(body.checks.database, 'failed')
  })
})
