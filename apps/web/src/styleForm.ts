/**
 * Add a fence style the way a vinyl color is added (Jonathan, Nov 5 2026),
 * any material: Settings → Fence Styles → Add style, or Settings → Price List
 * → the material → + Add style. Name it, pick the style it copies (a new
 * aluminum style copying Emily): every fence of that style (heights, No dig
 * and Dig set) is copied with its kits and the SAME quantities, so the pull
 * sheet works out the same (fenceCatalog.ts planAddChoice).
 *
 * The parts that belong to the style (for aluminum: the sections, the post
 * pieces and the gates named for it, "Emily") get new parts named for the new
 * style, at $0 until priced; shared hardware (hinges, latches, concrete,
 * screws, the plain I-post and cap) stays the same parts. On the form, each
 * part of the copied style is "own price" (its own new part, priced there) or
 * "same part as <copied style>"; a part named for the copied style starts as
 * its own, any other as the same part.
 *
 * The style waits for prices (ChoiceOption.waitForPrices): its fences are
 * held until every part in their kits has a price, then turn on by themselves.
 * Rename and Archive work as for a vinyl color: a rename keeps the part names;
 * Archive switches off its fences, kits and own parts, and Bring back turns
 * them on again. Saved quotes keep their prices.
 *
 * The server saves it in one step (portal lib/styleForms.ts) with the dated
 * cost of each part priced (price history, source style_form).
 */

import { normalizeItemName } from './materialCalculator'
import { KIT_KINDS, kitSetFor, type KitSet } from './materialKits'
import {
  madeForTag, materialOf, optionOf, planAddChoice, slug, stylesOfOption,
  type CatalogState, type ChoiceOption, type InvItem, type MaterialDef,
} from './fenceCatalog'

/** The choice that names a fence's style, by material. */
export const STYLE_DIM: Record<string, string> = { alum: 'panel', vinyl: 'style', wood: 'style', farm: 'style', chain: 'grade', other: 'product' }
export const STYLE_FORM_SOURCE = 'style_form'

export interface StyleFormPart {
  /** The copied style's part. */
  from: string
  mode: 'own' | 'same'
  /** Own: the new part's name (blank: the copied part's name with the style's name in it). */
  name?: string
  /** Own: its price, integer cents; null: not priced yet ($0). */
  cents?: number | null
}

export interface StyleFormInput {
  material: string
  label: string
  /** The style it copies (option key of STYLE_DIM). */
  copyFrom: string
  parts: StyleFormPart[]
}

/** Kept on the style's choice: how its parts were made, so the form opens again as it was saved. */
export interface StyleFormSpec {
  copiedFrom: string
  parts: Array<{ from: string; mode: 'own' | 'same'; name: string }>
  madeOn: string
}

export type StyleOption = ChoiceOption & { styleForm?: StyleFormSpec }

