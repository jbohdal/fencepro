/**
 * Vinyl Colors form, Rename (Jonathan, Nov 5, 2026: "Dark Gray p" to "Dark
 * Gray", and a Rename on the form). The new name is what the quote builder,
 * quotes and the website show (the fences' plain names); the color's
 * Inventory parts, kits and fences keep their names, so no price changes and
 * a part never takes the name of an archived color's part.
 */

import { describe, test, expect } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_CATALOG, plainName, type CatalogState } from '../../web/src/fenceCatalog'
import { planVinylColor, planArchiveVinylColor, inputFromColor, RAIL_INSERT_8, type VinylColorInput } from '../../web/src/vinylColorForm'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
let n = 0
const opts = { today: '2026-11-05', newId: (p: string) => `${p}_r${++n}` }
function baseState(): CatalogState {
  const cfg = estimateConfig({})
  return { fenceStyles: cfg.fenceStyles.map(s => { const c = { ...s }; delete c.label; delete c.held; delete c.jobLot; return c }), fenceCatalog: clone(DEFAULT_CATALOG), items: [{ id: 'wv-insert', name: RAIL_INSERT_8, unitCost: 8.15 }], kits: [] }
}
const piece = (name: string): VinylColorInput => ({
  name, mode: 'piece', sizes: ['6x6', '6x8'], methods: ['nd', 'ds'], samePostPrice: true,
  posts: { '6': { allCents: 2578 } }, capCents: 386, uprightCents: 4000,
  sections: { '6x6': { costCents: null }, '6x8': { costCents: null } },
  pieces: { picketCents: 546, rail6Cents: 1480, rail8Cents: 1480, uTrimCents: 279 },
})
const colorOpt = (st: CatalogState, key: string) => st.fenceCatalog.materials.find(m => m.key === 'vinyl')!.dims.find(d => d.key === 'color')!.options.find(o => o.key === key)!

// As on live: the old "Dark Gray" archived, the new one added as "Dark Gray p".
function live() {
  const old = planVinylColor(baseState(), piece('Dark Gray'), opts)
  const off = planArchiveVinylColor(old.state, old.key, true).state
  return planVinylColor(off, piece('Dark Gray p'), opts)
}

describe('rename a color', () => {
  test('"Dark Gray p" to "Dark Gray": the name shown changes; parts, kits and fences keep theirs; no price changes', () => {
    const made = live()
    expect(made.key).toBe('dark-gray-p')
    const before = clone(made.state)
    const plan = planVinylColor(made.state, { ...inputFromColor(made.state, 'dark-gray-p')!, name: 'Dark Gray' }, { ...opts, key: 'dark-gray-p' })
    expect(plan.renamed).toEqual({ from: 'Dark Gray p', to: 'Dark Gray' })
    expect(plan.message).toMatch(/^Dark Gray p renamed Dark Gray\./)
    expect(plan.priced).toEqual([])
    expect(colorOpt(plan.state, 'dark-gray-p').label).toBe('Dark Gray')
    expect(colorOpt(plan.state, 'dark-gray-p').color!.form!.partName).toBe('Dark Gray p')
    // Every part, kit and fence exactly as before (the old Dark Gray's archived parts untouched too).
    expect(plan.state.items).toEqual(before.items)
    expect(plan.state.kits.map(k => ({ ...k, updatedAt: null }))).toEqual(before.kits.map(k => ({ ...k, updatedAt: null })))
    expect(plan.state.fenceStyles).toEqual(before.fenceStyles)
    // What the quote builder, quotes and the website show.
    const fence = plan.state.fenceStyles.find(s => s.name === 'vinyl/privacy/6/dark-gray-p/nd/6')!
    expect(plainName(plan.state.fenceCatalog, { material: 'vinyl', choices: fence.choices! })).toBe('Dark Gray Vinyl Privacy, 6 ft tall, 6 ft sections, No dig')
  })

  test('the form after: shows the new name, and a later edit still prices the parts it was made with', () => {
    const made = live()
    const renamed = planVinylColor(made.state, { ...inputFromColor(made.state, 'dark-gray-p')!, name: 'Dark Gray' }, { ...opts, key: 'dark-gray-p' })
    const again = inputFromColor(renamed.state, 'dark-gray-p')!
    expect(again).toMatchObject({ name: 'Dark Gray', partName: 'Dark Gray p', capCents: 386, pieces: { picketCents: 546 } })
    const edit = planVinylColor(renamed.state, { ...again, pieces: { ...again.pieces, picketCents: 599 } }, { ...opts, key: 'dark-gray-p' })
    expect(edit.renamed).toBeNull()
    expect(edit.priced.map(p => [p.name, p.cents])).toEqual([['*Vinyl, Dark Gray p, Picket, 62-1/4"', 599]])
    // The archived old Dark Gray's picket is not touched or brought back.
    const oldPicket = edit.state.items.find(i => i.name === '*Vinyl, Dark Gray, Picket, 62-1/4"')!
    expect(oldPicket).toMatchObject({ status: 'archived', unitCost: 5.46 })
    expect(edit.state.items.filter(i => i.name.startsWith('*Vinyl, Dark Gray, ')).every(i => i.status === 'archived')).toBe(true)
    // Stiffeners on a renamed color are its parts' names too.
    const st = planVinylColor(renamed.state, { ...again, stiffeners: { picket: { cents: 500, perSection: { '6x6': 2, '6x8': 3 }, perLeaf: 2 }, rail: null } }, { ...opts, key: 'dark-gray-p' })
    expect(st.state.items.some(i => i.name === '*Vinyl, Dark Gray p, Picket Stiffener' && i.unitCost === 5)).toBe(true)
    expect(st.state.items.some(i => i.name === '*Vinyl, Dark Gray, Picket Stiffener')).toBe(false)
  })

  test('a name another color in use has is refused; a blank name keeps the one it has', () => {
    const made = planVinylColor(planVinylColor(baseState(), piece('Slate'), opts).state, piece('Slate p'), opts)
    const input = inputFromColor(made.state, 'slate-p')!
    expect(() => planVinylColor(made.state, { ...input, name: 'Slate' }, { ...opts, key: 'slate-p' })).toThrow(/There is already a vinyl color called Slate/)
    expect(() => planVinylColor(made.state, { ...input, name: 'White' }, { ...opts, key: 'slate-p' })).toThrow(/already a vinyl color/)
    expect(planVinylColor(made.state, { ...input, name: '' }, { ...opts, key: 'slate-p' }).renamed).toBeNull()
  })
})
