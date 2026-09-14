import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

// Configuration is read when the module graph loads, so the environment goes in
// first. Placeholders: nothing here opens a database, Redis or the bucket.
process.env.NODE_ENV = 'test'
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex')
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/none'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com'
process.env.S3_BUCKET = 'test-bucket'
process.env.S3_ACCESS_KEY_ID = 'test-key'
process.env.S3_SECRET_ACCESS_KEY = 'test-secret'

const { createApp } = await import('./app.js')
const { buildHelmetOptions } = await import('./config/security.js')
const session = (await import('express-session')).default

let baseUrl: string
let server: import('node:http').Server

before(async () => {
  const app = createApp({ sessionStore: new session.MemoryStore() })

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

describe('the headers the API sends', () => {
  const health = () => fetch(`${baseUrl}/api/health`)

  it('allows nothing to load, and nothing to frame it', async () => {
    const csp = (await health()).headers.get('content-security-policy') ?? ''

    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /base-uri 'none'/)
  })

  it('stops a browser from guessing a content type', async () => {
    assert.equal((await health()).headers.get('x-content-type-options'), 'nosniff')
  })

  it('sends no referrer', async () => {
    assert.equal((await health()).headers.get('referrer-policy'), 'no-referrer')
  })

  it('does not name the framework', async () => {
    assert.equal((await health()).headers.get('x-powered-by'), null)
  })

  it('sends no HSTS outside production', async () => {
    assert.equal((await health()).headers.get('strict-transport-security'), null)
  })

  it('sets no cookie for a visitor who never signs in', async () => {
    assert.equal((await health()).headers.get('set-cookie'), null)
  })
})

describe('buildHelmetOptions', () => {
  it('asks for HSTS for a year, subdomains included, in production', () => {
    assert.deepEqual(buildHelmetOptions(true).strictTransportSecurity, {
      maxAge: 31_536_000,
      includeSubDomains: true,
    })
  })

  it('turns HSTS off in development, or localhost would refuse plain HTTP for a year', () => {
    assert.equal(buildHelmetOptions(false).strictTransportSecurity, false)
  })
})
