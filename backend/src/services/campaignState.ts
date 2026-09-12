/**
 * The campaign lifecycle, and what each state permits.
 *
 * Section 5 of the specification names the states. What it does not say, and
 * what matters more, is which moves between them are legal and what may be
 * edited in each: a campaign whose body can change while it sends produces two
 * different messages under one name, with no record of which recipient got
 * which.
 */

export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
] as const

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/**
 * The whole graph, written out.
 *
 * Nothing returns to `draft` once sending has begun, because `draft` is the
 * only editable state. `completed` is terminal. A transition to the same state
 * is refused: it usually means a duplicated request, and rejecting it makes
 * the duplicate visible rather than silently accepted.
 */
// A Map rather than a plain object: indexing an object by a variable is an
// injection sink, and while this key is a typed union it costs nothing to use
// a structure where the question does not arise.
const ALLOWED = new Map<CampaignStatus, readonly CampaignStatus[]>([
  ['draft', ['scheduled']],
  // Unscheduling is allowed while nothing has gone out yet.
  ['scheduled', ['draft', 'running', 'paused']],
  ['running', ['paused', 'completed']],
  ['paused', ['running']],
  ['completed', []],
])

export class InvalidTransitionError extends Error {
  readonly status = 409

  constructor(from: CampaignStatus, to: CampaignStatus) {
    super(`A campaign cannot move from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return ALLOWED.get(from)?.includes(to) ?? false
}

/** Throws a 409-carrying error rather than returning false, for use in a route. */
export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

/**
 * Subject, body and attachment.
 *
 * Only a draft. Once scheduled, the first send can happen at any moment, and
 * there is no point after that where changing the message is safe.
 */
export function canEditContent(status: CampaignStatus): boolean {
  return status === 'draft'
}

/**
 * Pace, start hour and timezone.
 *
 * Editable whenever the campaign is not actively sending. A running campaign
 * already has its day planned; changing the pace under it would let the
 * campaign exceed the daily cap it was planned against.
 */
export function canEditCadence(status: CampaignStatus): boolean {
  return status === 'draft' || status === 'scheduled' || status === 'paused'
}

/**
 * Deleting cascades the contacts and the logs away. Doing that mid-send would
 * strand jobs that still reference them and lose the record of what already
 * went out, so a running campaign has to be paused first.
 */
export function canDelete(status: CampaignStatus): boolean {
  return status !== 'running'
}
