import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

// The application reads its configuration when the module graph loads, so the
// environment has to be in place before the dynamic import below. The values
// are placeholders: nothing in this file opens a database or a Redis
// connection, because the session store is an in-memory one.
process.env.NODE_ENV = 'test'
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex')
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/none'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback'
process.env.FRONTEND_URL = 'http://localhost:5173'

const { createApp } = await import('../app.js')
const session = (await import('express-session')).default

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = createApp({ sessionStore: new session.MemoryStore() })

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve()
    })
  })

  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

describe('GET /api/auth/me', () => {
  it('answers 401 without a session', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`)

    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'Not signed in' })
  })

  it('sets no cookie on a rejected request', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`)

    assert.equal(res.headers.get('set-cookie'), null)
  })
})

describe('GET /api/auth/google', () => {
  it('redirects to Google', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' })

    assert.equal(res.status, 302)
    assert.match(res.headers.get('location') ?? '', /^https:\/\/accounts\.google\.com\//)
  })

  it('asks for offline access and forces the consent screen', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' })
    const target = new URL(res.headers.get('location') ?? '')

    // Without these two, Google returns no refresh token and the account
    // cannot send once the first access token expires.
    assert.equal(target.searchParams.get('access_type'), 'offline')
    assert.equal(target.searchParams.get('prompt'), 'consent')
  })

  it('requests exactly the four scopes, and nothing restricted', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' })
    const scopes = (
      new URL(res.headers.get('location') ?? '').searchParams.get('scope') ?? ''
    )
      .split(' ')
      .filter(Boolean)

    assert.deepEqual(scopes.sort(), [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ])
  })

  it('carries a state parameter, which is what stops login CSRF', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' })
    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state')

    assert.ok(state && state.length > 8, 'no usable state parameter')
  })

  it('sends the registered callback URL', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' })
    const target = new URL(res.headers.get('location') ?? '')

    // A mismatch here, down to a trailing slash, is answered by Google with
    // redirect_uri_mismatch.
    assert.equal(
      target.searchParams.get('redirect_uri'),
      'http://localhost:3000/api/auth/google/callback',
    )
  })
})

describe('POST /api/auth/logout', () => {
  it('succeeds even without a session', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })

    assert.equal(res.status, 204)
  })

  it('is not reachable by GET', async () => {
    // A GET that destroys a session can be fired by any page with an <img>
    // tag, logging the user out without their involvement.
    const res = await fetch(`${baseUrl}/api/auth/logout`, { redirect: 'manual' })

    assert.equal(res.status, 404)
  })
})

describe('the callback route', () => {
  it('exists as a GET, because an OAuth redirect is a browser navigation', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback`, { redirect: 'manual' })

    // Without Google's parameters Passport bounces to the failure redirect.
    // What matters here is that the route is reached at all.
    assert.notEqual(res.status, 404)
  })

  it('is not reachable by POST, which is what the specification asked for', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback`, { method: 'POST' })

    assert.equal(res.status, 404)
  })
})
