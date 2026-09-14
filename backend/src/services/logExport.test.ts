import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { csvCell, logsToCsv, type LogRow } from './logExport.js'

describe('csvCell', () => {
  it('quotes every value', () => {
    assert.equal(csvCell('rh@exemple.fr'), '"rh@exemple.fr"')
  })

  it('doubles the quotes inside a value', () => {
    assert.equal(csvCell('dit "non"'), '"dit ""non"""')
  })

  it('keeps a comma and a newline inside their cell', () => {
    assert.equal(csvCell('a,b\nc'), '"a,b\nc"')
  })

  for (const start of ['=', '+', '-', '@', '\t', '\r']) {
    it(`neutralises a value a spreadsheet would run, starting with ${JSON.stringify(start)}`, () => {
      // An imported address such as =HYPERLINK(...) must reach the export as
      // text, not as a formula in the user's spreadsheet.
      const cell = csvCell(`${start}HYPERLINK("http://x","clic")`)
      assert.ok(cell.startsWith(`"'${start}`), cell)
    })
  }

  it('leaves an ordinary value untouched apart from the quotes', () => {
    assert.equal(csvCell('Recipient address rejected'), '"Recipient address rejected"')
  })
})

describe('logsToCsv', () => {
  const rows: LogRow[] = [
    {
      created_at: new Date('2026-07-01T23:30:05Z'),
      event_type: 'sent',
      email: 'zoe@exemple.fr',
      message: '18f2abc',
    },
    {
      created_at: new Date('2026-07-02T08:00:00Z'),
      event_type: 'error',
      email: null,
      message: 'Accès Google expiré',
    },
  ]

  it('starts with a BOM and a header, and ends every line with CRLF', () => {
    const csv = logsToCsv(rows, 'Europe/Paris')

    assert.ok(csv.startsWith('\uFEFF"date","evenement","adresse","detail"\r\n'))
    assert.ok(csv.endsWith('\r\n'))
    assert.equal(csv.split('\r\n').length, 4)
  })

  it('writes the date on the campaign’s wall clock', () => {
    // 23:30 UTC is 01:30 the next day in Paris.
    assert.ok(logsToCsv(rows, 'Europe/Paris').includes('"2026-07-02 01:30:05"'))
    assert.ok(logsToCsv(rows, 'UTC').includes('"2026-07-01 23:30:05"'))
  })

  it('labels the events in the user’s language', () => {
    const csv = logsToCsv(rows, 'UTC')

    assert.ok(csv.includes('"envoyé"'))
    assert.ok(csv.includes('"erreur"'))
  })

  it('leaves the address empty for an event that concerns no contact', () => {
    assert.ok(logsToCsv(rows, 'UTC').includes('"erreur","","Accès Google expiré"'))
  })

  it('writes only the header for a campaign with no log yet', () => {
    assert.equal(logsToCsv([], 'UTC'), '\uFEFF"date","evenement","adresse","detail"\r\n')
  })
})
