import { Router } from 'express'
import { z } from 'zod'

import { SESSION_COOKIE_NAME } from '../config/session.js'
import { requireAuth } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import type { DeletionReport } from '../services/accountDeletion.js'
import type { AuditLog } from '../services/audit.js'
import { contactsToCsv, type UserExport } from '../services/userExport.js'

export interface UsersRouterDeps {
  deleteAccount: (userId: string) => Promise<DeletionReport>
  exportUser: (userId: string) => Promise<UserExport | null>
  /** Records each export and each deletion. */
  audit?: AuditLog | undefined
}

/**
 * The address, typed again. Not a password — the account has none — but proof
 * the person meant this account and this action, which a stray click, a
 * shared screen or a script replaying a request does not supply.
 */
const deleteAccountSchema = z
  .object({ email: z.string().trim().min(1).max(320) })
  .strict()

export function createUsersRouter({
  deleteAccount,
  exportUser,
  audit,
}: UsersRouterDeps): Router {
  const router = Router()

  router.use(requireAuth)

  /**
   * DELETE /api/users/me — the account and everything attached to it.
   *
   * Answers 200 with what could be done, not 204: a revocation or a purge that
   * failed is worth telling the user, who can then remove the application from
   * their Google account by hand.
   */
  router.delete('/me', validateBody(deleteAccountSchema), (req, res, next) => {
    void (async () => {
      const user = req.user as { id: string; email: string }
      const { email } = req.body as z.infer<typeof deleteAccountSchema>

      if (email.toLowerCase() !== user.email.toLowerCase()) {
        res
          .status(422)
          .json({ error: 'The address does not match the signed-in account' })
        return
      }

      const report = await deleteAccount(user.id)

      if (report.deleted) {
        // After the fact, and without a foreign key: the record of the deletion
        // outlives the account it describes.
        await audit?.record(user.id, 'account.deleted')
      }

      // The session now points at an account that no longer exists. It is
      // destroyed here rather than left to fail on the next request.
      req.logout((logoutErr) => {
        if (logoutErr) {
          next(logoutErr)
          return
        }

        req.session.destroy((destroyErr) => {
          if (destroyErr) {
            next(destroyErr)
            return
          }

          res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
          res.json({
            deleted: report.deleted,
            googleRevoked: report.googleRevoked,
            filesPurged: report.filesPurged,
          })
        })
      })
    })().catch(next)
  })

  /**
   * GET /api/users/me/export — everything held about the user, as a download.
   *
   * `format=json` (the default) is the complete record; `format=csv` is every
   * contact, the part most often opened in a spreadsheet. Never cached: both
   * hold personal data about the user and about the people they wrote to.
   */
  router.get('/me/export', (req, res, next) => {
    void (async () => {
      const user = req.user as { id: string }
      const data = await exportUser(user.id)

      if (!data) {
        res.status(404).json({ error: 'Account not found' })
        return
      }

      await audit?.record(user.id, 'account.exported')

      const day = data.exportedAt.slice(0, 10)
      res.setHeader('cache-control', 'no-store')

      if (req.query.format === 'csv') {
        res.setHeader('content-type', 'text/csv; charset=utf-8')
        res.setHeader(
          'content-disposition',
          `attachment; filename="campaign-mailer-contacts-${day}.csv"`,
        )
        res.send(contactsToCsv(data))
        return
      }

      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader(
        'content-disposition',
        `attachment; filename="campaign-mailer-donnees-${day}.json"`,
      )
      res.send(JSON.stringify(data, null, 2))
    })().catch(next)
  })

  return router
}
