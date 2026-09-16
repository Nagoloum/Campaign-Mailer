import { closePool, pool } from '../db/pool.js'
import { TARGETS, meetsTargets, readSuccessMetrics } from '../services/metrics.js'

/**
 * Prints where the application stands against the specification's success
 * criteria (services/metrics.ts), and measures the API's latency from here.
 *
 * Usage, from backend/:
 *   tsx src/scripts/metrics.ts [https://api-url]
 *
 * The latency is measured from wherever this runs, so it includes the network
 * between this machine and the API. Read it as an upper bound, not as the
 * server's own time.
 */

const SAMPLES = 10

async function measureLatency(url: string): Promise<{ median: number; worst: number }> {
  const times: number[] = []

  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now()
    await fetch(`${url}/api/health`)
    times.push(performance.now() - started)
  }

  times.sort((a, b) => a - b)

  return {
    median: Math.round(times[Math.floor(times.length / 2)] ?? 0),
    worst: Math.round(times.at(-1) ?? 0),
  }
}

const verdict = (ok: boolean | null) => (ok === null ? 'no data' : ok ? 'met' : 'MISSED')

try {
  const metrics = await readSuccessMetrics(pool)
  const targets = meetsTargets(metrics)
  const percent = (rate: number | null) =>
    rate === null ? 'no data' : `${(rate * 100).toFixed(2)} %`

  console.log('Accounts:', metrics.accounts)
  console.log('Campaigns by status:', metrics.campaigns)
  console.log('')
  console.log('Send error rate')
  console.log(
    `  last 24 h: ${percent(metrics.last24h.errorRate)} (${String(metrics.last24h.sent)} sent, ${String(metrics.last24h.failed)} failed)`,
  )
  console.log(
    `  last 7 d:  ${percent(metrics.last7d.errorRate)} (${String(metrics.last7d.sent)} sent, ${String(metrics.last7d.failed)} failed)`,
  )
  console.log(
    `  target under ${String(TARGETS.errorRate * 100)} % over 7 days: ${verdict(targets.errorRate)}`,
  )
  console.log('')
  console.log('Account to first campaign launched')
  console.log(
    `  accounts that launched: ${String(metrics.timeToFirstLaunch.accounts)}, median ${
      metrics.timeToFirstLaunch.medianSeconds === null
        ? 'no data'
        : `${String(Math.round(metrics.timeToFirstLaunch.medianSeconds / 60))} min`
    }`,
  )
  console.log(
    `  target under ${String(TARGETS.firstLaunchSeconds / 60)} min: ${verdict(targets.firstLaunch)}`,
  )

  const url = process.argv[2]

  if (url) {
    const latency = await measureLatency(url)
    console.log('')
    console.log(`API latency from here (${String(SAMPLES)} calls to /api/health)`)
    console.log(
      `  median ${String(latency.median)} ms, worst ${String(latency.worst)} ms`,
    )
    console.log(
      `  target under ${String(TARGETS.apiLatencyMs)} ms: ${verdict(latency.median <= TARGETS.apiLatencyMs)}`,
    )
  }
} finally {
  await closePool()
}
