/**
 * The Nov 3 2026 answer scripts' own logic, no database:
 *   scripts/settings-answers-2026-11-03.ts  item 6 (sub extra hour rate) and item 12
 *     (No dig 14% and Dig set 10% saved on the install choices, every fence the same);
 *   scripts/inventory-archive-2026-11-03.ts  item 31 (the 45 parts, and what counts as "used").
 */

import { describe, it, expect } from 'vitest'
import { planInstallProfits, subExtraHourRateOf, INSTALL_PROFIT } from '../scripts/settings-answers-2026-11-03.js'
import { GREEN, PIPES, EMILY_GATES, partsNamedIn } from '../scripts/inventory-archive-2026-11-03.js'
import { DEFAULT_CONFIG } from '../../web/src/configDefaults.js'
import { estimateConfig } from '../../web/src/estimate.js'
import { styleChoicesOf } from '../../web/src/fenceCatalog.js'
import { earnedProfitPct } from '../../web/src/targetMargin.js'
import { withRate } from '../../web/src/fenceRates.js'

type Json = any

/** Settings as on dev and live today: the Target Profit saved on each fence, No dig 14 and Dig set 10 on vinyl, 12 elsewhere. */
function settingsToday(): Json {
  const cfg: Json = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  cfg.pricing = { ...cfg.pricing, overheadPct: 25.6, liveOverhead: { on: false } }
  cfg.fenceStyles = cfg.fenceStyles.map((s: Json) => {
    const sc = styleChoicesOf(s)
    const tp = sc?.material === 'vinyl' ? (sc.choices.install === 'ds' ? 10 : 14) : 12
    return { ...s, targetProfitPct: tp }
  })
  return cfg
}

/** Every fence's Target Profit by name, for one material and install choice. */
function earned(cfg: Json, material: string, install: string): number[] {
  return estimateConfig(cfg).fenceStyles
    .filter(s => { const sc = styleChoicesOf(s); return sc?.material === material && sc.choices.install === install })
    .map(s => earnedProfitPct(s) as number)
}

/** The same Settings with a Target Profit set on the Vinyl material, in memory. */
function vinylAt(cfg: Json, pct: number): Json {
  const out = JSON.parse(JSON.stringify(cfg))
  const vinyl = out.fenceCatalog.materials.find((m: Json) => m.key === 'vinyl')
  vinyl.rateDefaults = withRate(vinyl.rateDefaults, 'targetProfitPct', pct)
  return out
}

