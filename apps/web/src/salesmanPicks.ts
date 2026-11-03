/**
 * The Salesman's fence picker (Jonathan, Nov 2 2026, "so a new Salesman can't
 * get confused"):
 *
 *   1. She picks only Material > Style > Height > Color (Finish for chain
 *      link, Picket type for wood) > add ons (barbed wire). Nothing else.
 *   2. Section width is never her choice: always the best price. The fixed
 *      6 ft and 8 ft fences stay as hidden internal fences.
 *   3. Install (No dig / Dig set) is not asked: the quote takes the Better
 *      option's install, so the main price and the Better card are the same
 *      fence at the same price. Good / Better / Best shows the other install.
 *   4. A choice with only one option is not shown; it is just used.
 *   5. Anything that cannot be quoted (off, archived, unpriced, no kit) is
 *      hidden, not greyed.
 *
 * Chain link's "6 ft + 1 ft barbed wire" is a height in the choice tree (its
 * old styles keep it); here it reads as the 6 ft height plus a Barbed wire
 * add on, which picks the 6+1 fence.
 *
 * Pure: the choices come from the same choice tree and styles as the owner's
 * picker (fenceCatalog.ts); nothing is saved but the style picked.
 */

import type { FenceStyle } from './configStore'
import { materialOf, styleChoicesOf, type FenceCatalog, type MaterialDef } from './fenceCatalog'

/** Choices she never makes: worked out for her (install from the Better option, the best price width, the grade that quotes). */
export const AUTO_DIMS = new Set(['install', 'width', 'grade'])

/** The add on key for barbed wire, and the height pattern it stands for ("6+1": 6 ft plus 1 ft of barbed wire). */
export const BARBED = 'barbed'
const PLUS_HEIGHT = /^(\d+)\+(\d+)$/

/** The word each choice reads as on every screen (the saved tree keeps its own labels and keys). */
export function choiceLabel(material: string, dim: { key: string; label: string }): string {
  if (dim.key === 'picket') return 'Picket type'
  if (dim.key === 'width') return 'Section width'
  if (material === 'alum' && dim.key === 'panel') return 'Style'
  return dim.label
}

/** A height option's words without the add on ("6 ft + 1 ft barbed wire" → "6 ft"). */
function baseHeight(key: string): string { const m = PLUS_HEIGHT.exec(key); return m ? m[1] : key }

export interface SimpleOption { key: string; label: string }
export interface SimpleDim {
  key: string
  label: string
  options: SimpleOption[]
  /** More than one option: shown. One: used without asking (rule 4). */
  shown: boolean
  /** The options not made with a pick after them, said plainly ("8 ft comes in White only."), so a tap that changes that pick is no surprise. */
  notes: string[]
}

/** What one style reads as on the Salesman's picker: its choices, the height without the add on, and the add on. */
function viewOf(s: FenceStyle, m: MaterialDef): Record<string, string> | null {
  const sc = styleChoicesOf(s)
  if (!sc || sc.material !== m.key) return null
  const v: Record<string, string> = {}
  for (const d of m.dims) {
    if (AUTO_DIMS.has(d.key)) continue
    const k = sc.choices[d.key] ?? ''
    v[d.key] = d.key === 'height' ? baseHeight(k) : k
  }
  if (m.dims.some(d => d.key === 'height' && d.options.some(o => PLUS_HEIGHT.test(o.key)))) v[BARBED] = PLUS_HEIGHT.test(sc.choices.height ?? '') ? 'yes' : 'no'
  return v
}

