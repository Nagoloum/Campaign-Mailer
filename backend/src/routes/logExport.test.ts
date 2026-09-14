import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import type { CampaignRepository, CampaignRow } from '../services/campaigns.js'
import type { LogExportRepository } from '../services/logExport.js'

import { createLogExportRouter } from './logExport.js'

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'

let signedInAs: string | null
let askedFor: string | null

const campaigns = {
  findForUser: (id: string, userId: string) =>
    Promise.resolve(
      id === CAMPAIGN && userId === ALICE
        ? ({ id: CAMPAIGN, user_id: ALICE, timezone: 'Europe/Paris' } as CampaignRow)
        : null,
    ),
} as unknown as CampaignRepository

const logs: LogExportRepository = {
  logsFor: (id) => {
    askedFor = id
    return Promise.resolve([
      {
        created_at: new Date('2026-07-01T10:00:00Z'),
        event_type: 'sent',
        email: '=cmd@exemple.fr',
        message: '18f2abc',
      },
    ])
  },
}

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = express()
  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })
  app.use('/campaigns/:id/logs/export', createLogExportRouter({ campaigns, logs }))

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve()
    })
  })
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

beforeEach(() => {
  signedInAs = ALICE
  askedFor = null
})

const get = (id = CAMPAIGN) => fetch(`${baseUrl}/campaigns/${id}/logs/export`)

describe('GET /campaigns/:id/logs/export', () => {
  it('refuses a request without a session', async () => {
    signedInAs = null
    assert.equal((await get()).status, 401)
  })

  it('answers 404 for another user’s campaign, and reads no log', async () => {
    signedInAs = 'bbbbbbbb-2222-4222-8222-222222222222'

    assert.equal((await get()).status, 404)
    assert.equal(askedFor, null)
  })

  it('answers 404 for a malformed id', async () => {
    assert.equal((await get('pas-un-uuid')).status, 404)
  })

  it('serves a CSV download that no cache keeps', async () => {
    const res = await get()

    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8/)
    assert.equal(
      res.headers.get('content-disposition'),
      `attachment; filename="campagne-${CAMPAIGN}-journal.csv"`,
    )
    assert.equal(res.headers.get('cache-control'), 'no-store')
  })

  it('neutralises an imported address that a spreadsheet would run', async () => {
    const body = await (await get()).text()

    assert.ok(body.includes(`"'=cmd@exemple.fr"`), body)
    assert.ok(body.includes('"2026-07-01 12:00:00"'), 'dates on the campaign’s clock')
  })
})
