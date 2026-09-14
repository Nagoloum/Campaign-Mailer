import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { neutraliseUnsafeLinks, renderHtml, type TemplateContact } from './template.js'

const contact = (company_name: string): TemplateContact => ({
  email: 'rh@exemple.fr',
  contact_name: 'Marie',
  company_name,
  salutation: null,
})

describe('a CSV value used as a link', () => {
  for (const scheme of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'vbscript:msgbox',
    'data:text/html,<script>',
  ]) {
    it(`cannot put ${scheme.split(':')[0]} into a sent email`, () => {
      const html = renderHtml('<a href="{{company_name}}">Site</a>', contact(scheme))

      assert.ok(!/href="\s*(javascript|vbscript|data):/i.test(html), html)
      assert.ok(html.startsWith('<a href="#'), html)
    })
  }

  it('is caught with spaces before the scheme', () => {
    const html = renderHtml(
      '<a href="{{company_name}}">x</a>',
      contact('   javascript:alert(1)'),
    )
    assert.ok(!/javascript:/i.test(html), html)
  })

  it('leaves an ordinary web link untouched', () => {
    const html = renderHtml(
      '<a href="{{company_name}}">x</a>',
      contact('https://exemple.fr/offre'),
    )
    assert.equal(html, '<a href="https://exemple.fr/offre">x</a>')
  })

  it('leaves a mailto link untouched', () => {
    assert.equal(
      neutraliseUnsafeLinks('<a href="mailto:rh@exemple.fr">RH</a>'),
      '<a href="mailto:rh@exemple.fr">RH</a>',
    )
  })

  it('leaves the word javascript in running text alone', () => {
    const html = renderHtml(
      '<p>Poste : {{company_name}}</p>',
      contact('javascript: développeur'),
    )
    assert.ok(html.includes('javascript: développeur'))
  })

  it('also catches an image source', () => {
    assert.equal(
      neutraliseUnsafeLinks('<img src="data:image/svg+xml,x">'),
      '<img src="#image/svg+xml,x">',
    )
  })
})
