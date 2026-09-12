import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TEMPLATE_VARIABLES,
  extractVariables,
  renderHtml,
  renderText,
  type TemplateContact,
} from './template.js'

const CONTACT: TemplateContact = {
  email: 'marie@exemple.fr',
  contact_name: 'Marie Dupont',
  company_name: 'Exemple SA',
  salutation: 'Madame',
}

describe('renderText', () => {
  it('replaces every known variable', () => {
    const out = renderText(
      'Bonjour {{salutation}} {{contact_name}}, chez {{company_name}} ({{email}})',
      CONTACT,
    )

    assert.equal(out, 'Bonjour Madame Marie Dupont, chez Exemple SA (marie@exemple.fr)')
  })

  it('keeps accents and non-ASCII intact', () => {
    assert.equal(
      renderText('Chère {{contact_name}} — 日本', { ...CONTACT, contact_name: 'Amélie' }),
      'Chère Amélie — 日本',
    )
  })

  it('does not escape HTML, because a text body is not HTML', () => {
    assert.equal(
      renderText('{{company_name}}', { ...CONTACT, company_name: 'Foo & Bar <SARL>' }),
      'Foo & Bar <SARL>',
    )
  })

  it('tolerates spaces inside the braces', () => {
    assert.equal(renderText('{{ contact_name }}', CONTACT), 'Marie Dupont')
  })

  it('replaces every occurrence, not just the first', () => {
    assert.equal(
      renderText('{{email}} {{email}}', CONTACT),
      `${CONTACT.email} ${CONTACT.email}`,
    )
  })
})

describe('missing values', () => {
  it('never leaves a raw placeholder in the output', () => {
    // A recipient seeing {{contact_name}} is the failure this guards against.
    const out = renderText('Bonjour {{contact_name}}', { ...CONTACT, contact_name: null })

    assert.ok(!out.includes('{{'))
    assert.ok(!out.includes('contact_name'))
  })

  it('uses the fallback given after a pipe', () => {
    assert.equal(
      renderText('Bonjour {{contact_name|à vous}}', { ...CONTACT, contact_name: null }),
      'Bonjour à vous',
    )
  })

  it('ignores the fallback when the value is there', () => {
    assert.equal(renderText('{{contact_name|à vous}}', CONTACT), 'Marie Dupont')
  })

  it('treats blank and whitespace-only as missing', () => {
    assert.equal(
      renderText('{{company_name|votre société}}', { ...CONTACT, company_name: '   ' }),
      'votre société',
    )
  })

  it('drops the placeholder when there is no fallback', () => {
    assert.equal(
      renderText('Bonjour{{contact_name}}!', { ...CONTACT, contact_name: null }),
      'Bonjour!',
    )
  })

  it('leaves an unknown variable out rather than guessing', () => {
    // Only the four documented names resolve. Anything else is removed, so a
    // typo cannot reach a recipient and no other field can be addressed.
    const out = renderText('a{{secret_field}}b', CONTACT)

    assert.equal(out, 'ab')
  })

  it('cannot be used to read a prototype property', () => {
    assert.equal(renderText('{{constructor}}{{__proto__}}{{toString}}', CONTACT), '')
  })
})

describe('renderHtml', () => {
  it('escapes a value containing markup', () => {
    // A contact name comes from a CSV file the user was handed. Treating it as
    // markup would let that file inject into every email sent.
    const out = renderHtml('<p>{{contact_name}}</p>', {
      ...CONTACT,
      contact_name: '<script>alert(1)</script>',
    })

    assert.ok(!out.includes('<script>'))
    assert.ok(out.includes('&lt;script&gt;'))
  })

  it('escapes ampersands and quotes', () => {
    const out = renderHtml('{{company_name}}', {
      ...CONTACT,
      company_name: `Foo & "Bar" 'Baz'`,
    })

    assert.equal(out, 'Foo &amp; &quot;Bar&quot; &#39;Baz&#39;')
  })

  it('escapes the fallback too', () => {
    assert.equal(
      renderHtml('{{contact_name|<b>vous</b>}}', { ...CONTACT, contact_name: null }),
      '&lt;b&gt;vous&lt;/b&gt;',
    )
  })

  it('leaves the template markup alone', () => {
    // The template is written by the account owner, not by a contact.
    assert.equal(renderHtml('<b>{{contact_name}}</b>', CONTACT), '<b>Marie Dupont</b>')
  })

  it('escapes a value that closes an attribute', () => {
    const out = renderHtml('<a title="{{company_name}}">x</a>', {
      ...CONTACT,
      company_name: '" onmouseover="alert(1)',
    })

    assert.ok(!out.includes('onmouseover="alert'))
  })
})

describe('extractVariables', () => {
  it('lists the known variables a template uses', () => {
    assert.deepEqual(extractVariables('{{contact_name}} chez {{company_name}}').sort(), [
      'company_name',
      'contact_name',
    ])
  })

  it('reports each one once', () => {
    assert.deepEqual(extractVariables('{{email}} {{email}}'), ['email'])
  })

  it('ignores unknown names', () => {
    assert.deepEqual(extractVariables('{{nope}}'), [])
  })

  it('sees through a fallback', () => {
    assert.deepEqual(extractVariables('{{contact_name|vous}}'), ['contact_name'])
  })
})

describe('TEMPLATE_VARIABLES', () => {
  it('is the list the interface offers, and matches what renders', () => {
    // Object.entries rather than CONTACT[name]: same assertion, no indexing by
    // a variable.
    const values = new Map(Object.entries(CONTACT))

    for (const name of TEMPLATE_VARIABLES) {
      assert.equal(renderText(`{{${name}}}`, CONTACT), String(values.get(name)))
    }
  })

  it('covers every variable the contact type declares', () => {
    assert.deepEqual([...TEMPLATE_VARIABLES].sort(), Object.keys(CONTACT).sort())
  })
})
