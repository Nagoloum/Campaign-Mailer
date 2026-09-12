/**
 * What may be attached, and under what name.
 *
 * Kept apart from the storage client so these rules can be tested without a
 * configured bucket — and so they read as rules rather than as plumbing.
 */

/** Ten megabytes. Gmail refuses much more once base64 encoding inflates it. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * An allowlist, not a blocklist.
 *
 * The interesting case is not the executable someone uploads on purpose, it is
 * the file a recipient's mail client decides to treat as runnable. A CV is a
 * PDF or a Word document.
 */
const ALLOWED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/msword', 'doc'],
])

export class AttachmentRejected extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'AttachmentRejected'
  }
}

/** Returns the extension the type implies, or refuses. */
export function assertAllowedType(contentType: string): string {
  const extension = ALLOWED.get(contentType.split(';')[0]?.trim().toLowerCase() ?? '')

  if (!extension) {
    throw new AttachmentRejected('Only a PDF or a Word document can be attached')
  }

  return extension
}

/**
 * Keeps a filename readable without letting it decide anything.
 *
 * The stored key is generated, never derived from this, so a name carrying
 * `../` or a null byte cannot escape its prefix. The name only travels back to
 * the user and into the message's Content-Disposition header, where a newline
 * would be header injection.
 *
 * The extension always comes from the content type, so a Word document named
 * `.pdf` does not reach the recipient mislabelled.
 */
export function safeFileName(raw: string, extension: string): string {
  const base = raw
    .replace(/[\r\n\0]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  const withoutExtension = base.replace(/\.[A-Za-z0-9]{1,8}$/, '')

  return `${withoutExtension === '' ? 'piece-jointe' : withoutExtension}.${extension}`
}
