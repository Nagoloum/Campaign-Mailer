import { z } from 'zod'

/**
 * One row as the web app sends it, already mapped to the four fields.
 *
 * The client parses the CSV, because it also has to show the column mapping
 * and a preview of the first rows before anything is sent. The server trusts
 * none of it: every address is validated and de-duplicated again server-side,
 * in services/contactImport.ts.
 */
const row = z
  .object({
    email: z.string().max(400),
    contact_name: z.string().max(400).optional(),
    company_name: z.string().max(400).optional(),
    salutation: z.string().max(400).optional(),
  })
  .strict()

/**
 * A cap on rows per request, so one call cannot hold the pool or the event
 * loop. The web app splits a larger file and merges the reports.
 */
export const IMPORT_BATCH_LIMIT = 2000

export const importContactsSchema = z
  .object({
    rows: z.array(row).max(IMPORT_BATCH_LIMIT),
    /** Line number of the first row, so the report matches the spreadsheet. */
    first_line: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict()

export const addContactSchema = z
  .object({
    email: z.string().max(400),
    contact_name: z.string().max(200).optional(),
    company_name: z.string().max(200).optional(),
    salutation: z.string().max(100).optional(),
  })
  .strict()

export const updateContactSchema = z
  .object({
    // Only these two: a client may set a contact aside or put it back in the
    // queue. `sent` and `failed` are the send engine's to write, and letting a
    // client set them would corrupt the record of what actually went out.
    status: z.enum(['pending', 'ignored']),
  })
  .strict()

export const listContactsSchema = z
  .object({
    status: z.enum(['pending', 'sent', 'failed', 'ignored']).optional(),
    search: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()

export type ImportContactsInput = z.infer<typeof importContactsSchema>
export type AddContactInput = z.infer<typeof addContactSchema>
export type UpdateContactInput = z.infer<typeof updateContactSchema>
export type ListContactsQuery = z.infer<typeof listContactsSchema>
