/**
 * Tan no dig, 6 or 8 ft sections (best price): "TV-Auto ND Privacy", made the
 * way White's WV-Auto ND and Tan's TV-Auto DS are (Jonathan, Nov 2 2026:
 * "every color should work the same way"). Its parts per width are the
 * TV-ND 6'x6' and 6'x8' lists, line by line, from the built in kits; the
 * style row copies TV-ND 6'x6'. Priced with the Inventory prices of
 * 2026-10-14 (fixtures).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import {
  legacyCalculateMaterialsDetailed, legacyCalculateMixedMaterialsDetailed, calculateMixedMaterialsDetailed,
  normalizeItemName, setMaterialPriceSource, priceSourceFromMap, type LineItem, type RailWidth,
} from '../../web/src/materialCalculator'
import { builtInKitSet, isAutoKitStyle } from '../../web/src/materialKits'
import { planTanAutoNd, TAN_AUTO_ND } from '../../web/src/tanAutoNd'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { styleLabel, resolveFenceStyles, DEFAULT_CATALOG } from '../../web/src/fenceCatalog'
import type { FenceStyle } from '../../web/src/configStore'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const TAN_ND = { installMethod: 'no-dig' as const, colorFamily: 'tan' as const }
type J = { runs: number[]; corners: number; ends: number; walkGates: number; dblGates: number }
const JOBS: J[] = [
  { runs: [150], corners: 0, ends: 2, walkGates: 0, dblGates: 0 },
  { runs: [37, 120, 52], corners: 2, ends: 2, walkGates: 1, dblGates: 1 },
  { runs: [6, 13, 250, 8], corners: 3, ends: 1, walkGates: 2, dblGates: 0 },
  { runs: [48, 64, 96], corners: 2, ends: 1, walkGates: 0, dblGates: 2 },
]
const asMap = (items: LineItem[]) => {
  const m = new Map<string, number>()
  for (const i of items) if (i.qty) m.set(normalizeItemName(i.item), (m.get(normalizeItemName(i.item)) ?? 0) + i.qty)
  return m
}
const run = (j: J, rail: RailWidth) => ({ ...TAN_ND, ...j, tearOutSections: 0, tearOutGates: 0, runs: j.runs.map(ft => ({ ft, rail })) })
const locked = (name: string, j: J) => legacyCalculateMaterialsDetailed({ fenceStyle: name, ...j, tearOutSections: 0, tearOutGates: 0 }).items

describe('tan no dig best price parts list = the TV-ND rows', () => {
  test("all 6 ft runs: every line as TV-ND 6'x6'; all 8 ft: as TV-ND 6'x8' (old list and kit)", () => {
    for (const j of JOBS) {
      expect(asMap(legacyCalculateMixedMaterialsDetailed(run(j, '6ft')).items)).toEqual(asMap(locked("TV-ND 6'x6' Privacy", j)))
      expect(asMap(legacyCalculateMixedMaterialsDetailed(run(j, '8ft')).items)).toEqual(asMap(locked("TV-ND 6'x8' Privacy", j)))
      // The kits: a gate leaf is built from a 6 ft section on every best price kit (White's WV-Auto ND too), where the
      // 8 ft list builds it from an 8 ft one; the old parts list above covers the yards with gates.
      if (j.walkGates || j.dblGates) continue
      expect(asMap(calculateMixedMaterialsDetailed(run(j, '6ft')).items)).toEqual(asMap(locked("TV-ND 6'x6' Privacy", j)))
      expect(asMap(calculateMixedMaterialsDetailed(run(j, '8ft')).items)).toEqual(asMap(locked("TV-ND 6'x8' Privacy", j)))
    }
  })
  test('the built in kit set derives cleanly', () => {
    expect(isAutoKitStyle(TAN_AUTO_ND)).toBe(true)
    const set = builtInKitSet(TAN_AUTO_ND)!
    expect(set).toBeTruthy()
    expect(set.mismatch).toBeUndefined()
  })
})

describe('planTanAutoNd: the style row', () => {
  const base = (): FenceStyle[] => JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES))
  test("added next to the other best price styles, with TV-ND 6'x6''s settings", () => {
    const styles = base().filter(s => s.name !== TAN_AUTO_ND)
    const src = styles.find(s => s.name === "TV-ND 6'x6' Privacy")!
    src.targetProfitPct = 14; src.subRate = 5.5
    const plan = planTanAutoNd(styles)
    expect(plan.added).toBe(TAN_AUTO_ND)
    expect(plan.copiedFrom).toBe("TV-ND 6'x6' Privacy")
    const s = plan.fenceStyles.find(x => x.name === TAN_AUTO_ND)!
    expect(s).toMatchObject({ autoRailMix: true, installMethod: 'no-dig', colorFamily: 'tan', panelWidth: 6, targetProfitPct: 14, subRate: 5.5, sectionsPerMH: src.sectionsPerMH, category: 'Vinyl' })
    expect(s.choices).toEqual({ color: 'tan', style: 'privacy', width: 'auto', height: '6', install: 'nd' })
    // Next to the other best price styles; nothing else moved or changed.
    const at = plan.fenceStyles.findIndex(x => x.name === TAN_AUTO_ND)
    expect(plan.fenceStyles[at - 1].autoRailMix).toBe(true)
    expect(plan.fenceStyles.filter(x => x.name !== TAN_AUTO_ND)).toEqual(styles)
  })
  test('already there, or nothing to copy: nothing changes', () => {
    const once = planTanAutoNd(base().filter(s => s.name !== TAN_AUTO_ND)).fenceStyles
    const again = planTanAutoNd(once)
    expect(again.added).toBeNull()
    expect(again.fenceStyles).toEqual(once)
    const none = planTanAutoNd(base().filter(s => !s.name.startsWith('TV-ND') && s.name !== TAN_AUTO_ND))
    expect(none.added).toBeNull()
  })
  test('a held source stays held; the plain name reads sections', () => {
    const styles = base().filter(s => s.name !== TAN_AUTO_ND)
    styles.find(s => s.name === "TV-ND 6'x6' Privacy")!.quotable = false
    const s = planTanAutoNd(styles).fenceStyles.find(x => x.name === TAN_AUTO_ND)!
    expect(s.quotable).toBe(false)
    resolveFenceStyles([s], DEFAULT_CATALOG)
    expect(styleLabel(TAN_AUTO_ND)).toBe('Tan Vinyl Privacy, 6 ft tall, 6 or 8 ft sections (best price), No dig')
  })
})
