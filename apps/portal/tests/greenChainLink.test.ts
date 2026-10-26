/**
 * Green chain link from Stephens quotation 06-251707 (Jonathan, Oct 26 2026),
 * made as Settings → Fence styles → Add color makes a color (lib/greenChainLink):
 *   - a Green twin of each 4 ft black chain link fence (No dig and Dig set),
 *     switched off for quoting, with the black kits' quantities;
 *   - every green part is the one 06-251707 sells (PP20 posts, 2-1/2" bands,
 *     the .055 gate, steel hog rings ...), the bolts are the galvanized ones;
 *   - every one of the quote's 22 lines prices a part a green kit uses;
 *   - the parts the quote has no green line for are listed and left unpriced;
 *   - made once: a second run changes nothing.
 */

import { describe, test, expect, afterEach } from 'vitest'
import fs from 'fs'
import { DEFAULT_CATALOG, planAddColor, planUpdateOption, type FenceCatalog } from '../../web/src/fenceCatalog'
import { planChainDigSet } from '../../web/src/chainDigSet'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { estimateConfig } from '../../web/src/estimate'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { isQuotable } from '../../web/src/styleAvailability'
import { GREEN_LINES, greenLineFor, planGreenChainLink, STEPHENS } from '../src/server/lib/greenChainLink'

const prices: Record<string, number> = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const m = { planAddColor, planUpdateOption } as any

function start() {
  const items = Object.entries(prices).map(([name, unitCost], i) => ({ id: `fx${i}`, name, unitCost, category: 'Fixture' }))
  const ds = planChainDigSet({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), fenceCatalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as FenceCatalog, items, kits: [] } as any)
  return ds.state as any
}

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('green chain link from 06-251707', () => {
  test('a Green twin of each 4 ft black fence, switched off, with the quote\'s parts', () => {
    const plan = planGreenChainLink(m, start())
    expect(plan.made).toBe(true)
    expect(plan.styles.map(s => [s.madeFrom, s.install]).sort()).toEqual([["CL - 4' Black", 'nd'], ['chain/4/black/res/ds', 'ds']])
    const opt = plan.state.fenceCatalog.materials.find((x: any) => x.key === 'chain').dims.find((d: any) => d.key === 'finish').options.find((o: any) => o.label === 'Green')
    expect(opt.quotable).toBe(false)

    const nd = plan.state.kits.find((k: any) => k.styleName === plan.styles.find(s => s.install === 'nd')!.name)
    const parts = (kind: string) => nd.kits[kind].map((p: any) => `${p.qty} ${p.part.trim()}`)
    expect(parts('line')).toEqual([`1 Pipe, Green, 1-5/8" X 8' (PP20)`, '1 Green, Cap, Loop, AL, 1-5/8" x 1-3/8"'])
    expect(parts('end')).toContain(`1 Pipe, Green, 2-1/2" X 8' (PP20)`)
    expect(parts('corner')).toContain('6 Green, Band, Tension, 2-1/2"')
    expect(parts('walkGate')).toEqual(expect.arrayContaining([`1 Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, '1 Drop Rod, 30", Green', '2 G, Bolt, 3/8" x 2" w/ Nut', '2 G, Bolt, 3/8" x 3" w/ Nut']))
    expect(parts('section')).toContain('5 Green, Hog Ring, 9GA, Steel')
    // No Black part is left, and no green bolt was made.
    for (const k of plan.state.kits.filter((x: any) => plan.kits.includes(x.name))) for (const ps of Object.values(k.kits) as any[]) for (const p of ps) expect(p.part).not.toMatch(/\bBlack\b|\bBlk\b/)
    expect(plan.items.some(n => /Bolt/.test(n))).toBe(false)
    const made = plan.state.items.filter((i: any) => i.madeFor === 'chain:finish:green')
    expect(made.every((i: any) => i.category === 'Chainlink Green' && i.unitCost === 0)).toBe(true)
    expect(made.filter((i: any) => i.supplier === STEPHENS).length).toBe(GREEN_LINES.filter(g => !g.existing).length)
  })

  test('each of the 22 quote lines prices a part a green kit uses; the rest is listed as no green equivalent', () => {
    const plan = planGreenChainLink(m, start())
    const used = new Set<string>()
    for (const k of plan.state.kits.filter((x: any) => plan.kits.includes(x.name))) for (const ps of Object.values(k.kits) as any[]) for (const p of ps) used.add(norm(p.part))
    expect(GREEN_LINES).toHaveLength(22)
    for (const g of GREEN_LINES) expect(used.has(norm(g.part)), g.part).toBe(true)
    expect(plan.noGreen.map(n => n.part).sort()).toEqual([
      'DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4\' Chain Link',
      'DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4\' Chain Link',
      'Drop Rod, 48", Green',
      'Green, Fork, PS, 2-1/2"',
    ])
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
})
