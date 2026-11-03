/**
 * Target Profit % and sub rates set on a material or a choice for every fence
 * under it, with a fence's or a color's own number winning (web fenceRates.ts,
 * Jonathan Nov 2 2026), and the honest switches on Settings → Fence styles
 * (web fenceSettingsView.ts). Nothing set above a fence: every number is
 * exactly what it was.
 */

import { describe, test, expect } from 'vitest'
import { estimateConfig, followedRatesByStyle } from '../../web/src/estimate'
import { DEFAULT_CATALOG, stripDerived, type FenceCatalog } from '../../web/src/fenceCatalog'
import { earnedProfitPct, MAX_TARGET_MARGIN_PCT } from '../../web/src/targetMargin'
import { followedRates, ownRate, withRate, catalogHasRates } from '../../web/src/fenceRates'
import { calculatePrice, resolveSubRate, resolveSubGateRate, type PricingSettings } from '../../web/src/pricingEngine'
import { groupSwitch, fenceStatus, dimHeading, fenceName, archivedBy, categoryChoices, FENCE_CATEGORIES, example100ft } from '../../web/src/fenceSettingsView'
import { DEFAULT_CONFIG } from '../../web/src/configDefaults'
import { subRateFor, subGateRateFor } from '../src/server/lib/jobCostingMath'
import { redactCosts } from '../src/server/lib/costRedact'
import type { FenceStyle } from '../../web/src/configStore'

const st = (name: string, extra: Partial<FenceStyle> = {}): FenceStyle =>
  ({ id: name, name, category: 'Vinyl', margin: 0.6, targetProfitPct: 14, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, ...extra })
const ND = "WV-ND 6'x6' Privacy", DS = "WV-DS 6'x6' Privacy", TAN_ND = "TV-ND 6'x6' Privacy", CL = "CL - 4' Galv"
const styles = () => [st(ND), st(DS, { targetProfitPct: 10 }), st(TAN_ND), st(CL, { category: 'Chainlink', targetProfitPct: 12 })]
const pricing = { overheadPct: 30, subUnit: 'foot', subRateDefault: 5, subRateByCategory: { Vinyl: 5, Chainlink: 3.9 }, subWalkGate: 10, subDblGate: 20, laborMode: 'subcontractor' }
/** The default tree with numbers set on it. */
function catalog(edit: (c: FenceCatalog) => void = () => {}): FenceCatalog {
  const c = JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as FenceCatalog
  edit(c)
  return c
}
const vinyl = (c: FenceCatalog) => c.materials.find(m => m.key === 'vinyl')!
const opt = (c: FenceCatalog, dim: string, key: string) => vinyl(c).dims.find(d => d.key === dim)!.options.find(o => o.key === key)!
const read = (fenceStyles: FenceStyle[], fenceCatalog?: FenceCatalog) => estimateConfig({ fenceStyles, fenceCatalog, pricing } as any).fenceStyles
const by = (list: FenceStyle[], name: string) => list.find(s => s.name === name)!

describe('nothing set above a fence: every number as before', () => {
  test('Target Margin = 30% overhead + each fence’s saved Target Profit, bit for bit', () => {
    const out = read(styles())
    expect(out.map(s => [s.name, s.targetProfitPct, s.margin])).toEqual([[ND, 14, (100 - 30 - 14) / 100], [DS, 10, (100 - 30 - 10) / 100], [TAN_ND, 14, (100 - 30 - 14) / 100], [CL, 12, (100 - 30 - 12) / 100]])
    expect(out.every(s => s.followed === undefined)).toBe(true)
    expect(catalogHasRates(DEFAULT_CATALOG)).toBe(false)
  })
  test('sub rates: category, then the default, then Settings’ gate rates', () => {
    const out = read(styles())
    expect(resolveSubRate(by(out, ND), pricing as PricingSettings)).toBe(5)
    expect(resolveSubRate(by(out, CL), pricing as PricingSettings)).toBe(3.9)
    expect([resolveSubGateRate(by(out, ND), pricing, 'walk'), resolveSubGateRate(by(out, ND), pricing, 'dbl')]).toEqual([10, 20])
  })
})

