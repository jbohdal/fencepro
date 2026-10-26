/**
 * Green chain link from Stephens quotation 06-251707 (Jonathan, Oct 26 2026:
 * "copy the black chain link setup and kits, swap in the green parts"),
 * made as Settings → Fence styles → Add color makes a color (lib/greenChainLink):
 *   - a Green twin of each 4 ft black chain link fence (No dig and Dig set),
 *     switched off for quoting;
 *   - its kits are DERIVED from the black kits as they are (gate leaves by
 *     width, once per job forks, collar and drop rod, 6 female hinges per
 *     double gate, 4 bolts 3/8 x 3 per double gate): same kits, same
 *     quantities, every Black part swapped for the green part 06-251707 sells;
 *   - the 19 quote lines with a green part each price a part a green kit uses;
 *     the 3 plain BOLT/NUT lines (no color printed) are left for Jonathan;
 *   - the parts with no green line on the quote are listed and left unpriced;
 *   - made once, and kept in step: a black kit change reaches Green, a Green
 *     kit edited in Material Kits is left alone.
 */

import { describe, test, expect, afterEach } from 'vitest'
import fs from 'fs'
import { DEFAULT_CATALOG, planAddColor, planUpdateOption, swapColor, isColorPart, type FenceCatalog } from '../../web/src/fenceCatalog'
import { planChainDigSet } from '../../web/src/chainDigSet'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { estimateConfig } from '../../web/src/estimate'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, kitSetFor, builtInKitSet } from '../../web/src/materialKits'
import { isQuotable } from '../../web/src/styleAvailability'
import { GREEN_LINES, GREEN_ASK, greenLineFor, greenAskFor, greenKitFrom, kitKey, planGreenChainLink, planGreenFollowsBlack, STEPHENS } from '../src/server/lib/greenChainLink'

const prices: Record<string, number> = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const m = { planAddColor, planUpdateOption, kitSetFor, swapColor, isColorPart } as any
const BLACK = ['Black', 'Blk']

