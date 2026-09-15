import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { initErrorReporting, redact, reportError, scrubEvent } from './errorReporting.js'

function fakeSdk() {
  const calls = { init: [] as unknown[], capture: [] as unknown[][] }

  const sdk = {
    init: (options: unknown) => {
      calls.init.push(options)
      return undefined
    },
    captureException: (...args: unknown[]) => {
      calls.capture.push(args)
      return 'event-id'
    },
    close: () => Promise.resolve(true),
  }

  return { sdk: sdk as unknown as Parameters<typeof initErrorReporting>[1], calls }
}

const options = { environment: 'test', release: undefined, service: 'worker' }

afterEach(() => {
  initErrorReporting({ ...options, dsn: '' }, fakeSdk().sdk)
})

describe('error reporting', () => {
  it('stays off without a DSN, and reporting is then a no-op', () => {
    const { sdk, calls } = fakeSdk()

    assert.equal(initErrorReporting({ ...options, dsn: '' }, sdk), false)
    reportError(new Error('boom'))

    assert.equal(calls.init.length, 0)
    assert.equal(calls.capture.length, 0)
  })

  it('starts without default PII and scrubs every event before it leaves', () => {
    const { sdk, calls } = fakeSdk()

    assert.equal(
      initErrorReporting({ ...options, dsn: 'https://k@o1.ingest.sentry.io/1' }, sdk),
      true,
    )

    const init = calls.init[0] as { sendDefaultPii: boolean; beforeSend: unknown }
    assert.equal(init.sendDefaultPii, false)
    assert.equal(init.beforeSend, scrubEvent)
  })

  it('sends a send failure with the context needed to find the job again', () => {
    const { sdk, calls } = fakeSdk()
    initErrorReporting({ ...options, dsn: 'https://k@o1.ingest.sentry.io/1' }, sdk)

    const err = new Error('Gmail refused the message')
    reportError(err, {
      level: 'warning',
      service: 'worker',
      job: 'send',
      jobId: 'send-c1',
      attempt: 1,
      campaignId: 'camp-1',
      contactId: 'c1',
      userId: 'u1',
      reason: 'Invalid To header: jane@example.com',
      fingerprint: ['send-refused'],
    })

    assert.deepEqual(calls.capture, [
      [
        err,
        {
          level: 'warning',
          tags: { service: 'worker', job: 'send' },
          extra: {
            jobId: 'send-c1',
            attempt: 1,
            campaignId: 'camp-1',
            contactId: 'c1',
            reason: 'Invalid To header: [email]',
          },
          user: { id: 'u1' },
          fingerprint: ['send-refused'],
        },
      ],
    ])
  })
})

describe('redact', () => {
  it('removes access tokens, refresh tokens and addresses', () => {
    assert.equal(
      redact('token ya29.a0AfB_x-1 refresh 1//0gAbC-d_e for jane.doe+cv@mail.example.fr'),
      'token [access-token] refresh [refresh-token] for [email]',
    )
  })
})

describe('scrubEvent', () => {
  it('keeps the method and path of a request, nothing that identifies the caller', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        method: 'GET',
        url: 'https://api.example.com/api/auth/google/callback?code=4/secret',
        cookies: { 'connect.sid': 's%3Aabc' },
        headers: { authorization: 'Bearer ya29.x' },
        query_string: 'code=4/secret',
        data: { email: 'jane@example.com' },
      },
      user: { id: 'u1', email: 'jane@example.com', ip_address: '203.0.113.9' },
    })

    assert.deepEqual(event.request, {
      method: 'GET',
      url: 'https://api.example.com/api/auth/google/callback',
    })
    assert.deepEqual(event.user, { id: 'u1' })
  })

  it('redacts messages, exception values and breadcrumbs, and drops breadcrumb data', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'failed for jane@example.com',
      exception: { values: [{ type: 'Error', value: 'bad token ya29.abc' }] },
      breadcrumbs: [{ message: 'to bob@example.com', data: { url: 'https://x/?t=1' } }],
    })

    assert.equal(event.message, 'failed for [email]')
    assert.equal(event.exception?.values?.[0]?.value, 'bad token [access-token]')
    assert.deepEqual(event.breadcrumbs, [{ message: 'to [email]' }])
  })
})
