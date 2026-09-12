import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SAMPLE_CONTACT, renderPreview, toTemplateContact } from './preview.js'

const TEMPLATE = {
  subject: 'Candidature chez {{company_name}}',
  body_html: '<p>Bonjour {{salutation}} {{contact_name}}</p>',
  body_text: 'Bonjour {{salutation}} {{contact_name}}',
}

describe('toTemplateContact', () => {
  it('falls back to the sample values when nothing is given', () => {
    assert.deepEqual(toTemplateContact(undefined), SAMPLE_CONTACT)
  })

  it('fills only the missing fields', () => {
    // A CSV that lacks a column would otherwise preview with a hole exactly
    // where the user is checking their sentence.
    const contact = toTemplateContact({ contact_name: 'Marie' })

    assert.equal(contact.contact_name, 'Marie')
    assert.equal(contact.company_name, SAMPLE_CONTACT.company_name)
  })

  it('treats null like absent', () => {
    assert.equal(
      toTemplateContact({ contact_name: null }).contact_name,
      SAMPLE_CONTACT.contact_name,
    )
  })
})

describe('renderPreview', () => {
  it('renders subject and both bodies', () => {
    const preview = renderPreview(TEMPLATE, {
      company_name: 'Acme',
      contact_name: 'Marie',
    })

    assert.equal(preview.subject, 'Candidature chez Acme')
    assert.equal(preview.bodyHtml, '<p>Bonjour Madame Marie</p>')
    assert.equal(preview.bodyText, 'Bonjour Madame Marie')
  })

  it('does not escape the subject', () => {
    // A mail client shows a subject literally, so escaping would put
    // `Foo &amp; Bar` in the inbox.
    const preview = renderPreview(
      { ...TEMPLATE, subject: '{{company_name}}' },
      {
        company_name: 'Foo & Bar',
      },
    )

    assert.equal(preview.subject, 'Foo & Bar')
  })

  it('escapes the HTML body', () => {
    const preview = renderPreview(TEMPLATE, { contact_name: '<script>x</script>' })

    assert.ok(!preview.bodyHtml.includes('<script>'))
  })

  it('leaves the text body unescaped', () => {
    const preview = renderPreview(TEMPLATE, { contact_name: 'Foo & Bar' })

    assert.ok(preview.bodyText.includes('Foo & Bar'))
  })

  it('handles a campaign with nothing written yet', () => {
    const preview = renderPreview(
      { subject: null, body_html: null, body_text: null },
      undefined,
    )

    assert.deepEqual(
      {
        subject: preview.subject,
        bodyHtml: preview.bodyHtml,
        bodyText: preview.bodyText,
      },
      { subject: '', bodyHtml: '', bodyText: '' },
    )
  })

  it('reports the values it used', () => {
    // Shown beside the result, so the user can tell a missing value from a
    // sentence that reads badly.
    const preview = renderPreview(TEMPLATE, { contact_name: 'Marie' })

    assert.equal(preview.contact.contact_name, 'Marie')
    assert.equal(preview.contact.salutation, SAMPLE_CONTACT.salutation)
  })
})
