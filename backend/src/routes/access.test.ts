import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { createRequireCampaignOwner, requireAuth } from '../middleware/auth.js'

/**
 * Exercises the guards as Express middleware over real HTTP, rather than as
 * functions called with fakes. The unit tests already cover the decisions;
 * what is checked here is that those decisions reach the wire as the right
 * status, in the right order, when chained on a route.
 *
 * The signed-in user is injected by a stub rather than obtained from Google,
 * so the test stays offline. Passport's own wiring is covered by the OAuth
 * redirect assertions in auth.test.ts.
 */

const ALICE = 'aaaaaaaa-1111-4111-8111-111111111111'
const BOB = 'bbbbbbbb-2222-4222-8222-222222222222'
const ALICE_CAMPAIGN = 'cccccccc-3333-4333-8333-333333333333'

let baseUrl: string
let server: import('node:http').Server
/** Who the stub signs in for the next request, if anyone. */
let signedInAs: string | null = null

before(async () => {
  const app = express()

  app.use((req, _res, next) => {
    if (signedInAs) {
      req.user = { id: signedInAs }
    }
    next()
  })

  const campaigns = {
    belongsTo: (campaignId: string, userId: string) =>
      Promise.resolve(campaignId === ALICE_CAMPAIGN && userId === ALICE),
  }

  app.get('/campaigns', requireAuth, (_req, res) => {
    res.json({ campaigns: [] })
  })

  app.get(
    '/campaigns/:id',
    requireAuth,
    createRequireCampaignOwner(campaigns),
    (_req, res) => {
      res.json({ campaign: { id: ALICE_CAMPAIGN } })
    },
  )

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

describe('a visitor with no session', () => {
  it('is refused on a listing', async () => {
    signedInAs = null

    const res = await fetch(`${baseUrl}/campaigns`)

    assert.equal(res.status, 401)
  })

  it('is refused on a single campaign, before any ownership check', async () => {
    signedInAs = null

    const res = await fetch(`${baseUrl}/campaigns/${ALICE_CAMPAIGN}`)

    assert.equal(res.status, 401)
  })
})

describe('a signed-in user', () => {
  it('reaches their own campaign', async () => {
    signedInAs = ALICE

    const res = await fetch(`${baseUrl}/campaigns/${ALICE_CAMPAIGN}`)

    assert.equal(res.status, 200)
  })

  it('gets 404, not 403, on a campaign belonging to someone else', async () => {
    // 403 would confirm the campaign exists. Walking the id space would then
    // map which campaigns are real, one request at a time.
    signedInAs = BOB

    const res = await fetch(`${baseUrl}/campaigns/${ALICE_CAMPAIGN}`)

    assert.equal(res.status, 404)
  })

  it('cannot tell a campaign owned by another from one that never existed', async () => {
    signedInAs = BOB

    const theirs = await fetch(`${baseUrl}/campaigns/${ALICE_CAMPAIGN}`)
    const nothing = await fetch(
      `${baseUrl}/campaigns/dddddddd-4444-4444-8444-444444444444`,
    )

    assert.equal(theirs.status, nothing.status)
    assert.deepEqual(await theirs.json(), await nothing.json())
  })

  it('gets 404 on a malformed id, not a server error', async () => {
    signedInAs = ALICE

    const res = await fetch(`${baseUrl}/campaigns/not-a-uuid`)

    assert.equal(res.status, 404)
  })
})
