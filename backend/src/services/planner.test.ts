import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { localHour, planDay, type PlanInput } from './planner.js'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${String(i)}`)

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    // 10:30 in Paris, in summer.
    now: new Date('2026-07-01T08:30:00Z'),
    timezone: 'Europe/Paris',
    startHour: 9,
    mailsPerDay: 46,
    pauseMs: 3000,
    sentByCampaign: 0,
    sentByAccount: 0,
    accountLimit: 120,
    pendingContactIds: ids(100),
    random: () => 0,
    ...overrides,
  }
}

/** The interval between each planned send and the one before it. */
function gapsOf(planned: readonly { delayMs: number }[]): number[] {
  const delays = planned.map((send) => send.delayMs)
  return delays.slice(1).map((delay, index) => delay - (delays.at(index) ?? 0))
}

function sends(overrides: Partial<PlanInput> = {}) {
  const outcome = planDay(input(overrides))
  assert.equal(outcome.kind, 'planned')
  return outcome.sends
}

describe('the start hour', () => {
  it('follows daylight saving in the campaign’s zone', () => {
    // 07:30 UTC is 09:30 in Paris in July and 08:30 in January. A server-time
    // or fixed-offset reading would get one of the two wrong.
    assert.equal(localHour(new Date('2026-07-01T07:30:00Z'), 'Europe/Paris'), 9)
    assert.equal(localHour(new Date('2026-01-15T07:30:00Z'), 'Europe/Paris'), 8)
  })

  it('plans nothing before it', () => {
    const outcome = planDay(input({ now: new Date('2026-01-15T07:30:00Z') }))
    assert.deepEqual(outcome, { kind: 'before_start_hour' })
  })

  it('plans from the hour itself', () => {
    assert.ok(sends({ now: new Date('2026-07-01T07:00:00Z') }).length > 0)
  })

  it('reads midnight as 0, not 24', () => {
    assert.equal(localHour(new Date('2026-07-01T22:00:00Z'), 'Europe/Paris'), 0)
  })
})

describe('how many', () => {
  it('takes the campaign’s daily pace', () => {
    assert.equal(sends().length, 46)
  })

  it('subtracts what the campaign already sent in the last 24 hours', () => {
    assert.equal(sends({ sentByCampaign: 40 }).length, 6)
  })

  it('never exceeds what the account has left, whatever the campaign asks', () => {
    // Two campaigns from one account share one Gmail quota.
    assert.equal(sends({ sentByAccount: 110 }).length, 10)
  })

  it('stops at the account ceiling', () => {
    assert.deepEqual(planDay(input({ sentByAccount: 120 })), {
      kind: 'account_quota_reached',
    })
  })

  it('stops at the campaign’s pace', () => {
    assert.deepEqual(planDay(input({ sentByCampaign: 46 })), {
      kind: 'campaign_quota_reached',
    })
  })

  it('takes the oldest contacts first', () => {
    assert.deepEqual(
      sends({ mailsPerDay: 3 }).map((s) => s.contactId),
      ['c0', 'c1', 'c2'],
    )
  })

  it('says so when nobody is left', () => {
    assert.deepEqual(planDay(input({ pendingContactIds: [] })), {
      kind: 'nothing_pending',
    })
  })
})

describe('when', () => {
  it('sends the first one now and spaces the rest by the pause', () => {
    assert.deepEqual(
      sends({ mailsPerDay: 3 }).map((s) => s.delayMs),
      [0, 3000, 6000],
    )
  })

  it('adds at most twenty percent of jitter to each gap', () => {
    const gaps = gapsOf(sends({ mailsPerDay: 3, random: () => 0.999 }))

    assert.equal(gaps.length, 2)
    for (const gap of gaps) {
      assert.ok(gap > 3000 && gap <= 3600, `gap ${String(gap)} out of bounds`)
    }
  })

  it('never produces two identical gaps with a real random source', () => {
    const gaps = new Set(gapsOf(sends({ mailsPerDay: 20, random: Math.random })))
    assert.ok(gaps.size > 1, 'a perfectly regular interval is a signature')
  })
})
