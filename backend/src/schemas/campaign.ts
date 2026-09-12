import { z } from 'zod'

/**
 * Payload shapes for the campaign routes.
 *
 * The bounds mirror the CHECK constraints in the initial migration on purpose.
 * The database is the boundary a script or a manual UPDATE cannot walk around;
 * these exist so a user gets a readable message instead of a constraint
 * violation, and so both say the same thing.
 */

/** Long enough for a real newsletter, short enough that a paste cannot fill the table. */
const MAX_BODY = 100_000
const MAX_SUBJECT = 500
const MAX_NAME = 200

/**
 * Gmail allows roughly 150 a day on a personal account and 1500 on Workspace.
 * The upper bound here is the ceiling of what the platform could ever permit;
 * GMAIL_DAILY_LIMIT caps the application well below it at send time.
 */
const MIN_MAILS_PER_DAY = 1
const MAX_MAILS_PER_DAY = 1500

/** Sending in a burst is what gets an account flagged, so a floor, not zero. */
const MIN_PAUSE_MS = 1000
const MAX_PAUSE_MS = 600_000

/**
 * An IANA zone name, and nothing else.
 *
 * Intl accepts a fixed offset such as `+02:00` as a valid time zone, and that
 * would quietly break the campaign: an offset does not follow daylight saving,
 * so "send at 9 in the morning" would go out at 8 or at 10 for half the year.
 * Only a Region/City name, or UTC, carries the rules.
 *
 * The name is then checked against the runtime's own database rather than a
 * regular expression, so a plausible but non-existent city is refused.
 */
const ZONE_SEGMENT = /^[A-Za-z0-9_+-]{1,20}$/

function looksLikeZoneName(value: string): boolean {
  if (value === 'UTC') {
    return true
  }

  // Split and check each part, rather than one expression with a quantifier
  // inside a quantifier. That shape is what catastrophic backtracking is built
  // from, and here it buys nothing.
  const parts = value.split('/')

  return (
    parts.length >= 2 &&
    parts.length <= 3 &&
    parts.every((part) => ZONE_SEGMENT.test(part))
  )
}

function isTimeZone(value: string): boolean {
  if (!looksLikeZoneName(value)) {
    return false
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: 'Unknown time zone' })

const cadence = {
  mails_per_day: z.number().int().min(MIN_MAILS_PER_DAY).max(MAX_MAILS_PER_DAY),
  start_hour: z.number().int().min(0).max(23),
  pause_ms: z.number().int().min(MIN_PAUSE_MS).max(MAX_PAUSE_MS),
  timezone,
}

const content = {
  // Trimmed before length is judged, so a name of spaces is empty, not valid.
  name: z.string().trim().min(1).max(MAX_NAME),
  subject: z.string().trim().max(MAX_SUBJECT),
  body_html: z.string().max(MAX_BODY),
  body_text: z.string().max(MAX_BODY),
}

export const createCampaignSchema = z
  .object({
    name: content.name,
    subject: content.subject.optional(),
    body_html: content.body_html.optional(),
    body_text: content.body_text.optional(),
    mails_per_day: cadence.mails_per_day.optional(),
    start_hour: cadence.start_hour.optional(),
    pause_ms: cadence.pause_ms.optional(),
    timezone: cadence.timezone.optional(),
  })
  // Unknown keys are refused rather than dropped. A typo in a field name would
  // otherwise be accepted in silence and the value never stored.
  .strict()

/**
 * Every field optional, but at least one present: an empty PATCH is almost
 * always a bug in the caller, and answering 200 to it hides that.
 */
export const updateCampaignSchema = createCampaignSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No field to update',
  })

/** Which of a payload's fields are content, and which are cadence. */
export const CONTENT_FIELDS = ['name', 'subject', 'body_html', 'body_text'] as const
export const CADENCE_FIELDS = [
  'mails_per_day',
  'start_hour',
  'pause_ms',
  'timezone',
] as const

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>

export const previewSchema = z
  .object({
    // A preview may target a stored contact, or made-up values when no contact
    // has been imported yet.
    contact_id: z.uuid().optional(),
    contact: z
      .object({
        email: z.string().max(320).optional(),
        contact_name: z.string().max(200).optional(),
        company_name: z.string().max(200).optional(),
        salutation: z.string().max(100).optional(),
      })
      .optional(),
  })
  .strict()

export type PreviewInput = z.infer<typeof previewSchema>
