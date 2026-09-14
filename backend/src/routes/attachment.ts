import express, { Router } from 'express'

import { isUuid, requireAuth } from '../middleware/auth.js'
import {
  AttachmentRejected,
  MAX_ATTACHMENT_BYTES,
  contentDisposition,
  extensionOfKey,
  safeFileName,
} from '../services/attachmentRules.js'
import { canEditContent } from '../services/campaignState.js'
import type { CampaignRepository } from '../services/campaigns.js'
import { deleteAttachment, getAttachment, putAttachment } from '../services/storage.js'

/**
 * The campaign's attachment: one file, replaced rather than accumulated.
 *
 * The body is the file itself rather than a multipart form. The browser can
 * post a File straight through fetch, so multipart buys nothing here and costs
 * a parser dependency; the filename travels in a header instead.
 */
/**
 * The filename header, decoded, or the default name.
 *
 * The client URI-encodes it; a stray `%` from any other client made
 * decodeURIComponent throw, which answered 500 for what is a naming detail.
 */
function decodeFileName(header: string | undefined): string {
  if (!header) {
    return 'piece-jointe'
  }

  try {
    return decodeURIComponent(header)
  } catch {
    return 'piece-jointe'
  }
}

export function createAttachmentRouter(campaigns: CampaignRepository): Router {
  const router = Router({ mergeParams: true })

  router.use(requireAuth)

  const userId = (req: { user?: unknown }): string => (req.user as { id: string }).id

  const load = async (req: { params: Record<string, unknown>; user?: unknown }) => {
    const raw: unknown = req.params.id
    return isUuid(raw) ? campaigns.findForUser(raw, userId(req)) : null
  }

  router.post(
    '/',
    // Any type is accepted at this layer so an unsupported one produces a
    // readable refusal rather than an empty body and a confusing 400.
    express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
    (req, res, next) => {
      void (async () => {
        const campaign = await load(req)

        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found' })
          return
        }

        if (!canEditContent(campaign.status)) {
          res.status(409).json({
            error: 'The attachment can no longer change once the campaign is scheduled',
          })
          return
        }

        // The header is URI-encoded by the client, because a filename with an
        // accent is not a valid header value as it stands.
        const rawName = decodeFileName(req.get('x-file-name'))
        const contentType = req.get('content-type') ?? ''

        let stored
        try {
          stored = await putAttachment(
            campaign.id,
            req.body as Buffer,
            rawName,
            contentType,
          )
        } catch (err) {
          if (err instanceof AttachmentRejected) {
            res.status(err.status).json({ error: err.message })
            return
          }
          throw err
        }

        const previousKey = campaign.attachment_key

        await campaigns.setAttachment(campaign.id, { key: stored.key, name: stored.name })

        // Only once the new one is recorded. Deleting first would leave the
        // campaign pointing at nothing if the upload failed.
        if (previousKey) {
          await deleteAttachment(previousKey).catch((err: unknown) => {
            // The campaign is already correct; an orphan object costs storage,
            // not correctness.
            console.error('Could not delete the replaced attachment', err)
          })
        }

        res.status(201).json({
          attachment: {
            name: stored.name,
            size: stored.size,
            contentType: stored.contentType,
          },
        })
      })().catch(next)
    },
  )

  router.get('/', (req, res, next) => {
    void (async () => {
      const campaign = await load(req)

      if (!campaign?.attachment_key) {
        res.status(404).json({ error: 'No attachment' })
        return
      }

      const body = await getAttachment(campaign.attachment_key)
      // The extension from the stored key, not a fixed "pdf": a Word document
      // used to download named .pdf and open as a broken file.
      const name = safeFileName(
        campaign.attachment_name ?? 'piece-jointe',
        extensionOfKey(campaign.attachment_key),
      )

      // attachment, not inline: a PDF rendered in the tab would run in this
      // origin.
      res.setHeader('content-disposition', contentDisposition(name))
      res.setHeader('content-type', 'application/octet-stream')
      res.send(body)
    })().catch(next)
  })

  router.delete('/', (req, res, next) => {
    void (async () => {
      const campaign = await load(req)

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      if (!canEditContent(campaign.status)) {
        res.status(409).json({
          error: 'The attachment can no longer change once the campaign is scheduled',
        })
        return
      }

      if (campaign.attachment_key) {
        await campaigns.setAttachment(campaign.id, null)
        await deleteAttachment(campaign.attachment_key).catch((err: unknown) => {
          console.error('Could not delete the attachment object', err)
        })
      }

      res.status(204).end()
    })().catch(next)
  })

  return router
}
