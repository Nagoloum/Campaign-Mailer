import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  ReauthorizationRequiredError,
  createGoogleTokenEndpoint,
} from './tokenRefresh.js'

/**
 * The real exchange with Google's token endpoint, with fetch stood in for.
 *
 * The distinction tested here is the one the send engine depends on:
 * invalid_grant means the user must reconnect, and the campaign pauses; any
 * other failure is transient, and the job may retry.
 */

const realFetch = globalThis.fetch
let requests: { url: string; method: string | undefined; body: string }[] = []

function answer(status: number, body: unknown) {
  globalThis.fetch = (input, init) => {
    requests.push({
      url: input as string,
      method: init?.method,
      body: (init?.body as URLSearchParams).toString(),
    })
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
}

afterEach(() => {
  globalThis.fetch = realFetch
  requests = []
})

const exchange = createGoogleTokenEndpoint({
  clientId: 'client-id',
  clientSecret: 'client-secret',
})

describe('exchanging a refresh token', () => {
  it('returns the new access token and its lifetime', async () => {
    answer(200, { access_token: 'ya29.new', expires_in: 3599 })

    assert.deepEqual(await exchange('1//refresh'), {
      accessToken: 'ya29.new',
      expiresIn: 3599,
    })
  })

  it('sends a refresh_token grant with the client credentials, in the body', async () => {
    answer(200, { access_token: 'ya29.new', expires_in: 3599 })
    await exchange('1//refresh')

    const [request] = requests
    assert.ok(request)
    assert.equal(request.url, 'https://oauth2.googleapis.com/token')
    assert.ok(!request.url.includes('refresh'))

    const body = new URLSearchParams(request.body)
    assert.equal(body.get('grant_type'), 'refresh_token')
    assert.equal(body.get('refresh_token'), '1//refresh')
    assert.equal(body.get('client_id'), 'client-id')
    assert.equal(body.get('client_secret'), 'client-secret')
  })

  it('turns invalid_grant into a demand to reconnect, never a retry', async () => {
    answer(400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    })

    await assert.rejects(exchange('1//refresh'), ReauthorizationRequiredError)
  })

  it('treats a server failure as transient', async () => {
    answer(503, { error: 'backend_error' })

    await assert.rejects(exchange('1//refresh'), (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(
        !(err instanceof ReauthorizationRequiredError),
        'a 503 must stay retryable',
      )
      assert.match(err.message, /answered 503/)
      return true
    })
  })

  it('never puts the token in the error it throws', async () => {
    answer(500, { error: 'internal' })

    await assert.rejects(exchange('1//secret-refresh'), (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.ok(!err.message.includes('secret-refresh'))
      return true
    })
  })

  it('refuses an answer without an access token rather than returning an empty one', async () => {
    answer(200, { expires_in: 3599 })
    await assert.rejects(exchange('1//refresh'), /no access token/)
  })

  it('treats a missing lifetime as already expired, not as a token that never expires', async () => {
    answer(200, { access_token: 'ya29.new' })
    assert.equal((await exchange('1//refresh')).expiresIn, 0)
  })
})
