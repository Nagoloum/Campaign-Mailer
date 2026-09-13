/**
 * Deciding which contacts go out, and when.
 *
 * Pure on purpose: no database, no queue, no clock of its own. Every rule that
 * decides how many messages a user's account sends in a day lives here, where
 * a test can pin it without Redis or Postgres.
 */

/** Up to twenty percent added to each pause. A perfectly regular interval is a signature. */
const JITTER = 0.2

export interface PlanInput {
  now: Date
  /** IANA zone. The start hour is the user's morning, not the server's. */
  timezone: string
  startHour: number
  mailsPerDay: number
  pauseMs: number
  /** What this campaign sent over the last 24 hours. */
  sentByCampaign: number
  /** What the account sent over the last 24 hours, across every campaign. */
  sentByAccount: number
  accountLimit: number
  /** Oldest first. The plan takes from the front. */
  pendingContactIds: readonly string[]
  /** Injected so a test can pin the jitter. Defaults to Math.random. */
  random?: (() => number) | undefined
}

export interface PlannedSend {
  contactId: string
  /** From `now`. */
  delayMs: number
}

export type PlanOutcome =
  | { kind: 'planned'; sends: PlannedSend[] }
  | { kind: 'before_start_hour' }
  | { kind: 'campaign_quota_reached' }
  | { kind: 'account_quota_reached' }
  | { kind: 'nothing_pending' }

/** The hour on the wall clock in `timezone`, 0 to 23, daylight saving included. */
export function localHour(now: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .find((part) => part.type === 'hour')?.value

  return Number(hour)
}

export function planDay(input: PlanInput): PlanOutcome {
  if (localHour(input.now, input.timezone) < input.startHour) {
    return { kind: 'before_start_hour' }
  }

  if (input.pendingContactIds.length === 0) {
    return { kind: 'nothing_pending' }
  }

  const campaignBudget = input.mailsPerDay - input.sentByCampaign
  const accountBudget = input.accountLimit - input.sentByAccount

  // The account ceiling is checked first because it is the one that protects
  // the user's Google account; the campaign's own pace is a preference.
  if (accountBudget <= 0) {
    return { kind: 'account_quota_reached' }
  }

  if (campaignBudget <= 0) {
    return { kind: 'campaign_quota_reached' }
  }

  const random = input.random ?? Math.random
  const budget = Math.min(campaignBudget, accountBudget)
  const sends: PlannedSend[] = []
  let delayMs = 0

  for (const contactId of input.pendingContactIds.slice(0, budget)) {
    sends.push({ contactId, delayMs })
    delayMs += Math.round(input.pauseMs * (1 + random() * JITTER))
  }

  return { kind: 'planned', sends }
}
