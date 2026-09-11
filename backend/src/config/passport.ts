import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'

import { pool } from '../db/pool.js'
import { createTokenCipher } from '../services/encryption.js'
import {
  buildStrategyOptions,
  createGoogleProfileHandler,
  type GoogleTokenParams,
} from '../services/googleAuth.js'
import { createUserRepository } from '../services/users.js'
import { env } from './env.js'

/**
 * Registers the Google strategy.
 *
 * The session serializers belong to the session work and are not here yet, so
 * the strategy is configured but no route drives it. Mounting the routes and
 * the Redis-backed session is the next step.
 */
export function configurePassport(): typeof passport {
  const handleGoogleProfile = createGoogleProfileHandler({
    users: createUserRepository(pool),
    cipher: createTokenCipher(env.encryptionKey),
  })

  passport.use(
    new GoogleStrategy(
      buildStrategyOptions(env.google),
      // passport-google-oauth20 passes the token parameters when the strategy
      // is constructed with this arity. expires_in is what lets the refresh
      // service renew before a call fails rather than after.
      (
        accessToken: string,
        refreshToken: string | undefined,
        params: GoogleTokenParams,
        profile: { id: string; displayName?: string; emails?: { value: string }[] },
        done: (err: Error | null, user?: { id: string }) => void,
      ) => {
        handleGoogleProfile(accessToken, refreshToken, profile, params)
          .then((user) => {
            done(null, user)
          })
          .catch((err: unknown) => {
            // Never hand the raw error to Passport: it can carry the token
            // values that came back from Google.
            console.error('Google sign-in failed', err)
            done(new Error('Google sign-in failed'))
          })
      },
    ),
  )

  return passport
}
