import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createGoogleTokenRevoker } from './googleRevoke.js'

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

const revoke = createGoogleTokenRevoker()

describe('revoking a Google token', () => {
  it('resolves when Google accepts the revocation', async () => {
    answer(200, {})
    await assert.doesNotReject(revoke('1//refresh-token'))
  })

  it('sends the token in the body, never in the URL', async () => {
    answer(200, {})
    await revoke('1//refresh-token')

    const [request] = requests
    assert.ok(request)
    assert.equal(request.url, 'https://oauth2.googleapis.com/revoke')
    assert.ok(!request.url.includes('refresh-token'))
    assert.equal(request.method, 'POST')
    assert.equal(request.body, 'token=1%2F%2Frefresh-token')
  })

  it('treats invalid_token as done: the grant is already over', async () => {
    // Revoked by the user, expired, or revoked twice: the outcome wanted is
    // already true.
    answer(400, { error: 'invalid_token' })
    await assert.doesNotReject(revoke('1//already-gone'))
  })

  it('fails on any other refusal, so the deletion can report it', async () => {
    answer(503, { error: 'backend_error' })
    await assert.rejects(revoke('1//refresh-token'), /Google revocation answered 503/)
  })

  it('fails on a refusal whose body is not JSON', async () => {
    globalThis.fetch = () => Promise.resolve(new Response('<html>', { status: 500 }))
    await assert.rejects(revoke('1//refresh-token'), /answered 500/)
  })
})
