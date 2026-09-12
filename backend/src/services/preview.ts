import { renderHtml, renderText, type TemplateContact } from './template.js'

/**
 * Sample values, used when a campaign has no contacts imported yet.
 *
 * Obviously fictional on purpose: a preview that looks like a real recipient
 * invites the reader to check the message against that person rather than
 * against the template.
 */
export const SAMPLE_CONTACT: TemplateContact = {
  email: 'destinataire@exemple.fr',
  contact_name: 'Camille Martin',
  company_name: 'Société Exemple',
  salutation: 'Madame',
}

export interface PreviewSource {
  email?: string | null | undefined
  contact_name?: string | null | undefined
  company_name?: string | null | undefined
  salutation?: string | null | undefined
}

export interface CampaignTemplate {
  subject: string | null
  body_html: string | null
  body_text: string | null
}

export interface RenderedPreview {
  subject: string
  bodyHtml: string
  bodyText: string
  /** What the merge actually used, so the interface can show it beside the result. */
  contact: TemplateContact
}

/**
 * Fills the gaps in a partial contact with the sample values.
 *
 * A contact imported from a CSV that lacks a column would otherwise preview
 * with a hole exactly where the user is trying to check their sentence.
 */
export function toTemplateContact(source: PreviewSource | undefined): TemplateContact {
  return {
    email: source?.email ?? SAMPLE_CONTACT.email,
    contact_name: source?.contact_name ?? SAMPLE_CONTACT.contact_name,
    company_name: source?.company_name ?? SAMPLE_CONTACT.company_name,
    salutation: source?.salutation ?? SAMPLE_CONTACT.salutation,
  }
}

/**
 * Renders a campaign as the recipient would receive it.
 *
 * The subject is rendered as text even though it is merged like the body: a
 * mail client shows a subject literally, so escaping it would display
 * `Foo &amp; Bar` in the inbox.
 */
export function renderPreview(
  campaign: CampaignTemplate,
  source: PreviewSource | undefined,
): RenderedPreview {
  const contact = toTemplateContact(source)

  return {
    subject: renderText(campaign.subject ?? '', contact),
    bodyHtml: renderHtml(campaign.body_html ?? '', contact),
    bodyText: renderText(campaign.body_text ?? '', contact),
    contact,
  }
}
