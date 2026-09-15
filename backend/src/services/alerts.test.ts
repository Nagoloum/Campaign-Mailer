import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HEARTBEAT_STALE_MS } from '../jobs/heartbeat.js'

import {
  ALERT_REPEAT_MS,
  QUEUE_STUCK_AFTER_MS,
  createAlertTracker,
  queueStuckAlert,
  readQueueHealth,
  runAlertChecks,
  sendErrorRateAlert,
  workerStoppedAlert,
  type Alert,
} from './alerts.js'

const NOW = 1_700_000_000_000

describe('sendErrorRateAlert', () => {
  it('stays quiet on too few sends to mean anything', () => {
    assert.equal(sendErrorRateAlert({ sent: 5, errors: 4 }), null)
  })

  it('stays quiet at exactly 5 %: the threshold is "above"', () => {
    assert.equal(sendErrorRateAlert({ sent: 19, errors: 1 }), null)
  })

  it('fires above 5 %, with the counts', () => {
    assert.deepEqual(sendErrorRateAlert({ sent: 18, errors: 2 }), {
      kind: 'send_error_rate',
      message: 'Send error rate at 10 % over the last hour (2 of 20)',
      details: { sent: 18, errors: 2, rate: 0.1 },
    })
  })
})

describe('queueStuckAlert', () => {
  it('stays quiet on an empty queue', () => {
    assert.equal(queueStuckAlert({ earliestDueAt: null }, NOW), null)
  })

  it('stays quiet on a job a sleeping worker has not reached yet', () => {
    assert.equal(queueStuckAlert({ earliestDueAt: NOW - 2 * 60_000 }, NOW), null)
  })

  it('fires when a job has been due for longer than the limit', () => {
    const alert = queueStuckAlert(
      { earliestDueAt: NOW - QUEUE_STUCK_AFTER_MS - 60_000 },
      NOW,
    )

    assert.equal(alert?.kind, 'queue_stuck')
    assert.equal(alert.message, 'Queue stuck: a job has been due for 16 minutes')
  })
})

describe('workerStoppedAlert', () => {
  it('stays quiet while the heartbeat is fresh', () => {
    assert.equal(workerStoppedAlert(NOW - 60_000, NOW), null)
  })

  it('fires when there is no heartbeat at all', () => {
    assert.equal(workerStoppedAlert(null, NOW)?.message, 'Worker stopped: no heartbeat')
  })

  it('fires when the heartbeat is older than three beats', () => {
    const alert = workerStoppedAlert(NOW - HEARTBEAT_STALE_MS - 60_000, NOW)

    assert.equal(alert?.kind, 'worker_stopped')
    assert.equal(alert.message, 'Worker stopped: last heartbeat 16 minutes ago')
  })
})

const stopped: Alert = { kind: 'worker_stopped', message: 'Worker stopped', details: {} }
const watched = ['worker_stopped', 'queue_stuck'] as const

describe('createAlertTracker', () => {
  it('notifies when a condition starts, not on every check while it lasts', () => {
    const tracker = createAlertTracker()

    assert.deepEqual(tracker.update(watched, [stopped], NOW).notify, [stopped])
    assert.deepEqual(tracker.update(watched, [stopped], NOW + 5 * 60_000).notify, [])
  })

  it('notifies again once the repeat interval has passed', () => {
    const tracker = createAlertTracker()
    tracker.update(watched, [stopped], NOW)

    assert.deepEqual(tracker.update(watched, [stopped], NOW + ALERT_REPEAT_MS).notify, [
      stopped,
    ])
  })

  it('reports a condition that ended, once, and notifies anew if it returns', () => {
    const tracker = createAlertTracker()
    tracker.update(watched, [stopped], NOW)

    assert.deepEqual(tracker.update(watched, [], NOW + 1).resolved, ['worker_stopped'])
    assert.deepEqual(tracker.update(watched, [], NOW + 2).resolved, [])
    assert.deepEqual(tracker.update(watched, [stopped], NOW + 3).notify, [stopped])
  })
})

describe('readQueueHealth', () => {
  const queueWith = (waiting: object[], delayed: object[]) =>
    ({
      getJobs: () => Promise.resolve(waiting),
      getDelayed: () => Promise.resolve(delayed),
    }) as unknown as Parameters<typeof readQueueHealth>[0]

  it('takes the earliest due time across waiting and delayed jobs', async () => {
    const health = await readQueueHealth(
      queueWith([{ timestamp: 5_000, delay: 0 }], [{ timestamp: 1_000, delay: 2_000 }]),
    )

    assert.deepEqual(health, { earliestDueAt: 3_000 })
  })

  it('counts a job promoted from delayed as due when its delay ended, not when it was queued', async () => {
    const health = await readQueueHealth(
      queueWith([{ timestamp: 1_000, delay: 60_000 }], []),
    )

    assert.deepEqual(health, { earliestDueAt: 61_000 })
  })

  it('reports nothing due on an empty queue', async () => {
    assert.deepEqual(await readQueueHealth(queueWith([], [])), { earliestDueAt: null })
  })
})

describe('runAlertChecks', () => {
  it('logs and reports what fires, and logs what resolves', async () => {
    const lines: unknown[][] = []
    const reported: Alert[] = []
    const log = {
      error: (...args: unknown[]) => lines.push(['error', ...args]),
      info: (...args: unknown[]) => lines.push(['info', ...args]),
    } as unknown as Parameters<typeof runAlertChecks>[0]['log']

    const tracker = createAlertTracker()
    const deps = {
      watched,
      tracker,
      log,
      report: (alert: Alert) => reported.push(alert),
      now: () => NOW,
    }

    await runAlertChecks({ ...deps, checks: () => Promise.resolve([stopped, null]) })
    await runAlertChecks({ ...deps, checks: () => Promise.resolve([null, null]) })

    assert.deepEqual(reported, [stopped])
    assert.deepEqual(lines, [
      ['error', { alert: 'worker_stopped' }, 'Worker stopped'],
      ['info', { alert: 'worker_stopped' }, 'Alert resolved'],
    ])
  })
})
