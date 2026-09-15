import type { BrowserOptions } from '@sentry/react'

/**
 * Browser-side error reporting to Sentry.
 *
 * Inactive without VITE_SENTRY_DSN. The SDK is loaded on demand, after the
 * first render, so a build without a DSN ships none of it to the visitor and a
 * build with one does not make the first paint wait on it. The price: an error
 * thrown before the SDK has loaded is not reported, and it is still logged in
 * the console.
 *
 * Events leave without the user, without query strings (the OAuth callback
 * carries a code in its URL) and without console breadcrumbs, where a CSV
 * preview could have printed a contact.
 */

type SentryEvent = Parameters<NonNullable<BrowserOptions['beforeSend']>>[0]
type Breadcrumb = Parameters<NonNullable<BrowserOptions['beforeBreadcrumb']>>[0]
type Capture = (error: unknown, extra: Record<string, unknown> | undefined) => void

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g

const redact = (text: string) => text.replace(EMAIL, '[email]')
const withoutQuery = (url: string) => url.split(/[?#]/)[0] ?? ''

function scrubEvent(event: SentryEvent): SentryEvent {
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
    if (event.request.url) {
      event.request.url = withoutQuery(event.request.url)
    }
  }

  delete event.user

  if (event.message) {
    event.message = redact(event.message)
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = redact(exception.value)
    }
  }

  return event
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') {
    return null
  }

  if (breadcrumb.data) {
    for (const key of ['url', 'from', 'to']) {
      const value: unknown = breadcrumb.data[key]
      if (typeof value === 'string') {
        breadcrumb.data[key] = withoutQuery(value)
      }
    }
  }

  if (breadcrumb.message) {
    breadcrumb.message = redact(breadcrumb.message)
  }

  return breadcrumb
}

let capture: Capture | null = null

export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN

  if (!dsn) {
    return
  }

  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      })
      capture = (error, extra) => {
        Sentry.captureException(error, extra ? { extra } : undefined)
      }
    })
    .catch((err: unknown) => {
      // Blocked by an extension or offline: the application works without it.
      console.warn('Error reporting could not start', err)
    })
}

export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  capture?.(error, extra)
}

/**
 * For React's root error callbacks. Passing them replaces React's own console
 * output, so the error is logged here first.
 */
export function onReactError(
  error: unknown,
  info: { componentStack?: string | undefined },
): void {
  console.error(error)
  reportError(error, { componentStack: info.componentStack })
}
