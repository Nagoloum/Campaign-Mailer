import crypto from 'node:crypto'

/**
 * Authenticated encryption for the Google tokens held in the users table.
 *
 * AES-256-GCM rather than CBC: GCM authenticates the ciphertext, so a row
 * altered in the database fails to decrypt instead of yielding a token that
 * looks plausible and is not.
 *
 * The bundle is `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version
 * is there so the algorithm or the key derivation can change later without
 * having to guess what an existing row was encrypted with.
 *
 * Key rotation (docs/security.md): the cipher always encrypts with the current
 * key, and decrypts with the current key or any previous one. GCM's tag tells a
 * wrong key from a right one, so trying each in turn is safe, and during a
 * rotation every stored token stays readable until it has been re-encrypted.
 */

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // The size GCM is specified for; anything else weakens it.
const KEY_BYTES = 32

export interface TokenCipher {
  encrypt(plaintext: string): string
  decrypt(bundle: string): string
}

function parseKey(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(keyHex)) {
    throw new Error('Encryption key must be hex encoded')
  }

  if (keyHex.length !== KEY_BYTES * 2) {
    throw new Error(
      `Encryption key must be ${KEY_BYTES} bytes, hex encoded (${KEY_BYTES * 2} characters)`,
    )
  }

  return Buffer.from(keyHex, 'hex')
}

function open(key: Buffer, ivPart: string, tagPart: string, bodyPart: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * @param keyHex 32 bytes, hex encoded, so 64 characters. Encrypts and decrypts.
 *   Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * @param previousKeysHex keys retired by a rotation. They only decrypt.
 */
export function createTokenCipher(
  keyHex: string,
  previousKeysHex: readonly string[] = [],
): TokenCipher {
  const key = parseKey(keyHex)
  const readable = [key, ...previousKeysHex.map(parseKey)]

  return {
    encrypt(plaintext: string): string {
      const iv = crypto.randomBytes(IV_BYTES)
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()

      return [
        VERSION,
        iv.toString('base64url'),
        tag.toString('base64url'),
        body.toString('base64url'),
      ].join('.')
    },

    decrypt(bundle: string): string {
      const parts = bundle.split('.')

      if (parts.length !== 4 || parts[0] !== VERSION) {
        // Says what is wrong with the shape, never what the value was.
        throw new Error('Unsupported ciphertext format')
      }

      const [, ivPart, tagPart, bodyPart] = parts as [string, string, string, string]

      for (const candidate of readable) {
        try {
          return open(candidate, ivPart, tagPart, bodyPart)
        } catch {
          // The tag did not verify under this key; try the next one.
        }
      }

      // The underlying error carries no secret, but it does distinguish a bad
      // tag from a bad key, which is a detail an attacker can use and an
      // operator cannot. One message for every failure.
      throw new Error('Unable to decrypt: wrong key, or the value was altered')
    },
  }
}
