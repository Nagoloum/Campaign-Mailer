import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createIdleController,
  decideIdle,
  type QueueActivity,
  type Sleeper,
} from './idleSleep.js'

const NOW = 1_000_000
const HORIZON = 150_000

const quiet: QueueActivity = { waiting: 0, active: 0, nextDueAt: null }

const decide = (paused: boolean, activity: Partial<QueueActivity> = {}) =>
  decideIdle({
    paused,
    activity: { ...quiet, ...activity },
    now: NOW,
    horizonMs: HORIZON,
  })

describe('decideIdle', () => {
  it('pauses a running worker when the queue is empty', () => {
    assert.equal(decide(false), 'pause')
  })

  it('leaves a sleeping worker asleep when nothing is coming', () => {
    assert.equal(decide(true), 'stay')
  })

  it('wakes for a job waiting now', () => {
    // A user pressed "start": the dispatch job is waiting.
    assert.equal(decide(true, { waiting: 1 }), 'resume')
  })

  it('never pauses in the middle of a job', () => {
    assert.equal(decide(false, { active: 1 }), 'stay')
  })

  it('wakes for a delayed job that falls due within the horizon', () => {
    // The next send of a running campaign, thirty seconds away.
    assert.equal(decide(true, { nextDueAt: NOW + 30_000 }), 'resume')
  })

  it('wakes for a delayed job already overdue', () => {
    assert.equal(decide(true, { nextDueAt: NOW - 5_000 }), 'resume')
  })

  it('treats the edge of the horizon as due', () => {
    assert.equal(decide(true, { nextDueAt: NOW + HORIZON }), 'resume')
  })

  it('sleeps through a delayed job due beyond the horizon', () => {
    // Tomorrow morning's first send.
    assert.equal(decide(false, { nextDueAt: NOW + 12 * 3600_000 }), 'pause')
  })
})

describe('the idle controller', () => {
  function fakeWorker(startPaused: boolean) {
    const calls: string[] = []
    let paused = startPaused
    const worker: Sleeper = {
      isPaused: () => paused,
      pause: () => {
        calls.push('pause')
        paused = true
        return Promise.resolve()
      },
      resume: () => {
        calls.push('resume')
        paused = false
      },
    }
    return { worker, calls }
  }

  const controllerWith = (worker: Sleeper, activity: QueueActivity) =>
    createIdleController({
      worker,
      readActivity: () => Promise.resolve(activity),
      horizonMs: HORIZON,
      now: () => NOW,
    })

  it('pauses the worker it was given', async () => {
    const { worker, calls } = fakeWorker(false)

    assert.equal(await controllerWith(worker, quiet).check(), 'pause')
    assert.deepEqual(calls, ['pause'])
  })

  it('resumes it when work appears', async () => {
    const { worker, calls } = fakeWorker(true)

    assert.equal(await controllerWith(worker, { ...quiet, waiting: 2 }).check(), 'resume')
    assert.deepEqual(calls, ['resume'])
    assert.equal(worker.isPaused(), false)
  })

  it('does nothing when the worker is already where it should be', async () => {
    const { worker, calls } = fakeWorker(true)

    await controllerWith(worker, quiet).check()
    assert.deepEqual(calls, [])
  })
})
