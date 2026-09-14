import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { NextFunction, Request, Response } from 'express'

import { CURRENT_TERMS_VERSION } from '../services/terms.js'

import { requireCurrentTerms } from './terms.js'

function run(user: unknown) {
  let status: number | null = null
  let body: unknown = null
  let passed = false

  const res = {
    status(code: number) {
      status = code
      return this
    },
    json(payload: unknown) {
      body = payload
      return this
    },
  } as unknown as Response

  const next: NextFunction = () => {
    passed = true
  }

  requireCurrentTerms({ user } as Request, res, next)

  return { status, body, passed }
}

describe('requireCurrentTerms', () => {
  it('lets through a user who accepted the current terms', () => {
    assert.equal(run({ id: 'u', terms_version: CURRENT_TERMS_VERSION }).passed, true)
  })

  it('refuses a user who never accepted, with 403 and a code the interface can read', () => {
    const outcome = run({ id: 'u', terms_version: null })

    assert.equal(outcome.passed, false)
    assert.equal(outcome.status, 403)
    assert.deepEqual(outcome.body, {
      error: 'The current terms have not been accepted',
      code: 'terms_not_accepted',
    })
  })

  it('refuses a user who accepted an older version', () => {
    assert.equal(run({ id: 'u', terms_version: '2020-01-01' }).status, 403)
  })

  it('leaves a request without a session to the router behind, which answers 401', () => {
    assert.equal(run(undefined).passed, true)
  })
})
