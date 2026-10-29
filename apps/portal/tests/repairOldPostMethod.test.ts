/**
 * The old posts' method on a repair or move (review Oct 29 2026, Salesman on
 * an iPhone): it follows the style's install method until it is picked by
 * hand, so pulling and hauling the old posts is priced at the right rate; a
 * hand pick stays and says so when it differs from the style; a saved quote
 * keeps what it saved. The rates come from Settings > Moves and Repairs.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, KIT_KINDS } from '../../web/src/materialKits'
import {
  priceRepair, priceMove, moveRepairSettings, postTypeOf, oldPostsMethod, oldPostsCheck, oldPostCostLine, toSavedWork, REPAIR_HINT,
  type WorkCommon, type RepairDraft, type MoveDraft, type RepairInputs, type MoveInputs, type PostType,
} from '../../web/src/moveRepair'
import { RepairPanel, MovePanel } from '../../web/src/MoveRepairPanels'
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
// Live's Settings > Moves and Repairs since Oct 29 2026: no dig $10 + $10, dig set $12 + $24 a post.
const SETTINGS = moveRepairSettings({ moveRepair: { pullNdLaborCents: 1000, pullNdDisposalCents: 1000, pullDsLaborCents: 1200, pullDsDisposalCents: 2400, footerDisposalCents: 1500 } })
const common = (s: QuoteStyle, settings = SETTINGS): WorkCommon => ({ style: s, pricing: PRICING, settings, overheadPct: 30, hasSalesman: true, priceAdjust: 0, extraLaborHrs: 0 })
const cents = (r: { lines: Array<{ key: string; cents: number; label: string }> }, key: string) => r.lines.find(l => l.key === key)
const pullAndHaul = (r: { lines: Array<{ key: string; cents: number; label: string }> }, k = 'replacePost') => (cents(r, `${k}:pull`)?.cents ?? 0) + (cents(r, `${k}:disposal`)?.cents ?? 0)

// What the quote builder does: the draft as entered, the style picked, the inputs priced.
const repairInputs = (draft: RepairDraft, s: QuoteStyle): RepairInputs => ({ ...draft, postType: oldPostsMethod(draft.postType, postTypeOf(s)).type })
const moveInputs = (draft: MoveDraft, s: QuoteStyle): MoveInputs => ({ ...draft, oldPostType: oldPostsMethod(draft.oldPostType, postTypeOf(s)).type })
// The panel's own edit: a patch on the draft (a step on the list never fills in the method).
const patch = <T,>(d: T, p: Partial<T>): T => ({ ...d, ...p })

beforeAll(() => {
  const map: Record<string, number> = {}
  for (const n of [WVND, WVDS]) {
    const k = builtInKitSet(n)!
    for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) map[p.part] = p.fallbackCost
  }
  setMaterialPriceSource(priceSourceFromMap(map))
  setSavedKitSets(() => [])
})
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('the old posts follow the style until picked by hand', () => {
  test('No dig start, posts added, style switched to Dig set: the old posts are pulled and hauled at the dig set rate', () => {
    expect(postTypeOf(style(WVND))).toBe('nd')
    expect(postTypeOf(style(WVDS))).toBe('ds')
    let draft: RepairDraft = { what: 'other', items: {}, newPostCaps: false, gateKind: 'walk' }
    draft = patch(draft, { items: { replacePost: 2 } })                 // Christa adds two posts on the No dig style
    expect(draft.postType).toBeUndefined()
    const nd = priceRepair(common(style(WVND)), repairInputs(draft, style(WVND)))
    expect(pullAndHaul(nd)).toBe(2 * (1000 + 1000))
    expect(cents(nd, 'replacePost:pull')!.label).toBe('Pull old posts (no dig)')
    // Then switches the style to Dig set: the new post material and the pull and haul both follow.
    const ds = priceRepair(common(style(WVDS)), repairInputs(draft, style(WVDS)))
    expect(cents(ds, 'replacePost:pull')).toMatchObject({ label: 'Pull old posts (dig set, concrete)', cents: 2400 })
    expect(cents(ds, 'replacePost:disposal')).toMatchObject({ label: 'Disposal of old posts (dig set, concrete)', cents: 4800 })
    expect(pullAndHaul(ds) - pullAndHaul(nd)).toBe(2 * 1600)           // ($12 + $24) − ($10 + $10): $16 a post that was missed before
    expect(cents(ds, 'replacePost:post')!.label).toBe('Replace a post: new post and setting material')
    expect(oldPostsMethod(draft.postType, 'ds')).toEqual({ type: 'ds', byHand: false, note: null })
  })

  test('a hand pick stays when the style changes, and a note says the two differ', () => {
    let draft: RepairDraft = { what: 'other', items: { replacePost: 1 }, newPostCaps: false, gateKind: 'walk' }
    draft = patch(draft, { postType: 'nd' })                            // tapped "No dig" by hand on the No dig style
    expect(oldPostsMethod(draft.postType, 'nd')).toEqual({ type: 'nd', byHand: true, note: null })
    draft = patch(draft, { items: { replacePost: 3 } })                 // more edits keep the pick
    expect(draft.postType).toBe('nd')
    // Style switched to Dig set: the pick is not overridden; the note shows.
    const m = oldPostsMethod(draft.postType, postTypeOf(style(WVDS)))
    expect(m).toEqual({ type: 'nd', byHand: true, note: 'Old posts are No dig, new fence is Dig set. Is that right?' })
    const r = priceRepair(common(style(WVDS)), repairInputs(draft, style(WVDS)))
    expect(pullAndHaul(r)).toBe(3 * 2000)
    expect(cents(r, 'replacePost:pull')!.label).toBe('Pull old posts (no dig)')
    // The other way round.
    expect(oldPostsMethod('ds', 'nd').note).toBe('Old posts are Dig set, new fence is No dig. Is that right?')
  })

  test('a move follows the same way', () => {
    const draft: MoveDraft = { oldFt: 60, oldWalkGates: 0, oldDblGates: 0, newPostCaps: false }
    const line = { runs: [60], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }
    const nd = priceMove(common(style(WVND)), moveInputs(draft, style(WVND)), line)
    const ds = priceMove(common(style(WVDS)), moveInputs(draft, style(WVDS)), line)
    const posts = 11                                                    // 60 ft: 10 sections + 1
    expect(cents(nd, 'pull')!.cents + cents(nd, 'disposal')!.cents).toBe(posts * 2000)
    expect(cents(ds, 'pull')!.cents + cents(ds, 'disposal')!.cents).toBe(posts * 3600)
    const picked = patch(draft, { oldPostType: 'nd' as PostType })
    const kept = priceMove(common(style(WVDS)), moveInputs(picked, style(WVDS)), line)
    expect(cents(kept, 'pull')!.cents + cents(kept, 'disposal')!.cents).toBe(posts * 2000)
  })
})

describe('a saved quote keeps its choice and its prices', () => {
  test('reopened, the saved method stays whatever the style is now; the saved cost lines do not move', () => {
    const draft: RepairDraft = { what: 'other', items: { replacePost: 2 }, newPostCaps: false, gateKind: 'walk' }
    const inputs = repairInputs(draft, style(WVND))
    const r = priceRepair(common(style(WVND)), inputs)
    const saved = toSavedWork(r, { repair: inputs })
    expect(saved.repair!.postType).toBe('nd')
    const before = JSON.stringify(saved.priced)
    // Reopened: the builder starts from the saved inputs, so the saved method is a pick that stays.
    expect(oldPostsMethod(saved.repair!.postType, 'ds')).toMatchObject({ type: 'nd', byHand: true })
    // A Settings rate change prices new work anew, never the saved cost lines.
    const later = moveRepairSettings({ moveRepair: { pullNdLaborCents: 1500, pullNdDisposalCents: 1500, pullDsLaborCents: 1200, pullDsDisposalCents: 2400 } })
    const repriced = priceRepair(common(style(WVND), later), repairInputs(saved.repair!, style(WVND)))
    expect(pullAndHaul(repriced)).toBe(2 * 3000)
    expect(JSON.stringify(saved.priced)).toBe(before)
    expect(saved.priced.lines.find(l => l.key === 'replacePost:pull')!.cents).toBe(2000)
  })
})

describe('the wording', () => {
  test('our cost per old post is pull + haul from Settings, labeled as our cost; the item hints have no prices', () => {
    expect(oldPostCostLine(SETTINGS)).toBe('Our cost per old post (pull + haul): no dig $20, dig set $36')
    const changed = moveRepairSettings({ moveRepair: { pullNdLaborCents: 1100, pullNdDisposalCents: null, pullDsLaborCents: 1325, pullDsDisposalCents: 2500 } })
    expect(oldPostCostLine(changed)).toBe('Our cost per old post (pull + haul): no dig not set, dig set $38.25')
    for (const k of Object.keys(REPAIR_HINT) as Array<keyof typeof REPAIR_HINT>) expect(REPAIR_HINT[k]).not.toMatch(/\$|Settings/)
  })

  test('the repair panel asks how the old posts are set, with the note and our cost once', () => {
    const repair: RepairInputs = { what: 'other', items: { replacePost: 1, resetPost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' }
    const html = renderToStaticMarkup(createElement(RepairPanel, {
      style: style(WVDS), repair, setRepair: () => {}, oldPostsNote: oldPostsMethod('nd', 'ds').note, postRates: SETTINGS,
      yard: null, layoutResult: null, runSections: [], widthFt: 6,
    }))
    expect(html).toContain('How are the old posts set?')
    expect(html).not.toContain('come out of')
    expect(html).toContain('No dig (pipe and donut)')
    expect(html).toContain('Dig set (concrete)')
    expect(html).toContain('Old posts are No dig, new fence is Dig set. Is that right?')
    // Two post items on the list, the cost line once.
    expect(html.split('Our cost per old post (pull + haul): no dig $20, dig set $36').length - 1).toBe(1)
    expect(html).not.toContain('$10.00')
    // No rates handed in (someone who does not see costs): no prices at all.
    const plain = renderToStaticMarkup(createElement(RepairPanel, {
      style: style(WVDS), repair, setRepair: () => {}, oldPostsNote: null, postRates: null,
      yard: null, layoutResult: null, runSections: [], widthFt: 6,
    }))
    expect(plain).not.toContain('$')
    expect(plain).not.toContain('Our cost')
    expect(plain).not.toContain('data-old-posts-note')
  })

  test("a move names the new fence's method only when no note says it", () => {
    const move: MoveInputs = { oldFt: 60, oldWalkGates: 0, oldDblGates: 0, newPostCaps: false, oldPostType: 'ds' }
    const props = { style: style(WVND), move, setMove: () => {}, defaultPostType: 'nd' as PostType, defaultDamagePct: 10,
      newLine: { walkGates: 0, dblGates: 0, footage: 60, sections: 10 }, yard: null, layoutResult: null, runSections: [], widthFt: 6 }
    const withNote = renderToStaticMarkup(createElement(MovePanel, { ...props, oldPostsNote: oldPostsMethod('ds', 'nd').note }))
    expect(withNote).toContain('Old posts are Dig set, new fence is No dig. Is that right?')
    expect(withNote).not.toContain('the new fence is')
    expect(withNote).not.toContain('the style is')
    const noNote = renderToStaticMarkup(createElement(MovePanel, { ...props, move: { ...move, oldPostType: 'nd' }, oldPostsNote: null }))
    expect(noNote).toContain('How are the old posts set? (the new fence is no dig)')
  })
})

describe('the Price step check box repeats a mismatch', () => {
  const differ = oldPostsMethod('nd', 'ds')
  const same = oldPostsMethod('ds', 'ds')
  const line = 'Old posts are No dig, new fence is Dig set. Is that right? Change it on the Style step, under "How are the old posts set?"'
  test('a repair with a post item on it', () => {
    expect(oldPostsCheck('repair', same, differ, { replacePost: 1 })).toBe(line)
    expect(oldPostsCheck('repair', same, differ, { resetPost: 2 })).toBe(line)
    // No post on the list: the old posts are not priced, nothing to check.
    expect(oldPostsCheck('repair', same, differ, { rehangGate: 1, replacePost: 0 })).toBeNull()
    expect(oldPostsCheck('repair', same, same, { replacePost: 1 })).toBeNull()
    expect(oldPostsCheck('repair', same, oldPostsMethod(undefined, 'ds'), { replacePost: 1 })).toBeNull()
  })
  test('a move, and never a new fence', () => {
    expect(oldPostsCheck('move', differ, same, {})).toBe(line)
    expect(oldPostsCheck('move', same, differ, { replacePost: 1 })).toBeNull()
    expect(oldPostsCheck('new', differ, differ, { replacePost: 1 })).toBeNull()
  })
})
