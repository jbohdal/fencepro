/**
 * Mixed-rail material calculator tests (Milestone B).
 *
 * Verifies that an auto-mix vinyl job (per-run mix of 6ft and 8ft rails)
 * produces the correct quantities, splitting picket / rail / stiffener
 * counts by rail width while keeping post / hardware counts driven by
 * total post counts.
 *
 * Important: this file imports from the WEB-side materialCalculator since
 * that's where the calculator lives. Vitest can resolve the path because
 * it's just TypeScript.
 */

import { describe, test, expect } from 'vitest'
import { calculateMixedMaterials, mixedTotalSections } from '../../web/src/materialCalculator'
import type { MixedRunInput } from '../../web/src/materialCalculator'

const baseInput = {
  installMethod: 'no-dig' as const,
  colorFamily: 'white' as const,
  corners: 0,
  ends: 0,
  walkGates: 0,
  dblGates: 0,
  tearOutSections: 0,
  tearOutGates: 0,
}

function find(items: ReturnType<typeof calculateMixedMaterials>, name: string) {
  return items.find(i => i.item === name)
}

describe('mixedTotalSections', () => {
  test('sums per-run section counts at chosen rail width', () => {
    const runs: MixedRunInput[] = [
      { ft: 6, rail: '6ft' },    // 1
      { ft: 100, rail: '8ft' },  // ceil(100/8) = 13
      { ft: 7, rail: '6ft' },    // 2
    ]
    expect(mixedTotalSections(runs)).toBe(16)
  })

  test('zero-footage runs do not contribute', () => {
    expect(mixedTotalSections([{ ft: 0, rail: '6ft' }, { ft: 6, rail: '6ft' }])).toBe(1)
  })
})

describe('calculateMixedMaterials — white vinyl ND', () => {
  test('all-6ft job produces no stiffener and no 8-foot rails', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      runs: [{ ft: 60, rail: '6ft' }],   // 10 sections at 6ft
      corners: 2,
      ends: 2,
    })
    expect(find(items, "*Vinyl, White, Rail, 6'")?.qty).toBe(20) // 10 sections × 2
    expect(find(items, "*Vinyl, White, Rail, 8'")).toBeUndefined()
    expect(find(items, "Vinyl, Rail Insert, 8'")).toBeUndefined()
    expect(find(items, '*Vinyl, White, Picket, 62-1/4"')?.qty).toBe(110) // 10 × 11
  })

  test('all-8ft job produces stiffeners equal to total 8ft sections', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      runs: [{ ft: 64, rail: '8ft' }],   // 8 sections at 8ft
      corners: 2,
      ends: 2,
    })
    expect(find(items, "*Vinyl, White, Rail, 8'")?.qty).toBe(16) // 8 × 2
    expect(find(items, "Vinyl, Rail Insert, 8'")?.qty).toBe(8)   // 1 per 8ft section
    expect(find(items, "*Vinyl, White, Rail, 6'")).toBeUndefined()
    expect(find(items, '*Vinyl, White, Picket, 62-1/4"')?.qty).toBe(120) // 8 × 15
  })

  test('mixed job: 1 short run @ 6ft + 1 long run @ 8ft', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      runs: [
        { ft: 4, rail: '6ft' },     // 1 section at 6ft
        { ft: 104, rail: '8ft' },   // ceil(104/8) = 13 sections at 8ft
      ],
      corners: 4,
      ends: 6,
      walkGates: 1,
      dblGates: 0,
    })
    // Section breakdown: 1 + 13 = 14 total, 1 at 6ft, 13 at 8ft
    expect(find(items, "*Vinyl, White, Rail, 6'")?.qty).toBe(2)   // 1 × 2
    expect(find(items, "*Vinyl, White, Rail, 8'")?.qty).toBe(26)  // 13 × 2
    expect(find(items, "Vinyl, Rail Insert, 8'")?.qty).toBe(13)   // 1 per 8ft section, none for 6ft
    // Pickets split by rail:
    // 1 × 11 (6ft) + 13 × 15 (8ft) = 11 + 195 = 206 total
    // The calculator emits two separate picket lines (one per rail width).
    const picketLines = items.filter(i => i.item === '*Vinyl, White, Picket, 62-1/4"')
    const totalPickets = picketLines.reduce((s, p) => s + p.qty, 0)
    expect(totalPickets).toBe(206)
    // U-trim: total sections × 2 = 14 × 2 = 28
    expect(find(items, '*Vinyl, White, U-Trim, 59-1/4"')?.qty).toBe(28)
  })

  test('no stiffener for 6ft-only runs in a mixed job', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      runs: [
        { ft: 4, rail: '6ft' },    // 1 section, no stiffener
        { ft: 6, rail: '6ft' },    // 1 section, no stiffener
      ],
    })
    expect(find(items, "Vinyl, Rail Insert, 8'")).toBeUndefined()
  })

  test('post counts are aggregate, not per-rail', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      runs: [
        { ft: 24, rail: '6ft' }, // 4 sections, 3 line posts
        { ft: 64, rail: '8ft' }, // 8 sections, 7 line posts
      ],
      corners: 2,
      ends: 2,
    })
    // total post count = 2 corners + 2 ends + 3+7 line posts = 14
    // ND donut count = total post count × 2 = 28
    expect(find(items, 'ND, Donut')?.qty).toBe(28)
    // Pipe = total post count = 14
    expect(find(items, 'Pipe, PT40, Galv, 2-1/2" x 8\'')?.qty).toBe(14)
  })
})

