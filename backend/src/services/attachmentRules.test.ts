import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AttachmentRejected, assertAllowedType, safeFileName } from './attachmentRules.js'

describe('assertAllowedType', () => {
  it('accepts a PDF and a Word document', () => {
    assert.equal(assertAllowedType('application/pdf'), 'pdf')
    assert.equal(
      assertAllowedType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
      'docx',
    )
  })

  it('ignores the charset a browser appends', () => {
    assert.equal(assertAllowedType('application/pdf; charset=binary'), 'pdf')
  })

  it('is not case sensitive', () => {
    assert.equal(assertAllowedType('APPLICATION/PDF'), 'pdf')
  })

  describe('refuses', () => {
    // An allowlist, not a blocklist. The interesting case is not the
    // executable someone uploads on purpose, it is the file a recipient's mail
    // client decides to treat as runnable.
    for (const type of [
      'application/x-msdownload',
      'text/html',
      'image/svg+xml',
      'application/zip',
      'application/octet-stream',
      '',
    ]) {
      it(type || '(empty)', () => {
        assert.throws(() => assertAllowedType(type), AttachmentRejected)
      })
    }
  })
})

describe('safeFileName', () => {
  it('keeps a readable name and forces the extension', () => {
    assert.equal(safeFileName('Mon CV 2026.pdf', 'pdf'), 'Mon CV 2026.pdf')
  })

  it('replaces the extension with the one the type says', () => {
    // A file called .pdf that is really a Word document would otherwise reach
    // the recipient mislabelled.
    assert.equal(safeFileName('cv.pdf', 'docx'), 'cv.docx')
  })

  it('strips path separators', () => {
    assert.ok(!safeFileName('../../etc/passwd', 'pdf').includes('/'))
    assert.ok(!safeFileName('..\\..\\windows', 'pdf').includes('\\'))
  })

  it('strips newlines, which would be header injection', () => {
    // The name ends up in a Content-Disposition header when the message is
    // built.
    const name = safeFileName('cv\r\nContent-Type: text/html', 'pdf')

    assert.ok(!name.includes('\n'))
    assert.ok(!name.includes('\r'))
  })

  it('strips a null byte', () => {
    assert.ok(!safeFileName('cv\0.exe', 'pdf').includes('\0'))
  })

  it('falls back when nothing readable is left', () => {
    assert.equal(safeFileName('   ', 'pdf'), 'piece-jointe.pdf')
    assert.equal(safeFileName('.pdf', 'pdf'), 'piece-jointe.pdf')
  })

  it('bounds the length', () => {
    assert.ok(safeFileName('x'.repeat(500), 'pdf').length <= 124)
  })

  it('keeps accents, which a French CV has', () => {
    assert.equal(
      safeFileName('Curriculum vitæ — Amélie.pdf', 'pdf'),
      'Curriculum vitæ — Amélie.pdf',
    )
  })
})