export interface StylePartRow {
  part: string
  /** Kit kinds it is in ("section", "walkGate"...), and on how many of the style's fences. */
  kinds: string[]
  fences: number
  /** Its Inventory price now, integer cents; null: none ($0 or no item). */
  cents: number | null
  /** Other styles (any material) whose fences use the same part. */
  alsoIn: string[]
  /** Named for the style (its own part, not shared hardware). */
  own: boolean
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const cents = (item: InvItem | undefined): number | null => (item && Number.isFinite(item.unitCost) && item.unitCost > 0 ? Math.round(item.unitCost * 100) : null)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words of a style's name that mark its own parts: "Emily", "Abigail" (not "Industrial", "Rail", a number). */
export function styleWords(label: string): string[] {
  const generic = new Set(['industrial', 'rail', 'style', 'fence', 'privacy', 'double', 'single', 'picket', 'panel', 'with', 'and', 'the'])
  return label.split(/[^A-Za-z]+/).filter(w => w.length >= 4 && !generic.has(w.toLowerCase()))
}
const namedFor = (part: string, words: string[]) => words.some(w => new RegExp(`\\b${esc(w)}\\b`, 'i').test(part))

/** The new part's name: the copied part's with the copied style's name changed to the new one's; else the new name after it. */
export function ownPartName(part: string, fromLabel: string, newLabel: string): string {
  const words = styleWords(fromLabel)
  let out = part
  for (const w of words) out = out.replace(new RegExp(`\\b${esc(w)}\\b`, 'gi'), newLabel.trim())
  return out === part ? `${part.replace(/^\*+/, '')} (${newLabel.trim()})` : out
}

export function styleDimOf(m: MaterialDef | undefined) {
  return m ? m.dims.find(d => d.key === STYLE_DIM[m.key]) : undefined
}

/** Every part in the kits of a style's fences, with its price and where else it is used. */
export function stylePartRows(st: CatalogState, material: string, key: string): StylePartRow[] {
  const m = materialOf(st.fenceCatalog, material)
  const dim = styleDimOf(m)
  const opt = optionOf(m, dim?.key ?? '', key)
  if (!m || !dim || !opt) return []
  const fences = stylesOfOption(st.fenceStyles, m.key, dim.key, key).filter(s => s.isActive !== false || opt.archived)
  const names = new Set(fences.map(s => s.name))
  const words = styleWords((opt as StyleOption).styleForm ? optionOf(m, dim.key, (opt as StyleOption).styleForm!.copiedFrom)?.label ?? opt.label : opt.label)
  const ownNames = new Set(((opt as StyleOption).styleForm?.parts ?? []).filter(p => p.mode === 'own').map(p => normalizeItemName(p.name)))
  const rows = new Map<string, StylePartRow>()
  const byItem = new Map(st.items.map(i => [normalizeItemName(i.name), i]))
  // The kit a fence prices with: saved, else built in (Emily's are built in).
  const kitOf = (name: string): KitSet | null => { const k = kitSetFor(name, st.kits); return k && k !== 'archived' ? k : null }
  const has = (k: KitSet, part: string) => KIT_KINDS.some(kind => (k.kits[kind] ?? []).some(l => l.part === part))
  const mine = fences.map(s => kitOf(s.name)).filter((k): k is KitSet => !!k)
  for (const k of mine) for (const kind of KIT_KINDS) for (const line of k.kits[kind] ?? []) {
    const r = rows.get(line.part) ?? { part: line.part, kinds: [], fences: 0, cents: cents(byItem.get(normalizeItemName(line.part))), alsoIn: [], own: ownNames.has(normalizeItemName(line.part)) || namedFor(line.part, words) || namedFor(line.part, styleWords(opt.label)) }
    if (!r.kinds.includes(kind)) r.kinds.push(kind)
    rows.set(line.part, r)
  }
  for (const r of rows.values()) r.fences = mine.filter(k => has(k, r.part)).length
  // Where else each part is used: the other styles' fences (by their style's name).
  const labelOf = (fence: string): string | null => {
    const s = st.fenceStyles.find(x => x.name === fence)
    if (!s?.material || !s.choices) return null
    const mm = materialOf(st.fenceCatalog, s.material)
    const dd = styleDimOf(mm)
    const o = dd ? optionOf(mm, dd.key, s.choices[dd.key]) : undefined
    return o ? `${mm!.label} ${o.label}` : mm?.label ?? null
  }
  for (const s of st.fenceStyles) {
    if (names.has(s.name) || s.isActive === false) continue
    const k = kitOf(s.name)
    if (!k) continue
    for (const r of rows.values()) {
      if (!has(k, r.part)) continue
      const l = labelOf(s.name)
      if (l && !r.alsoIn.includes(l)) r.alsoIn.push(l)
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.own) - Number(a.own) || a.part.localeCompare(b.part))
}

/** What the form starts with for a new style copying `copyFrom`: its parts, named for the new style when they are the style's own. */
export function proposedParts(st: CatalogState, material: string, copyFrom: string, label: string): StyleFormPart[] {
  const m = materialOf(st.fenceCatalog, material)
  const from = optionOf(m, STYLE_DIM[material] ?? '', copyFrom)
  return stylePartRows(st, material, copyFrom).map(r => (r.own
    ? { from: r.part, mode: 'own' as const, name: ownPartName(r.part, from?.label ?? copyFrom, label || 'New style'), cents: null }
    : { from: r.part, mode: 'same' as const }))
}

export interface StyleFormPlan {
  state: CatalogState
  key: string
  label: string
  styles: string[]
  kits: string[]
  items: Array<{ id: string; name: string; cents: number | null }>
  priced: Array<{ id: string; name: string; cents: number; prevCents: number | null }>
  renamed?: { from: string; to: string }
  /** Own parts with no price yet: the style waits for them. */
  waiting: string[]
  message: string
}

/**
 * Add a style from the form, or (key) save the form again for one: a style it
 * made, or one copied before the form (Add choice), its parts made its own now.
 */
export function planStyleForm(st0: CatalogState, input: StyleFormInput, opts: { key?: string; today: string; newId: (p: string) => string }): StyleFormPlan {
  let st = clone(st0)
  const m = materialOf(st.fenceCatalog, input.material)
  const dim = styleDimOf(m)
  if (!m || !dim) throw new Error('Pick the material of the new style.')
  const label = String(input.label ?? '').trim()
  if (!label) throw new Error('Type the name of the style.')
  if (label.length > 60) throw new Error('Keep the style name under 60 letters.')
  let key = opts.key ?? ''
  let renamed: StyleFormPlan['renamed']
  let styles: string[] = []
  const kitsBefore = new Set(st.kits.map(k => k.id))
  if (!key) {
    const from = optionOf(m, dim.key, input.copyFrom)
    if (!from || from.archived) throw new Error('Pick the style it copies.')
    const before = new Set(dim.options.map(o => o.key))
    const plan = planAddChoice(st, { material: m.key, dim: dim.key, label, copyFrom: input.copyFrom })
    st = plan.state as CatalogState
    styles = plan.styles
    const mm = materialOf(st.fenceCatalog, m.key)!
    const added = styleDimOf(mm)!.options.find(o => !before.has(o.key))!
    key = added.key
  }
  const mm = materialOf(st.fenceCatalog, m.key)!
  const dd = styleDimOf(mm)!
  const opt = optionOf(mm, dd.key, key) as StyleOption | undefined
  if (!opt) throw new Error('That style is not in Settings.')
  if (opt.archived) throw new Error(`${opt.label} is archived. Bring it back first.`)
  const copiedFrom = opt.styleForm?.copiedFrom ?? opt.copiedFrom ?? input.copyFrom
  const fromOpt = optionOf(mm, dd.key, copiedFrom)
  if (opts.key && label !== opt.label) {
    if (dd.options.some(o => o.key !== key && !o.archived && o.label.trim().toLowerCase() === label.toLowerCase())) throw new Error(`There is already a ${dd.label.toLowerCase()} called ${label}.`)
    renamed = { from: opt.label, to: label }
    opt.label = label
    delete opt.nameText
  }
  const tag = madeForTag(mm.key, dd.key, key)
  // Its fences and their kits.
  const fences = stylesOfOption(st.fenceStyles, mm.key, dd.key, key)
  const fenceNames = new Set(fences.map(s => s.name))
  const kits = st.kits.filter(k => !k.archived && k.styleName && fenceNames.has(k.styleName))

  // Each copied part: the name its kits use now (from the form's last save; before it, the copied part's own), and the one they use after.
  const was = new Map((opt.styleForm?.parts ?? []).map(p => [p.from, p.name]))
  const byItem = new Map(st.items.map(i => [normalizeItemName(i.name), i]))
  const items: StyleFormPlan['items'] = []
  const priced: StyleFormPlan['priced'] = []
  const spec: StyleFormSpec['parts'] = []
  const usedNames = new Set<string>()
  for (const p of input.parts ?? []) {
    const from = String(p?.from ?? '')
    if (!from) continue
    const now = was.get(from) ?? from
    let next = from
    if (p.mode === 'own') {
      next = String(p.name ?? '').trim() || ownPartName(from, fromOpt?.label ?? copiedFrom, label)
      if (normalizeItemName(next) === normalizeItemName(from)) throw new Error(`"${next}" is the ${fromOpt?.label ?? 'copied style'} part's own name. Give ${label}'s part its own name, or pick Same part.`)
      if (usedNames.has(normalizeItemName(next))) throw new Error(`Two parts are both called "${next}".`)
      usedNames.add(normalizeItemName(next))
      let item = byItem.get(normalizeItemName(next))
      // Another style's own part with this name would be shared by mistake.
      if (item && item.madeFor && item.madeFor !== tag) throw new Error(`"${next}" is a part of another style already. Give ${label}'s part another name.`)
      if (!item) {
        const src = byItem.get(normalizeItemName(from))
        item = { ...(src ? clone(src) : {}), id: opts.newId('inv'), name: next, unitCost: 0, category: src?.category ?? mm.label, status: 'active', madeFor: tag } as InvItem
        for (const k of ['vendorItemNumber', 'priceUpdatedAt', 'priceImported', 'qtyBreak', 'lastReceivedAt', 'onHand']) delete (item as Record<string, unknown>)[k]
        st.items.push(item); byItem.set(normalizeItemName(next), item)
        items.push({ id: item.id, name: next, cents: p.cents ?? null })
      } else if (item.status === 'archived') item.status = 'active'
      const c = typeof p.cents === 'number' && Number.isInteger(p.cents) && p.cents > 0 ? p.cents : null
      if (c != null) {
        const prev = cents(item)
        if (prev !== c || !item.priceUpdatedAt) {
          item.unitCost = c / 100
          item.priceUpdatedAt = opts.today
          item.priceImported = false
          priced.push({ id: item.id, name: item.name, cents: c, prevCents: prev })
        }
      }
    }
    if (now !== next) for (const k of kits) for (const kind of KIT_KINDS) for (const line of k.kits[kind] ?? []) if (line.part === now) line.part = next
    if (now !== next) for (const k of kits) k.roundUp = (k.roundUp ?? []).map(r => (r === now ? next : r))
    spec.push({ from, mode: p.mode === 'own' ? 'own' : 'same', name: next })
  }
  for (const k of kits) { k.updatedAt = new Date().toISOString(); if (!k.madeFor) k.madeFor = tag }
  opt.styleForm = { copiedFrom, parts: spec, madeOn: opt.styleForm?.madeOn ?? opts.today }
  // On by itself once every part of its kits has a price.
  opt.waitForPrices = true
  delete opt.quotable
  const waiting = spec.filter(p => p.mode === 'own' && !cents(byItem.get(normalizeItemName(p.name)))).map(p => p.name)
  const madeKits = st.kits.filter(k => !kitsBefore.has(k.id)).map(k => k.id)
  if (!styles.length) styles = fences.map(s => s.name)
  const message = !opts.key
    ? `${label} added: ${styles.length} fence${styles.length === 1 ? '' : 's'} copying ${fromOpt?.label ?? copiedFrom} with the same quantities, ${spec.filter(p => p.mode === 'own').length} parts of its own${waiting.length ? `. It turns on by itself when the ${waiting.length} part${waiting.length === 1 ? '' : 's'} still at $0 ${waiting.length === 1 ? 'is' : 'are'} priced.` : ', all priced: it is on for quoting.'}`
    : `${label} saved${priced.length ? `: ${priced.length} price${priced.length === 1 ? '' : 's'} changed` : ''}${waiting.length ? `. ${waiting.length} part${waiting.length === 1 ? '' : 's'} still at $0: it waits for them.` : '.'}`
  return { state: st, key, label, styles, kits: madeKits, items, priced, ...(renamed ? { renamed } : {}), waiting, message }
}

/** Archive a style (or bring it back): its fences switched off, its kits and its own parts archived. Saved quotes keep working. */
export function planArchiveStyle(st0: CatalogState, material: string, key: string, archive: boolean): { state: CatalogState; styles: string[]; items: string[]; kits: string[] } {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, material)
  const dim = styleDimOf(m)
  const opt = optionOf(m, dim?.key ?? '', key) as StyleOption | undefined
  if (!m || !dim || !opt) throw new Error('That style is not in Settings.')
  if (!archive && dim.options.some(o => o.key !== key && !o.archived && o.label.trim().toLowerCase() === opt.label.trim().toLowerCase())) throw new Error(`Another style is called ${opt.label} now. Rename one of them first.`)
  const tag = madeForTag(m.key, dim.key, key)
  if (archive) opt.archived = true; else delete opt.archived
  const fences = stylesOfOption(st.fenceStyles, m.key, dim.key, key)
  const styles: string[] = []
  for (const s of fences) {
    const on = !archive
    if (archive && s.isActive !== false) { s.isActive = false; (s as unknown as Record<string, unknown>).offWithStyle = true; styles.push(s.name) }
    else if (on && (s as unknown as Record<string, unknown>).offWithStyle) { s.isActive = true; delete (s as unknown as Record<string, unknown>).offWithStyle; styles.push(s.name) }
  }
  const names = new Set(fences.map(s => s.name))
  const kits: string[] = []
  for (const k of st.kits as Array<KitSet & { archivedWithStyle?: boolean }>) {
    if (!(k.styleName && names.has(k.styleName))) continue
    if (archive && !k.archived) { k.archived = true; k.archivedWithStyle = true; kits.push(k.name) }
    else if (!archive && k.archivedWithStyle) { delete k.archived; delete k.archivedWithStyle; kits.push(k.name) }
  }
  const items: string[] = []
  for (const i of st.items) {
    if (i.madeFor !== tag) continue
    const next = archive ? 'archived' : 'active'
    if (i.status !== next) { i.status = next; items.push(i.name) }
  }
  return { state: st, styles, items, kits }
}

