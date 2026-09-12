import { Router } from 'express'

import { isUuid, requireAuth } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  CADENCE_FIELDS,
  CONTENT_FIELDS,
  createCampaignSchema,
  previewSchema,
  updateCampaignSchema,
  type CreateCampaignInput,
  type PreviewInput,
  type UpdateCampaignInput,
} from '../schemas/campaign.js'
import { canDelete, canEditCadence, canEditContent } from '../services/campaignState.js'
import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import { renderPreview, type PreviewSource } from '../services/preview.js'

/**
 * Section 6 of the specification, for campaigns.
 *
 * Every route is behind `requireAuth`, and every query is scoped by the
 * signed-in user's id rather than filtered afterwards: a campaign belonging to
 * someone else is simply not found, which is the same answer as one that never
 * existed.
 */
export function createCampaignRouter(campaigns: CampaignRepository): Router {
  const router = Router()

  router.use(requireAuth)

  const userId = (req: { user?: unknown }): string => (req.user as { id: string }).id

  /**
   * The campaign id from the path, or null.
   *
   * Express types a route parameter as string | string[] once a middleware
   * precedes the handler, since a wildcard can match several segments. The
   * shape is checked before the value reaches Postgres, because `WHERE id = $1`
   * against a uuid column raises a syntax error on anything else, which would
   * answer 500 where an unknown id answers 404 and let the two be told apart.
   */
  const paramId = (req: { params: Record<string, unknown> }): string | null =>
    isUuid(req.params.id) ? req.params.id : null

  router.get('/', (req, res, next) => {
    campaigns
      .listForUser(userId(req))
      .then((rows) => {
        res.json({ campaigns: rows.map(toPublicCampaign) })
      })
      .catch(next)
  })

  router.post('/', validateBody(createCampaignSchema), (req, res, next) => {
    const input = req.body as CreateCampaignInput

    campaigns
      .create(userId(req), input)
      .then((row) => {
        res.status(201).json({ campaign: toPublicCampaign(row) })
      })
      .catch(next)
  })

  router.get('/:id', (req, res, next) => {
    void (async () => {
      const id = paramId(req)
      const row = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!row) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      res.json({ campaign: toPublicCampaign(row) })
    })().catch(next)
  })

  router.patch('/:id', validateBody(updateCampaignSchema), (req, res, next) => {
    void (async () => {
      const patch = req.body as UpdateCampaignInput
      const id = paramId(req)
      const current = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!current) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      const refusal = refuseEdit(current, patch)

      if (refusal) {
        // 409, not 400: the payload was fine, the campaign had moved on.
        res.status(409).json({ error: refusal })
        return
      }

      const updated = await campaigns.update(current.id, patch)

      res.json({ campaign: toPublicCampaign(updated ?? current) })
    })().catch(next)
  })

  /**
   * Renders the campaign as a recipient would receive it.
   *
   * POST rather than GET because the payload may carry made-up values, and a
   * body is the honest place for them. Nothing is stored.
   */
  router.post('/:id/preview', validateBody(previewSchema), (req, res, next) => {
    void (async () => {
      const input = req.body as PreviewInput
      const id = paramId(req)
      const campaign = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      let source: PreviewSource | undefined = input.contact

      if (input.contact_id) {
        const contact = await campaigns.findContact(campaign.id, input.contact_id)

        if (!contact) {
          res.status(404).json({ error: 'Contact not found in this campaign' })
          return
        }

        source = contact
      }

      res.json({ preview: renderPreview(campaign, source) })
    })().catch(next)
  })

  router.delete('/:id', (req, res, next) => {
    void (async () => {
      const id = paramId(req)
      const current = id ? await campaigns.findForUser(id, userId(req)) : null

      if (!current) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      if (!canDelete(current.status)) {
        res.status(409).json({
          error: 'A sending campaign cannot be deleted. Pause it first.',
        })
        return
      }

      await campaigns.remove(current.id)
      res.status(204).end()
    })().catch(next)
  })

  return router
}

/**
 * Why an edit is refused, or null when it is allowed.
 *
 * The state machine decides; this only reports which half of the payload the
 * campaign's state forbids.
 */
function refuseEdit(current: CampaignRow, patch: UpdateCampaignInput): string | null {
  const touchesContent = CONTENT_FIELDS.some((field) => field in patch)
  const touchesCadence = CADENCE_FIELDS.some((field) => field in patch)

  if (touchesContent && !canEditContent(current.status)) {
    return `The subject and body of a ${current.status} campaign can no longer change`
  }

  if (touchesCadence && !canEditCadence(current.status)) {
    return `The pace of a ${current.status} campaign can no longer change`
  }

  return null
}

/** The shape a client sees. user_id stays server-side; it tells a client nothing. */
function toPublicCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    attachmentName: row.attachment_name,
    status: row.status,
    totalContacts: row.total_contacts,
    sentCount: row.sent_count,
    errorCount: row.error_count,
    mailsPerDay: row.mails_per_day,
    startHour: row.start_hour,
    pauseMs: row.pause_ms,
    timezone: row.timezone,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    scheduledAt: row.scheduled_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  }
}
