import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

/**
 * Parses the body against a schema and replaces it with the parsed value.
 *
 * Replacing rather than merely checking matters: the parsed value carries the
 * schema's trimming and its refusal of unknown keys, so a handler downstream
 * cannot reach a field the schema never approved.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      // Field paths and messages, nothing else. Zod's full issue objects can
      // echo the submitted value back, which puts user input in error logs.
      res.status(400).json({
        error: 'Invalid request',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }

    req.body = result.data
    next()
  }
}
