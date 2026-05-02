/**
 * Per-run section-count regression tests.
 *
 * Locks in the fix where total sections must be Σ ceil(run / panel) across
 * runs, never ceil(Σ run / panel). The chappel quote (the canonical
 * reproducer) must produce exactly 59 sections.
 */

import { describe, test, expect } from 'vitest'
import {
  sectionsForRun,
  calculateSectionCount,
  calculateLinePostsPerRun,
  totalLinePosts,
} from '../src/server/lib/sectionCount.js'

describe('sectionsForRun', () => {
  test('exact divide does not round up', () => {
    expect(sectionsForRun(6, 6)).toBe(1)
    expect(sectionsForRun(60, 6)).toBe(10)
    expect(sectionsForRun(80, 8)).toBe(10)
    expect(sectionsForRun(100, 10)).toBe(10)
  })

  test('non-exact divide rounds up', () => {
    expect(sectionsForRun(7, 6)).toBe(2)
    expect(sectionsForRun(104, 6)).toBe(18) // 17.33 → 18
    expect(sectionsForRun(70, 6)).toBe(12)
    expect(sectionsForRun(94, 6)).toBe(16)
    expect(sectionsForRun(40, 6)).toBe(7)
    expect(sectionsForRun(22, 6)).toBe(4)
  })

  test('zero or negative footage returns 0', () => {
    expect(sectionsForRun(0, 6)).toBe(0)
    expect(sectionsForRun(-5, 6)).toBe(0)
  })

  test('zero or negative panel returns 0', () => {
    expect(sectionsForRun(100, 0)).toBe(0)
    expect(sectionsForRun(100, -6)).toBe(0)
  })

  test('chainlink uses 10ft panel', () => {
    expect(sectionsForRun(104, 10)).toBe(11)
    expect(sectionsForRun(100, 10)).toBe(10)
  })

  test('8ft style uses 8ft panel', () => {
    expect(sectionsForRun(64, 8)).toBe(8)
    expect(sectionsForRun(65, 8)).toBe(9)
  })
})

describe('calculateSectionCount', () => {
  test('each run is calculated independently, not from total footage', () => {
    const runs = [
      { footage: 104 }, // 18
      { footage: 70 },  // 12
      { footage: 94 },  // 16
      { footage: 40 },  // 7
      { footage: 22 },  // 4
      { footage: 6 },   // 1
    ]
    const result = calculateSectionCount(runs, 6)
    expect(result.perRun).toEqual([18, 12, 16, 7, 4, 1])
    expect(result.total).toBe(58)
    // The wrong way: ceil(336 / 6) = 56 — must NOT match.
    expect(result.total).not.toBe(56)
  })

  test('chappel quote produces exactly 59 sections (regression target)', () => {
    const runs = [
      { footage: 4 },
      { footage: 104 },
      { footage: 70 },
      { footage: 94 },
      { footage: 40 },
      { footage: 22 },
      { footage: 6 },
    ]
    const result = calculateSectionCount(runs, 6)
    expect(result.perRun).toEqual([1, 18, 12, 16, 7, 4, 1])
    expect(result.total).toBe(59)
  })

  test('accepts a plain number array as well as RunInput objects', () => {
    const r1 = calculateSectionCount([104, 70, 94, 40, 22, 6], 6)
    const r2 = calculateSectionCount(
      [{ footage: 104 }, { footage: 70 }, { footage: 94 }, { footage: 40 }, { footage: 22 }, { footage: 6 }],
      6,
    )
    expect(r1).toEqual(r2)
  })

  test('zero-footage runs do not contribute to total', () => {
    const result = calculateSectionCount([0, 0, 6, 0], 6)
    expect(result.perRun).toEqual([0, 0, 1, 0])
    expect(result.total).toBe(1)
  })

  test('chainlink: 100ft + 7ft = 11 sections, not ceil(107/10)=11 (coincidentally same — use a non-coinciding case)', () => {
    // 33ft + 33ft + 33ft = 99 total. wrong way: ceil(99/10)=10. right way: 4+4+4=12.
    const result = calculateSectionCount([33, 33, 33], 10)
    expect(result.perRun).toEqual([4, 4, 4])
    expect(result.total).toBe(12)
  })

  test('mixed boundary cases', () => {
    // 100ft (one section over the divisible boundary) + 7ft (rounds up to 2)
    const result = calculateSectionCount([100, 7], 6)
    // 100/6 = 16.67 → 17
    // 7/6  = 1.17  → 2
    // total 19
    expect(result.perRun).toEqual([17, 2])
    expect(result.total).toBe(19)
    // The wrong way: ceil(107/6) = 18 — must NOT match.
    expect(result.total).not.toBe(18)
  })
})

describe('calculateLinePostsPerRun', () => {
  test('per-run, sections-1, floor 0', () => {
    expect(calculateLinePostsPerRun([18, 12, 16, 7, 4, 1])).toEqual([17, 11, 15, 6, 3, 0])
  })

  test('a run with 1 section has 0 line posts', () => {
    expect(calculateLinePostsPerRun([1])).toEqual([0])
  })

  test('a run with 0 sections has 0 line posts', () => {
    expect(calculateLinePostsPerRun([0])).toEqual([0])
  })

  test('total line posts sums per-run line posts (not from total sections)', () => {
    // 18+12+16+7+4+1 = 58 sections
    // ceil(58-1) is irrelevant — line posts are per-run: 17+11+15+6+3+0 = 52.
    const sectionsPerRun = [18, 12, 16, 7, 4, 1]
    expect(totalLinePosts(sectionsPerRun)).toBe(52)
  })
})
