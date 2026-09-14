import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it } from 'node:test'

import { createTokenCipher } from './encryption.js'

const OLD = crypto.randomBytes(32).toString('hex')
const NEW = crypto.randomBytes(32).toString('hex')
const UNRELATED = crypto.randomBytes(32).toString('hex')

describe('a cipher during a key rotation', () => {
  it('still reads what the previous key encrypted', () => {
    const before = createTokenCipher(OLD)
    const during = createTokenCipher(NEW, [OLD])

    assert.equal(during.decrypt(before.encrypt('refresh-token')), 'refresh-token')
  })

  it('writes with the new key only', () => {
    const during = createTokenCipher(NEW, [OLD])
    const newOnly = createTokenCipher(NEW)
    const oldOnly = createTokenCipher(OLD)
    const bundle = during.encrypt('refresh-token')

    assert.equal(newOnly.decrypt(bundle), 'refresh-token')
    assert.throws(() => oldOnly.decrypt(bundle))
  })

  it('reads the current key’s bundles too', () => {
    const during = createTokenCipher(NEW, [OLD])
    assert.equal(during.decrypt(createTokenCipher(NEW).encrypt('x')), 'x')
  })

  it('refuses a bundle neither key encrypted, with the same message as ever', () => {
    const during = createTokenCipher(NEW, [OLD])
    const foreign = createTokenCipher(UNRELATED).encrypt('x')

    assert.throws(() => during.decrypt(foreign), /Unable to decrypt: wrong key/)
  })

  it('refuses a malformed previous key at construction, not on first use', () => {
    assert.throws(() => createTokenCipher(NEW, ['not-hex']), /hex encoded/)
    assert.throws(() => createTokenCipher(NEW, ['ab']), /32 bytes/)
  })

  it('still detects a bundle altered in the database', () => {
    const during = createTokenCipher(NEW, [OLD])
    const bundle = createTokenCipher(OLD).encrypt('refresh-token')
    const [version, iv, tag, body] = bundle.split('.') as [string, string, string, string]
    const flipped = Buffer.from(body, 'base64url')
    flipped[0] = (flipped[0] ?? 0) ^ 0xff

    assert.throws(() =>
      during.decrypt([version, iv, tag, flipped.toString('base64url')].join('.')),
    )
  })
})
