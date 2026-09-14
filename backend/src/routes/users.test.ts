import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import express from 'express'

import { createUsersRouter } from './users.js'

const ALICE = { id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'alice@exemple.fr' }

let signedIn: typeof ALICE | null
let deletedFor: string[]
let sessionDestroyed: boolean

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (signedIn) {
      req.user = signedIn
    }
    // Stand-ins for Passport and express-session, which the route drives.
    req.logout = ((done: (err?: unknown) => void) => {
      done()
    }) as typeof req.logout
    Object.assign(req, {
      session: {
        destroy: (done: (err?: unknown) => void) => {
          sessionDestroyed = true
          done()
        },
      },
    })
    next()
  })
  app.use(
    '/users',
    createUsersRouter({
      deleteAccount: (userId) => {
        deletedFor.push(userId)
        return Promise.resolve({ deleted: true, googleRevoked: true, filesPurged: false })
      },
    }),
  )

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
  signedIn = ALICE
  deletedFor = []
  sessionDestroyed = false
})

const remove = (body: unknown) =>
  fetch(`${baseUrl}/users/me`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('DELETE /users/me', () => {
  it('refuses a request without a session', async () => {
    signedIn = null

    assert.equal((await remove({ email: ALICE.email })).status, 401)
    assert.deepEqual(deletedFor, [])
  })

  it('refuses without the address typed again', async () => {
    assert.equal((await remove({})).status, 400)
    assert.deepEqual(deletedFor, [])
  })

  it('refuses an address that is not the signed-in account’s', async () => {
    const res = await remove({ email: 'bob@exemple.fr' })

    assert.equal(res.status, 422)
    assert.deepEqual(deletedFor, [])
  })

  it('deletes the signed-in account, whatever case the address was typed in', async () => {
    const res = await remove({ email: 'Alice@Exemple.FR' })

    assert.equal(res.status, 200)
    assert.deepEqual(deletedFor, [ALICE.id])
  })

  it('ends the session and clears the cookie', async () => {
    const res = await remove({ email: ALICE.email })

    assert.equal(sessionDestroyed, true)
    assert.match(res.headers.get('set-cookie') ?? '', /cm\.sid=;/)
  })

  it('says what could not be done, so the interface can tell the user', async () => {
    const body = (await (await remove({ email: ALICE.email })).json()) as Record<
      string,
      unknown
    >

    assert.deepEqual(body, { deleted: true, googleRevoked: true, filesPurged: false })
  })

  it('refuses an unknown field', async () => {
    assert.equal((await remove({ email: ALICE.email, force: true })).status, 400)
  })
})
