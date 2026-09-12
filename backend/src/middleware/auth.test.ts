import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { NextFunction, Request, Response } from 'express'

import { createRequireCampaignOwner, requireAuth } from './auth.js'

const VALID_UUID = '11111111-2222-4333-8444-555555555555'
const OTHER_UUID = '99999999-8888-4777-8666-555555555555'

/** A response that records what the middleware did to it. */
function fakeResponse() {
  const recorded: { status?: number; body?: unknown } = {}
  const res = {
    status(code: number) {
      recorded.status = code
      return res
    },
    json(body: unknown) {
      recorded.body = body
      return res
    },
  }
  return { res: res as unknown as Response, recorded }
}

function fakeRequest(parts: {
  user?: { id: string }
  params?: Record<string, string>
}): Request {
  return { params: {}, ...parts } as unknown as Request
}

function spyNext() {
  const calls: unknown[] = []
  const next = ((err?: unknown) => {
    calls.push(err)
  }) as NextFunction
  return { next, calls }
}

describe('requireAuth', () => {
  it('lets a signed-in request through', () => {
    const { res, recorded } = fakeResponse()
    const { next, calls } = spyNext()

    requireAuth(fakeRequest({ user: { id: VALID_UUID } }), res, next)

    assert.equal(calls.length, 1)
    assert.equal(recorded.status, undefined)
  })

  it('answers 401 without a user', () => {
    const { res, recorded } = fakeResponse()
    const { next, calls } = spyNext()

    requireAuth(fakeRequest({}), res, next)

    assert.equal(calls.length, 0)
    assert.equal(recorded.status, 401)
  })
})

describe('createRequireCampaignOwner', () => {
  function middleware(owned: boolean, onQuery?: (id: string, userId: string) => void) {
    return createRequireCampaignOwner({
      belongsTo: (campaignId, userId) => {
        onQuery?.(campaignId, userId)
        return Promise.resolve(owned)
      },
    })
  }

  it('lets the owner through', async () => {
    const { res } = fakeResponse()
    const { next, calls } = spyNext()

    await middleware(true)(
      fakeRequest({ user: { id: OTHER_UUID }, params: { id: VALID_UUID } }),
      res,
      next,
    )

    assert.deepEqual(calls, [undefined])
  })

  it('answers 404, not 403, for a campaign owned by someone else', async () => {
    // 403 confirms the campaign exists. Anyone could then walk the id space
    // and learn which campaigns are real. 404 says nothing either way.
    const { res, recorded } = fakeResponse()
    const { next, calls } = spyNext()

    await middleware(false)(
      fakeRequest({ user: { id: OTHER_UUID }, params: { id: VALID_UUID } }),
      res,
      next,
    )

    assert.equal(calls.length, 0)
    assert.equal(recorded.status, 404)
  })

  it('answers 401 when nobody is signed in', async () => {
    const { res, recorded } = fakeResponse()
    const { next } = spyNext()

    await middleware(true)(fakeRequest({ params: { id: VALID_UUID } }), res, next)

    assert.equal(recorded.status, 401)
  })

  it('rejects a malformed id without asking the database', async () => {
    // `WHERE id = $1` against a uuid column raises `invalid input syntax for
    // type uuid` on anything else, which would surface as a 500 and hand an
    // attacker a way to tell a malformed id from a real one.
    let queried = false
    const { res, recorded } = fakeResponse()
    const { next } = spyNext()

    await middleware(true, () => {
      queried = true
    })(fakeRequest({ user: { id: OTHER_UUID }, params: { id: 'not-a-uuid' } }), res, next)

    assert.equal(queried, false)
    assert.equal(recorded.status, 404)
  })

  it('rejects a missing id', async () => {
    const { res, recorded } = fakeResponse()
    const { next } = spyNext()

    await middleware(true)(fakeRequest({ user: { id: OTHER_UUID } }), res, next)

    assert.equal(recorded.status, 404)
  })

  it('asks about the campaign on behalf of the signed-in user', async () => {
    const seen: { campaignId?: string; userId?: string } = {}
    const { res } = fakeResponse()
    const { next } = spyNext()

    await middleware(true, (campaignId, userId) => {
      seen.campaignId = campaignId
      seen.userId = userId
    })(fakeRequest({ user: { id: OTHER_UUID }, params: { id: VALID_UUID } }), res, next)

    assert.equal(seen.campaignId, VALID_UUID)
    assert.equal(seen.userId, OTHER_UUID)
  })

  it('hands a database failure to the error handler rather than answering 404', async () => {
    // A 404 here would hide an outage behind a plausible answer.
    const { res, recorded } = fakeResponse()
    const { next, calls } = spyNext()

    const failing = createRequireCampaignOwner({
      belongsTo: () => Promise.reject(new Error('database down')),
    })

    await failing(
      fakeRequest({ user: { id: OTHER_UUID }, params: { id: VALID_UUID } }),
      res,
      next,
    )

    assert.equal(recorded.status, undefined)
    assert.ok(calls[0] instanceof Error)
  })
})
