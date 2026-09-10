import type { NextFunction, Request, Response } from 'express'

import { isProduction } from '../config/env.js'

/**
 * An error whose status and message are safe to send to the client.
 * Anything thrown that is not an HttpError becomes a 500 with a generic body.
 */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', path: req.originalUrl })
}

/**
 * Terminal error handler. Express 5 forwards rejected promises from async
 * handlers here on its own, which is why the project runs Express 5 rather
 * than the version named in the specification.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }

  // Never leak an internal message or a stack trace to a client. Tokens and
  // connection strings surface in those.
  console.error('Unhandled error', err)

  res.status(500).json({
    error: isProduction ? 'Internal server error' : String(err),
  })
}
