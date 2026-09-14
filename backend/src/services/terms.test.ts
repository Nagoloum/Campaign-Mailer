import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { CURRENT_TERMS_VERSION } from './terms.js'

describe('the terms version', () => {
  it('is the one the web app shows and sends back', () => {
    // Two workspaces, one version. If they drift, the interface asks users to
    // accept terms the API then refuses, and nobody can get past the screen.
    // A fixed path built from this file's own location, not from any input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const legal = readFileSync(
      new URL('../../../frontend/src/services/legal.ts', import.meta.url),
      'utf8',
    )

    assert.ok(
      legal.includes(`TERMS_VERSION = '${CURRENT_TERMS_VERSION}'`),
      'frontend/src/services/legal.ts carries a different TERMS_VERSION',
    )
  })
})
