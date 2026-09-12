import type { TokenCipher } from './encryption.js'
import type { GoogleProfile, UserRepository, UserRow } from './users.js'

/**
 * Everything the application asks Google for, and nothing more.
 *
 * gmail.send is sensitive: it permits sending as the user and gives no read
 * access to the mailbox. Adding gmail.readonly or gmail.modify would make the
 * scope set restricted instead, which pulls the project into an annual
 * third-party security assessment. See docs/google-oauth-setup.md.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.send',
] as const

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  callbackUrl: string
}

export function buildStrategyOptions(config: GoogleOAuthConfig) {
  return {
    clientID: config.clientId,
    clientSecret: config.clientSecret,
    callbackURL: config.callbackUrl,
    // Belongs here, not in the authorization options. passport-oauth2 reads
    // `state` at construction to install a session-backed state store; passed
    // to authenticate() instead, it is treated as a literal value to forward
    // and no CSRF protection is installed at all.
    //
    // The state ties the callback to the session that began the flow. Without
    // it an attacker can make a victim's browser finish an OAuth flow the
    // victim never started, signing them into the attacker's account.
    state: true,
  }
}

/**
 * Options for the redirect to Google.
 *
 * accessType offline is what makes Google issue a refresh token at all, and
 * prompt consent is what makes it issue one again. Google returns a refresh
 * token only on first authorization; without forcing the consent screen, a
 * user who reconnects after the record was lost would leave the application
 * with an access token it cannot renew.
 */
export function buildAuthorizationOptions() {
  return {
    scope: [...GOOGLE_SCOPES],
    accessType: 'offline' as const,
    prompt: 'consent' as const,
  }
}

/** What Google returns alongside the tokens. Only the lifetime is used. */
export interface GoogleTokenParams {
  expires_in?: number
}

export interface GoogleProfileHandlerDeps {
  // Only the one method it calls. A wider dependency would force every fake
  // and every future caller to satisfy methods this handler never touches.
  users: Pick<UserRepository, 'upsertFromGoogle'>
  cipher: TokenCipher
}

/**
 * Turns a Google profile into a stored user.
 *
 * The tokens are encrypted here, at the edge, so no layer below this one ever
 * holds a readable Google credential.
 */
export function createGoogleProfileHandler({ users, cipher }: GoogleProfileHandlerDeps) {
  return async function handleGoogleProfile(
    accessToken: string,
    refreshToken: string | undefined,
    profile: GoogleProfile,
    params?: GoogleTokenParams,
  ): Promise<UserRow> {
    if (!profile.id) {
      throw new Error('Google returned a profile with no Google id')
    }

    const email = profile.emails?.[0]?.value

    if (!email) {
      throw new Error('Google returned a profile with no email address')
    }

    // An empty string and an absent value mean the same thing here: Google
    // sent nothing, so whatever is already stored must survive.
    const hasRefreshToken = typeof refreshToken === 'string' && refreshToken.length > 0

    const expiresIn = params?.expires_in

    return users.upsertFromGoogle({
      googleId: profile.id,
      email: email.toLowerCase(),
      accessToken: cipher.encrypt(accessToken),
      refreshToken: hasRefreshToken ? cipher.encrypt(refreshToken) : undefined,
      accessTokenExpiresAt:
        typeof expiresIn === 'number'
          ? new Date(Date.now() + expiresIn * 1000)
          : undefined,
    })
  }
}
