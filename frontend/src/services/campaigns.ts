import { api } from './api'

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed'

export interface Campaign {
  id: string
  name: string
  subject: string | null
  bodyHtml: string | null
  bodyText: string | null
  attachmentName: string | null
  status: CampaignStatus
  totalContacts: number
  sentCount: number
  errorCount: number
  mailsPerDay: number
  startHour: number
  pauseMs: number
  timezone: string
  createdAt: string
  updatedAt: string
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface StarterTemplate {
  id: string
  name: string
  description: string
  subject: string
  bodyText: string
  bodyHtml: string
}

export interface Preview {
  subject: string
  bodyHtml: string
  bodyText: string
  contact: Record<string, string | null>
}

/** Mirrors the server's list, fetched rather than duplicated so the two cannot drift. */
export interface TemplateCatalogue {
  templates: StarterTemplate[]
  variables: string[]
}

export const campaignsApi = {
  list: () => api.get<{ campaigns: Campaign[] }>('/campaigns').then((r) => r.campaigns),

  get: (id: string) =>
    api.get<{ campaign: Campaign }>(`/campaigns/${id}`).then((r) => r.campaign),

  create: (input: {
    name: string
    subject?: string
    body_html?: string
    body_text?: string
  }) => api.post<{ campaign: Campaign }>('/campaigns', input).then((r) => r.campaign),

  update: (id: string, patch: Record<string, unknown>) =>
    api.patch<{ campaign: Campaign }>(`/campaigns/${id}`, patch).then((r) => r.campaign),

  remove: (id: string) => api.delete(`/campaigns/${id}`),

  preview: (
    id: string,
    source: { contact_id?: string; contact?: Record<string, string> },
  ) =>
    api
      .post<{ preview: Preview }>(`/campaigns/${id}/preview`, source)
      .then((r) => r.preview),

  templates: () => api.get<TemplateCatalogue>('/templates'),

  start: (id: string) =>
    api.post<{ campaign: Campaign }>(`/campaigns/${id}/start`).then((r) => r.campaign),

  pause: (id: string) =>
    api.post<{ campaign: Campaign }>(`/campaigns/${id}/pause`).then((r) => r.campaign),

  resume: (id: string) =>
    api.post<{ campaign: Campaign }>(`/campaigns/${id}/resume`).then((r) => r.campaign),
}

export interface SendSchedule {
  remaining: number
  days: number
  /** The last day messages go out, counted from today. */
  lastDay: Date
  /** Roughly how long one day's sending takes, pauses included. */
  minutesPerDay: number
}

/**
 * What launching commits the user to, in days and minutes.
 *
 * An estimate, and said to be one: it counts from today in the browser's
 * calendar, and ignores the account ceiling another campaign may be spending.
 * A campaign started after its start hour begins at once, so today is always
 * the first day.
 */
export function estimateSchedule(
  campaign: Pick<
    Campaign,
    'totalContacts' | 'sentCount' | 'errorCount' | 'mailsPerDay' | 'pauseMs'
  >,
  today: Date = new Date(),
): SendSchedule | null {
  const remaining = campaign.totalContacts - campaign.sentCount - campaign.errorCount

  if (remaining <= 0 || campaign.mailsPerDay <= 0) {
    return null
  }

  const days = Math.ceil(remaining / campaign.mailsPerDay)
  const lastDay = new Date(today)
  lastDay.setDate(lastDay.getDate() + days - 1)

  const perDay = Math.min(remaining, campaign.mailsPerDay)
  // The average jitter is ten percent on top of the pause.
  const minutesPerDay = Math.ceil((perDay * campaign.pauseMs * 1.1) / 60_000)

  return { remaining, days, lastDay, minutesPerDay }
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Brouillon',
  scheduled: 'Programmée',
  running: 'En cours',
  paused: 'En pause',
  completed: 'Terminée',
}

export function statusLabel(status: CampaignStatus): string {
  return STATUS_LABELS[status]
}

/**
 * Only a draft can be edited. Mirrors the server rule so the interface does not
 * offer an action the API will refuse with a 409.
 */
export function isEditable(status: CampaignStatus): boolean {
  return status === 'draft'
}

/**
 * The pace stays editable while the campaign is not actively sending. Mirrors
 * the server rule, so the interface never offers an action the API refuses.
 */
export function canEditCadence(status: CampaignStatus): boolean {
  return status === 'draft' || status === 'scheduled' || status === 'paused'
}
