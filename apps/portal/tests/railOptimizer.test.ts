/**
 * The 6 ft / 8 ft picker's decision rules, given the full cost of each run at
 * each width. The real full costs (pull sheet plus labor) are tested in
 * widthPricing.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { optimizeRun, optimizeJob, DEFAULT_RAIL_OPTIMIZER_SETTINGS, type RunCostFn } from '../../web/src/railOptimizer'

const settings = DEFAULT_RAIL_OPTIMIZER_SETTINGS
// $100 per 6 ft section, $120 per 8 ft section: 8 ft is cheaper on long runs.
const perSection: RunCostFn = (ft, rail) => (rail === '8ft' ? 120 * Math.ceil(ft / 8) : 100 * Math.ceil(ft / 6))

describe('optimizeRun', () => {
  test('8 ft wins when it costs less', () => {
    const r = optimizeRun({ footage: 48, runCost: perSection, settings }) // 6 ft: 8 × 100 = 800, 8 ft: 6 × 120 = 720
    expect(r.railType).toBe('8ft')
    expect(r.sectionCount).toBe(6)
    expect(r.savings).toBe(80)
  })

  test('6 ft wins when 8 ft costs more than 2% extra', () => {
    const r = optimizeRun({ footage: 12, runCost: (ft, rail) => (rail === '8ft' ? 110 : 100), settings })
    expect(r.railType).toBe('6ft')
    expect(r.savings).toBe(10)
  })

  test('8 ft is kept when it costs no more than 2% extra', () => {
    const r = optimizeRun({ footage: 12, runCost: (ft, rail) => (rail === '8ft' ? 102 : 100), settings })
    expect(r.railType).toBe('8ft')
    expect(r.savings).toBe(0)
  })

  test('runs at or under the cutoff are always 6 ft', () => {
    const r = optimizeRun({ footage: 6, runCost: (ft, rail) => (rail === '8ft' ? 1 : 100), settings })
    expect(r.railType).toBe('6ft')
    expect(r.isShortRun).toBe(true)
  })

  test('a width set by hand wins over cost and cutoff', () => {
    expect(optimizeRun({ footage: 4, runCost: perSection, settings, override: '8ft' }).railType).toBe('8ft')
    expect(optimizeRun({ footage: 48, runCost: perSection, settings, override: '6ft' }).railType).toBe('6ft')
  })

  test('optimizer off means 6 ft', () => {
    const r = optimizeRun({ footage: 48, runCost: perSection, settings: { ...settings, enabled: false } })
    expect(r.railType).toBe('6ft')
    expect(r.isDisabled).toBe(true)
  })
})

describe('optimizeJob', () => {
  test('adds up sections and cost against all 6 ft', () => {
    const job = optimizeJob({ runs: [{ footage: 4 }, { footage: 48 }, { footage: 96 }], runCost: perSection, settings })
    expect(job.perRun.map(r => r.railType)).toEqual(['6ft', '8ft', '8ft'])
    expect(job.totals.totalSections).toBe(1 + 6 + 12)
    expect(job.totals.sectionsSavedVsAll6ft).toBe((1 + 8 + 16) - 19)
    expect(job.totals.costAll6ft).toBe(100 + 800 + 1600)
    expect(job.totals.cost).toBe(100 + 720 + 1440)
    expect(job.totals.savingsVsAll6ft).toBe(240)
  })
})
