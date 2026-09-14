/**
 * The publisher's identity and the version of the terms.
 *
 * The identity comes from the build configuration (frontend/.env), not from
 * the source: it is shown to every visitor, but it does not belong in a public
 * repository. A missing value is displayed as such rather than invented.
 */

function read(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export const LEGAL = {
  publisher: read(import.meta.env.VITE_LEGAL_PUBLISHER),
  email: read(import.meta.env.VITE_LEGAL_EMAIL),
  phone: read(import.meta.env.VITE_LEGAL_PHONE),
  address: read(import.meta.env.VITE_LEGAL_ADDRESS),
  country: read(import.meta.env.VITE_LEGAL_COUNTRY) ?? 'France',
}

/**
 * The version of the terms and privacy policy a user accepts.
 *
 * Must equal CURRENT_TERMS_VERSION in backend/src/services/terms.ts; a backend
 * test reads this file to make sure the two never drift. Changing it asks
 * every user to accept again at their next visit.
 */
export const TERMS_VERSION = '2026-09-14'

/** The same date, as the pages print it. */
export const TERMS_UPDATED = '14 septembre 2026'
