import { api } from './api'
import type { CampaignStatus } from './campaigns'

export interface UpcomingSend {
  campaignId: string
  name: string
  status: CampaignStatus
  pending: number
  /** ISO instant, or null when nobody is left to send to. */
  nextSendAt: string | null
  estimatedEndAt: string | null
}

export interface Dashboard {
  campaigns: {
    total: number
    byStatus: Record<CampaignStatus, number>
  }
  account: {
    /** Messages this account sent over the last 24 hours, across every campaign. */
    sentLast24h: number
    dailyLimit: number
    remaining: number
  }
  /** Scheduled and running campaigns, soonest next send first. */
  upcoming: UpcomingSend[]
}

export const dashboardApi = {
  get: () => api.get<{ dashboard: Dashboard }>('/dashboard').then((r) => r.dashboard),
}
