import type { Pool } from 'pg'

import {
  dispatchCampaign,
  listDispatchableCampaignIds,
  type DispatchDeps,
  type DispatchOutcome,
  type SendJobData,
} from '../services/dispatch.js'
import {
  pauseCampaign,
  recordFailureById,
  sendToContact,
  type SendEngineDeps,
  type SendOutcome,
} from '../services/sendEngine.js'

/**
 * What the workers do, without the workers.
 *
 * BullMQ only calls these. Keeping them free of Job and Worker means the whole
 * pipeline — plan, send, retry, give up — runs in a test against the real
 * database with no Redis at all.
 */

export const REAUTHORIZATION_MESSAGE =
  'Accès Google expiré ou révoqué. Reconnectez votre compte, puis reprenez la campagne.'

export function createSendProcessor(engine: SendEngineDeps) {
  return async function processSend(data: SendJobData): Promise<SendOutcome> {
    const outcome = await sendToContact(engine, {
      contactId: data.contactId,
      userId: data.userId,
    })

    if (outcome.kind === 'paused' && outcome.reason === 'reauthorization_required') {
      // Paused once: the jobs behind this one find the campaign no longer
      // running and claim nothing, so the reason is logged once too.
      await pauseCampaign(engine.pool, data.campaignId, REAUTHORIZATION_MESSAGE)
    }

    // daily_limit_reached pauses the sending, not the campaign. The contact
    // stays pending and the next plan takes it once the 24-hour window frees;
    // flipping the status would make the user resume by hand every morning.
    return outcome
  }
}

/**
 * Called when a send job has used its last attempt.
 *
 * Only an error that was allowed to retry reaches here — a Gmail "not now", a
 * token endpoint outage, an unreachable attachment store — and none of them
 * reached a recipient, so marking the contact failed loses nothing but the
 * send the user can relaunch.
 */
export async function failAfterLastAttempt(
  pool: Pool,
  data: SendJobData,
  error: Error,
): Promise<void> {
  await recordFailureById(
    pool,
    data.contactId,
    `Échec après plusieurs tentatives : ${error.message}`,
  )
}

export function createDispatchProcessor(deps: DispatchDeps) {
  return async function processDispatch(data: {
    campaignId?: string | undefined
  }): Promise<Map<string, DispatchOutcome>> {
    const ids = data.campaignId
      ? [data.campaignId]
      : await listDispatchableCampaignIds(deps.pool)

    const outcomes = new Map<string, DispatchOutcome>()

    for (const id of ids) {
      try {
        outcomes.set(id, await dispatchCampaign(deps, id))
      } catch (err) {
        // One campaign failing to plan must not starve the others of their day.
        console.error('Dispatch failed for a campaign', {
          campaignId: id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return outcomes
  }
}
