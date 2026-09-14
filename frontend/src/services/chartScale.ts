import type { DaySends } from './campaigns'

/**
 * The arithmetic behind the sends chart, kept apart from the component so it
 * can be checked without React, and so the component file exports only a
 * component — which is what Vite's fast refresh needs.
 */

/** A month is what fits at a readable column width, and what the question is about. */
export const MAX_DAYS = 30

/** Every calendar day from the first send to the last, zero-filled, capped to the last month. */
export function continuousDays(days: readonly DaySends[]): DaySends[] {
  const first = days[0]
  const last = days.at(-1)

  if (!first || !last) {
    return []
  }

  const byDay = new Map(days.map((day) => [day.day, day]))
  const filled: DaySends[] = []
  const end = Date.parse(`${last.day}T00:00:00Z`)

  for (let t = Date.parse(`${first.day}T00:00:00Z`); t <= end; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10)
    filled.push(byDay.get(key) ?? { day: key, sent: 0, failed: 0 })
  }

  return filled.slice(-MAX_DAYS)
}

/** The smallest of 1, 2 or 5 times a power of ten at or above `value`. */
export function niceMax(value: number): number {
  if (value <= 0) {
    return 1
  }

  const power = 10 ** Math.floor(Math.log10(value))

  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value) {
      return step * power
    }
  }

  return 10 * power
}
