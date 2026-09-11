import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it } from 'node:test'

import { createTokenCipher } from './encryption.js'
import {
  GOOGLE_SCOPES,
  buildAuthorizationOptions,
  buildStrategyOptions,
  createGoogleProfileHandler,
} from './googleAuth.js'
import type { GoogleProfile, UpsertGoogleUser, UserRepository, UserRow } from './users.js'

const cipher = createTokenCipher(crypto.randomBytes(32).toString('hex'))

const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: 'http://localhost:3000/api/auth/google/callback',
}

function profile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    id: 'google-user-1',
    emails: [{ value: 'Person@Example.com' }],
    displayName: 'A Person',
    ...overrides,
  }
}

/** Captures what the handler asks the repository to store. */
function fakeRepository(): UserRepository & { calls: UpsertGoogleUser[] } {
  const calls: UpsertGoogleUser[] = []
  return {
    calls,
    upsertFromGoogle(input) {
      calls.push(input)
      return Promise.resolve({ id: 'user-uuid', email: input.email } as UserRow)
    },
  }
}

describe('buildStrategyOptions', () => {
  it('passes the credentials and the callback through', () => {
    const options = buildStrategyOptions(CONFIG)

    assert.equal(options.clientID, CONFIG.clientId)
    assert.equal(options.clientSecret, CONFIG.clientSecret)
    assert.equal(options.callbackURL, CONFIG.callbackUrl)
  })
})

describe('GOOGLE_SCOPES', () => {
  it('requests exactly the four scopes the application needs', () => {
    assert.deepEqual([...GOOGLE_SCOPES].sort(), [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ])
  })

  it('asks for no scope that would make Google require a security assessment', () => {
    // gmail.readonly and gmail.modify are restricted scopes. Requesting either
    // pulls the project into an annual third-party audit.
    // See docs/google-oauth-setup.md.
    for (const scope of GOOGLE_SCOPES) {
      assert.ok(
        !/gmail\.(readonly|modify)|auth\/drive/.test(scope),
        `forbidden scope: ${scope}`,
      )
    }
  })
})

describe('buildAuthorizationOptions', () => {
  it('asks for offline access, so Google returns a refresh token', () => {
    assert.equal(buildAuthorizationOptions().accessType, 'offline')
  })

  it('forces the consent screen', () => {
    // Google returns a refresh token only on first authorization. Without
    // prompt=consent, a user who reconnects gives us an access token and
    // nothing to refresh it with.
    assert.equal(buildAuthorizationOptions().prompt, 'consent')
  })

  it('carries the scopes', () => {
    assert.deepEqual(buildAuthorizationOptions().scope, [...GOOGLE_SCOPES])
  })
})

describe('createGoogleProfileHandler', () => {
  it('stores the tokens encrypted, never in the clear', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    await handle('access-token-plain', 'refresh-token-plain', profile())

    const [stored] = users.calls
    assert.ok(stored)
    assert.notEqual(stored.accessToken, 'access-token-plain')
    assert.notEqual(stored.refreshToken, 'refresh-token-plain')
    assert.equal(cipher.decrypt(stored.accessToken), 'access-token-plain')
    assert.equal(cipher.decrypt(stored.refreshToken ?? ''), 'refresh-token-plain')
  })

  it('lowercases the email, so one account cannot be created twice', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    await handle('a', 'r', profile({ emails: [{ value: 'Person@Example.COM' }] }))

    assert.equal(users.calls[0]?.email, 'person@example.com')
  })

  it('leaves the refresh token untouched when Google does not send one', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    // Google omits the refresh token on every authorization after the first.
    // Storing an empty value here would lock the user out until they revoke
    // access and sign in again.
    await handle('access-token', undefined, profile())

    assert.equal(users.calls[0]?.refreshToken, undefined)
  })

  it('treats an empty refresh token the same as an absent one', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    await handle('access-token', '', profile())

    assert.equal(users.calls[0]?.refreshToken, undefined)
  })

  it('records when the access token expires', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })
    const before = Date.now()

    await handle('access-token', 'refresh', profile(), { expires_in: 3599 })

    const expiry = users.calls[0]?.accessTokenExpiresAt
    assert.ok(expiry instanceof Date)
    assert.ok(expiry.getTime() > before)
    assert.ok(expiry.getTime() <= before + 3599 * 1000)
  })

  it('leaves the expiry unset when Google does not say', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    await handle('access-token', 'refresh', profile())

    assert.equal(users.calls[0]?.accessTokenExpiresAt, undefined)
  })

  it('refuses a profile with no email address', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    await assert.rejects(() => handle('a', 'r', profile({ emails: [] })), /no email/i)
    assert.equal(users.calls.length, 0)
  })

  it('refuses a profile with no Google id', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    await assert.rejects(() => handle('a', 'r', profile({ id: '' })), /no google id/i)
    assert.equal(users.calls.length, 0)
  })

  it('returns the stored user', async () => {
    const users = fakeRepository()
    const handle = createGoogleProfileHandler({ users, cipher })

    const user = await handle('a', 'r', profile())

    assert.equal(user.id, 'user-uuid')
  })
})