describe('set on the material: every fence under it follows', () => {
  const c = catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 15, subRate: 6, subWalkGate: 12 } })
  test('Target Profit 15% on Vinyl: both vinyl fences, the dig set one too; chain link untouched', () => {
    const out = read(styles(), c)
    expect(by(out, ND).margin).toBe((100 - 30 - 15) / 100)
    expect(by(out, DS).margin).toBe((100 - 30 - 15) / 100)
    expect(earnedProfitPct(by(out, DS))).toBe(15)
    // What is saved on each fence is left as it is.
    expect([by(out, ND).targetProfitPct, by(out, DS).targetProfitPct]).toEqual([14, 10])
    expect(by(out, CL).margin).toBe((100 - 30 - 12) / 100)
    expect(by(out, ND).followed?.targetProfitPct).toEqual({ value: 15, from: 'Vinyl' })
  })
  test('sub rate and walk gate from Vinyl; double gate still Settings’', () => {
    const out = read(styles(), c)
    expect(resolveSubRate(by(out, DS), pricing as PricingSettings)).toBe(6)
    expect(resolveSubGateRate(by(out, DS), pricing, 'walk')).toBe(12)
    expect(resolveSubGateRate(by(out, DS), pricing, 'dbl')).toBe(20)
    expect(resolveSubRate(by(out, CL), pricing as PricingSettings)).toBe(3.9)
    // A quote's own typed rate still wins.
    expect(resolveSubRate(by(out, DS), pricing as PricingSettings, 4.5)).toBe(4.5)
  })
  test('labor: 100 ft at $6/ft + 1 walk gate at $12 + 1 double gate at $20', () => {
    const out = read(styles(), c)
    const p = calculatePrice({ sections: 17, footage: 100, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0, materialCost: 1000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, style: by(out, DS), pricing: { ...pricing, manHourRate: 25, commissionSalesman: 0.09, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27 } as any })
    expect(p.laborCost).toBe(600 + 12 + 20)
    expect(p.notes).toEqual([])
  })
})

describe('nearest wins: a choice beats the material, the color beats the other choices, the fence’s own beats all', () => {
  test('Dig set 10% under Vinyl 15%', () => {
    const c = catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 15 }; opt(x, 'install', 'ds').rateDefaults = { targetProfitPct: 10, subRate: 5.5 } })
    const out = read(styles(), c)
    expect([earnedProfitPct(by(out, ND)), earnedProfitPct(by(out, DS))]).toEqual([15, 10])
    expect(by(out, DS).followed?.targetProfitPct?.from).toBe('Dig set')
    expect(resolveSubRate(by(out, DS), pricing as PricingSettings)).toBe(5.5)
  })
  test('the last choice chosen is nearest: Panel width over Install over Style', () => {
    const c = catalog(x => { opt(x, 'style', 'privacy').rateDefaults = { targetProfitPct: 11 }; opt(x, 'install', 'nd').rateDefaults = { targetProfitPct: 13 } })
    expect(followedRates(vinyl(c), { style: 'privacy', height: '6', color: 'white', install: 'nd', width: '6' }).targetProfitPct).toEqual({ value: 13, from: 'No dig' })
  })
  test('a color’s Target Profit beats the material and its choices; the fence’s own beats the color', () => {
    const c = catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 15 }; opt(x, 'color', 'tan').color!.targetProfitPct = 18 })
    const out = read([...styles().slice(0, 2), st(TAN_ND), st("TV-ND 6'x8' Privacy", { ownProfitPct: 16 })], c)
    expect(by(out, TAN_ND).margin).toBe((100 - 30 - 18) / 100)
    expect(by(out, "TV-ND 6'x8' Privacy").margin).toBe((100 - 30 - 16) / 100)
    expect(by(out, ND).margin).toBe((100 - 30 - 15) / 100)
  })
  test('a fence’s own Target Profit stays when Vinyl changes; its sub rate typed on it too', () => {
    const c = catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 15, subRate: 6 } })
    const out = read([st(ND, { ownProfitPct: 20, subRate: 7 }), st(DS)], c)
    expect(by(out, ND).margin).toBe((100 - 30 - 20) / 100)
    expect(resolveSubRate(by(out, ND), pricing as PricingSettings)).toBe(7)
    expect(ownRate(by(out, ND), 'targetProfitPct')).toBe(20)
    expect(ownRate(by(out, DS), 'targetProfitPct')).toBeUndefined()
  })
  test('a fence with no own number keeps its saved number when nothing is set above it', () => {
    expect(by(read([st(DS, { targetProfitPct: 9 })]), DS).margin).toBe((100 - 30 - 9) / 100)
  })
  test('Vinyl 15%, then blank: every fence back to what it had, 14% no dig and 10% dig set (review Nov 2 2026)', () => {
    const set = catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 15 } })
    // Read, then saved as the Settings page saves it (what is worked out left off), then the number cleared.
    const savedBack = stripDerived(read(styles(), set))
    const cleared = read(savedBack, catalog())
    expect([earnedProfitPct(by(cleared, ND)), earnedProfitPct(by(cleared, DS))]).toEqual([14, 10])
    expect([by(cleared, ND).margin, by(cleared, DS).margin]).toEqual([(100 - 30 - 14) / 100, (100 - 30 - 10) / 100])
  })
})

