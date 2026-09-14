import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { describe, it } from 'node:test'

import { createLogger } from './logger.js'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString())
      done()
    },
  })
  const log = createLogger(stream, { level: 'info' })
  return { log, lines }
}

describe('the logger', () => {
  it('writes one JSON object per line, with an ISO timestamp', () => {
    const { log, lines } = capture()

    log.info({ campaignId: 'c1' }, 'Campaign planned')

    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    assert.equal(entry.msg, 'Campaign planned')
    assert.equal(entry.campaignId, 'c1')
    assert.match(String(entry.time), /^\d{4}-\d{2}-\d{2}T/)
  })

  it('redacts a token field, at the top level and one level down', () => {
    const { log, lines } = capture()

    log.error(
      {
        refreshToken: '1//secret-refresh',
        google_access_token: 'v1.cipher',
        user: { accessToken: 'ya29.secret-access' },
      },
      'Something went wrong',
    )

    const line = lines.join('')
    assert.ok(!line.includes('secret-refresh'), line)
    assert.ok(!line.includes('v1.cipher'), line)
    assert.ok(!line.includes('secret-access'), line)
    assert.ok(line.includes('[redacted]'))
  })

  it('redacts the cookie and authorization headers of a request', () => {
    const { log, lines } = capture()

    log.info(
      {
        req: { headers: { cookie: 'cm.sid=s%3Asecret', authorization: 'Bearer secret' } },
      },
      'request',
    )

    assert.ok(!lines.join('').includes('secret'))
  })

  it('serialises an error with its message and stack', () => {
    const { log, lines } = capture()

    log.error({ err: new Error('Gmail answered 503') }, 'Send failed')

    const entry = JSON.parse(lines[0] ?? '{}') as {
      err?: { message?: string; stack?: string }
    }
    const err = entry.err
    assert.ok(err)
    assert.equal(err.message, 'Gmail answered 503')
    assert.ok(err.stack?.includes('Error'))
  })
})
