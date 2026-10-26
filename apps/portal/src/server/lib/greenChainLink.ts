/**
 * Green vinyl coated chain link, 4 ft, residential (Jonathan, Oct 26 2026):
 * "Use these prices as quoted (PP20 posts) to make green chain link quotable:
 * copy the black chain link setup and kits, swap in the green parts from this
 * quote" (Stephens Pipe & Steel quotation 06-251707).
 *
 * Made the way Settings → Fence styles → Chain link → Finish → Add color makes
 * a color (web/src/fenceCatalog.ts planAddColor): "Green", copying Black, 4 ft
 * only. That gives a Green twin of each 4 ft black style (No dig and Dig set,
 * the same install methods, labor and profit), switched off for quoting.
 *
 * The Green kits are not a frozen copy: each is DERIVED from the kit of the
 * black style it was made from (greenKitFrom), as that kit is now, saved or
 * built in from the parts list (materialCalculator, which follows the takeoff
 * sheet). Every Black / Blk part becomes the Green one, same quantity, then:
 *   - a green part is named for what 06-251707 sells where the quote says
 *     something else than the black part's name (PP20 posts, 2-1/2" bands,
 *     hinge and dome cap, the .055 4' x 4' gate, a 30" drop rod, steel hog rings).
 * Quantities are the black kits' own; nothing here is a new fence rule.
 *
 * planGreenFollowsBlack keeps them in step: at every server start (index.ts,
 * after the chain link steps) and in the Stephens script, a Green kit that
 * still is what it was last derived as is derived again from the black kit;
 * one Jonathan edited in Material Kits is left as he left it (and said so).
 * A green part the black kit needs that is not in Inventory yet is added with
 * no price (Chainlink Green), so Green is "not fully priced" until it has one.
 *
 * Prices come only from ordering 06-251707 through Inventory > Invoices
 * (lib/vendorInvoices: landed cost, estimated tax, freight spread, no fuel).
 * Three plain BOLT/NUT lines on 06-251707 print no color: whether they are the
 * galvanized bolts or green ones is Jonathan's call, so they are not matched
 * (GREEN_ASK); they wait in Needs a match.
 */

import { randomUUID } from 'crypto'

export const GREEN_KEY = 'migration:green-chain-link-2026-10-26'
export const GREEN_LABEL = 'Green'
export const STEPHENS = 'Stephens Pipe & Steel, LLC'
export const GREEN_CATEGORY = 'Chainlink Green'

/** How one 06-251707 line is matched: the Inventory item (by its final name) and the unit. */
export interface GreenLine {
  /** The line as printed on 06-251707. */
  description: string
  /** The Inventory item it prices (its name after the swap and rename). */
  part: string
  /** The green part's name as the Black → Green swap makes it, when the quote's part reads differently. */
  swappedFrom?: string
  /** "50 FT = 1 roll": vendorPer vendor units are invPer Inventory units. */
  vendorPer: number
  invPer: number
  unitWords: string
  /** Said in the report next to it. */
  note?: string
}