describe('what is saved', () => {
  test('setting and clearing a level’s number', () => {
    expect(withRate(undefined, 'targetProfitPct', 14)).toEqual({ targetProfitPct: 14 })
    expect(withRate({ targetProfitPct: 14 }, 'targetProfitPct', undefined)).toBeUndefined()
    expect(withRate({ targetProfitPct: 14 }, 'subRate', 0)).toEqual({ targetProfitPct: 14 })
    expect(withRate(undefined, 'targetProfitPct', 81)).toBeUndefined()
  })
  test('what a fence follows is worked out on every read, never saved', async () => {
    const c = catalog(x => { vinyl(x).rateDefaults = { subRate: 6 } })
    expect(stripDerived(read(styles(), c)).some(s => 'followed' in s)).toBe(false)
  })
})

describe('the server’s job costing reads the same rates', () => {
  test('followedRatesByStyle gives each fence its material’s and choices’ numbers', () => {
    const c = catalog(x => { vinyl(x).rateDefaults = { subRate: 6, subDblGate: 25 } })
    const f = followedRatesByStyle({ fenceStyles: styles(), fenceCatalog: c } as any)
    expect(f[DS].subRate).toEqual({ value: 6, from: 'Vinyl' })
    expect(f[CL]).toBeUndefined()
    const style = { ...styles()[1], followed: f[DS] }
    expect(subRateFor(style, pricing)).toBe(6)
    expect([subGateRateFor(style, pricing, 'walk'), subGateRateFor(style, pricing, 'dbl')]).toEqual([10, 25])
    expect(subRateFor({ ...style, subRate: 7 }, pricing)).toBe(7)
  })
})

describe('the Installer never receives them', () => {
  test('rateDefaults, followed and ownProfitPct are left out of a limited login’s answers', () => {
    const body = { config: { fenceCatalog: { materials: [{ key: 'vinyl', rateDefaults: { targetProfitPct: 15 } }] }, fenceStyles: [{ name: ND, ownProfitPct: 18, followed: { subRate: { value: 6, from: 'Vinyl' } } }] } }
    const out = redactCosts(body, { prices: true }) as any
    expect(out.config.fenceCatalog.materials[0].rateDefaults).toBeUndefined()
    expect(out.config.fenceStyles[0].followed).toBeUndefined()
    expect(out.config.fenceStyles[0].ownProfitPct).toBeUndefined()
  })
})

