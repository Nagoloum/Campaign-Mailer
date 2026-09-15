import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import { createLogger } from '../logger.js'

import { createRequestLogger, requestId } from './requestLogging.js'

let lines: string[] = []
let baseUrl: string
let server: import('node:http').Server

const stream = new Writable({
  write(chunk: Buffer, _encoding, done) {
    lines.push(chunk.toString())
    done()
  },
})

before(async () => {
  const app = express()
  app.use(createRequestLogger(createLogger(stream, { level: 'info' })))
  app.get('/api/auth/google/callback', (req, res) => {
    req.log.info('handling the callback')
    res.status(200).send('ok')
  })
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.get('/api/broken', (_req, res) => {
    res.status(500).json({ error: 'Internal server error' })
  })

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

beforeEach(() => {
  lines = []
})

/** The response is logged on 'finish', a moment after fetch resolves. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>)

describe('request logging', () => {
  it('logs the path without its query string, so an OAuth code never reaches the logs', async () => {
    await fetch(`${baseUrl}/api/auth/google/callback?code=4%2F0AQSecretCode&state=xyz`, {
      headers: { cookie: 'cm.sid=s%3Asecret-session' },
    })
    await settle()

    const all = lines.join('')
    assert.ok(!all.includes('SecretCode'), all)
    assert.ok(!all.includes('secret-session'), all)

    const completed = entries().find((entry) => entry.msg === 'request completed') as
      | { req?: { path?: string; method?: string }; res?: { statusCode?: number } }
      | undefined
    const req = completed?.req
    const res = completed?.res
    assert.ok(req && res, lines.join(''))
    assert.equal(req.path, '/api/auth/google/callback')
    assert.equal(req.method, 'GET')
    assert.equal(res.statusCode, 200)
  })

  it('gives every line of a request the same id, and sends it back', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback`)
    await settle()

    const id = res.headers.get('x-request-id')
    assert.ok(id)

    const handled = entries().find((entry) => entry.msg === 'handling the callback') as {
      req?: { id?: string }
    }
    const completed = entries().find((entry) => entry.msg === 'request completed') as {
      req?: { id?: string }
    }
    assert.equal(handled.req?.id, id)
    assert.equal(completed.req?.id, id)
  })

  it('reuses a well-formed incoming request id', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback`, {
      headers: { 'x-request-id': 'edge-1234-abcd' },
    })

    assert.equal(res.headers.get('x-request-id'), 'edge-1234-abcd')
  })

  it('logs a server error at error level', async () => {
    await fetch(`${baseUrl}/api/broken`)
    await settle()

    // pino-http names a 5xx "request errored", and logs it at the level
    // customLogLevel chose: error, which pino numbers 50.
    const errored = entries().find((entry) => entry.msg === 'request errored')
    assert.ok(errored, lines.join(''))
    assert.equal(errored.level, 'error')
  })

  it('does not log the health check', async () => {
    await fetch(`${baseUrl}/api/health`)
    await settle()

    assert.deepEqual(lines, [])
  })
})

describe('requestId', () => {
  it('keeps a plausible id', () => {
    assert.equal(
      requestId('3f2a9c1e-0000-4000-8000-000000000000'),
      '3f2a9c1e-0000-4000-8000-000000000000',
    )
  })

  it('replaces one that could smuggle anything into a log line', () => {
    for (const bad of [
      'short',
      'has spaces in it',
      'x'.repeat(65),
      'line\nbreak-12345',
    ]) {
      assert.match(requestId(bad), /^[0-9a-f-]{36}$/, bad)
    }
  })

  it('generates one when none was sent', () => {
    assert.match(requestId(undefined), /^[0-9a-f-]{36}$/)
  })
})
