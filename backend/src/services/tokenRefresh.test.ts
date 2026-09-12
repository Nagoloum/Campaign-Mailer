import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it } from 'node:test'

import { createTokenCipher } from './encryption.js'
import {
  ReauthorizationRequiredError,
  createAccessTokenProvider,
  type GoogleTokenEndpoint,
  type UserAuthRow,
} from './tokenRefresh.js'

const cipher = createTokenCipher(crypto.randomBytes(32).toString('hex'))

const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000)
const A_MINUTE_AGO = () => new Date(Date.now() - 60_000)

function authRow(overrides: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: 'user-uuid',
    google_access_token: cipher.encrypt('stored-access-token'),
    google_refresh_token: cipher.encrypt('stored-refresh-token'),
    google_token_expires_at: IN_AN_HOUR(),
    ...overrides,
  }
}

/** Records what was persisted, and what Google was asked for. */
function harness(
  options: {
    row?: UserAuthRow | null
    endpoint?: GoogleTokenEndpoint
  } = {},
) {
  const saved: { id: string; accessToken: string; expiresAt: Date }[] = []
  const asked: string[] = []

  const endpoint: GoogleTokenEndpoint =
    options.endpoint ??
    ((refreshToken) => {
      asked.push(refreshToken)
      return Promise.resolve({ accessToken: 'fresh-access-token', expiresIn: 3599 })
    })

  const provider = createAccessTokenProvider({
    cipher,
    endpoint,
    auth: {
      findAuthById: () =>
        Promise.resolve(options.row === undefined ? authRow() : options.row),
      saveAccessToken: (id, accessToken, expiresAt) => {
        saved.push({ id, accessToken, expiresAt })
        return Promise.resolve()
      },
    },
  })

  return { provider, saved, asked }
}

describe('createAccessTokenProvider', () => {
  it('returns the stored token while it is still valid', async () => {
    const { provider, asked } = harness()

    assert.equal(await provider('user-uuid'), 'stored-access-token')
    assert.equal(asked.length, 0, 'Google should not have been called')
  })

  it('refreshes an expired token', async () => {
    const { provider, asked } = harness({
      row: authRow({ google_token_expires_at: A_MINUTE_AGO() }),
    })

    assert.equal(await provider('user-uuid'), 'fresh-access-token')
    assert.deepEqual(asked, ['stored-refresh-token'])
  })

  it('refreshes a token that is about to expire', async () => {
    // Renewing only once expired guarantees a race: the token dies between
    // the check and the Gmail call, and the send fails for no good reason.
    const { provider, asked } = harness({
      row: authRow({ google_token_expires_at: new Date(Date.now() + 20_000) }),
    })

    await provider('user-uuid')

    assert.equal(asked.length, 1)
  })

  it('refreshes when the expiry is unknown', async () => {
    const { provider, asked } = harness({
      row: authRow({ google_token_expires_at: null }),
    })

    await provider('user-uuid')

    assert.equal(asked.length, 1)
  })

  it('stores the new token encrypted, with its expiry', async () => {
    const { provider, saved } = harness({
      row: authRow({ google_token_expires_at: A_MINUTE_AGO() }),
    })
    const before = Date.now()

    await provider('user-uuid')

    const [record] = saved
    assert.ok(record)
    assert.equal(record.id, 'user-uuid')
    assert.notEqual(record.accessToken, 'fresh-access-token')
    assert.equal(cipher.decrypt(record.accessToken), 'fresh-access-token')
    assert.ok(record.expiresAt.getTime() > before)
  })

  it('writes nothing when the stored token is still good', async () => {
    const { provider, saved } = harness()

    await provider('user-uuid')

    assert.equal(saved.length, 0)
  })

  describe('demands reauthorization', () => {
    it('when the account is gone', async () => {
      const { provider } = harness({ row: null })

      await assert.rejects(() => provider('user-uuid'), ReauthorizationRequiredError)
    })

    it('when no refresh token was ever stored', async () => {
      const { provider } = harness({
        row: authRow({
          google_refresh_token: null,
          google_token_expires_at: A_MINUTE_AGO(),
        }),
      })

      await assert.rejects(() => provider('user-uuid'), ReauthorizationRequiredError)
    })

    it('when Google answers invalid_grant', async () => {
      // The user revoked access, changed their password, or the app is still
      // in Testing where refresh tokens expire after seven days. Retrying
      // cannot help; the campaign has to stop and the user reconnect.
      const { provider } = harness({
        row: authRow({ google_token_expires_at: A_MINUTE_AGO() }),
        endpoint: () => Promise.reject(new ReauthorizationRequiredError('invalid_grant')),
      })

      await assert.rejects(() => provider('user-uuid'), ReauthorizationRequiredError)
    })
  })

  it('lets a transient failure through, so the caller can retry', async () => {
    const { provider } = harness({
      row: authRow({ google_token_expires_at: A_MINUTE_AGO() }),
      endpoint: () => Promise.reject(new Error('Google is unavailable')),
    })

    await assert.rejects(
      () => provider('user-uuid'),
      (err: unknown) =>
        err instanceof Error && !(err instanceof ReauthorizationRequiredError),
    )
  })

  it('names no token in the error it raises', async () => {
    const { provider } = harness({
      row: authRow({
        google_refresh_token: null,
        google_token_expires_at: A_MINUTE_AGO(),
      }),
    })

    try {
      await provider('user-uuid')
      assert.fail('expected a throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      assert.ok(!message.includes('stored-access-token'))
      assert.ok(!message.includes('stored-refresh-token'))
      assert.ok(!message.includes('v1.'))
    }
  })
})