describe('calculateMixedMaterials — white vinyl DS', () => {
  test('DS uses concrete and 102" posts, no steel pipe or donuts', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      installMethod: 'dig-set',
      runs: [{ ft: 60, rail: '6ft' }],
      corners: 2,
      ends: 2,
    })
    expect(find(items, '*Vinyl, White, Post, Corner, 5" x 5" x 102"')?.qty).toBe(2)
    expect(find(items, 'Misc, Concrete')).toBeDefined()
    expect(find(items, 'Pipe, PT40, Galv, 2-1/2" x 8\'')).toBeUndefined()
    expect(find(items, 'ND, Donut')).toBeUndefined()
  })

  test('DS mixed-rail still applies stiffener to 8ft sections only', () => {
    const items = calculateMixedMaterials({
      ...baseInput,
      installMethod: 'dig-set',
      runs: [
        { ft: 4, rail: '6ft' },
        { ft: 104, rail: '8ft' },
      ],
      corners: 2,
      ends: 2,
    })
    expect(find(items, "Vinyl, Rail Insert, 8'")?.qty).toBe(13)
    expect(find(items, "*Vinyl, White, Rail, 8'")?.qty).toBe(26)
    expect(find(items, "*Vinyl, White, Rail, 6'")?.qty).toBe(2)
  })
})

describe('calculateMixedMaterials — chappel quote scenario', () => {
  test('chappel runs at WV-Auto ND with optimizer-resolved rails (4 forced 6ft, 6 cost-resolved)', () => {
    // Optimizer resolves chappel runs as:
    //   4 → 6ft (short-run cutoff)
    //   104 → cost compare (likely 6ft based on actual costs)
    //   70 → cost compare
    //   94 → cost compare
    //   40 → cost compare
    //   22 → cost compare
    //   6 → 6ft (short-run cutoff)
    // For this test we hardcode an example mix to verify aggregation.
    const runs: MixedRunInput[] = [
      { ft: 4, rail: '6ft' },
      { ft: 104, rail: '6ft' },
      { ft: 70, rail: '6ft' },
      { ft: 94, rail: '6ft' },
      { ft: 40, rail: '6ft' },
      { ft: 22, rail: '6ft' },
      { ft: 6, rail: '6ft' },
    ]
    expect(mixedTotalSections(runs)).toBe(59)

    // If we flip the long runs to 8ft:
    const mixed: MixedRunInput[] = [
      { ft: 4, rail: '6ft' },     // 1
      { ft: 104, rail: '8ft' },   // 13
      { ft: 70, rail: '8ft' },    // ceil(70/8) = 9
      { ft: 94, rail: '8ft' },    // ceil(94/8) = 12
      { ft: 40, rail: '8ft' },    // 5
      { ft: 22, rail: '8ft' },    // ceil(22/8) = 3
      { ft: 6, rail: '6ft' },     // 1
    ]
    // 1 + 13 + 9 + 12 + 5 + 3 + 1 = 44
    expect(mixedTotalSections(mixed)).toBe(44)
    // The 8ft mix saves 59 - 44 = 15 sections worth of labor.
  })
})