describe('item 12: No dig 14% and Dig set 10% saved on the install choices', () => {
  const today = settingsToday()
  today.fenceCatalog = estimateConfig(today).fenceCatalog
  const plan = planInstallProfits(today)

  it('saves Vinyl No dig 14 and Dig set 10, and leaves Chain link and Aluminum (12 both) as they are', () => {
    expect(plan.saves).toEqual(['Vinyl: No dig 14%', 'Vinyl: Dig set 10%'])
    expect(plan.mixed).toEqual([])
    expect(plan.left.some(l => l.startsWith('Chain link: No dig 12%'))).toBe(true)
    expect(plan.left.some(l => l.startsWith('Aluminum: No dig 12%'))).toBe(true)
    const vinyl = plan.next.fenceCatalog.materials.find((m: Json) => m.key === 'vinyl')
    const install = vinyl.dims.find((d: Json) => d.key === 'install')
    expect(install.options.find((o: Json) => o.key === 'nd').rateDefaults).toEqual({ targetProfitPct: INSTALL_PROFIT.nd })
    expect(install.options.find((o: Json) => o.key === 'ds').rateDefaults).toEqual({ targetProfitPct: INSTALL_PROFIT.ds })
  })

  it('every fence keeps its Target Profit, Target Margin and 100 ft price; vinyl ones now follow the install choice', () => {
    expect(plan.rows.length).toBe(today.fenceStyles.length)
    expect(plan.rows.filter(r => !r.same)).toEqual([])
    const vinylRows = plan.rows.filter(r => r.material === 'Vinyl')
    expect(vinylRows.length).toBeGreaterThan(0)
    for (const r of vinylRows) expect(r.from).toEqual(['Saved on this fence', r.install])
    for (const r of plan.rows.filter(r => r.material !== 'Vinyl')) expect(r.from).toEqual(['Saved on this fence', 'Saved on this fence'])
  })

  it('before: Vinyl 15% would move Dig set and No dig fences to 15% (the install difference wiped)', () => {
    expect(new Set(earned(vinylAt(today, 15), 'vinyl', 'ds'))).toEqual(new Set([15]))
    expect(new Set(earned(vinylAt(today, 15), 'vinyl', 'nd'))).toEqual(new Set([15]))
  })

  it('after: Vinyl 15% leaves Dig set fences at 10% and No dig at 14%', () => {
    const ds = earned(vinylAt(plan.next, 15), 'vinyl', 'ds')
    const nd = earned(vinylAt(plan.next, 15), 'vinyl', 'nd')
    expect(ds.length).toBeGreaterThan(0)
    expect(nd.length).toBeGreaterThan(0)
    expect(new Set(ds)).toEqual(new Set([10]))
    expect(new Set(nd)).toEqual(new Set([14]))
  })

  it('run again, it saves nothing', () => {
    const again = planInstallProfits(plan.next)
    expect(again.saves).toEqual([])
    expect(again.rows.filter(r => !r.same)).toEqual([])
  })

  it('a material partly at 14 / 10 is listed as mixed (the script stops)', () => {
    const odd = JSON.parse(JSON.stringify(today))
    const one = odd.fenceStyles.find((s: Json) => styleChoicesOf(s)?.material === 'vinyl' && styleChoicesOf(s)?.choices.install === 'ds')
    one.targetProfitPct = 11
    const p = planInstallProfits(odd)
    expect(p.mixed.length).toBe(1)
    expect(p.mixed[0]).toMatch(/^Vinyl: No dig 14%, Dig set (10% \/ 11%|11% \/ 10%)$/)
  })

  it('a fence with its own number keeps it; nothing about it changes', () => {
    const own = JSON.parse(JSON.stringify(today))
    const one = own.fenceStyles.find((s: Json) => styleChoicesOf(s)?.material === 'vinyl' && styleChoicesOf(s)?.choices.install === 'nd')
    one.ownProfitPct = 20
    one.targetProfitPct = 14
    const p = planInstallProfits(own)
    expect(p.mixed).toEqual([])
    expect(p.rows.filter(r => !r.same)).toEqual([])
    const row = p.rows.find(r => r.from[0] === 'Own number')!
    expect(row.profit).toEqual([20, 20])
  })
})

describe('item 6: Sub extra labor, per hour', () => {
  it('blank is never typed or cleared; a number is that number; anything else is other', () => {
    expect(subExtraHourRateOf({ pricing: {} })).toBe(null)
    expect(subExtraHourRateOf({ pricing: { subExtraHourRate: null } })).toBe(null)
    expect(subExtraHourRateOf({})).toBe(null)
    expect(subExtraHourRateOf({ pricing: { subExtraHourRate: 30 } })).toBe(30)
    expect(subExtraHourRateOf({ pricing: { subExtraHourRate: 25 } })).toBe(25)
    expect(subExtraHourRateOf({ pricing: { subExtraHourRate: '30' } })).toBe('other')
  })
})

describe('item 31: the parts archived and what counts as used', () => {
  it('38 old green and 7 vendor pipe names, all different; the 6 Emily gates are listed only', () => {
    expect(GREEN.length).toBe(38)
    expect(PIPES.length).toBe(7)
    expect(new Set([...GREEN, ...PIPES].map(p => p.id)).size).toBe(45)
    expect(GREEN.every(p => /^(Gr, |Gate, Grn, |Pipe, Grn, |Chainlink, Green, Hardware, Hook Ties, 6-1\/2" x 9ga \(100\)$)/.test(p.name))).toBe(true)
    expect([...GREEN, ...PIPES].some(p => (EMILY_GATES as readonly string[]).includes(p.id))).toBe(false)
  })

  it('finds a part by id or by name (spaces and capitals ignored), anywhere in a record', () => {
    const parts = [GREEN[0], PIPES[0]]
    const used = new Map<string, Set<string>>()
    partsNamedIn(parts, 'quote A', { pullSheet: [{ part: 'gr, bolt, 3/8"  x 2" w/ nut', qty: 2 }] }, used)
    partsNamedIn(parts, 'link B', { inventoryItemId: PIPES[0].id }, used)
    partsNamedIn(parts, 'quote C', { pullSheet: [{ part: 'Green, Bolt, 3/8" x 2" w/ Nut' }], notes: 'Gr, Bolt, 3/8" x 2" w/ Nut was cheaper' }, used)
    expect([...used.get(GREEN[0].id)!]).toEqual(['quote A'])
    expect([...used.get(PIPES[0].id)!]).toEqual(['link B'])
  })
})