export const GREEN_LINES: GreenLine[] = [
  { description: 'GRN VNL Ext 2x9(13core)x48in KK 50ft/rll', part: 'Res, Fabric, 48", Green, KK (9)', vendorPer: 50, invPer: 1, unitWords: '50 ft = 1 roll' },
  { description: `GRN PLY 1-3/8" x 21' x PP055 SW x 7pc`, part: `Pipe, Green, 1-3/8" x 10'6" (.055)`, vendorPer: 21, invPer: 2, unitWords: "21 ft stick = 2 top rail pieces of 10'6\" (the black kit counts 10'6\" pieces)" },
  { description: `GRN PLY 1-5/8" x 8' x PP20`, part: `Pipe, Green, 1-5/8" X 8' (PP20)`, swappedFrom: `Pipe, Green, 1-5/8" X 8' (SS40)`, vendorPer: 1, invPer: 1, unitWords: '1 piece = 1 each' },
  { description: `GRN PLY 2-1/2" x 8' x PP20`, part: `Pipe, Green, 2-1/2" X 8' (PP20)`, swappedFrom: `Pipe, Green, 2-1/2" X 8' (SS40)`, vendorPer: 1, invPer: 1, unitWords: '1 piece = 1 each' },
  { description: 'GRN PLY TENSION BAR 48"x5/8"', part: 'Green, Tension Bar, 48"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY TENSION BAND 2-1/2in', part: 'Green, Band, Tension, 2-1/2"', swappedFrom: 'Green, Band, Tension, 2-3/8" x 3/4"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY BRACE BAND 2-1/2in', part: 'Green, Band, Brace, 2-1/2"', swappedFrom: 'Green, Band, Brace, 2-3/8", 3/4"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY FEMALE HINGE PS 1-3/8in', part: 'Green, Hinge, Female, 1-3/8" x 5/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY MALE HINGE 2-1/2in', part: 'Green, Hinge, Male, 2-1/2"', swappedFrom: 'Green, Hinge, Male, 2-3/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY AL LOOP CAP 1-5/8x1-3/8', part: 'Green, Cap, Loop, AL, 1-5/8" x 1-3/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY AL RAIL END 1-3/8in', part: 'Green, Rail End, AL, Offset, 1-3/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY AL DOME CAP 2-1/2in', part: 'Green, Cap, Dome, AL, 2-1/2"', swappedFrom: 'Green, Cap, Post, AL, 2-3/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: `GRN RES SNG GATE 4'Wx4' 1-3/8"SP055 NO SCR`, part: `Chainlink, Green, Gate, 1-3/8", 4' x 4' (.055)`, swappedFrom: `Chainlink, Green, Gate, 1-3/8", 4' x 4' (.065)`, vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN VNL ALUM TIE 9gax6-1/2in', part: 'Chainlink, Green, Hardware, Hook Ties, 6-1/2" x 9ga, AL (100)', vendorPer: 100, invPer: 1, unitWords: '100 each = 1 box' },
  { description: 'GRN PLY RES DROP ROD 3/8x30in', part: 'Drop Rod, 30", Green', swappedFrom: 'Drop Rod, 24", Green', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY DROP FORK 1-3/8in', part: 'Green, Fork, PS, 1-3/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY COLLAR 1-3/8in', part: 'Green, Collar, PS, 1-3/8" (Set of 2)', vendorPer: 1, invPer: 1, unitWords: '1 set = 1 set of 2' },
  { description: "ENS DOM VNL TENS WIRE 9ga SMOOTH (1000')", part: 'Green, Wire, Tension, 9GA', vendorPer: 1, invPer: 1000, unitWords: '1 roll = 1000 ft (the kit counts feet)', note: 'the line prints no color (VNL = vinyl coated); matched to the Green tension wire because Jonathan named tension wire among the green parts of this order' },
  { description: 'GRN VNL STEEL HOG RING (140/#)', part: 'Green, Hog Ring, 9GA, Steel', swappedFrom: 'Green, Hog Ring, 9GA, Alum', vendorPer: 1, invPer: 140, unitWords: '1 lb = 140 each' },
]

/** 06-251707 lines not matched: no color printed on a green order, so which item they are is Jonathan's call. */
export interface GreenAsk { description: string; candidates: string[]; why: string }
export const GREEN_ASK: GreenAsk[] = [
  { description: 'BOLT/NUT 5/16x1-1/4in', candidates: ['G, Bolt, 5/16 x 1-1/4" w/ Nut', 'Green, Bolt, 5/16 x 1-1/4" w/ Nut'], why: 'plain bolt, no color printed: the galvanized bolt or a green one?' },
  { description: 'BOLT/NUT 3/8x2in', candidates: ['G, Bolt, 3/8" x 2" w/ Nut', 'Green, Bolt, 3/8" x 2" w/ Nut'], why: 'plain bolt, no color printed: the galvanized bolt or a green one?' },
  { description: 'BOLT/NUT 3/8x3in', candidates: ['G, Bolt, 3/8" x 3" w/ Nut', 'Green, Bolt, 3/8" x 3" w/ Nut'], why: 'plain bolt, no color printed: the galvanized bolt or a green one?' },
]

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** The 06-251707 line rule for a printed description (exact, spacing ignored). */
export function greenLineFor(description: string): GreenLine | null {
  return GREEN_LINES.find(g => norm(g.description) === norm(description)) ?? null
}
/** A 06-251707 line left for Jonathan to match (exact, spacing ignored). */
export function greenAskFor(description: string): GreenAsk | null {
  return GREEN_ASK.find(g => norm(g.description) === norm(description)) ?? null
}

export interface GreenState { fenceStyles: any[]; fenceCatalog: any; items: any[]; kits: any[] }

/** The web pricing code this uses (apps/web/src/estimate.ts exports; the tests pass the functions themselves). */
export interface GreenModule {
  planAddColor(st: GreenState, req: unknown): { state: GreenState; styles: string[]; items: string[]; message: string }
  planUpdateOption(st: GreenState, material: string, dim: string, key: string, patch: unknown): GreenState
  kitSetFor(styleName: string, sets: any[]): any
  swapColor(part: string, words: readonly string[], to: string): string
  isColorPart(part: string, words: readonly string[]): boolean
}

const chainDims = (cat: any) => arr(arr(cat?.materials).find((m: any) => m?.key === 'chain')?.dims).find((d: any) => d?.key === 'finish')
const greenOption = (cat: any) => arr(chainDims(cat)?.options).find((o: any) => String(o?.label ?? '').trim().toLowerCase() === GREEN_LABEL.toLowerCase() && !o.archived) ?? null
const tagOf = (opt: any) => `chain:finish:${opt.key}`

/** The rename from the swapped green name to the part 06-251707 sells. */
const RENAME = new Map(GREEN_LINES.filter(g => g.swappedFrom).map(g => [norm(g.swappedFrom!), g.part]))

/**
 * A Green kit set's kits, derived from a black kit set as it is now: every
 * color part swapped to Green (same quantity, no fallback price), then named
 * for what 06-251707 sells. `from` maps each green part to the black part it came from.
 */
export function greenKitFrom(m: GreenModule, black: any, words: readonly string[]): { kits: Record<string, any[]>; roundUp: string[]; from: Map<string, string> } {
  const from = new Map<string, string>()
  const green = (part: string) => {
    if (!m.isColorPart(part, words)) return part
    const swapped = m.swapColor(part, words, GREEN_LABEL)
    const out = RENAME.get(norm(swapped)) ?? swapped
    if (!from.has(norm(out))) from.set(norm(out), part)
    return out
  }
  const kits: Record<string, any[]> = {}
  for (const [kind, parts] of Object.entries(black?.kits ?? {})) {
    if (!arr(parts).length) continue
    kits[kind] = arr(parts).map((p: any) => {
      const part = green(String(p.part))
      return part === p.part ? { ...p } : { part, qty: p.qty, fallbackCost: 0 }
    })
  }
  return { kits, roundUp: arr(black?.roundUp).map((p: string) => green(p)), from }
}

/** A kit set's parts and quantities as one string, to tell whether it changed. */
export function kitKey(set: { kits?: Record<string, any[]>; roundUp?: string[] }): string {
  const kinds = Object.entries(set.kits ?? {}).filter(([, ps]) => arr(ps).length).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([kinds.map(([k, ps]) => [k, arr(ps).map((p: any) => `${norm(String(p.part))}=${Math.round(Number(p.qty) * 1e6) / 1e6}`).sort()]), arr(set.roundUp).map(norm).sort()])
}

/** What changed between two kit sets, kit by kit, in words. */
function kitDiff(a: any, b: any): string[] {
  const out: string[] = []
  const kinds = new Set([...Object.keys(a?.kits ?? {}), ...Object.keys(b?.kits ?? {})])
  for (const kind of [...kinds].sort()) {
    const was = new Map(arr(a?.kits?.[kind]).map((p: any) => [norm(p.part), p]))
    const now = new Map(arr(b?.kits?.[kind]).map((p: any) => [norm(p.part), p]))
    const bits: string[] = []
    for (const [k, p] of was) if (!now.has(k)) bits.push(`− ${p.qty} × ${String(p.part).trim()}`)
    for (const [k, p] of now) {
      const o = was.get(k)
      if (!o) bits.push(`+ ${p.qty} × ${String(p.part).trim()}`)
      else if (Number(o.qty) !== Number(p.qty)) bits.push(`${String(p.part).trim()} ${o.qty} → ${p.qty}`)
    }
    if (bits.length) out.push(`${kind}: ${bits.join('; ')}`)
  }
  return out
}

/** Green parts the kits use that are not in Inventory yet: added with no price (Chainlink Green; Stephens for the ones 06-251707 prices). */
function addMissingItems(st: GreenState, tag: string, kits: Record<string, any[]>, from: Map<string, string>): string[] {
  const have = new Set(st.items.map((i: any) => norm(String(i?.name ?? ''))))
  const byName = new Map(st.items.map((i: any) => [norm(String(i?.name ?? '')), i]))
  const priced = new Set(GREEN_LINES.map(g => norm(g.part)))
  const added: string[] = []
  for (const parts of Object.values(kits)) for (const p of parts) {
    const k = norm(String(p.part))
    if (have.has(k) || !from.has(k)) continue
    const src = byName.get(norm(from.get(k)!))
    st.items.push({
      id: `inv_${randomUUID().replace(/-/g, '').slice(0, 12)}`, name: String(p.part).trim(), unitCost: 0, category: GREEN_CATEGORY,
      ...(src?.unitOfMeasure ? { unitOfMeasure: src.unitOfMeasure } : {}), ...(priced.has(k) ? { supplier: STEPHENS } : {}), status: 'active', madeFor: tag,
    })
    have.add(k); added.push(String(p.part).trim())
  }
  return added
}

const greenStyles = (st: GreenState, opt: any) => st.fenceStyles.filter((s: any) => s?.material === 'chain' && s?.choices?.finish === opt.key && s?.madeFrom)
const blackWords = (cat: any, opt: any): string[] => arr(arr(chainDims(cat)?.options).find((o: any) => o?.key === (opt?.copiedFrom ?? opt?.color?.copiedFrom ?? 'black'))?.color?.words)

export interface GreenUnpriced { part: string; kits: string[]; ask?: GreenAsk }

/** Parts the Green kits use that no 06-251707 line prices and that have no price in Inventory. */
export function greenUnpriced(st: GreenState): GreenUnpriced[] {
  const opt = greenOption(st.fenceCatalog)
  if (!opt) return []
  const names = new Set(greenStyles(st, opt).map((s: any) => s.name))
  const priced = new Set(GREEN_LINES.map(g => norm(g.part)))
  const tag = tagOf(opt)
  const left = new Map<string, Set<string>>()
  for (const k of st.kits) {
    if (k.archived || !names.has(k.styleName)) continue
    for (const [kind, parts] of Object.entries(k.kits ?? {})) for (const p of arr(parts)) {
      const item = st.items.find((i: any) => norm(String(i?.name ?? '')) === norm(p.part))
      const isGreen = item ? item.madeFor === tag || item.category === GREEN_CATEGORY : true
      if (isGreen && !priced.has(norm(p.part)) && !(Number(item?.unitCost) > 0)) left.set(String(p.part).trim(), new Set([...(left.get(String(p.part).trim()) ?? []), `${k.styleName} ${kind}`]))
    }
  }
  return [...left].map(([part, kits]) => {
    const ask = GREEN_ASK.find(a => a.candidates.some(c => norm(c) === norm(part)))
    return { part, kits: [...kits], ...(ask ? { ask } : {}) }
  }).sort((a, b) => a.part.localeCompare(b.part))
}

export interface GreenFollow {
  state: GreenState
  /** Green kit sets derived again from their black kit, with what changed. */
  updated: Array<{ kit: string; from: string; changes: string[] }>
  /** Left as they are, and why. */
  skipped: string[]
  /** Green parts added to Inventory with no price. */
  items: string[]
  /** Kit sets only marked as following (their parts were already right). */
  marked: string[]
}

/**
 * Keep each Green kit set derived from the black kit it was made from (see the
 * top of this file). A set is derived again when it still is what it was last
 * derived as: its `followsKit.key`, or, for a set made before that mark
 * existed, when it was not saved since Green was made (`madeAt`, the time
 * GREEN_KEY records). Pure; saved quotes keep their prices.
 */
export function planGreenFollowsBlack(m: GreenModule, st0: GreenState, opts: { madeAt?: string | null } = {}): GreenFollow {
  const st = clone(st0)
  const out: GreenFollow = { state: st, updated: [], skipped: [], items: [], marked: [] }
  const opt = greenOption(st.fenceCatalog)
  if (!opt) return out
  const words = blackWords(st.fenceCatalog, opt)
  if (!words.length) { out.skipped.push('Green has no color it was copied from'); return out }
  const tag = tagOf(opt)
  const madeAt = opts.madeAt ? Date.parse(opts.madeAt) : NaN
  for (const s of greenStyles(st, opt)) {
    const set = st.kits.find((k: any) => k.styleName === s.name && !k.archived)
    if (!set) { out.skipped.push(`${s.name}: no kit set`); continue }
    const black = m.kitSetFor(s.madeFrom, st.kits)
    if (!black || black === 'archived' || black.mismatch) { out.skipped.push(`${s.name}: no kit for ${s.madeFrom} to follow`); continue }
    const want = greenKitFrom(m, black, words)
    const wantKey = kitKey(want)
    const haveKey = kitKey(set)
    const last = set.followsKit?.key ?? null
    const unedited = last ? last === haveKey : Number.isFinite(madeAt) && !(Date.parse(set.updatedAt ?? '') > madeAt + 60_000)
    if (haveKey !== wantKey && !unedited) { out.skipped.push(`${set.name}: edited in Material Kits since it was made, left as it is (it no longer follows ${s.madeFrom})`); continue }
    out.items.push(...addMissingItems(st, tag, want.kits, want.from))
    if (haveKey === wantKey && last === wantKey && set.followsKit?.from === s.madeFrom) continue
    const changes = kitDiff(set, want)
    set.kits = want.kits
    set.roundUp = want.roundUp
    set.followsKit = { from: s.madeFrom, key: wantKey }
    if (changes.length) {
      set.updatedAt = new Date().toISOString()
      out.updated.push({ kit: set.name, from: s.madeFrom, changes })
    } else out.marked.push(set.name)
  }
  return out
}

export interface GreenPlan {
  state: GreenState
  /** False when Green was already made (then only planGreenFollowsBlack applies). */
  made: boolean
  styles: Array<{ name: string; madeFrom: string; install: string }>
  kits: string[]
  /** New Inventory items (no price yet), by final name. */
  items: string[]
  /** Green kit parts with no price from 06-251707: they stay with no price, so Green is not fully priced. */
  noGreen: GreenUnpriced[]
  /** Kit parts named for what the quote sells instead of the plain swap. */
  renamed: Array<{ from: string; to: string }>
  message: string
}

/** Green chain link (4 ft, residential, No dig and Dig set) as Add color makes it, kits derived from black with 06-251707's parts, switched off. */
export function planGreenChainLink(m: GreenModule, st0: GreenState): GreenPlan {
  const existing = greenOption(st0.fenceCatalog)
  if (existing) {
    const names = greenStyles(st0, existing).map((s: any) => s.name)
    return { state: st0, made: false, styles: names.map((n: string) => ({ name: n, madeFrom: '', install: '' })), kits: [], items: [], noGreen: greenUnpriced(st0), renamed: [], message: `Green chain link is already in Settings (${names.join(', ') || 'no fences'}): not made again.` }
  }
  const added = m.planAddColor(clone(st0), { material: 'chain', under: { dim: 'height', key: '4' }, label: GREEN_LABEL, copyFrom: 'black', pricing: 'part' })
  const opt = greenOption(added.state.fenceCatalog)
  if (!opt) throw new Error('Add color did not make Green.')
  const st = m.planUpdateOption(added.state, 'chain', 'finish', opt.key, { quotable: false })
  const tag = tagOf(opt)
  // The kits, derived (the same derivation that keeps them in step later); the
  // items Add color made only under the plain swap's name go, the quote's names come in.
  st.items = st.items.filter((i: any) => i?.madeFor !== tag)
  const follow = planGreenFollowsBlack(m, st, { madeAt: new Date().toISOString() })
  const s2 = follow.state
  const made = new Set(added.styles)
  const styles = s2.fenceStyles.filter((s: any) => made.has(s.name)).map((s: any) => ({ name: s.name, madeFrom: s.madeFrom, install: s.choices?.install }))
  const items = s2.items.filter((i: any) => i?.madeFor === tag).map((i: any) => String(i.name))
  const renamed = GREEN_LINES.filter(g => g.swappedFrom && items.some((n: string) => norm(n) === norm(g.part))).map(g => ({ from: g.swappedFrom!, to: g.part }))
  return {
    state: s2, made: true, styles, kits: s2.kits.filter((k: any) => made.has(k.styleName)).map((k: any) => k.name), items,
    noGreen: greenUnpriced(s2), renamed,
    message: `Green chain link: ${styles.length} fences (${styles.map((s: any) => s.name).join(', ')}), switched off for quoting; ${items.length} new parts in Inventory.`,
  }
}
