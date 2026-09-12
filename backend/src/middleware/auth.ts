import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Matches the shape `gen_random_uuid()` produces. Checked before the value
 * reaches Postgres, because `WHERE id = $1` against a uuid column raises
 * `invalid input syntax for type uuid` on anything else: that surfaces as a
 * 500 and tells an attacker a malformed id apart from a real one.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = req.user as { id: string } | undefined

  if (!user?.id) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  next()
}

export interface CampaignOwnershipRepository {
  /** True when the campaign exists and belongs to that user. */
  belongsTo(campaignId: string, userId: string): Promise<boolean>
}

/**
 * Guards a route addressed by `:id` so a user only ever reaches their own
 * campaign.
 *
 * A campaign that exists but belongs to someone else answers **404, not 403**.
 * A 403 confirms the campaign is real, which is all an attacker needs to walk
 * the id space and map what exists. A 404 says nothing either way, and the
 * legitimate owner never sees it.
 */
export function createRequireCampaignOwner(
  campaigns: CampaignOwnershipRepository,
): RequestHandler {
  // async, so Express 5 forwards a rejection on its own and a test can await
  // the handler rather than racing its internal promise.
  return async (req, res, next) => {
    const user = req.user as { id: string } | undefined

    if (!user?.id) {
      res.status(401).json({ error: 'Not signed in' })
      return
    }

    // Express 5 types a route parameter as string | string[], because a
    // wildcard can match several segments. Only a single value is a candidate.
    const raw: unknown = req.params.id
    const campaignId = typeof raw === 'string' ? raw : ''

    if (!campaignId || !UUID.test(campaignId)) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    let owned: boolean

    try {
      owned = await campaigns.belongsTo(campaignId, user.id)
    } catch (err: unknown) {
      // A database failure is not a missing campaign. Answering 404 here would
      // hide an outage behind a plausible answer.
      next(err instanceof Error ? err : new Error('Ownership check failed'))
      return
    }

    if (!owned) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }

    next()
  }
}
