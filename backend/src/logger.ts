import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino'

/**
 * The one logger, shared by the API and the worker.
 *
 * JSON lines in production, which a log platform can index and filter;
 * readable, coloured lines on a developer's terminal; silent under the test
 * runner unless LOG_LEVEL says otherwise.
 *
 * It reads process.env directly rather than config/env.ts on purpose: a
 * service that logs must not require the whole configuration to be present,
 * or every unit test would have to invent a database URL.
 */

/**
 * Paths that never reach a log line, whatever an object passed to the logger
 * happens to carry. The request serializer already leaves headers out; these
 * hold for anything else that slips through.
 */
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'token',
  'accessToken',
  'refreshToken',
  'google_access_token',
  'google_refresh_token',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.google_access_token',
  '*.google_refresh_token',
]

export function createLogger(
  destination?: DestinationStream,
  overrides: LoggerOptions = {},
): Logger {
  // node:test sets NODE_TEST_CONTEXT in the processes it runs.
  const underTest = process.env.NODE_TEST_CONTEXT !== undefined
  const pretty =
    destination === undefined &&
    !underTest &&
    process.env.NODE_ENV !== 'production' &&
    process.stdout.isTTY

  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? (underTest ? 'silent' : 'info'),
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {
          // "error" rather than 50. Railway reads the level as text, and showed
          // every numeric line as info, errors included.
          formatters: { level: (label: string) => ({ level: label }) },
        }),
    ...overrides,
  }

  return destination === undefined ? pino(options) : pino(options, destination)
}

export const logger = createLogger()
