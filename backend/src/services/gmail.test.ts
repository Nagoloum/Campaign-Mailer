import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createGmailGateway } from './gmail.js'
import { PermanentSendError } from './sendEngine.js'

const realFetch = globalThis.fetch

function answer(status: number, body: unknown) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
}

const googleError = (reason: string, message = 'refus') => ({
  error: { message, errors: [{ reason, message }] },
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const gateway = createGmailGateway()
const send = () => gateway.send('token', 'raw')

describe('a message Gmail accepts', () => {
  it('returns the id it assigned', async () => {
    answer(200, { id: '18f2abc' })

    assert.equal(await send(), '18f2abc')
  })

  it('fails loudly when there is no id, rather than reporting a send', async () => {
    answer(200, {})

    await assert.rejects(send, /no id/)
  })
})

describe('a refusal that stands', () => {
  it('is permanent on 400', async () => {
    // The address or the message is wrong, and will be just as wrong in a
    // minute. Retrying costs three attempts and teaches nothing.
    answer(400, googleError('invalidArgument', 'Invalid to header'))

    await assert.rejects(send, PermanentSendError)
  })

  it('is permanent on a plain 403', async () => {
    answer(403, googleError('forbidden'))

    await assert.rejects(send, PermanentSendError)
  })

  it('carries Google’s own wording, which is what the user will read', async () => {
    answer(400, googleError('invalidArgument', 'Recipient address rejected'))

    await assert.rejects(send, /Recipient address rejected/)
  })
})

describe('a refusal about the moment', () => {
  it('is retryable on 429', async () => {
    await assertRetryable(429, {})
  })

  for (const status of [500, 502, 503]) {
    it(`is retryable on ${String(status)}`, async () => {
      await assertRetryable(status, {})
    })
  }

  for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']) {
    it(`is retryable on 403 ${reason}`, async () => {
      // The trap: a rate refusal wears the same status as a real one. Reading
      // the status alone would mark the contact failed and lose it for a
      // reason that clears by itself.
      await assertRetryable(403, googleError(reason))
    })
  }
})

async function assertRetryable(status: number, body: unknown) {
  answer(status, body)

  await assert.rejects(send, (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.ok(!(err instanceof PermanentSendError), 'should not be permanent')
    return true
  })
}