/** The choices she sees, in order, from the styles that can be quoted; picks that no longer fit are moved to the first that does. */
export function simplePicker<S extends FenceStyle>(styles: S[], catalog: FenceCatalog, material: string, picks: Record<string, string>, isOk: (s: S) => boolean):
  { dims: SimpleDim[]; picks: Record<string, string>; candidates: S[] } {
  const m = materialOf(catalog, material)
  if (!m) return { dims: [], picks: {}, candidates: [] }
  let mine = styles.filter(isOk).map(s => ({ s, v: viewOf(s, m) })).filter((x): x is { s: S; v: Record<string, string> } => !!x.v)
  const order: Array<{ key: string; label: string; opts: SimpleOption[] }> = []
  for (const d of m.dims) {
    if (AUTO_DIMS.has(d.key)) continue
    const opts: SimpleOption[] = []
    for (const o of d.options) {
      const key = d.key === 'height' ? baseHeight(o.key) : o.key
      if (opts.some(x => x.key === key)) continue
      // A height made only with the add on reads as its base height ("6 ft").
      const label = d.key === 'height' && PLUS_HEIGHT.test(o.key) ? `${key} ft` : o.label
      opts.push({ key, label })
    }
    order.push({ key: d.key, label: choiceLabel(m.key, d), opts })
    // The add on comes right after the height it sits on.
    if (d.key === 'height' && d.options.some(o => PLUS_HEIGHT.test(o.key))) {
      const plus = d.options.find(o => PLUS_HEIGHT.test(o.key))!
      const extra = PLUS_HEIGHT.exec(plus.key)![2]
      order.push({ key: BARBED, label: 'Barbed wire', opts: [{ key: 'no', label: 'No' }, { key: 'yes', label: `Yes, ${extra} ft on top` }] })
    }
  }
  // The add on is asked last (Material > Style > Height > Color > add ons).
  const addOns = order.filter(d => d.key === BARBED)
  const asked = [...order.filter(d => d.key !== BARBED), ...addOns]
  // Settle the picks: each one kept when a fence has it with the picks before it, else the first that does. A pick that
  // changes this way is said, never silent (review Nov 3 2026: Tan, then 8 ft, turned the color White without a word).
  const all = mine
  const out: Record<string, string> = {}
  for (const d of asked) {
    const options = d.opts.filter(o => mine.some(x => x.v[d.key] === o.key))
    if (!options.length) continue
    const pick = options.some(o => o.key === picks[d.key]) ? picks[d.key] : options[0].key
    out[d.key] = pick
    mine = mine.filter(x => x.v[d.key] === pick)
  }
  const keys = asked.map(d => d.key).filter(k => k in out)
  const fitsExcept = (x: { v: Record<string, string> }, skip: string[]) => keys.every(k => skip.includes(k) || x.v[k] === out[k])
  const labelOf = (key: string, val: string) => asked.find(d => d.key === key)?.opts.find(o => o.key === val)?.label ?? val
  const dims: SimpleDim[] = []
  for (const d of asked) {
    if (!(d.key in out)) continue
    const at = keys.indexOf(d.key)
    const before = keys.slice(0, at), after = keys.slice(at + 1)
    // What the picks before it allow (whether the choice is asked at all), and what every other pick allows (offered).
    const options = d.opts.filter(o => all.some(x => before.every(k => x.v[k] === out[k]) && x.v[d.key] === o.key))
    // An option not made with a pick after it says so before it is tapped ("8 ft comes in White only."); tapping it
    // changes that pick, and the picker says that too (StyleChoices).
    const notes = options.filter(o => !all.some(x => fitsExcept(x, [d.key]) && x.v[d.key] === o.key)).flatMap(o => {
      // The pick after it that it is not made with: the first one that, set free, lets it be made.
      const l = after.find(k => all.some(x => fitsExcept(x, [d.key, k]) && x.v[d.key] === o.key)) ?? after[0]
      if (!l) return []
      const fits = all.filter(x => before.every(k => x.v[k] === out[k]) && x.v[d.key] === o.key)
      if (l === BARBED) return [`${o.label} is ${out[l] === 'yes' ? 'not made with barbed wire' : 'made with barbed wire only'}.`]
      const vals = [...new Set(fits.map(x => x.v[l]))].map(v => labelOf(l, v))
      return vals.length ? [`${o.label} comes in ${vals.join(' or ')} only.`] : []
    })
    dims.push({ key: d.key, label: d.label, options, shown: options.length > 1, notes })
  }
  return { dims, picks: out, candidates: mine.map(x => x.s) }
}