describe('honest switches (Settings → Fence styles)', () => {
  const off = (name: string, extra: Partial<FenceStyle> = {}) => st(name, { quotable: false, ...extra })
  test('a choice whose 3 fences are all switched off shows OFF, with the reason', () => {
    const sw = groupSwitch(true, [off('a'), off('b'), off('c')], 'Commercial')
    expect(sw).toEqual({ on: false, ownOn: true, offWhy: 'Off (nothing under it can be quoted): all 3 fences are switched off.' })
  })
  test('one fence quotable: ON', () => {
    expect(groupSwitch(true, [off('a'), st('b')], 'Emily').on).toBe(true)
  })
  test('its own switch off: OFF, no reason (it says Switched off itself)', () => {
    expect(groupSwitch(false, [st('a')], 'Tan')).toEqual({ on: false, ownOn: false, offWhy: null })
  })
  test('held back by prices: the reason, without repeating its own name', () => {
    const sw = groupSwitch(true, [st('a', { held: '8 ft tall needs section and post prices' }), st('b', { held: '8 ft tall needs section and post prices' })], '8 ft')
    expect(sw.offWhy).toBe('Off (nothing under it can be quoted): 8 ft tall needs section and post prices.')
  })
  test('mixed reasons are counted', () => {
    const sw = groupSwitch(true, [off('a'), st('b', { held: 'Black is not fully priced yet' })], 'Commercial')
    expect(sw.offWhy).toBe('Off (nothing under it can be quoted): 1 of 2 fences are switched off; Black is not fully priced yet (1 of 2 fences).')
  })
  test('archived fences are not counted for a choice; they are listed apart', () => {
    const archived = st('w', { held: 'Privacy is archived' })
    expect(archivedBy(archived)).toEqual(['Privacy'])
    expect(groupSwitch(true, [archived, st('x')], 'Wood').on).toBe(true)
    expect(groupSwitch(true, [archived], 'Wood').offWhy).toBe('Off (nothing under it can be quoted): no fence is made with it.')
  })
  test('a fence that cannot be quoted: OFF words, never "available"', () => {
    expect(fenceStatus(st('a'))).toBeNull()
    expect(fenceStatus(st('a', { held: 'Tan is not fully priced yet' }))).toBe('Off (cannot be quoted): Tan is not fully priced yet.')
    expect(fenceStatus(off('a'))).toBe('Switched off.')
    expect(fenceStatus(off('a', { held: 'Commercial is turned off' }))).toBe('Switched off. Also: Commercial is turned off.')
  })
  test('words on this screen: sections, not panels; Picket type', () => {
    expect(dimHeading({ key: 'picket', label: 'Pickets' })).toBe('Picket type')
    expect(dimHeading({ key: 'width', label: 'Panel width' })).toBe('Section width')
    expect(fenceName({ name: 'x', label: 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig' })).toBe('White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig')
  })
})

describe('the Category list shows and saves every fence as itself (audit Nov 2 2026: wood read "Vinyl")', () => {
  test('Wood is in the list, and every category a fence can have', () => {
    const all: Array<FenceStyle['category']> = ['Vinyl', 'Chainlink', 'Commercial', 'Aluminum', 'Wood', 'Other']
    expect([...FENCE_CATEGORIES].sort()).toEqual([...all].sort())
    for (const c of all) expect(categoryChoices(c)).toContain(c)
  })
  test('every category the starting fences use is in it; an unknown one saved earlier is kept, never swapped for the first', () => {
    for (const s of DEFAULT_CONFIG.fenceStyles) expect(categoryChoices(s.category)).toContain(s.category)
    expect(categoryChoices('Gates')).toContain('Gates')
    expect(categoryChoices('Wood')[0]).toBe('Vinyl')
  })
})

describe('Target Margin can never reach 100% (review Nov 2 2026)', () => {
  test('a fence over the most allowed is held back from quoting, with the reason', () => {
    const c = catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 60 } })   // 30 + 60 = 90% > 80%
    const out = read(styles(), c)
    expect(MAX_TARGET_MARGIN_PCT).toBe(80)
    expect(by(out, ND).held).toContain('its Target Margin 90% is over 80%')
    expect(by(out, CL).held).toBeUndefined()
  })
  test('the engine never prices a factor of 0 or less with the 0.64 fallback: no price, and it says why', () => {
    const p = calculatePrice({ sections: 10, footage: 60, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, materialCost: 1000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
      style: { margin: (100 - 30 - 80) / 100, sectionsPerMH: 1 }, pricing: { ...pricing, manHourRate: 25, commissionSalesman: 0, commissionNonSalesman: 0, tearOutFence: 0, tearOutGate: 0 } as any })
    expect(p.price).toBe(0)
    expect(p.notes.join(' ')).toContain('cannot be priced')
  })
  test('the server finds a Settings save that adds one', async () => {
    const { overMaxTargetMargin } = await import('../../web/src/estimate')
    expect(overMaxTargetMargin({ fenceStyles: styles(), fenceCatalog: catalog(), pricing } as any)).toEqual([])
    expect(overMaxTargetMargin({ fenceStyles: styles(), fenceCatalog: catalog(x => { vinyl(x).rateDefaults = { targetProfitPct: 60 } }), pricing } as any).length).toBe(3)
  })
})

describe('the 100 ft example', () => {
  test('a fence that cannot be quoted says why, never a price', () => {
    expect(example100ft(st(ND, { held: '8 ft tall needs our section and post costs' }), { pricing } as any)).toEqual({ cannot: '8 ft tall needs our section and post costs' })
    expect(example100ft(st(ND, { quotable: false }), { pricing } as any)).toEqual({ cannot: 'it is switched off' })
  })
})
