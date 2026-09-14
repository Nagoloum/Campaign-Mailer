/**
 * Re-encrypts every stored Google token under ENCRYPTION_KEY.
 *
 *   npm run rotate:encryption-key --workspace backend
 *
 * Run it after setting the new key as ENCRYPTION_KEY and the retired one in
 * ENCRYPTION_KEY_PREVIOUS, with the API and the worker already running on that
 * configuration. The full procedure is in docs/security.md.
 */
import { env } from '../config/env.js'
import { closePool, pool } from '../db/pool.js'
import { createTokenCipher } from '../services/encryption.js'
import { reencryptTokens } from '../services/keyRotation.js'

if (env.previousEncryptionKeys.length === 0) {
  console.error(
    'ENCRYPTION_KEY_PREVIOUS is empty: there is no retired key to rotate away from.',
  )
  process.exitCode = 1
} else {
  const report = await reencryptTokens(
    pool,
    createTokenCipher(env.encryptionKey),
    createTokenCipher(env.encryptionKey, env.previousEncryptionKeys),
  )

  // Counts only. Never a token, never an address.
  console.log('Key rotation finished', report)

  if (report.unreadable > 0) {
    console.error(
      `${String(report.unreadable)} token(s) readable by no configured key were left untouched; those users must reconnect Google.`,
    )
    process.exitCode = 2
  }
}

await closePool()
