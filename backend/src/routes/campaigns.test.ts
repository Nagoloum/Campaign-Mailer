import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type { CampaignStatus } from '../services/campaignState.js'
import type {
  CampaignPatch,
  CampaignRepository,
  CampaignRow,
} from '../services/campaigns.js'

import { createCampaignRouter } from './campaigns.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'
const CONTACT = 'dddddddd-4444-4444-8444-444444444444'

/** `exactOptionalPropertyTypes` is on, so an absent key has to allow undefined. */
type RowOverrides = { [K in keyof CampaignRow]?: CampaignRow[K] | undefined }

function row(overrides: RowOverrides = {}): CampaignRow {
  // Spreading would let an explicitly-undefined override erase a default,
  // which is exactly what exactOptionalPropertyTypes objects to. Only defined
  // values are applied.
  const merged: CampaignRow = defaults()

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      Object.assign(merged, { [key]: value })
    }
  }

  return merged
}

function defaults(): CampaignRow {
  return {
    id: CAMPAIGN,
    user_id: ALICE,
    name: 'Candidatures',
    subject: null,
    body_html: null,
    body_text: null,
    attachment_key: null,
    attachment_name: null,
    status: 'draft',
    total_contacts: 0,
    sent_count: 0,
    error_count: 0,
    mails_per_day: 46,
    start_hour: 9,
    pause_ms: 3000,
    timezone: 'Europe/Paris',
    created_at: new Date('2026-09-12T10:00:00Z'),
    updated_at: new Date('2026-09-12T10:00:00Z'),
    scheduled_at: null,
    started_at: null,
    completed_at: null,
  }
}

let stored: CampaignRow | null = row()
let signedInAs: string | null = ALICE
let lastPatch: CampaignPatch | null = null
let removed = false

const repository: CampaignRepository = {
  belongsTo: () => Promise.resolve(true),
  listForUser: (userId) => Promise.resolve(stored?.user_id === userId ? [stored] : []),
  create: (userId, input) => Promise.resolve(row({ user_id: userId, ...input })),
  findForUser: (campaignId, userId) =>
    Promise.resolve(
      stored?.id === campaignId && stored.user_id === userId ? stored : null,
    ),
  update: (_campaignId, patch) => {
    lastPatch = patch
    return Promise.resolve(stored ? row({ ...stored, ...patch }) : null)
  },
  remove: () => {
    removed = true
    return Promise.resolve(true)
  },
  findContact: (campaignId, contactId) =>
    Promise.resolve(
      campaignId === CAMPAIGN && contactId === CONTACT
        ? {
            id: CONTACT,
            email: 'marie@exemple.fr',
            contact_name: 'Marie',
            company_name: 'Acme',
            salutation: 'Madame',
          }
        : null,
    ),
}

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })
  app.use('/campaigns', createCampaignRouter(repository))

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve()
    })
  })

  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

beforeEach(() => {
  stored = row()
  signedInAs = ALICE
  lastPatch = null
  removed = false
})

const send = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

describe('without a session', () => {
  it('refuses every route', async () => {
    signedInAs = null

    for (const [method, path] of [
      ['GET', '/campaigns'],
      ['POST', '/campaigns'],
      ['GET', `/campaigns/${CAMPAIGN}`],
      ['PATCH', `/campaigns/${CAMPAIGN}`],
      ['DELETE', `/campaigns/${CAMPAIGN}`],
    ] as const) {
      const res = await send(path, method === 'GET' ? { method } : { method, body: '{}' })
      assert.equal(res.status, 401, `${method} ${path}`)
    }
  })
})

describe('POST /campaigns', () => {
  it('creates and answers 201', async () => {
    const res = await send('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'Prospection' }),
    })

    assert.equal(res.status, 201)
    const body = (await res.json()) as { campaign: { name: string; status: string } }
    assert.equal(body.campaign.name, 'Prospection')
    assert.equal(body.campaign.status, 'draft')
  })

  it('refuses a payload with no name', async () => {
    const res = await send('/campaigns', { method: 'POST', body: '{}' })

    assert.equal(res.status, 400)
  })

  it('refuses an out-of-range cadence', async () => {
    const res = await send('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', start_hour: 24 }),
    })

    assert.equal(res.status, 400)
    const body = (await res.json()) as { details: { field: string }[] }
    assert.equal(body.details[0]?.field, 'start_hour')
  })

  it('never echoes the submitted value back in the error', async () => {
    // Error bodies reach logs and error reporting. The field name and the
    // reason are enough to fix a request; the value is not.
    const res = await send('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', timezone: 'Europe/Secret-Value' }),
    })

    assert.ok(!JSON.stringify(await res.json()).includes('Secret-Value'))
  })
})

