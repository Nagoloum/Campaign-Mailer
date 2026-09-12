import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Request } from 'express'

import { RATE_LIMIT, buildCorsOptions, rateLimitKey } from './security.js'

/** Just enough of a request for the key generator. */
function req(parts: {
  user?: { id: string }
  ip?: string
}): Pick<Request, 'user' | 'ip'> {
  return parts as unknown as Pick<Request, 'user' | 'ip'>
}

const FRONTEND = 'http://localhost:5173'

/** Runs the CORS origin callback and reports what it decided. */
function originDecision(origin: string | undefined): 'allowed' | 'refused' {
  const { origin: check } = buildCorsOptions(FRONTEND)
  let decision: 'allowed' | 'refused' = 'refused'

  check(origin, (err, allow) => {
    decision = !err && allow === true ? 'allowed' : 'refused'
  })

  return decision
}

describe('buildCorsOptions', () => {
  it('allows the configured frontend', () => {
    assert.equal(originDecision(FRONTEND), 'allowed')
  })

  it('allows a request with no Origin header', () => {
    // curl, a health check and a server-to-server call send none. Refusing
    // them would break the OAuth redirect, which is a top-level navigation.
    assert.equal(originDecision(undefined), 'allowed')
  })

  it('refuses another origin', () => {
    assert.equal(originDecision('https://evil.example'), 'refused')
  })

  it('refuses an origin that merely starts with the allowed one', () => {
    // A prefix check would accept this. It is a different host.
    assert.equal(originDecision('http://localhost:5173.evil.example'), 'refused')
  })

  it('refuses a different port on the same host', () => {
    assert.equal(originDecision('http://localhost:5174'), 'refused')
  })

  it('refuses plain HTTP when the frontend is HTTPS', () => {
    const { origin: check } = buildCorsOptions('https://app.example.com')
    let allowed = false
    check('http://app.example.com', (err, allow) => {
      allowed = !err && allow === true
    })

    assert.equal(allowed, false)
  })

  it('allows credentials, or the session cookie never travels', () => {
    assert.equal(buildCorsOptions(FRONTEND).credentials, true)
  })
})

describe('rateLimitKey', () => {
  it('keys a signed-in request on the user, not the address', () => {
    // Two colleagues behind one office address must not consume each other's
    // allowance, and a signed-in caller must not reset theirs by switching
    // networks.
    const key = rateLimitKey(req({ user: { id: 'user-uuid' }, ip: '203.0.113.7' }))

    assert.ok(key.includes('user-uuid'))
    assert.ok(!key.includes('203.0.113.7'))
  })

  it('keys an anonymous request on the address', () => {
    assert.ok(rateLimitKey(req({ ip: '203.0.113.7' })).includes('203.0.113.7'))
  })

  it('collapses an IPv6 address to its /64 prefix', () => {
    // Otherwise a caller holding an IPv6 range gets a fresh allowance for
    // every address in it, which is most of them.
    const a = rateLimitKey(req({ ip: '2001:db8:1234:5678:1::1' }))
    const b = rateLimitKey(req({ ip: '2001:db8:1234:5678:9::9' }))

    assert.equal(a, b)
  })

  it('gives signed-in and anonymous callers separate namespaces', () => {
    // Otherwise a user whose id happened to match an address string would
    // share an allowance with it.
    assert.notEqual(
      rateLimitKey(req({ user: { id: 'x' } })),
      rateLimitKey(req({ ip: 'x' })),
    )
  })

  it('still returns a key when neither is available', () => {
    assert.ok(rateLimitKey(req({})).length > 0)
  })
})

describe('RATE_LIMIT', () => {
  it('allows 100 requests per minute, as the specification asks', () => {
    assert.equal(RATE_LIMIT.limit, 100)
    assert.equal(RATE_LIMIT.windowMs, 60_000)
  })
})
