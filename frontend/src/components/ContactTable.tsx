import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/services/api'
import {
  contactStatusLabel,
  contactsApi,
  type Contact,
  type ContactStatus,
} from '@/services/contacts'

const PAGE = 25

const STATUS_FILTERS: { value: ContactStatus | ''; label: string }[] = [
  { value: '', label: 'Tous' },
  { value: 'pending', label: 'En attente' },
  { value: 'sent', label: 'Envoyés' },
  { value: 'failed', label: 'En erreur' },
  { value: 'ignored', label: 'Ignorés' },
]

export function ContactTable({
  campaignId,
  reloadKey,
  onChanged,
}: {
  campaignId: string
  /** Changes when an import lands, so the table reloads without a prop drill. */
  reloadKey: number
  onChanged: () => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState<ContactStatus | ''>('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const result = await contactsApi.list(campaignId, {
        ...(status ? { status } : {}),
        ...(search ? { search } : {}),
        limit: PAGE,
        offset,
      })

      setContacts(result.contacts)
      setTotal(result.total)
    } catch {
      toast.error('Impossible de charger les contacts.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, status, search, offset])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load, reloadKey])

  /** Filtering from a later page would show an empty table and look broken. */
  function refine(next: { status?: ContactStatus | ''; search?: string }) {
    setOffset(0)
    if (next.status !== undefined) {
      setStatus(next.status)
    }
    if (next.search !== undefined) {
      setSearch(next.search)
    }
  }

  async function act(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      toast.success(message)
      await load()
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’action a échoué.')
    }
  }

  return (
    <section aria-labelledby="contacts-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="contacts-heading" className="text-sm font-medium">
          Contacts <span className="text-ink-muted tabular-nums">({total})</span>
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="contact-search">
            Rechercher un contact
          </label>
          <input
            id="contact-search"
            value={search}
            placeholder="Rechercher…"
            onChange={(event) => {
              refine({ search: event.target.value })
            }}
            className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
          />
          <select
            value={status}
            aria-label="Filtrer par statut"
            onChange={(event) => {
              refine({ status: event.target.value as ContactStatus | '' })
            }}
            className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <p role="status" className="mt-3 text-sm text-ink-muted">
          Chargement…
        </p>
      )}

      {!loading && contacts.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
          {total === 0 && !search && !status
            ? 'Aucun contact. Importez un fichier CSV pour commencer.'
            : 'Aucun contact ne correspond à ce filtre.'}
        </p>
      )}

      {!loading && contacts.length > 0 && (
        <>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="bg-surface-raised text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Adresse</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">Entreprise</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{contact.email}</span>
                      {contact.errorMessage && (
                        // The reason a send failed belongs beside the address,
                        // not in a detail panel nobody opens.
                        <span className="block text-xs text-amber-700">
                          {contact.errorMessage}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{contact.contactName ?? '—'}</td>
                    <td className="px-3 py-2">{contact.companyName ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {contactStatusLabel(contact.status)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {(contact.status === 'pending' || contact.status === 'ignored') && (
                        <button
                          type="button"
                          onClick={() =>
                            void act(
                              () =>
                                contactsApi.setStatus(
                                  campaignId,
                                  contact.id,
                                  contact.status === 'ignored' ? 'pending' : 'ignored',
                                ),
                              contact.status === 'ignored'
                                ? 'Contact remis en attente.'
                                : 'Contact ignoré.',
                            )
                          }
                          className="text-xs text-ink-muted hover:text-ink"
                        >
                          {contact.status === 'ignored' ? 'Réactiver' : 'Ignorer'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void act(
                            () => contactsApi.remove(campaignId, contact.id),
                            'Contact supprimé.',
                          )
                        }
                        className="ms-3 text-xs text-ink-muted hover:text-amber-700"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => {
                  setOffset((current) => Math.max(0, current - PAGE))
                }}
                className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
              >
                Précédent
              </button>
              <span className="text-xs text-ink-muted tabular-nums">
                {offset + 1}–{Math.min(offset + PAGE, total)} sur {total}
              </span>
              <button
                type="button"
                disabled={offset + PAGE >= total}
                onClick={() => {
                  setOffset((current) => current + PAGE)
                }}
                className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