/** Prices typed on the Price List for a style's parts (any style): the parts' Inventory prices, as dated costs. */
export function planStylePrices(st0: CatalogState, prices: Array<{ part: string; cents: number }>, today: string): { state: CatalogState; priced: StyleFormPlan['priced'] } {
  const st = clone(st0)
  const byItem = new Map(st.items.map(i => [normalizeItemName(i.name), i]))
  const priced: StyleFormPlan['priced'] = []
  for (const p of prices) {
    const c = p.cents
    if (!Number.isInteger(c) || c <= 0) throw new Error(`Type a price above $0 for ${p.part}.`)
    const item = byItem.get(normalizeItemName(p.part))
    if (!item) throw new Error(`${p.part} is not in Inventory.`)
    const prev = cents(item)
    if (prev === c) continue
    item.unitCost = c / 100
    item.priceUpdatedAt = today
    item.priceImported = false
    priced.push({ id: item.id, name: item.name, cents: c, prevCents: prev })
  }
  return { state: st, priced }
}

/** The style choices of a material, for the Price List: each with its fences, whether it is on, and what it waits for. */
export function stylesOfMaterial(st: CatalogState, material: string): Array<{ key: string; label: string; archived: boolean; form: boolean; copied: boolean; fences: number; on: number }> {
  const m = materialOf(st.fenceCatalog, material)
  const dim = styleDimOf(m)
  if (!m || !dim) return []
  return dim.options.map(o => {
    const fences = stylesOfOption(st.fenceStyles, m.key, dim.key, o.key)
    return { key: o.key, label: o.label, archived: !!o.archived, form: !!(o as StyleOption).styleForm, copied: !!o.copiedFrom, fences: fences.length, on: fences.filter(s => s.isActive !== false).length }
  })
}

export const styleKey = (label: string) => slug(label)
