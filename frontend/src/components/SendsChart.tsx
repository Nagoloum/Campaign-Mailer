import { useId, useState } from 'react'

import type { DaySends } from '@/services/campaigns'
import { continuousDays, niceMax } from '@/services/chartScale'

/**
 * Sends per day, as stacked columns: sent at the base, failures on top.
 *
 * Plain HTML rather than a charting library. It is one chart of at most thirty
 * columns, and a library would add more weight to the bundle than the rest of
 * this page. The two colours were run through the palette validator against
 * this surface: colour-blind separation ΔE 23.8, normal vision ΔE 31.6, both
 * above 3:1 contrast.
 */

const SENT = '#2a78d6'
const FAILED = '#d03b3b'

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function dayLabel(day: string): string {
  return DAY_LABEL.format(new Date(`${day}T00:00:00Z`))
}

function describe(day: DaySends): string {
  const sent = `${String(day.sent)} envoyé${day.sent > 1 ? 's' : ''}`
  return day.failed > 0
    ? `${dayLabel(day.day)} : ${sent}, ${String(day.failed)} en erreur`
    : `${dayLabel(day.day)} : ${sent}`
}

export function SendsChart({ days }: { days: readonly DaySends[] }) {
  const series = continuousDays(days)
  const [active, setActive] = useState<number | null>(null)
  const titleId = useId()

  if (series.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
        Aucun envoi pour l’instant. Le graphique se remplit au premier message parti.
      </p>
    )
  }

  const max = niceMax(Math.max(...series.map((day) => day.sent + day.failed)))
  const hasFailures = series.some((day) => day.failed > 0)
  // Label every k-th day so the axis never collides, and always the last one.
  const every = Math.ceil(series.length / 7)
  const activeDay = active === null ? undefined : series.at(active)

  return (
    <figure aria-labelledby={titleId} className="m-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption id={titleId} className="text-sm font-medium">
          Envois par jour
        </figcaption>

        {/* Two series, so a legend; identity is never colour alone. */}
        <ul className="flex gap-4 text-xs text-ink-muted">
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ background: SENT }}
            />
            Envoyés
          </li>
          {hasFailures && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: FAILED }}
              />
              En erreur
            </li>
          )}
        </ul>
      </div>

      <div className="relative mt-3 flex gap-2">
        {/* Y axis: three clean ticks, text in ink, never in the series colour. */}
        <div
          aria-hidden
          className="flex h-40 w-8 shrink-0 flex-col justify-between text-right text-[11px] text-ink-muted tabular-nums"
        >
          <span className="-translate-y-1/2">{max}</span>
          <span>{max / 2}</span>
          <span className="translate-y-1/2">0</span>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Hairline gridlines, recessive; the baseline one step stronger. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40">
            <div className="absolute inset-x-0 top-0 border-t border-border" />
            <div className="absolute inset-x-0 top-1/2 border-t border-border" />
            <div className="absolute inset-x-0 bottom-0 border-t border-ink-muted/40" />
          </div>

          <ol className="relative flex h-40 items-end">
            {series.map((day, index) => {
              const total = day.sent + day.failed
              const height = (total / max) * 100

              return (
                <li key={day.day} className="flex h-full flex-1 justify-center">
                  {/* The whole column is the hit target, not the painted bar. */}
                  <button
                    type="button"
                    aria-label={describe(day)}
                    onPointerEnter={() => {
                      setActive(index)
                    }}
                    onPointerLeave={() => {
                      setActive(null)
                    }}
                    onFocus={() => {
                      setActive(index)
                    }}
                    onBlur={() => {
                      setActive(null)
                    }}
                    className="group flex h-full w-full cursor-default items-end justify-center rounded-sm focus-visible:outline-offset-0"
                  >
                    <span
                      className="flex w-full max-w-6 flex-col gap-0.5 transition-[height,opacity] duration-300 ease-out group-hover:opacity-80 motion-reduce:transition-none"
                      style={{ height: `${String(height)}%` }}
                    >
                      {day.failed > 0 && (
                        <span
                          className="rounded-t-sm"
                          style={{ flexGrow: day.failed, background: FAILED }}
                        />
                      )}
                      {day.sent > 0 && (
                        <span
                          className={day.failed > 0 ? '' : 'rounded-t-sm'}
                          style={{ flexGrow: day.sent, background: SENT }}
                        />
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <ol aria-hidden className="mt-1.5 flex text-[11px] text-ink-muted">
            {series.map((day, index) => (
              <li key={day.day} className="flex-1 text-center whitespace-nowrap">
                {index % every === 0 || index === series.length - 1
                  ? dayLabel(day.day)
                  : ''}
              </li>
            ))}
          </ol>

          {activeDay && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-sm"
              style={{ left: `${String(((active + 0.5) / series.length) * 100)}%` }}
            >
              <p className="text-ink-muted">{dayLabel(activeDay.day)}</p>
              <p className="mt-1 flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-3" style={{ background: SENT }} />
                <strong className="font-semibold text-ink">{activeDay.sent}</strong>
                <span className="text-ink-muted">envoyés</span>
              </p>
              {activeDay.failed > 0 && (
                <p className="mt-0.5 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-0.5 w-3"
                    style={{ background: FAILED }}
                  />
                  <strong className="font-semibold text-ink">{activeDay.failed}</strong>
                  <span className="text-ink-muted">en erreur</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The table view: every value reachable without hovering. */}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">
          Voir les chiffres
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface-raised text-ink-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Jour</th>
                <th className="px-3 py-1.5 text-right font-medium">Envoyés</th>
                <th className="px-3 py-1.5 text-right font-medium">En erreur</th>
              </tr>
            </thead>
            <tbody>
              {series.map((day) => (
                <tr key={day.day} className="border-t border-border">
                  <td className="px-3 py-1.5">{dayLabel(day.day)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{day.sent}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{day.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
