import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import Papa from 'papaparse'

import { collectContacts, type RawRow } from './contactImport.js'

/**
 * Pins the parser behaviour the whole import rests on.
 *
 * The CSV itself is parsed in the web app, so these assertions live beside the
 * validation they feed rather than in a frontend suite that does not exist
 * yet. What they guard is an assumption, not our code: that papaparse, with
 * the options we pass it, strips a byte order mark and detects a semicolon
 * separator. An upgrade that changed either would break every French import
 * silently, and this is what would say so.
 */

/** Written as an escape: a literal byte order mark is invisible in a source file. */
const BOM = '\uFEFF'

const OPTIONS = { header: true, skipEmptyLines: 'greedy' } as const

function parse(csv: string) {
  const result = Papa.parse<Record<string, string>>(csv, OPTIONS)
  return { columns: result.meta.fields ?? [], rows: result.data }
}

/** Maps parsed rows onto the four fields, as the web app does before posting. */
function toRows(rows: Record<string, string>[], emailColumn: string): RawRow[] {
  // Through a Map rather than by indexing the row with a variable column name,
  // which is the injection sink the security rule watches for.
  return rows.map((row) => ({ email: new Map(Object.entries(row)).get(emailColumn) }))
}

describe('a plain comma-separated file', () => {
  const csv = 'email,nom\na@exemple.fr,Marie\nb@exemple.fr,Paul\n'

  it('reads its columns', () => {
    assert.deepEqual(parse(csv).columns, ['email', 'nom'])
  })

  it('reads its rows', () => {
    const { rows } = parse(csv)

    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.email, 'a@exemple.fr')
  })
})

describe('a file written by a French Excel', () => {
  // Semicolons, a byte order mark, and CRLF line endings: all three at once is
  // the normal case, not the awkward one.
  const csv = `${BOM}email;entreprise\r\na@exemple.fr;Dupont & Fils\r\nb@exemple.fr;Acme\r\n`

  it('detects the semicolon separator', () => {
    assert.deepEqual(parse(csv).columns, ['email', 'entreprise'])
  })

  it('strips the byte order mark from the first column name', () => {
    // Left in place, the mark prefixes the first column name with an
    // invisible character and no mapping ever matches it.
    const [first] = parse(csv).columns

    assert.equal(first, 'email')
    assert.ok(!first.includes(BOM))
  })

  it('survives CRLF line endings', () => {
    const { rows } = parse(csv)

    assert.equal(rows.length, 2)
    assert.equal(rows[1]?.email, 'b@exemple.fr')
  })

  it('feeds contacts that validate', () => {
    const { rows } = parse(csv)
    const result = collectContacts(toRows(rows, 'email'), { firstLine: 2 })

    assert.equal(result.summary.accepted, 2)
  })
})

describe('quoting', () => {
  it('keeps a separator inside a quoted field', () => {
    const { rows } = parse('email,entreprise\na@exemple.fr,"Dupont, Martin & Fils"\n')

    assert.equal(rows[0]?.entreprise, 'Dupont, Martin & Fils')
  })

  it('keeps a newline inside a quoted field', () => {
    const { rows } = parse('email,adresse\na@exemple.fr,"1 rue A\n75000 Paris"\n')

    assert.equal(rows.length, 1)
    assert.ok(rows[0]?.adresse?.includes('\n'))
  })
})

describe('an empty or unusable file', () => {
  it('yields no rows for an empty string', () => {
    assert.equal(parse('').rows.length, 0)
  })

  it('yields no rows for a header alone', () => {
    assert.equal(parse('email,nom\n').rows.length, 0)
  })

  it('skips blank lines rather than importing them', () => {
    // A trailing blank line is what every editor adds, and it must not become
    // a rejected row in the report.
    const { rows } = parse('email\na@exemple.fr\n\n\n')

    assert.equal(rows.length, 1)
  })

  it('collects nothing without failing', () => {
    assert.deepEqual(collectContacts(toRows(parse('email\n').rows, 'email')).summary, {
      read: 0,
      accepted: 0,
      rejected: 0,
    })
  })
})

describe('a realistic file of 500 rows', () => {
  const header = 'email;nom;entreprise\r\n'
  const body = Array.from(
    { length: 500 },
    (_, i) => `contact${String(i)}@exemple.fr;Nom ${String(i)};Société ${String(i)}\r\n`,
  ).join('')

  // The kinds of mess a real list contains, appended to the clean rows.
  const messy = [
    'pas-une-adresse;X;Y\r\n',
    'CONTACT7@Exemple.FR;Doublon;Z\r\n',
    ';Sans adresse;W\r\n',
    'marie dupont@exemple.fr;Espace;V\r\n',
  ].join('')

  const csv = `${BOM}${header}${body}${messy}`

  it('parses and validates well under the minute the target allows', () => {
    const started = Date.now()
    const { rows } = parse(csv)
    const result = collectContacts(toRows(rows, 'email'), { firstLine: 2 })
    const elapsed = Date.now() - started

    assert.equal(result.summary.read, 504)
    assert.equal(result.summary.accepted, 500)
    assert.equal(result.summary.rejected, 4)
    assert.ok(elapsed < 5000, `took ${String(elapsed)} ms`)
  })

  it('gives each rejection a reason and a line the spreadsheet agrees with', () => {
    const { rows } = parse(csv)
    const { rejected } = collectContacts(toRows(rows, 'email'), { firstLine: 2 })

    assert.deepEqual(
      rejected.map((row) => row.reason),
      ['invalid_email', 'duplicate_in_file', 'invalid_email', 'invalid_email'],
    )
    // 500 data rows start at line 2, so the first bad one is line 502.
    assert.equal(rejected[0]?.line, 502)
  })
})
