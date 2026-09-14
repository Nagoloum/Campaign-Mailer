import { api } from './api'

export interface DeletionReport {
  deleted: boolean
  /** False when Google could not be told; the user should remove access by hand. */
  googleRevoked: boolean
  filesPurged: boolean
}

export const accountApi = {
  /** The address typed again is the confirmation the server requires. */
  delete: (email: string) => api.deleteWith<DeletionReport>('/users/me', { email }),

  /** Plain links: the browser downloads, the session cookie rides along. */
  exportUrl: (format: 'json' | 'csv') => `/api/users/me/export?format=${format}`,
}

/** Where a Google user removes an application's access themselves. */
export const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions'
