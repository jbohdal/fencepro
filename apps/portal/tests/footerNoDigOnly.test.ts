/**
 * Jonathan, Oct 29 2026: "Concrete footer $15: no dig posts only. Dig set
 * rates already cover the concrete."
 *
 * The repair item "Concrete footer disposal (per post)" is offered and priced
 * only when the old posts are no dig: their method as picked by hand, else the
 * style's. Dig set old posts: the pick is off with its reason, a count already
 * entered is not charged (nor said to the customer, the crew or the
 * walkthrough), and the server prices it the same way whatever a phone sends.
 * Change orders (the job's style): off with its reason, and never priced.
 * A saved quote keeps the lines it was saved with.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, KIT_KINDS } from '../../web/src/materialKits'
import {
  priceRepair, priceChangeOrderPick, moveRepairSettings, postTypeOf, oldPostsMethod, oldPostsCheck, toSavedWork, workSummary, chargedRepairItems,
  FOOTER_DIG_SET_REASON, type WorkCommon, type RepairDraft, type RepairInputs,
} from '../../web/src/moveRepair'
import { RepairPanel } from '../../web/src/MoveRepairPanels'
import { pickList, pickPrice } from '../../web/src/changeOrderPicks'
import { priceQuoteJob } from '../../web/src/quoteJob'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { workChecklist } from '../src/server/lib/walkthroughRules'
import type { QuoteStyle } from '../../web/src/quoteCalc'
import type { PricingSettings } from '../../web/src/pricingEngine'

const WVND = "WV-ND 6'x6' Privacy"
const WVDS = "WV-DS 6'x6' Privacy"
const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const style = (name: string): QuoteStyle => ({ name, category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 })
// Live's Settings > Moves and Repairs since Oct 29 2026.
const MR = { pullNdLaborCents: 1000, pullNdDisposalCents: 1000, pullDsLaborCents: 1200, pullDsDisposalCents: 2400, footerDisposalCents: 1500 }
const SETTINGS = moveRepairSettings({ moveRepair: MR })
const common = (s: QuoteStyle): WorkCommon => ({ style: s, pricing: PRICING, settings: SETTINGS, overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0 })
const repairInputs = (draft: RepairDraft, s: QuoteStyle): RepairInputs => ({ ...draft, postType: oldPostsMethod(draft.postType, postTypeOf(s)).type })
const footer = (r: { lines: Array<{ key: string; cents: number }> }) => r.lines.find(l => l.key === 'footerDisposal')
const draft = (items: RepairDraft['items'], postType?: 'nd' | 'ds'): RepairDraft => ({ what: 'other', items, newPostCaps: false, gateKind: 'walk', ...(postType ? { postType } : {}) })

beforeAll(() => {
  const map: Record<string, number> = { 'Tear Out Haul-Away Fence': 9.5, 'Tear Out Haul-Away Gate': 27, 'Misc, Concrete': 6.25 }
  for (const n of [WVND, WVDS]) {
    const k = builtInKitSet(n)!
    for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) map[p.part] = p.fallbackCost
  }
  setMaterialPriceSource(priceSourceFromMap(map))
  setSavedKitSets(() => [])
})
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('the repair quote', () => {
  test('no dig old posts (the style\'s): $15 a post, said and listed for the crew', () => {
    const r = priceRepair(common(style(WVND)), repairInputs(draft({ replacePost: 2, footerDisposal: 2 }), style(WVND)))
    expect(footer(r)).toMatchObject({ cents: 3000, math: '2 posts × $15.00' })
    expect(r.description).toContain('haul away 2 concrete footers')
    expect(r.crew.some(c => c.startsWith('Concrete footer disposal (per post): 2.'))).toBe(true)
  })

  test('dig set old posts (the style\'s): not charged, not said, not on the crew list; the warning says why', () => {
    const withIt = priceRepair(common(style(WVDS)), repairInputs(draft({ replacePost: 2, footerDisposal: 2 }), style(WVDS)))
    const without = priceRepair(common(style(WVDS)), repairInputs(draft({ replacePost: 2 }), style(WVDS)))
    expect(footer(withIt)).toBeUndefined()
    expect(withIt.priceCents).toBe(without.priceCents)
    expect(withIt.costCents).toBe(without.costCents)
    expect(withIt.description).not.toMatch(/footer/i)
    expect(withIt.crew.some(c => /footer/i.test(c))).toBe(false)
    expect(withIt.warnings).toContain('Concrete footer disposal is not charged: dig set haul already covers the concrete.')
  })

  test('picked by hand: no dig old posts on a dig set style are charged; dig set old posts on a no dig style are not', () => {
    expect(footer(priceRepair(common(style(WVDS)), repairInputs(draft({ footerDisposal: 1 }, 'nd'), style(WVDS))))).toMatchObject({ cents: 1500 })
    expect(footer(priceRepair(common(style(WVND)), repairInputs(draft({ footerDisposal: 1 }, 'ds'), style(WVND))))).toBeUndefined()
  })

  test('the server: a phone that sends the footer with dig set old posts, or no method at all, is priced by the rule', () => {
    const cfg = estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { ...PRICING, overheadPct: 30 }, moveRepair: MR } as any)
    const base = {
      runs: [{ ft: 48, rail: 'auto' as const }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'repair',
    }
    const job = (fenceStyle: string, repair: Record<string, unknown>) => priceQuoteJob(cfg, { ...base, fenceStyle, repair } as any, 30).work!
    const sent = job(WVDS, { what: 'other', items: { replacePost: 1, footerDisposal: 3 }, postType: 'ds', newPostCaps: false, gateKind: 'walk' })
    const plain = job(WVDS, { what: 'other', items: { replacePost: 1 }, postType: 'ds', newPostCaps: false, gateKind: 'walk' })
    expect(footer(sent)).toBeUndefined()
    expect(sent.priceCents).toBe(plain.priceCents)
    // No method sent: the style's (dig set here: not charged; no dig: charged).
    expect(footer(job(WVDS, { what: 'other', items: { replacePost: 1, footerDisposal: 3 }, newPostCaps: false, gateKind: 'walk' }))).toBeUndefined()
    expect(footer(job(WVND, { what: 'other', items: { replacePost: 1, footerDisposal: 3 }, newPostCaps: false, gateKind: 'walk' }))).toMatchObject({ cents: 4500 })
  })

  test('the Price step check names the old posts when only footers are on the list', () => {
    const picked = oldPostsMethod('nd', 'ds')
    expect(oldPostsCheck('repair', { note: null }, picked, { footerDisposal: 1 })).toMatch(/^Old posts are No dig, new fence is Dig set\. Is that right\?/)
    expect(oldPostsCheck('repair', { note: null }, picked, { rehangGate: 1 })).toBeNull()
  })
})

describe('what is said of the work: the summary, the walkthrough', () => {
  const saved = (postType: 'nd' | 'ds') => ({ type: 'repair', repair: { items: { replacePost: 2, footerDisposal: 2 }, postType, gateKind: 'walk' as const } })
  test('no dig: the footers are listed; dig set: they are not', () => {
    expect(workSummary(saved('nd'))).toBe('Repair: 2 × Replace a post · 2 × Concrete footer disposal (per post)')
    expect(workSummary(saved('ds'))).toBe('Repair: 2 × Replace a post')
    const style: never[] = []
    expect(workChecklist(saved('nd'), style).map(i => i.label)).toContain('Concrete footers hauled away: 2')
    expect(workChecklist(saved('ds'), style).map(i => i.label).some(l => /footer/i.test(l))).toBe(false)
    expect(chargedRepairItems(saved('ds').repair)).toEqual({ replacePost: 2 })
    // A saved repair with no method recorded: as it was saved.
    expect(chargedRepairItems({ items: { footerDisposal: 1 } })).toEqual({ footerDisposal: 1 })
  })

  test('a saved quote keeps the lines it was saved with', () => {
    const r = priceRepair(common(style(WVND)), repairInputs(draft({ footerDisposal: 2 }), style(WVND)))
    const w = toSavedWork(r, { repair: repairInputs(draft({ footerDisposal: 2 }), style(WVND)) })
    expect(w.priced.lines.find(l => l.key === 'footerDisposal')).toMatchObject({ cents: 3000 })
    expect(JSON.parse(JSON.stringify(w)).priced.priceCents).toBe(r.priceCents)
  })
})

describe('the Repair panel', () => {
  const render = (s: QuoteStyle, d: RepairDraft) => renderToStaticMarkup(createElement(RepairPanel, {
    style: s, repair: repairInputs(d, s), setRepair: () => {}, oldPostsNote: oldPostsMethod(d.postType, postTypeOf(s)).note, postRates: SETTINGS,
    yard: null, layoutResult: null, runSections: [], widthFt: 6,
  }))
  const row = (html: string) => html.slice(html.indexOf('data-repair-item="footerDisposal"'), html.indexOf('</div></div>', html.indexOf('data-repair-item="footerDisposal"')) + 12)

  test('dig set old posts: the footer row is off and says why; a count entered says it is not charged', () => {
    const html = row(render(style(WVDS), draft({})))
    expect(html).toContain('data-repair-item-off="yes"')
    expect(html).toContain(`${FOOTER_DIG_SET_REASON}.`)
    expect(html).toContain('Old posts are no dig? Tap here')
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2)
    const entered = render(style(WVDS), draft({ footerDisposal: 2 }))
    expect(row(entered)).toContain('Dig set haul already covers the concrete: the 2 entered are not charged.')
    // With a count, the old posts' question shows, so it can be changed there too.
    expect(entered).toContain('How are the old posts set?')
  })

  test('no dig old posts: the footer row is on, with its hint', () => {
    for (const html of [row(render(style(WVND), draft({}))), row(render(style(WVDS), draft({}, 'nd')))]) {
      expect(html).not.toContain('data-repair-item-off')
      expect(html).toContain('Per post: haul off the concrete footer')
      // Only "one less" at 0; "one more" can be tapped.
      expect((html.match(/disabled=""/g) ?? []).length).toBe(1)
      expect(html).toMatch(/aria-label="One more Concrete footer disposal \(per post\)" class="[^"]*">/)
    }
  })
})

describe('change orders: the job\'s style', () => {
  const cfg = () => estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { ...PRICING, overheadPct: 30 }, moveRepair: MR } as any)
  test('dig set job: the footer is in the list, off, with its reason, and never priced', () => {
    const list = pickList(cfg(), [], { fenceStyle: WVDS, hasSalesman: false }, 30)
    expect(list.items.find(i => i.source === 'repair:footerDisposal')).toMatchObject({ off: FOOTER_DIG_SET_REASON, unitCents: 0 })
    expect(list.items.filter(i => i.off).map(i => i.source)).toEqual(['repair:footerDisposal'])
    expect(pickPrice(cfg(), [], { fenceStyle: WVDS, hasSalesman: false }, 30, 'repair:footerDisposal', 2)).toBeNull()
    // And the pricing itself charges nothing for it.
    expect(footer(priceChangeOrderPick(common(style(WVDS)), { kind: 'repair', key: 'footerDisposal' }, 2))).toBeUndefined()
  })
  test('no dig job: offered and priced ($15 ÷ the cost factor, whole dollars)', () => {
    const list = pickList(cfg(), [], { fenceStyle: WVND, hasSalesman: false }, 30)
    const item = list.items.find(i => i.source === 'repair:footerDisposal')!
    expect(item.off).toBeUndefined()
    expect(item.unitCents).toBeGreaterThan(0)
    const two = pickPrice(cfg(), [], { fenceStyle: WVND, hasSalesman: false }, 30, 'repair:footerDisposal', 2)!
    expect(two.priceCents).toBeGreaterThan(item.unitCents)
  })
})
