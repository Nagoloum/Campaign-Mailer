import type { Pool } from 'pg'

import { buildMimeMessage, toGmailRaw } from './message.js'
import type { SendableContact } from './sendEngine.js'
import { renderHtml, renderText, type TemplateContact } from './template.js'

/**
 * Builds the message one contact receives, from what is stored now.
 *
 * Read from the database on every send rather than captured at launch: the
 * content cannot change once a campaign leaves draft, so there is nothing to
 * snapshot, and a copy held in a job would be one more place a token or a body
 * sits in Redis.
 */

/** The inverse of attachmentRules' allowlist, read off the generated key. */
const TYPES = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['doc', 'application/msword'],
])

export interface ComposerDeps {
  pool: Pool
  readAttachment: (key: string) => Promise<Buffer>
}

interface MessageSource {
  subject: string | null
  body_html: string | null
  body_text: string | null
  attachment_key: string | null
  attachment_name: string | null
  sender: string
}

/**
 * The key is generated at upload as `campaigns/<id>/<uuid>.<ext>`, with the
 * extension taken from an allowlisted type, so it is a safe source for the
 * content type.
 */
export function contentTypeOfKey(key: string): string {
  const type = TYPES.get(key.slice(key.lastIndexOf('.') + 1).toLowerCase())

  if (!type) {
    throw new Error('The stored attachment has an unsupported type')
  }

  return type
}

export function createComposer(deps: ComposerDeps) {
  return async function compose(
    contact: SendableContact,
  ): Promise<{ raw: string; to: string }> {
    const { rows } = await deps.pool.query<MessageSource>(
      `SELECT c.subject, c.body_html, c.body_text, c.attachment_key, c.attachment_name,
              u.email AS sender
       FROM campaigns c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [contact.campaign_id],
    )

    const source = rows[0]

    if (!source?.subject || !source.body_html) {
      // The start route refuses a campaign without both, so this is a
      // campaign changed behind the API's back. Loud rather than an empty email.
      throw new Error('The campaign has no subject or no body')
    }

    const merge: TemplateContact = {
      email: contact.email,
      contact_name: contact.contact_name,
      company_name: contact.company_name,
      salutation: contact.salutation,
    }

    const mime = await buildMimeMessage({
      from: { address: source.sender },
      to: contact.email,
      // Text, not HTML: a client shows the subject literally.
      subject: renderText(source.subject, merge),
      html: renderHtml(source.body_html, merge),
      text: renderText(source.body_text ?? '', merge),
      attachment: source.attachment_key
        ? {
            filename: source.attachment_name ?? 'piece-jointe',
            content: await deps.readAttachment(source.attachment_key),
            contentType: contentTypeOfKey(source.attachment_key),
          }
        : undefined,
    })

    return { raw: toGmailRaw(mime), to: contact.email }
  }
}
