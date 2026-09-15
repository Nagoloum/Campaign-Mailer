import * as Sentry from '@sentry/node'

/**
 * Error reporting to Sentry, for the API and the worker.
 *
 * Inactive without SENTRY_DSN: every call below is then a no-op, which is how
 * development and the tests run.
 *
 * What reaches Sentry is what the logs already allow and nothing more. No
 * default PII (no IP, no cookies), the user as an id only, the request as a
 * method and a path, and every message passed through `redact` on its way
 * out: a Gmail refusal or a driver error can quote an address or a token, and
 * Sentry is a third party.
 *
 * Tracing is not enabled. Errors are what an incident needs; spans would spend
 * the free quota on requests that went well.
 */

type Sdk = Pick<typeof Sentry, 'init' | 'captureException' | 'close'>
export type SentryEvent = Parameters<NonNullable<Sentry.NodeOptions['beforeSend']>>[0]

/** Enough to find the request or the job again, never the content of either. */
export interface ErrorContext {
  level?: 'error' | 'warning'
  service?: string
  job?: string
  userId?: string
  /** Groups events that share a cause but differ in message, like Gmail refusals. */
  fingerprint?: string[]
  requestId?: string
  method?: string
  path?: string
  jobId?: string
  attempt?: number
  campaignId?: string
  contactId?: string
  reason?: string
}

const SECRETS: readonly [RegExp, string][] = [
  [/ya29\.[\w.-]+/g, '[access-token]'],
  [/1\/\/[\w.-]+/g, '[refresh-token]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
]

export function redact(text: string): string {
  return SECRETS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  )
}

export function scrubEvent(event: SentryEvent): SentryEvent {
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.data
    delete event.request.query_string

    if (event.request.url) {
      event.request.url = event.request.url.split('?')[0] ?? ''
    }
  }

  if (event.user) {
    event.user = event.user.id === undefined ? {} : { id: event.user.id }
  }

  if (event.message) {
    event.message = redact(event.message)
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = redact(exception.value)
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      const kept = { ...breadcrumb }
      delete kept.data
      if (kept.message) {
        kept.message = redact(kept.message)
      }
      return kept
    })
  }

  return event
}

export function toCaptureContext(context: ErrorContext) {
  const { level = 'error', service, job, userId, fingerprint, ...extra } = context

  return {
    level,
    tags: { ...(service ? { service } : {}), ...(job ? { job } : {}) },
    extra:
      extra.reason === undefined ? extra : { ...extra, reason: redact(extra.reason) },
    ...(userId ? { user: { id: userId } } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  }
}

let active: Sdk | null = null

export function initErrorReporting(
  options: {
    dsn: string
    environment: string
    release: string | undefined
    service: string
  },
  sdk: Sdk = Sentry,
): boolean {
  if (options.dsn === '') {
    active = null
    return false
  }

  sdk.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release ? { release: options.release } : {}),
    sendDefaultPii: false,
    initialScope: { tags: { service: options.service } },
    beforeSend: scrubEvent,
  })

  active = sdk
  return true
}

export function reportError(err: unknown, context: ErrorContext = {}): void {
  active?.captureException(err, toCaptureContext(context))
}

/** Sends what is queued before the process exits. A deploy must not swallow the last error. */
export async function closeErrorReporting(timeoutMs = 2_000): Promise<void> {
  await active?.close(timeoutMs)
}
