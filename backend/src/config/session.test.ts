import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SESSION_COOKIE_NAME, buildSessionOptions } from './session.js'

const SECRET = 'a'.repeat(64)
const store = {} as never

function options(overrides: Partial<Parameters<typeof buildSessionOptions>[0]> = {}) {
  return buildSessionOptions({ secret: SECRET, isProduction: false, store, ...overrides })
}

describe('buildSessionOptions', () => {
  it('keeps the cookie away from JavaScript', () => {
    // The session cookie is the whole authentication. A cross-site scripting
    // bug that can read it owns the account.
    assert.equal(options().cookie.httpOnly, true)
  })

  it('requires HTTPS in production', () => {
    assert.equal(options({ isProduction: true }).cookie.secure, true)
  })

  it('allows plain HTTP outside production, or local development cannot sign in', () => {
    assert.equal(options({ isProduction: false }).cookie.secure, false)
  })

  it('uses sameSite lax rather than strict', () => {
    // Google redirects the browser back to the callback. Under `strict` the
    // browser withholds the cookie on that cross-site navigation and the
    // OAuth state check fails, which reads as a broken login.
    assert.equal(options().cookie.sameSite, 'lax')
  })

  it('does not advertise the framework in the cookie name', () => {
    assert.notEqual(SESSION_COOKIE_NAME, 'connect.sid')
    assert.equal(options().name, SESSION_COOKIE_NAME)
  })

  it('gives the session a finite lifetime', () => {
    const maxAge = options().cookie.maxAge
    assert.ok(typeof maxAge === 'number' && maxAge > 0)
  })

  it('creates no session for a visitor who never signs in', () => {
    // saveUninitialized true writes a Redis key for every anonymous request,
    // including from crawlers.
    assert.equal(options().saveUninitialized, false)
  })

  it('does not rewrite an unchanged session on every request', () => {
    assert.equal(options().resave, false)
  })

  it('uses the store it is given', () => {
    assert.equal(options().store, store)
  })

  describe('rejects', () => {
    it('a missing secret', () => {
      assert.throws(() => options({ secret: '' }), /SESSION_SECRET/)
    })

    it('a secret short enough to brute force', () => {
      assert.throws(() => options({ secret: 'short' }), /32 characters/)
    })
  })
})