function start() {
  const items = Object.entries(prices).map(([name, unitCost], i) => ({ id: `fx${i}`, name, unitCost, category: 'Fixture' }))
  const ds = planChainDigSet({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), fenceCatalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as FenceCatalog, items, kits: [] } as any)
  return ds.state as any
}
const kitOf = (st: any, name: string) => st.kits.find((k: any) => k.styleName === name && !k.archived)

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('green chain link from 06-251707', () => {
  test('a Green twin of each 4 ft black fence, switched off, its kits the black kits with the quote\'s parts', () => {
    const st = start()
    const plan = planGreenChainLink(m, st)
    expect(plan.made).toBe(true)
    expect(plan.styles.map(s => [s.madeFrom, s.install]).sort()).toEqual([["CL - 4' Black", 'nd'], ['chain/4/black/res/ds', 'ds']])
    const opt = plan.state.fenceCatalog.materials.find((x: any) => x.key === 'chain').dims.find((d: any) => d.key === 'finish').options.find((o: any) => o.label === 'Green')
    expect(opt.quotable).toBe(false)

    const nd = kitOf(plan.state, plan.styles.find(s => s.install === 'nd')!.name)
    const parts = (kind: string) => nd.kits[kind].map((p: any) => `${p.qty} ${p.part.trim()}`).sort()
    expect(parts('line')).toEqual([`1 Pipe, Green, 1-5/8" X 8' (PP20)`, '1 Green, Cap, Loop, AL, 1-5/8" x 1-3/8"'].sort())
    expect(parts('end')).toContain(`1 Pipe, Green, 2-1/2" X 8' (PP20)`)
    expect(parts('corner')).toContain('6 Green, Band, Tension, 2-1/2"')
    expect(parts('section')).toContain('5 Green, Hog Ring, 9GA, Steel')
    // Gates as the sheet counts them for black 4 ft: leaves by width, hardware per gate, once per job parts.
    expect(parts('walkGate')).toEqual([`1 Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, '2 Green, Hinge, Female, 1-3/8" x 5/8"', '2 Green, Hinge, Male, 2-1/2"', '2 Green, Bolt, 3/8" x 2" w/ Nut', '2 Green, Bolt, 3/8" x 3" w/ Nut'].sort())
    expect(parts('dblGate')).toEqual([`2 Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, '6 Green, Hinge, Female, 1-3/8" x 5/8"', '4 Green, Hinge, Male, 2-1/2"', '4 Green, Bolt, 3/8" x 3" w/ Nut'].sort())
    expect(parts('walkGate5')).toContain(`1 Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`)
    expect(parts('dblGate10')).toContain(`2 Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`)
    expect(parts('dblGate12')).toContain(`2 Chainlink, Green, Gate, 1-3/8", 4' x 6' (.065)`)
    expect(parts('anyGate')).toEqual(['1 Green, Collar, PS, 1-3/8" (Set of 2)'])
    expect(parts('anyWalkGate')).toEqual(['1 Green, Fork, PS, 2-1/2"'])
    expect(parts('anyDblGate')).toEqual(['1 Drop Rod, 30", Green', '1 Green, Fork, PS, 1-3/8"'])

    // Each Green kit is its black kit, kind by kind and quantity by quantity, with no Black part left.
    for (const s of plan.styles) {
      const black = kitSetFor(s.madeFrom, st.kits) as any
      const green = kitOf(plan.state, s.name)
      expect(Object.keys(green.kits).sort()).toEqual(Object.keys(black.kits).filter(k => black.kits[k].length).sort())
      for (const kind of Object.keys(green.kits)) {
        expect(green.kits[kind].map((p: any) => p.qty)).toEqual(black.kits[kind].map((p: any) => p.qty))
        for (const [k, p] of green.kits[kind].entries()) {
          expect(p.part).not.toMatch(/\bBlack\b|\bBlk\b/)
          if (!isColorPart(black.kits[kind][k].part, BLACK)) expect(p.part).toBe(black.kits[kind][k].part)
        }
      }
      expect(green.followsKit).toEqual({ from: s.madeFrom, key: kitKey(greenKitFrom(m, black, BLACK)) })
    }
    // The Green No dig kit is the built in Black 4 ft kit (the parts list, which follows the sheet).
    expect(kitKey(nd)).toBe(kitKey(greenKitFrom(m, builtInKitSet("CL - 4' Black"), BLACK)))

    const made = plan.state.items.filter((i: any) => i.madeFor === 'chain:finish:green')
    expect(made.every((i: any) => i.category === 'Chainlink Green' && i.unitCost === 0)).toBe(true)
    expect(made.filter((i: any) => i.supplier === STEPHENS).map((i: any) => norm(i.name)).sort()).toEqual(GREEN_LINES.map(g => norm(g.part)).sort())
    // No galvanized part is used by a Green kit (the bolts are green bolts, unpriced, until Jonathan says).
    for (const k of plan.kits) for (const ps of Object.values(kitOf(plan.state, k).kits) as any[]) for (const p of ps) expect(p.part).not.toMatch(/^G, /)
  })

  test('19 quote lines each price a part a green kit uses; 3 plain bolts are left for Jonathan; the rest is listed as no green equivalent', () => {
    const plan = planGreenChainLink(m, start())
    const used = new Set<string>()
    for (const k of plan.state.kits.filter((x: any) => plan.kits.includes(x.name))) for (const ps of Object.values(k.kits) as any[]) for (const p of ps) used.add(norm(p.part))
    expect(GREEN_LINES).toHaveLength(19)
    for (const g of GREEN_LINES) expect(used.has(norm(g.part)), g.part).toBe(true)
    // The plain BOLT/NUT lines print no color: not matched (no galvanized guess), they wait in Needs a match.
    expect(GREEN_ASK.map(a => a.description)).toEqual(['BOLT/NUT 5/16x1-1/4in', 'BOLT/NUT 3/8x2in', 'BOLT/NUT 3/8x3in'])
    for (const a of GREEN_ASK) { expect(greenLineFor(a.description)).toBeNull(); expect(greenAskFor(a.description)).toBe(a) }
    // The tension wire prints no color either; it is the Green wire because Jonathan named tension wire among the green parts.
    expect(greenLineFor("ENS DOM VNL TENS WIRE 9ga SMOOTH (1000')")?.part).toBe('Green, Wire, Tension, 9GA')
    expect(greenLineFor("ENS DOM VNL TENS WIRE 9ga SMOOTH (1000')")?.note).toMatch(/no color/)
    expect(plan.noGreen.map(n => n.part).sort()).toEqual([
      `Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`,
      `Chainlink, Green, Gate, 1-3/8", 4' x 6' (.065)`,
      'DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4\' Chain Link',
      'DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4\' Chain Link',
      'Green, Bolt, 3/8" x 2" w/ Nut',
      'Green, Bolt, 3/8" x 3" w/ Nut',
      'Green, Bolt, 5/16 x 1-1/4" w/ Nut',
      'Green, Fork, PS, 2-1/2"',
    ].sort())
    expect(plan.noGreen.filter(n => n.ask).map(n => n.part).sort()).toEqual(['Green, Bolt, 3/8" x 2" w/ Nut', 'Green, Bolt, 3/8" x 3" w/ Nut', 'Green, Bolt, 5/16 x 1-1/4" w/ Nut'])
    expect(greenLineFor('GRN PLY 1-5/8"  x 8\' x PP20')?.part).toBe(`Pipe, Green, 1-5/8" X 8' (PP20)`)
    expect(greenLineFor('GRN PLY 1-3/8" x 21\' x PP40 x 7pc')).toBeNull() // 06-251608's top rail is not this one
  })

  test('not available for quoting: switched off (and not fully priced until the parts above have prices)', () => {
    const plan = planGreenChainLink(m, start())
    setMaterialPriceSource(inventoryPriceSource(plan.state.items))
    setSavedKitSets(() => plan.state.kits)
    const cfg = estimateConfig({ fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog, pricing: { overheadPct: 30 } } as any)
    for (const s of plan.styles) {
      const r = cfg.fenceStyles.find(x => x.name === s.name)!
      expect(isQuotable(r)).toBe(false)
      expect(r.held).toMatch(/Green is turned off/)
    }
    expect(isQuotable(cfg.fenceStyles.find(x => x.name === "CL - 4' Black")!)).toBe(true)
  })

  test('made once: run again it changes nothing', () => {
    const first = planGreenChainLink(m, start())
    const again = planGreenChainLink(m, first.state)
    expect(again.made).toBe(false)
    expect(again.state).toBe(first.state)
  })
  test('keeps following black: a black kit change reaches Green (new parts unpriced); a Green kit edited by hand is left alone', () => {
    const plan = planGreenChainLink(m, start())
    const st = JSON.parse(JSON.stringify(plan.state))
    // A chain link rule change on the black dig set kit: 7 female hinges per double gate, a new once per job part.
    const black = kitOf(st, 'chain/4/black/res/ds')
    black.kits.dblGate.find((p: any) => /Hinge, Female/.test(p.part)).qty = 7
    black.kits.anyGate.push({ part: 'Black, Gate Latch, 1-3/8"', qty: 1, fallbackCost: 3 })
    st.items.push({ id: 'blk-latch', name: 'Black, Gate Latch, 1-3/8"', unitCost: 3, unitOfMeasure: 'each' })
    const f = planGreenFollowsBlack(m, st)
    expect(f.updated.map(u => u.kit)).toEqual(['chain/4/green/res/ds'])
    expect(f.updated[0].changes.join(' | ')).toMatch(/Green, Hinge, Female, 1-3\/8" x 5\/8" 6 → 7/)
    expect(f.updated[0].changes.join(' | ')).toMatch(/\+ 1 × Green, Gate Latch, 1-3\/8"/)
    expect(f.items).toEqual(['Green, Gate Latch, 1-3/8"'])
    expect(f.state.items.find((i: any) => i.name === 'Green, Gate Latch, 1-3/8"')).toMatchObject({ unitCost: 0, category: 'Chainlink Green', unitOfMeasure: 'each', madeFor: 'chain:finish:green' })
    expect(kitOf(f.state, 'chain/4/green/res/nd')).toEqual(kitOf(st, 'chain/4/green/res/nd'))
    // In step: again changes nothing.
    const again = planGreenFollowsBlack(m, f.state)
    expect([again.updated, again.items, again.skipped, again.marked]).toEqual([[], [], [], []])

    // Jonathan edits the Green dig set kit in Material Kits: it no longer follows.
    const edited = JSON.parse(JSON.stringify(f.state))
    kitOf(edited, 'chain/4/green/res/ds').kits.section[1].qty = 6
    kitOf(edited, 'chain/4/black/res/ds').kits.dblGate.find((p: any) => /Hinge, Female/.test(p.part)).qty = 6
    const e = planGreenFollowsBlack(m, edited)
    expect(e.updated).toEqual([])
    expect(e.skipped).toEqual([expect.stringMatching(/^chain\/4\/green\/res\/ds: edited in Material Kits/)])
    expect(kitOf(e.state, 'chain/4/green/res/ds')).toEqual(kitOf(edited, 'chain/4/green/res/ds'))
  })

  test('a Green kit made before it was marked (Oct 26, old gate kits) follows when not saved since; saved since, it is left', () => {
    const plan = planGreenChainLink(m, start())
    const madeAt = '2026-10-26T19:26:03.430Z'
    const old = JSON.parse(JSON.stringify(plan.state))
    for (const k of old.kits.filter((x: any) => plan.kits.includes(x.name))) {
      delete k.followsKit
      k.updatedAt = '2026-10-26T19:26:03.347Z'
      // The kits as made then: 4 ft leaves only, hardware per gate, galvanized bolts.
      for (const kind of ['walkGate5', 'walkGate6', 'dblGate10', 'dblGate12', 'anyGate', 'anyWalkGate', 'anyDblGate']) delete k.kits[kind]
      k.kits.walkGate = [{ part: `Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, qty: 1 }, { part: 'Drop Rod, 30", Green', qty: 1 }, { part: 'G, Bolt, 3/8" x 2" w/ Nut', qty: 2 }]
    }
    const f = planGreenFollowsBlack(m, old, { madeAt })
    expect(f.updated.map(u => u.kit).sort()).toEqual(['chain/4/green/res/ds', 'chain/4/green/res/nd'])
    for (const k of plan.kits) expect(kitKey(kitOf(f.state, k))).toBe(kitKey(kitOf(plan.state, k)))
    // Saved in Material Kits after Green was made: left as it is.
    const saved = JSON.parse(JSON.stringify(old))
    kitOf(saved, 'chain/4/green/res/nd').updatedAt = '2026-10-27T09:00:00.000Z'
    const s = planGreenFollowsBlack(m, saved, { madeAt })
    expect(s.updated.map(u => u.kit)).toEqual(['chain/4/green/res/ds'])
    expect(s.skipped).toEqual([expect.stringMatching(/^chain\/4\/green\/res\/nd: edited/)])
  })
})
