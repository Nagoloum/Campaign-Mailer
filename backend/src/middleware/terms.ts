import type { NextFunction, Request, Response } from 'express'

import { CURRENT_TERMS_VERSION } from '../services/terms.js'

/**
 * Refuses the service until the current terms are accepted.
 *
 * Mounted in front of the routes that do the work — campaigns, the dashboard,
 * the templates — and deliberately not in front of the account routes: taking
 * a copy of one's data and deleting one's account are rights, and they do not
 * wait on accepting anything.
 *
 * The interface shows the acceptance screen first, so a person never meets
 * this refusal; it is the enforcement, not the experience.
 */
export function requireCurrentTerms(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.user as { terms_version?: string | null } | undefined

  if (!user) {
    // No session: the router behind answers 401, which is the truer answer.
    next()
    return
  }

  if (user.terms_version !== CURRENT_TERMS_VERSION) {
    res.status(403).json({
      error: 'The current terms have not been accepted',
      code: 'terms_not_accepted',
    })
    return
  }

  next()
}
