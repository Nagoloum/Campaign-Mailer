import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Pool } from 'pg'

import { contentTypeOfKey, createComposer } from './composer.js'
import type { SendableContact } from './sendEngine.js'

const contact: SendableContact = {
  id: 'c1',
  campaign_id: 'k1',
  email: 'rh@exemple.fr',
  contact_name: 'A&B <i>',
  company_name: 'Exemple',
  salutation: null,
  attempts: 0,
}

function poolReturning(row: Record<string, unknown> | undefined): Pool {
  return {
    query: () => Promise.resolve({ rows: row ? [row] : [] }),
  } as unknown as Pool
}

const campaign = {
  subject: 'Candidature {{contact_name}}',
  body_html: '<p>Bonjour {{contact_name}}</p>',
  body_text: 'Bonjour {{contact_name}}',
  attachment_key: null,
  attachment_name: null,
  sender: 'moi@gmail.com',
}

async function composeWith(
  row: Record<string, unknown> | undefined,
  file = Buffer.from('%PDF'),
) {
  const compose = createComposer({
    pool: poolReturning(row),
    readAttachment: () => Promise.resolve(file),
  })
  const { raw, to } = await compose(contact)
  return { mime: Buffer.from(raw, 'base64url').toString('utf8'), to }
}

describe('the composed message', () => {
  it('goes from the account’s own address to the contact', async () => {
    const { mime, to } = await composeWith(campaign)

    assert.equal(to, 'rh@exemple.fr')
    assert.match(mime, /^From: moi@gmail\.com$/m)
    assert.match(mime, /^To: rh@exemple\.fr$/m)
  })

  it('escapes the CSV value in the HTML part', async () => {
    const { mime } = await composeWith(campaign)

    assert.ok(mime.includes('A&amp;B &lt;i&gt;'), 'the value reached the HTML unescaped')
    assert.ok(!mime.includes('<p>Bonjour A&B <i>'))
  })

  it('leaves the subject literal, as a mail client shows it', async () => {
    const { mime } = await composeWith(campaign)

    assert.match(mime, /^Subject: Candidature A&B <i>$/m)
  })

  it('attaches the stored file with the type its key carries', async () => {
    const { mime } = await composeWith({
      ...campaign,
      attachment_key: 'campaigns/k1/0000.pdf',
      attachment_name: 'CV.pdf',
    })

    assert.match(mime, /Content-Type: application\/pdf; name=CV\.pdf/)
    assert.match(mime, /filename=CV\.pdf/)
  })

  it('refuses a campaign without a subject rather than sending an empty email', async () => {
    await assert.rejects(composeWith({ ...campaign, subject: null }), /no subject/)
  })

  it('refuses a campaign that no longer exists', async () => {
    await assert.rejects(composeWith(undefined), /no subject/)
  })
})

describe('contentTypeOfKey', () => {
  it('reads the three allowed types', () => {
    assert.equal(contentTypeOfKey('a/b.pdf'), 'application/pdf')
    assert.equal(contentTypeOfKey('a/b.doc'), 'application/msword')
    assert.equal(
      contentTypeOfKey('a/b.docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('refuses anything else', () => {
    assert.throws(() => contentTypeOfKey('a/b.exe'), /unsupported/)
  })
})