describe('GET /campaigns/:id', () => {
  it('returns the campaign', async () => {
    const res = await send(`/campaigns/${CAMPAIGN}`)

    assert.equal(res.status, 200)
  })

  it('answers 404 for a campaign belonging to someone else', async () => {
    stored = row({ user_id: 'bbbbbbbb-2222-4222-8222-222222222222' })

    const res = await send(`/campaigns/${CAMPAIGN}`)

    assert.equal(res.status, 404)
  })

  it('answers 404 for a malformed id, not a server error', async () => {
    const res = await send('/campaigns/not-a-uuid')

    assert.equal(res.status, 404)
  })

  it('does not expose the owner id', async () => {
    const res = await send(`/campaigns/${CAMPAIGN}`)

    assert.ok(!JSON.stringify(await res.json()).includes(ALICE))
  })
})

describe('PATCH /campaigns/:id', () => {
  const patchWith = (body: unknown) =>
    send(`/campaigns/${CAMPAIGN}`, { method: 'PATCH', body: JSON.stringify(body) })

  it('edits the content of a draft', async () => {
    const res = await patchWith({ subject: 'Bonjour' })

    assert.equal(res.status, 200)
    assert.equal(lastPatch?.subject, 'Bonjour')
  })

  it('refuses to edit the content of a running campaign, with 409', async () => {
    // The payload was fine; the campaign had moved on. 400 would blame the
    // caller for something they could not have known.
    stored = row({ status: 'running' })

    const res = await patchWith({ body_html: '<p>autre chose</p>' })

    assert.equal(res.status, 409)
    assert.equal(lastPatch, null)
  })

  for (const status of ['scheduled', 'paused', 'completed'] as CampaignStatus[]) {
    it(`refuses to edit the content of a ${status} campaign`, async () => {
      stored = row({ status })

      assert.equal((await patchWith({ subject: 'x' })).status, 409)
    })
  }

  it('allows changing the pace of a paused campaign', async () => {
    stored = row({ status: 'paused' })

    assert.equal((await patchWith({ mails_per_day: 20 })).status, 200)
  })

  it('refuses to change the pace of a running campaign', async () => {
    // Its day is already planned; a new pace under it could exceed the cap
    // the campaign was planned against.
    stored = row({ status: 'running' })

    assert.equal((await patchWith({ mails_per_day: 200 })).status, 409)
  })

  it('refuses an empty patch', async () => {
    assert.equal((await patchWith({})).status, 400)
  })

  it('refuses an unknown field', async () => {
    assert.equal((await patchWith({ sent_count: 999 })).status, 400)
  })
})

describe('POST /campaigns/:id/preview', () => {
  const preview = (body: unknown) =>
    send(`/campaigns/${CAMPAIGN}/preview`, { method: 'POST', body: JSON.stringify(body) })

  beforeEach(() => {
    stored = row({
      subject: 'Candidature chez {{company_name}}',
      body_html: '<p>Bonjour {{salutation}} {{contact_name}}</p>',
      body_text: 'Bonjour {{salutation}} {{contact_name}}',
    })
  })

  it('renders with a stored contact', async () => {
    const res = await preview({ contact_id: CONTACT })

    assert.equal(res.status, 200)
    const body = (await res.json()) as { preview: { subject: string; bodyHtml: string } }
    assert.equal(body.preview.subject, 'Candidature chez Acme')
    assert.equal(body.preview.bodyHtml, '<p>Bonjour Madame Marie</p>')
  })

  it('renders with sample values when nothing is given', async () => {
    const res = await preview({})

    const body = (await res.json()) as { preview: { subject: string } }
    assert.match(body.preview.subject, /Société Exemple/)
  })

  it('answers 404 for a contact that is not in this campaign', async () => {
    // Scoped by campaign as well as by id, so an id borrowed from another
    // campaign previews nothing.
    const res = await preview({ contact_id: 'eeeeeeee-5555-4555-8555-555555555555' })

    assert.equal(res.status, 404)
  })

  it('stores nothing', async () => {
    await preview({ contact: { contact_name: 'Éphémère' } })

    assert.equal(lastPatch, null)
  })
})

describe('DELETE /campaigns/:id', () => {
  it('deletes a draft', async () => {
    const res = await send(`/campaigns/${CAMPAIGN}`, { method: 'DELETE' })

    assert.equal(res.status, 204)
    assert.equal(removed, true)
  })

  it('refuses to delete a campaign that is sending', async () => {
    // The cascade would take the contacts and logs while jobs still reference
    // them, and lose the record of what already went out.
    stored = row({ status: 'running' })

    const res = await send(`/campaigns/${CAMPAIGN}`, { method: 'DELETE' })

    assert.equal(res.status, 409)
    assert.equal(removed, false)
  })
})
