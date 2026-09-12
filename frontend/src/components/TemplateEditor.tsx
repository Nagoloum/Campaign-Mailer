import { useRef, useState } from 'react'
import ReactQuill from 'react-quill-new'

import 'react-quill-new/dist/quill.snow.css'

/**
 * Only what an email can actually render.
 *
 * Mail clients strip or ignore most of what a rich editor offers; a toolbar
 * that promises colours and fonts produces a message that looks nothing like
 * the preview once it lands in a mailbox.
 */
const TOOLBAR = [
  ['bold', 'italic', 'underline'],
  [{ list: 'bullet' }, { list: 'ordered' }],
  ['link'],
  ['clean'],
]

const MODULES = { toolbar: TOOLBAR }
const FORMATS = ['bold', 'italic', 'underline', 'list', 'link']

export interface TemplateEditorProps {
  subject: string
  bodyHtml: string
  variables: string[]
  disabled: boolean
  onSubjectChange: (value: string) => void
  onBodyChange: (html: string, text: string) => void
}

export function TemplateEditor({
  subject,
  bodyHtml,
  variables,
  disabled,
  onSubjectChange,
  onBodyChange,
}: TemplateEditorProps) {
  const quillRef = useRef<ReactQuill>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  /** Which field a variable button should insert into. */
  const [target, setTarget] = useState<'subject' | 'body'>('body')

  function insert(name: string) {
    const token = `{{${name}}}`

    if (target === 'subject') {
      const input = subjectRef.current

      if (!input) {
        return
      }

      const at = input.selectionStart ?? subject.length
      onSubjectChange(subject.slice(0, at) + token + subject.slice(at))
      return
    }

    const editor = quillRef.current?.getEditor()

    if (!editor) {
      return
    }

    // At the cursor, not at the end. Appending would force the user to cut and
    // paste the token into the sentence they were writing.
    const at = editor.getSelection(true)?.index ?? editor.getLength()
    editor.insertText(at, token, 'user')
    editor.setSelection(at + token.length, 0)
  }

  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium">Objet</span>
        <input
          ref={subjectRef}
          value={subject}
          disabled={disabled}
          onFocus={() => {
            setTarget('subject')
          }}
          onChange={(event) => {
            onSubjectChange(event.target.value)
          }}
          maxLength={500}
          placeholder="Candidature — {{company_name}}"
          className="mt-1.5 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm disabled:opacity-60"
        />
      </label>

      <div className="mt-5">
        <span className="text-sm font-medium">Message</span>

        <div
          className="mt-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised"
          onFocus={() => {
            setTarget('body')
          }}
        >
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={bodyHtml}
            readOnly={disabled}
            modules={MODULES}
            formats={FORMATS}
            onChange={(html, _delta, _source, editor) => {
              // The text body is derived rather than written twice. Keeping
              // two editors in step is a chore users lose interest in, and a
              // message whose text part drifts from its HTML part is worse
              // than one with no text part at all.
              onBodyChange(html, editor.getText())
            }}
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs text-ink-muted">
          Insérer une variable dans {target === 'subject' ? 'l’objet' : 'le message'} :
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {variables.map((name) => (
            <button
              key={name}
              type="button"
              disabled={disabled}
              onClick={() => {
                insert(name)
              }}
              className="rounded-md border border-border px-2 py-1 font-mono text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              {`{{${name}}}`}
            </button>
          ))}
        </div>
        {/* The fallback syntax is the difference between "Bonjour Marie," and
            "Bonjour ," on a CSV that was missing a column. Worth saying where
            the user is writing, not in a help page. */}
        <p className="mt-2 text-xs text-ink-muted">
          Ajoutez un repli après une barre verticale, par exemple{' '}
          <code className="font-mono">{'{{contact_name|à vous}}'}</code>, pour les
          contacts dont la valeur manque.
        </p>
      </div>
    </div>
  )
}
