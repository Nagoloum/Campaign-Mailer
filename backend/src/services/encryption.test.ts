import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it } from 'node:test'

import { createTokenCipher } from './encryption.js'

const KEY = crypto.randomBytes(32).toString('hex')
const OTHER_KEY = crypto.randomBytes(32).toString('hex')

/** Splits a bundle, asserting its shape so the tests can index it safely. */
function parts(bundle: string): [string, string, string, string] {
  const split = bundle.split('.')
  assert.equal(split.length, 4, 'expected a four-part bundle')
  return split as [string, string, string, string]
}

describe('createTokenCipher', () => {
  it('round-trips a token', () => {
    const cipher = createTokenCipher(KEY)
    const token = '1//0eXaMpLe-refresh-token_value'

    assert.equal(cipher.decrypt(cipher.encrypt(token)), token)
  })

  it('round-trips a value with non-ASCII characters', () => {
    const cipher = createTokenCipher(KEY)
    const value = 'accentué — 日本語 — 🔐'

    assert.equal(cipher.decrypt(cipher.encrypt(value)), value)
  })

  it('round-trips an empty string', () => {
    const cipher = createTokenCipher(KEY)

    assert.equal(cipher.decrypt(cipher.encrypt('')), '')
  })

  it('produces a different ciphertext every time', () => {
    const cipher = createTokenCipher(KEY)
    const token = 'same-token'

    // A fixed IV would let anyone holding two rows see that two users share a
    // token, and would break GCM outright.
    assert.notEqual(cipher.encrypt(token), cipher.encrypt(token))
  })

  it('never leaves the plaintext visible in the output', () => {
    const cipher = createTokenCipher(KEY)
    const token = 'ya29.a0ARecognizableSecret'

    assert.ok(!cipher.encrypt(token).includes('Recognizable'))
  })

  it('carries a version prefix, so the format can change later', () => {
    const cipher = createTokenCipher(KEY)

    assert.match(cipher.encrypt('x'), /^v1\./)
  })

  describe('rejects', () => {
    it('a key that is not 32 bytes', () => {
      assert.throws(() => createTokenCipher('abcd'), /32 bytes/)
    })

    it('a key that is not hexadecimal', () => {
      assert.throws(() => createTokenCipher('z'.repeat(64)), /hex/i)
    })

    it('an empty key, which is what a missing variable looks like', () => {
      assert.throws(() => createTokenCipher(''), /32 bytes/)
    })

    it('a ciphertext produced under another key', () => {
      const mine = createTokenCipher(KEY)
      const theirs = createTokenCipher(OTHER_KEY)

      assert.throws(() => mine.decrypt(theirs.encrypt('token')), /Unable to decrypt/)
    })

    it('a tampered ciphertext', () => {
      const cipher = createTokenCipher(KEY)
      const [version, iv, tag, body] = parts(cipher.encrypt('token'))
      const flipped = Buffer.from(body, 'base64url')
      // readUInt8 rather than flipped[0], which noUncheckedIndexedAccess types
      // as possibly undefined.
      flipped.writeUInt8(flipped.readUInt8(0) ^ 0xff, 0)

      assert.throws(
        () => cipher.decrypt(`${version}.${iv}.${tag}.${flipped.toString('base64url')}`),
        /Unable to decrypt/,
      )
    })

    it('a tampered authentication tag', () => {
      const cipher = createTokenCipher(KEY)
      const [version, iv, , body] = parts(cipher.encrypt('token'))
      const forged = crypto.randomBytes(16).toString('base64url')

      assert.throws(
        () => cipher.decrypt(`${version}.${iv}.${forged}.${body}`),
        /Unable to decrypt/,
      )
    })

    it('a malformed bundle', () => {
      const cipher = createTokenCipher(KEY)

      for (const bad of ['', 'plain text', 'v1.only.three', 'v1.a.b.c.d']) {
        assert.throws(() => cipher.decrypt(bad), /Unable to decrypt|Unsupported/)
      }
    })

    it('an unknown format version', () => {
      const cipher = createTokenCipher(KEY)
      const rest = cipher.encrypt('token').split('.').slice(1).join('.')

      assert.throws(() => cipher.decrypt(`v9.${rest}`), /Unsupported/)
    })
  })

  it('never names the value it failed to decrypt', () => {
    const cipher = createTokenCipher(KEY)
    const secret = 'ya29.LeakMePlease'
    const bundle = createTokenCipher(OTHER_KEY).encrypt(secret)

    // An error message ends up in logs and in error reporting. A decryption
    // failure must not carry the ciphertext, and must never carry a plaintext.
    try {
      cipher.decrypt(bundle)
      assert.fail('expected a throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      assert.ok(!message.includes(secret))
      assert.ok(!message.includes(bundle))
    }
  })
})