/** The tier a quote's install follows: Better (the Most popular when there is no Better). Its install, when it sets one. */
export function betterInstall(set: { tiers: Array<{ key: string; install?: string }>; popular?: string | null } | null | undefined): 'no-dig' | 'dig-set' | null {
  if (!set) return null
  const t = set.tiers.find(x => x.key === 'better') ?? set.tiers.find(x => x.key === set.popular)
  return t?.install === 'no-dig' || t?.install === 'dig-set' ? t.install : null
}

const INSTALL_KEY = { 'no-dig': 'nd', 'dig-set': 'ds' } as const

/**
 * From the styles her picks name, the ones the quote chooses between by price: the grade that quotes first in the
 * tree (Residential before Commercial), the Better option's install when one of them has it (else the first in the
 * tree), every section width of that. The cheapest of these is the quote's fence (tiers.ts cheapestStyle).
 */
export function widthChoices<S extends FenceStyle>(candidates: S[], catalog: FenceCatalog, material: string, install: 'no-dig' | 'dig-set' | null): S[] {
  const m = materialOf(catalog, material)
  if (!m || !candidates.length) return candidates
  let left = candidates
  for (const key of ['grade', 'install']) {
    const d = m.dims.find(x => x.key === key)
    if (!d) continue
    const of = (s: S) => styleChoicesOf(s)?.choices[key]
    const want = key === 'install' && install ? INSTALL_KEY[install] : null
    const pick = (want && left.some(s => of(s) === want)) ? want : d.options.map(o => o.key).find(k => left.some(s => of(s) === k))
    if (pick) left = left.filter(s => of(s) === pick)
  }
  return left
}

/** The style the picks start from when the quote has one: its choices as she reads them. */
export function picksOf(s: FenceStyle | undefined, catalog: FenceCatalog): { material: string; picks: Record<string, string> } | null {
  if (!s) return null
  const sc = styleChoicesOf(s)
  const m = sc ? materialOf(catalog, sc.material) : undefined
  if (!sc || !m) return null
  return { material: m.key, picks: viewOf(s, m) ?? {} }
}

/**
 * The same fence in each section width that can be quoted (best price, all 6 ft, all 8 ft), for the owner's
 * Advanced width on the Price step: every other choice the same. Best price first.
 */
export function widthSiblings<S extends FenceStyle>(style: S, styles: S[]): Array<{ style: S; label: string }> {
  const sc = styleChoicesOf(style)
  if (!sc || sc.choices.width === undefined) return []
  const same = styles.filter(s => {
    if (s.isActive === false || s.quotable === false || s.held) return s.id === style.id
    const o = styleChoicesOf(s)
    return !!o && o.material === sc.material && Object.keys({ ...sc.choices, ...o.choices }).every(k => k === 'width' || o.choices[k] === sc.choices[k])
  })
  const rank = (s: S) => { const w = styleChoicesOf(s)!.choices.width; return w === 'auto' ? 0 : Number(w) || 99 }
  return same.sort((a, b) => rank(a) - rank(b)).map(s => {
    const w = styleChoicesOf(s)!.choices.width
    return { style: s, label: w === 'auto' ? '6 ft or 8 ft sections (best price)' : `All ${w} ft sections` }
  })
}

/**
 * The styles a Salesman's lists offer (Change style, Add option): each fence once, in its best price width (the
 * best price mix when there is one, else `cheapest` of its widths for the yard), the other widths hidden.
 * Everything else, the order included, as given.
 */
export function oneWidthEach<S extends FenceStyle>(styles: S[], cheapest: (ways: S[]) => S | undefined): S[] {
  const groups = new Map<string, S[]>()
  const keyOf = (s: S) => {
    const sc = styleChoicesOf(s)
    if (!sc || sc.choices.width === undefined) return `style:${s.name}`
    return `${sc.material}|${Object.keys(sc.choices).filter(k => k !== 'width').sort().map(k => `${k}=${sc.choices[k]}`).join('|')}`
  }
  for (const s of styles) { const k = keyOf(s); groups.set(k, [...(groups.get(k) ?? []), s]) }
  const keep = new Set<string>()
  for (const ways of groups.values()) {
    const pick = ways.length === 1 ? ways[0] : ways.find(s => s.autoRailMix) ?? cheapest(ways) ?? ways[0]
    keep.add(pick.name)
  }
  return styles.filter(s => keep.has(s.name))
}
