import type { Pool } from 'pg'

/**
 * The specification's success criteria, measured rather than assumed:
 * a campaign created in under five minutes, fewer than 2 % of sends failing,
 * and an API under 200 ms.
 *
 * The first two are read from the data the application already keeps. The
 * third is not in the database — it is a property of the requests — so the
 * script that prints these measures it from outside (src/scripts/metrics.ts).
 *
 * Every figure is counted from the rows, never from a running total, so a
 * counter that drifted cannot flatter the result.
 */

export interface SendMetrics {
  sent: number
  failed: number
  /** Failed over attempted, or null when nothing was attempted. */
  errorRate: number | null
}

export interface SuccessMetrics {
  last24h: SendMetrics
  last7d: SendMetrics
  /** Seconds from an account's first sign-in to its first campaign launched. */
  timeToFirstLaunch: { accounts: number; medianSeconds: number | null }
  campaigns: Record<string, number>
  accounts: number
}

async function readSendMetrics(pool: Pool, interval: string): Promise<SendMetrics> {
  const { rows } = await pool.query<{ sent: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE event_type = 'sent')::int  AS sent,
            count(*) FILTER (WHERE event_type = 'error')::int AS failed
       FROM logs
      WHERE contact_id IS NOT NULL
        AND event_type IN ('sent', 'error')
        AND created_at > now() - $1::interval`,
    [interval],
  )

  const counts = rows[0] ?? { sent: 0, failed: 0 }
  const attempted = counts.sent + counts.failed

  return {
    ...counts,
    errorRate: attempted === 0 ? null : counts.failed / attempted,
  }
}

export async function readSuccessMetrics(pool: Pool): Promise<SuccessMetrics> {
  const [last24h, last7d] = await Promise.all([
    readSendMetrics(pool, '24 hours'),
    readSendMetrics(pool, '7 days'),
  ])

  // The launch is taken from the audit log rather than started_at: it records
  // the moment the user pressed the button, which is what the criterion is
  // about, and it survives a campaign being deleted afterwards.
  const { rows: launches } = await pool.query<{
    accounts: number
    median_seconds: number | null
  }>(
    `WITH first_launch AS (
       SELECT u.id,
              min(a.created_at) - u.created_at AS delay
         FROM users u
         JOIN audit_events a ON a.actor_id = u.id AND a.action = 'campaign.started'
        GROUP BY u.id, u.created_at
     )
     SELECT count(*)::int AS accounts,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM delay))
              AS median_seconds
       FROM first_launch`,
  )

  const { rows: byStatus } = await pool.query<{ status: string; total: number }>(
    'SELECT status, count(*)::int AS total FROM campaigns GROUP BY status ORDER BY status',
  )

  const { rows: accounts } = await pool.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM users',
  )

  return {
    last24h,
    last7d,
    timeToFirstLaunch: {
      accounts: launches[0]?.accounts ?? 0,
      medianSeconds:
        launches[0]?.median_seconds === null || launches[0]?.median_seconds === undefined
          ? null
          : Math.round(launches[0].median_seconds),
    },
    campaigns: Object.fromEntries(byStatus.map((row) => [row.status, row.total])),
    accounts: accounts[0]?.total ?? 0,
  }
}

/** The specification's thresholds, so the script and a reader agree on them. */
export const TARGETS = {
  errorRate: 0.02,
  firstLaunchSeconds: 5 * 60,
  apiLatencyMs: 200,
} as const

export function meetsTargets(metrics: SuccessMetrics): {
  errorRate: boolean | null
  firstLaunch: boolean | null
} {
  return {
    errorRate:
      metrics.last7d.errorRate === null
        ? null
        : metrics.last7d.errorRate <= TARGETS.errorRate,
    firstLaunch:
      metrics.timeToFirstLaunch.medianSeconds === null
        ? null
        : metrics.timeToFirstLaunch.medianSeconds <= TARGETS.firstLaunchSeconds,
  }
}
