import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'

import { pool } from '../db/pool.js'
import { logger } from '../logger.js'
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
  const users = createUserRepository(pool)

  const handleGoogleProfile = createGoogleProfileHandler({
    users,
    cipher: createTokenCipher(env.encryptionKey, env.previousEncryptionKeys),
  })

  // Only the id goes into the session. Storing the row would put an email, and
  // one day a token, into Redis and into every session read.
  passport.serializeUser((user, done) => {
    done(null, (user as { id: string }).id)
  })

  passport.deserializeUser((id: string, done) => {
    users
      .findById(id)
      // A deleted account leaves a live cookie behind. `false` makes Passport
      // treat the request as signed out rather than throwing on every call.
      .then((user) => {
        done(null, user ?? false)
      })
      .catch((err: unknown) => {
        done(err instanceof Error ? err : new Error('Failed to load the session user'))
      })
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
            // The message only: an error from the token exchange is not an
            // object to log whole.
            logger.error(
              { error: err instanceof Error ? err.message : 'unknown error' },
              'Google sign-in failed',
            )
            done(new Error('Google sign-in failed'))
          })
      },
    ),
  )

  return passport
}
