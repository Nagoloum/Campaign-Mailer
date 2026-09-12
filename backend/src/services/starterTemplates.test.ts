import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { STARTER_TEMPLATES } from './starterTemplates.js'
import { extractVariables, renderHtml, renderText } from './template.js'

/** A contact with nothing in it, which is what a thin CSV produces. */
const EMPTY = { email: null, contact_name: null, company_name: null, salutation: null }

describe('STARTER_TEMPLATES', () => {
  it('offers three, each with a distinct id', () => {
    const ids = STARTER_TEMPLATES.map((template) => template.id)

    assert.equal(ids.length, 3)
    assert.equal(new Set(ids).size, 3)
  })

  for (const template of STARTER_TEMPLATES) {
    describe(template.name, () => {
      it('uses only known variables', () => {
        // An unknown name renders as nothing, so a typo here would silently
        // remove a word from every email a user sends.
        for (const field of [template.subject, template.bodyText, template.bodyHtml]) {
          const placeholders = [...field.matchAll(/\{\{\s*([a-z_]+)/gi)].map((m) => m[1])
          const known = new Set(extractVariables(field))

          for (const name of placeholders) {
            assert.ok(
              name && known.has(name as never),
              `unknown variable: ${String(name)}`,
            )
          }
        }
      })

      it('leaves no placeholder visible when the contact is empty', () => {
        // The case that reaches a real recipient: a CSV with only an address.
        for (const rendered of [
          renderText(template.subject, EMPTY),
          renderText(template.bodyText, EMPTY),
          renderHtml(template.bodyHtml, EMPTY),
        ]) {
          assert.ok(!rendered.includes('{{'), `placeholder left in: ${rendered}`)
        }
      })

      it('reads without a dangling comma when the name is missing', () => {
        // `Bonjour ,` is worse than no merge at all. Every greeting variable
        // carries a fallback, or the comma sits right after "Bonjour".
        const rendered = renderText(template.bodyText, EMPTY)

        assert.ok(!/\bBonjour\s+,/.test(rendered), rendered.split('\n')[0])
      })

      it('carries both a text and an HTML body', () => {
        assert.ok(template.bodyText.length > 100)
        assert.ok(template.bodyHtml.includes('<p>'))
      })

      it('says what it is for', () => {
        assert.ok(template.description.length > 40)
      })
    })
  }
})
