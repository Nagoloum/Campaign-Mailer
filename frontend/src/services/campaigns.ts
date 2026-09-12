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
