/**
 * Settings → Price List → Vinyl Colors → Add Color: a vinyl color from one
 * form (Jonathan, Oct 21, 2026). The form asks only what differs by color;
 * this file makes everything else from the White fences, the same way for a
 * new color and for an edit:
 *
 *   catalog items   *Vinyl, {Color}, Section, {size}        (per section)
 *                   *Vinyl, {Color}, Post, 5" x 5" x {78|102}"  (one post price;
 *                     "Post, Corner, ..." and so on when the post types differ)
 *                   *Vinyl, {Color}, Cap, 5"x5"  · Cap, Gate  · Upright
 *                   what a section kit includes, at $0 (Picket, Rail, 8',
 *                     Picket Stiffener, Rail Stiffener, U Channel)
 *                   per piece: Picket, 62-1/4" · Rail, 6' · Rail, 8' · U-Trim, 59-1/4"
 *   fences          one per size and set method ticked, copying the White
 *                   fence of that size and method (labor, profit, sub rate, gates)
 *   material kits   the White fence's kits with the color parts swapped in:
 *                   every kit keeps White's lines; a section kit's lines are
 *                   what Jonathan says the section includes
 *   choice tree     the color under Vinyl > Color, so the quote builder offers it
 *
 * Everything shared (concrete, donuts, pipe, screws, rivets, hex bolts, H beam,
 * P channel, hinges, latches, handles, braces) stays exactly White's.
 *
 * Gate leaves: White builds each gate leaf from one 6 ft section's parts. A
 * color sold by the section builds each leaf from one section kit: its 6x6
 * when it has one, else the fence's own section (Chai Gray: a 6x8). Its parts
 * are $0 and the section line counts one per leaf. 8 ft tall gates are
 * bought whole, as White's are ("Privacy Gate 8 x 4").
 *
 * Costs are integer cents here; Inventory keeps dollars. The server
 * (portal lib/vinylColors.ts) runs this in one transaction and writes a price
 * history row for every cost set (source color_form).
 */

import { normalizeItemName } from './materialCalculator'
import { KIT_KINDS, kitSetFor, type KitKind, type KitPart, type KitSet } from './materialKits'
import {
  colorDimOf, generatedName, madeForTag, materialOf, optionOf, plainName, slug, styleChoicesOf, stylesOfOption,
  type CatalogState, type ChoiceOption, type JobLotQuote, type VinylColorFormSpec,
} from './fenceCatalog'
import type { FenceStyle } from './configStore'

export const SIZE_KEYS = ['6x6', '6x8', '8x6', '8x8'] as const
export type SizeKey = typeof SIZE_KEYS[number]
export type SetMethod = 'nd' | 'ds'
export const SET_METHOD_LABEL: Record<SetMethod, string> = { nd: 'No dig', ds: 'Dig set' }
export const COLOR_FORM_SOURCE = 'color_form'
export const POST_TYPES = ['corner', 'end', 'line', 'blank'] as const
export type PostType = typeof POST_TYPES[number]
const POST_WORD: Record<PostType, string> = { corner: 'Corner', end: 'End', line: 'Line', blank: 'Blank' }

export interface SectionContents { pickets: number; rails: number; railFt: number; picketStiffeners: number; railStiffeners: number; uChannels: number }
export interface PostCosts { allCents?: number | null; cornerCents?: number | null; endCents?: number | null; lineCents?: number | null; blankCents?: number | null }

export interface VinylColorInput {
  name: string
  /** piece: pickets, rails and U trim priced on their own (White, Tan); section: the supplier sells the section as a kit. */
  mode: 'piece' | 'section'
  sizes: SizeKey[]
  methods: SetMethod[]
  /** One price for corner, end, line and blank posts. */
  samePostPrice: boolean
  /** By height ('6', '8'). */
  posts: Partial<Record<string, PostCosts>>
  capCents: number | null
  /** 6 ft tall gates (each leaf has uprights). */
  uprightCents?: number | null
  /** 8 ft tall: the walk gate is bought whole, as White's is. */
  gate8Cents?: number | null
  /** Per section: each size's cost and what it includes. Per piece: 8 ft tall sizes' cost (bought whole, as White's are). */
  sections: Partial<Record<SizeKey, { costCents: number | null } & Partial<SectionContents>>>
  /** Per piece, 6 ft tall. */
  pieces?: { picketCents?: number | null; rail6Cents?: number | null; rail8Cents?: number | null; uTrimCents?: number | null }
  /** Rivets of another color in place of White's (Chai Gray takes black; about 5 times White's cost). Absent: White's, shared. */
  rivets?: { color: string; cents: number | null } | null
}

/** The rail stiffener in an 8 ft rail is the same part for every privacy color (Jonathan, Oct 21): White's rail insert. */
export const RAIL_INSERT_8 = "Vinyl, Rail Insert, 8'"
export const rivetItemName = (color: string) => `*Vinyl, ${color}, Rivet, 1"`
const WHITE_RIVET = /^\*Vinyl, White, Rivet, 1"$/

/** White's section, by size: what the form starts a section's contents at (the rail insert is White's rail stiffener). */
export const WHITE_SECTION: Record<SizeKey, SectionContents | null> = {
  '6x6': { pickets: 11, rails: 2, railFt: 6, picketStiffeners: 0, railStiffeners: 0, uChannels: 2 },
  '6x8': { pickets: 15, rails: 2, railFt: 8, picketStiffeners: 0, railStiffeners: 1, uChannels: 2 },
  // White's 8 ft tall sections are bought whole; their parts are not listed.
  '8x6': null,
  '8x8': null,
}

const heightOf = (s: SizeKey) => s.split('x')[0]
const widthOf = (s: SizeKey) => s.split('x')[1]
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

// ── What a White part is ─────────────────────────────────────────────────────

export type PartRole =
  | { role: 'post'; type: PostType; len: string }
  | { role: 'cap' } | { role: 'gateCap' } | { role: 'upright' } | { role: 'gate8' }
  | { role: 'picket' } | { role: 'rail'; ft: string } | { role: 'uTrim' } | { role: 'railInsert' } | { role: 'sectionItem' }
  | { role: 'rivet' } | { role: 'shared' }

const TYPE_CODE: Record<string, PostType> = { CP: 'corner', EP: 'end', LP: 'line' }

/** What a part in a White vinyl privacy kit is. Anything not color specific is shared (kept as White's). */
export function whitePartRole(part: string): PartRole {
  const p = part.trim()
  let m = p.match(/^\*Vinyl, White, Post, (Corner|End|Line|Blank), 5" x 5" x (\d+)"$/)
  if (m) return { role: 'post', type: m[1].toLowerCase() as PostType, len: m[2] }
  m = p.match(/^V , W, Post, 8' Privacy, (CP|EP|LP), 5" x 5"$/)
  if (m) return { role: 'post', type: TYPE_CODE[m[1]], len: '8ft' }
  if (/^\*Vinyl, White, Cap, 5"x5"$/.test(p)) return { role: 'cap' }
  if (/^\*Vinyl, White, Cap, Gate$/.test(p)) return { role: 'gateCap' }
  if (/^\*Vinyl, White, Upright$/.test(p)) return { role: 'upright' }
  if (WHITE_RIVET.test(p)) return { role: 'rivet' }
  if (/^V , W, Privacy,? Gate 8 x 4$/.test(p)) return { role: 'gate8' }
  if (/^\*Vinyl, White, Picket\b/.test(p)) return { role: 'picket' }
  m = p.match(/^\*Vinyl, White, Rail, (\d+)'$/)
  if (m) return { role: 'rail', ft: m[1] }
  if (/^\*Vinyl, White, U-Trim\b/.test(p)) return { role: 'uTrim' }
  if (/^Vinyl, Rail Insert\b/.test(p)) return { role: 'railInsert' }
  if (/^V , W, Picket Section\b/.test(p)) return { role: 'sectionItem' }
  // Rivets are shared (Jonathan's list), even though White's carries the color in its name.
  return { role: 'shared' }
}

// ── The catalog item names ───────────────────────────────────────────────────

export function postItemName(color: string, height: string, len: string, type: PostType | 'all'): string {
  const t = type === 'all' ? '' : `${POST_WORD[type]}, `
  return len === '8ft' ? `*Vinyl, ${color}, Post, ${t}5" x 5", 8' Privacy` : `*Vinyl, ${color}, Post, ${t}5" x 5" x ${len}"`
}
export const sectionItemName = (color: string, size: string) => `*Vinyl, ${color}, Section, ${size}`
export const KIT_PART_NAME = {
  picket: (c: string) => `*Vinyl, ${c}, Picket`,
  rail: (c: string, ft: number) => `*Vinyl, ${c}, Rail, ${ft}'`,
  picketStiffener: (c: string) => `*Vinyl, ${c}, Picket Stiffener`,
  railStiffener: (c: string) => `*Vinyl, ${c}, Rail Stiffener`,
  uChannel: (c: string) => `*Vinyl, ${c}, U Channel`,
}
export const PIECE_PART_NAME = {
  picket: (c: string) => `*Vinyl, ${c}, Picket, 62-1/4"`,
  rail: (c: string, ft: string) => `*Vinyl, ${c}, Rail, ${ft}'`,
  uTrim: (c: string) => `*Vinyl, ${c}, U-Trim, 59-1/4"`,
}

/** One catalog item the form makes: its name, its cost (null: included in a section kit, $0) and what it is. */
export interface FormItem { role: string; name: string; cents: number | null; includedIn?: string; what: string }

// ── Checking the form ────────────────────────────────────────────────────────

/** What is missing or wrong on the form, in plain words (empty: it can be saved). */
export function formProblems(input: VinylColorInput, opts: { taken?: string[] } = {}): string[] {
  const out: string[] = []
  const name = input.name.trim()
  if (!name) out.push('Type the color name.')
  else if (/[,*]/.test(name)) out.push('A color name cannot have a comma or a star in it (catalog item names are made from it).')
  else if (/^(white|tan|w|t)$/i.test(name)) out.push(`${name} is already a vinyl color.`)
  else if ((opts.taken ?? []).some(t => t.trim().toLowerCase() === name.toLowerCase())) out.push(`There is already a vinyl color called ${name}.`)
  if (input.mode !== 'piece' && input.mode !== 'section') out.push('Pick how it is priced: per piece or per section.')
  const sizes = input.sizes.filter(s => (SIZE_KEYS as readonly string[]).includes(s))
  if (!sizes.length) out.push('Tick at least one section size.')
  if (!input.methods.some(m => m === 'nd' || m === 'ds')) out.push('Tick at least one set method (ND or DS).')
  const heights = [...new Set(sizes.map(heightOf))]
  const money = (v: unknown, what: string) => { if (!isCents(v)) out.push(`Enter the ${what}.`) }
  for (const s of sizes) {
    const sec = input.sections[s]
    if (input.mode === 'section' || heightOf(s) === '8') money(sec?.costCents, `${s} section cost`)
    if (input.mode === 'section') {
      const c: Partial<SectionContents> = sec ?? {}
      const whole = (v: unknown, min: number, what: string) => { if (!(typeof v === 'number' && Number.isInteger(v) && v >= min)) out.push(`${s} section: enter ${what}${min > 0 ? '' : ' (0 if none)'}.`) }
      whole(c.pickets, 1, 'the picket count'); whole(c.rails, 1, 'the rail count'); whole(c.railFt, 1, 'the rail length in feet')
      whole(c.picketStiffeners, 0, 'the picket stiffener count'); whole(c.railStiffeners, 0, 'the rail stiffener count'); whole(c.uChannels, 0, 'the U channel count')
    }
  }
  for (const h of heights) {
    const p = input.posts[h] ?? {}
    const tall = `${h} ft tall`
    if (input.samePostPrice) money(p.allCents, `post cost (${tall})`)
    else for (const t of POST_TYPES) if (!(h === '8' && t === 'blank')) money(p[`${t}Cents` as const], `${t} post cost (${tall})`)
  }
  money(input.capCents, 'post cap cost')
  if (input.rivets) {
    const rc = (input.rivets.color ?? '').trim()
    if (!rc) out.push('Type the rivet color, or keep White rivets.')
    else if (/[,*]/.test(rc)) out.push('A rivet color cannot have a comma or a star in it.')
    if (!isCents(input.rivets.cents)) out.push('Enter the rivet cost (each).')
  }
  if (heights.includes('6')) money(input.uprightCents, 'gate upright cost')
  if (heights.includes('8')) money(input.gate8Cents, '8 ft tall walk gate cost')
  if (input.mode === 'piece' && heights.includes('6')) {
    const p = input.pieces ?? {}
    money(p.picketCents, 'picket cost'); money(p.uTrimCents, 'U trim cost'); money(p.rail6Cents, '6 ft rail cost')
    if (sizes.includes('6x8')) money(p.rail8Cents, '8 ft rail cost')
  }
  return out
}

// ── The plan ─────────────────────────────────────────────────────────────────

export interface CreatedList {
  /** The catalog items made (id, name, cost in cents; null: included in a section kit at $0). */
  items: Array<{ id: string; name: string; cents: number | null; includedIn?: string }>
  /** The fences made: internal name and plain name. */
  styles: Array<{ name: string; label: string; madeFrom: string }>
  /** The material kit sets made: id, the fence, and the lines in each kit. */
  kits: Array<{ id: string; styleName: string; lines: Partial<Record<KitKind, number>> }>
  /** The choice in the tree (Vinyl > Color). */
  option: { key: string; label: string }
}

export interface VinylColorPlan {
  state: CatalogState
  key: string
  label: string
  /** Made by this save (an edit: only what is new). */
  created: CreatedList
  /** Every catalog item whose cost this save set or changed: a price history row each. */
  priced: Array<{ id: string; name: string; cents: number; prevCents: number | null }>
  /** Fences switched off (a size or method unticked) or back on (ticked again). */
  archived: string[]
  reactivated: string[]
  /** The color's fences and their kits now (every one, for an edit too). */
  styles: string[]
  message: string
}

export interface PlanOpts {
  /** YYYY-MM-DD (the business day). */
  today: string
  /** Ids for new records. */
  newId: (prefix: string) => string
  /** Edit this color (made by the form) instead of adding one. */
  key?: string
}

function templateFor(st: CatalogState, height: string, method: SetMethod, width: string): FenceStyle | undefined {
  return st.fenceStyles.find(s => {
    if (s.isActive === false) return false
    const sc = styleChoicesOf(s)
    return sc?.material === 'vinyl' && sc.choices.style === 'privacy' && sc.choices.color === 'white' && sc.choices.height === height && sc.choices.install === method && sc.choices.width === width
  })
}

/** The White fence a size and method copy: its labor and profit, and its kits. */
export function whiteTemplate(st: CatalogState, size: SizeKey, method: SetMethod): { style: FenceStyle; kits: KitSet } | { problem: string } {
  const style = templateFor(st, heightOf(size), method, widthOf(size))
  if (!style) return { problem: `There is no White ${SET_METHOD_LABEL[method]} ${size.replace('x', "'x")}' privacy fence turned on to copy.` }
  const k = kitSetFor(style.name, st.kits)
  if (!k || k === 'archived' || k.mismatch) return { problem: `${style.name} has no material kit in use to copy.` }
  return { style, kits: clone(k) }
}

/**
 * Add a vinyl color from the form, or (opts.key) save the form again for one
 * it made. Pure: takes Settings, Inventory items and kits, returns them changed.
 */
export function planVinylColor(st0: CatalogState, input0: VinylColorInput, opts: PlanOpts): VinylColorPlan {
  const st = clone(st0)
  const input = clone(input0)
  const m = materialOf(st.fenceCatalog, 'vinyl')
  const dim = colorDimOf(m)
  if (!m || !dim) throw new Error('Vinyl has no colors in Settings.')
  let opt: ChoiceOption | undefined
  if (opts.key) {
    opt = optionOf(m, dim.key, opts.key)
    if (!opt?.color?.form) throw new Error('That color was not made by the Vinyl Colors form.')
    input.name = opt.label
  }
  const taken = dim.options.filter(o => !o.archived && o.key !== opts.key).map(o => o.label)
  const problems = formProblems(input, { taken })
  if (problems.length) throw new Error(problems.join(' '))
  const color = input.name.trim()
  const sizes = SIZE_KEYS.filter(s => input.sizes.includes(s))
  const methods = (['nd', 'ds'] as const).filter(x => input.methods.includes(x))
  const heights = [...new Set(sizes.map(heightOf))]
  const key = opt?.key ?? (() => { const base = slug(color); let k = base, n = 2; while (dim.options.some(o => o.key === k)) k = `${base}-${n++}`; return k })()
  const tag = madeForTag('vinyl', dim.key, key)

  // ── The catalog items ──
  const items = new Map<string, FormItem>()
  const want = (role: string, name: string, cents: number | null, what: string, includedIn?: string) => {
    if (!items.has(role)) items.set(role, { role, name, cents, what, ...(includedIn ? { includedIn } : {}) })
    return items.get(role)!.name
  }
  const sectionKitParts = (size: SizeKey, leaves = 1): KitPart[] => {
    const c = input.sections[size]! as SectionContents & { costCents: number }
    const into = sectionItemName(color, size)
    const out: KitPart[] = []
    const add = (role: string, name: string, qty: number, what: string) => { if (qty > 0) out.push({ part: want(role, name, null, what, into), qty: qty * leaves, fallbackCost: 0 }) }
    add('kit:picket', KIT_PART_NAME.picket(color), c.pickets, 'Picket (in the section kit)')
    add(`kit:rail:${c.railFt}`, KIT_PART_NAME.rail(color, c.railFt), c.rails, `Rail, ${c.railFt} ft (in the section kit)`)
    add('kit:picketStiffener', KIT_PART_NAME.picketStiffener(color), c.picketStiffeners, 'Picket stiffener (in the section kit)')
    // An 8 ft rail's stiffener is White's rail insert, the same part for every color; any other length gets the color's own.
    add('kit:railStiffener', c.railFt === 8 ? RAIL_INSERT_8 : KIT_PART_NAME.railStiffener(color), c.railStiffeners, 'Rail stiffener (in the section kit)')
    add('kit:uChannel', KIT_PART_NAME.uChannel(color), c.uChannels, 'U channel (in the section kit)')
    return out
  }
  const postCost = (h: string, type: PostType): number | null => {
    const p = input.posts[h] ?? {}
    return (input.samePostPrice ? p.allCents : p[`${type}Cents` as const]) ?? null
  }
  const swapPart = (r: PartRole, h: string, original: KitPart): KitPart | null => {
    const at = (name: string, cents: number | null): KitPart => ({ part: name, qty: original.qty, fallbackCost: (cents ?? 0) / 100 })
    switch (r.role) {
      case 'post': {
        const type = input.samePostPrice ? 'all' : r.type
        const cents = postCost(h, r.type)
        return at(want(`post:${h}:${type}:${r.len}`, postItemName(color, h, r.len, type), cents, `${type === 'all' ? 'Post' : `${POST_WORD[r.type]} post`}, ${r.len === '8ft' ? '8 ft tall' : `${r.len}"`}`), cents)
      }
      case 'cap': return at(want('cap', `*Vinyl, ${color}, Cap, 5"x5"`, input.capCents, 'Post cap'), input.capCents)
      // White has a gate cap of its own; the form has one cap price, used for both.
      case 'gateCap': return at(want('gateCap', `*Vinyl, ${color}, Cap, Gate`, input.capCents, 'Gate cap (the post cap price)'), input.capCents)
      case 'upright': return at(want('upright', `*Vinyl, ${color}, Upright`, input.uprightCents ?? null, 'Gate upright'), input.uprightCents ?? null)
      case 'gate8': return at(want('gate8', `*Vinyl, ${color}, Gate, 8 x 4`, input.gate8Cents ?? null, 'Walk gate, 8 ft tall'), input.gate8Cents ?? null)
      case 'picket': { const c = input.pieces?.picketCents ?? null; return at(want('piece:picket', PIECE_PART_NAME.picket(color), c, 'Picket'), c) }
      case 'rail': { const c = (r.ft === '8' ? input.pieces?.rail8Cents : input.pieces?.rail6Cents) ?? null; return at(want(`piece:rail:${r.ft}`, PIECE_PART_NAME.rail(color, r.ft), c, `Rail, ${r.ft} ft`), c) }
      case 'uTrim': { const c = input.pieces?.uTrimCents ?? null; return at(want('piece:uTrim', PIECE_PART_NAME.uTrim(color), c, 'U trim'), c) }
      default: return null
    }
  }

  // ── Fences and their kits ──
  const madeStyles: CreatedList['styles'] = [], madeKits: CreatedList['kits'] = []
  const archived: string[] = [], reactivated: string[] = [], allStyles: string[] = []
  const sectionItems: Record<string, Record<string, string>> = {}
  const leafWidth: Record<string, string> = {}
  const covers: JobLotQuote['covers'] = { section: [], post: [], walkGate: [], dblGate: [] }
  const cover = (piece: keyof JobLotQuote['covers'], parts: KitPart[]) => { for (const p of parts) if (!covers[piece].includes(p.part)) covers[piece].push(p.part) }
  const now = new Date().toISOString()
  const ticked = new Set<string>()

  for (const size of sizes) for (const method of methods) {
    const t = whiteTemplate(st, size, method)
    if ('problem' in t) throw new Error(t.problem)
    const h = heightOf(size), w = widthOf(size)
    const choices = { ...styleChoicesOf(t.style)!.choices, color: key }
    const name = generatedName(m, choices)
    ticked.add(name)
    allStyles.push(name)
    // Per section, or a size bought whole (8 ft tall, as White's are): the section item.
    const sectionItem = input.mode === 'section' || h === '8'
      ? want(`section:${size}`, sectionItemName(color, size), input.sections[size]?.costCents ?? null, `Section, ${size}`)
      : null
    if (input.mode === 'section') (sectionItems[h] ??= {})[w] = sectionItem!
    // A gate leaf takes a 6 ft wide section kit when the color has one, else this size's.
    const leafSize: SizeKey = h === '6' && sizes.includes('6x6') ? '6x6' : size
    const kits: KitSet['kits'] = {}
    for (const kind of KIT_KINDS) {
      const parts = t.kits.kits[kind]
      if (!parts?.length) continue
      const out: KitPart[] = []
      let placed = false
      const isSectionKit = kind === 'section' || kind === 'section8'
      const leaves = kind === 'walkGate' ? 1 : kind === 'dblGate' ? 2 : 0
      for (const p of parts) {
        const r = whitePartRole(p.part)
        const sectionPart = r.role === 'picket' || r.role === 'rail' || r.role === 'uTrim' || r.role === 'railInsert' || r.role === 'sectionItem'
        if (input.mode === 'section' && sectionPart && (isSectionKit || leaves)) {
          // The section's parts become what the section kit includes, listed once where White's first one was.
          if (!placed) {
            const kitParts = isSectionKit ? sectionKitParts(size) : sectionKitParts(leafSize, leaves)
            out.push(...kitParts)
            cover(isSectionKit ? 'section' : kind === 'walkGate' ? 'walkGate' : 'dblGate', kitParts)
            placed = true
          }
          continue
        }
        if (r.role === 'sectionItem') { out.push({ part: sectionItem!, qty: p.qty, fallbackCost: (input.sections[size]?.costCents ?? 0) / 100 }); continue }
        if (r.role === 'rivet' && input.rivets?.color.trim() && !/^white$/i.test(input.rivets.color.trim())) {
          const rc = input.rivets.color.trim(), cents = input.rivets.cents
          out.push({ part: want('rivet', rivetItemName(rc), cents, `Rivet, ${rc}`), qty: p.qty, fallbackCost: (cents ?? 0) / 100 })
          continue
        }
        if (r.role === 'railInsert' || r.role === 'rivet' || r.role === 'shared') { out.push({ ...p }); continue }
        const swapped = swapPart(r, h, p)
        out.push(swapped ?? { ...p })
      }
      kits[kind] = out
    }
    if (input.mode === 'section' && h === '6' && (kits.walkGate || kits.dblGate)) leafWidth[h] = widthOf(leafSize)
    const ownRivet = input.rivets?.color.trim() && !/^white$/i.test(input.rivets.color.trim()) ? rivetItemName(input.rivets.color.trim()) : null
    const roundUp = t.kits.roundUp.flatMap(p => { const role = whitePartRole(p).role; return role === 'shared' ? [p] : role === 'rivet' ? [ownRivet ?? p] : [] })
    const lines = Object.fromEntries(KIT_KINDS.filter(k => kits[k]).map(k => [k, kits[k]!.length])) as Partial<Record<KitKind, number>>

    const existing = st.fenceStyles.find(s => s.name === name)
    if (existing) {
      if (existing.isActive === false) { existing.isActive = true; reactivated.push(name) }
    } else {
      const s = t.style
      st.fenceStyles.push({
        id: opts.newId('fs'), name, category: s.category, margin: s.margin, targetProfitPct: s.targetProfitPct,
        sectionsPerMH: s.sectionsPerMH, panelWidth: Number(w), mhPerWalkGate: s.mhPerWalkGate, mhPerDblGate: s.mhPerDblGate,
        isActive: true, ...(s.quotable === false ? { quotable: false } : {}),
        ...(s.subRate !== undefined ? { subRate: s.subRate } : {}), ...(s.pricePerFoot !== undefined ? { pricePerFoot: s.pricePerFoot } : {}),
        material: 'vinyl', choices, madeFrom: s.name,
      })
      madeStyles.push({ name, label: '', madeFrom: s.name })
    }
    const set = st.kits.find(k => k.styleName === name && !k.archived)
    if (set) { set.kits = kits; set.roundUp = roundUp; set.updatedAt = now }
    else {
      const id = opts.newId('kit')
      st.kits.push({ id, name, styleName: name, kits, roundUp, updatedAt: now, madeFor: tag })
      madeKits.push({ id, styleName: name, lines })
    }
  }
  // A size or method no longer ticked: its fences are switched off (saved quotes on them keep working).
  if (opt) for (const s of stylesOfOption(st.fenceStyles, 'vinyl', dim.key, key)) {
    if (!ticked.has(s.name) && s.isActive !== false) { s.isActive = false; archived.push(s.name) }
  }

  // ── Catalog items: made when missing, cost set when it differs ──
  const byName = new Map(st.items.map(i => [normalizeItemName(i.name), i]))
  const madeItems: CreatedList['items'] = []
  const priced: VinylColorPlan['priced'] = []
  for (const it of items.values()) {
    let item = byName.get(normalizeItemName(it.name))
    if (!item) {
      item = { id: opts.newId('inv'), name: it.name, unitCost: 0, category: `Vinyl ${color}`, status: 'active', madeFor: tag, ...(it.includedIn ? { includedIn: it.includedIn } : {}) }
      st.items.push(item); byName.set(normalizeItemName(it.name), item)
      madeItems.push({ id: item.id, name: it.name, cents: it.cents, ...(it.includedIn ? { includedIn: it.includedIn } : {}) })
    } else if (item.status === 'archived') item.status = 'active'
    if (it.cents == null) continue
    const prev = Number.isFinite(item.unitCost) && item.unitCost > 0 ? Math.round(item.unitCost * 100) : null
    if (prev === it.cents && item.priceUpdatedAt) continue
    item.unitCost = it.cents / 100
    item.priceUpdatedAt = opts.today
    item.priceImported = false
    priced.push({ id: item.id, name: item.name, cents: it.cents, prevCents: prev })
  }

  // ── The color in the choice tree ──
  const form: VinylColorFormSpec = {
    mode: input.mode, sizes: [...sizes], methods: [...methods], samePostPrice: !!input.samePostPrice,
    ...(input.mode === 'section' ? { contents: Object.fromEntries(sizes.map(s => { const c = input.sections[s]!; return [s, { pickets: c.pickets!, rails: c.rails!, railFt: c.railFt!, picketStiffeners: c.picketStiffeners!, railStiffeners: c.railStiffeners!, uChannels: c.uChannels! }] })) } : {}),
    items: Object.fromEntries([...items.values()].map(i => [i.role, i.name])),
    madeOn: opt?.color?.form?.madeOn ?? opts.today,
  }
  const jobLot: JobLotQuote | undefined = input.mode === 'section'
    ? { supplier: '', quotedOn: opts.today, byHeight: {}, covers, sectionItems, ...(Object.keys(leafWidth).length ? { leafWidth } : {}) }
    : undefined
  const spec = {
    words: [color], copiedFrom: 'white', pricing: input.mode === 'section' ? 'piece' as const : 'part' as const,
    addedOn: opt?.color?.addedOn ?? opts.today, ...(jobLot ? { jobLot } : {}), form,
    ...(typeof opt?.color?.targetProfitPct === 'number' ? { targetProfitPct: opt.color.targetProfitPct } : {}),
    ...(opt?.color?.readyOn ? { readyOn: opt.color.readyOn } : {}),
  }
  if (opt) { opt.color = spec; delete opt.archived }
  else dim.options.push({ key, label: color, copiedFrom: 'white', color: spec })

  for (const s of madeStyles) s.label = plainName(st.fenceCatalog, { material: 'vinyl', choices: st.fenceStyles.find(x => x.name === s.name)!.choices! })
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  const message = opt
    ? `${color} saved: ${n(priced.length, 'cost')} changed${madeStyles.length ? `, ${n(madeStyles.length, 'fence')} added` : ''}${archived.length ? `, ${n(archived.length, 'fence')} switched off` : ''}. Saved quotes keep the prices they were priced with.`
    : `${color} added: ${n(madeItems.length, 'catalog item')}, ${n(madeStyles.length, 'fence')}, ${n(madeKits.length, 'material kit set')}. It is in the quote builder now.`
  return {
    state: st, key, label: color, priced, archived, reactivated, styles: allStyles, message,
    created: { items: madeItems, styles: madeStyles, kits: madeKits, option: { key, label: color } },
  }
}

/** Archive a color made by the form (Remove), or bring it back: its fences off or on, its catalog items archived or active. */
export function planArchiveVinylColor(st0: CatalogState, key: string, archive: boolean): { state: CatalogState; styles: string[]; items: string[] } {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, 'vinyl')
  const dim = colorDimOf(m)
  const opt = optionOf(m, dim?.key ?? '', key)
  if (!m || !dim || !opt?.color?.form) throw new Error('That color was not made by the Vinyl Colors form.')
  const tag = madeForTag('vinyl', dim.key, key)
  const form = opt.color.form
  if (archive) opt.archived = true; else delete opt.archived
  const styles: string[] = []
  for (const s of stylesOfOption(st.fenceStyles, 'vinyl', dim.key, key)) {
    const sc = styleChoicesOf(s)!
    const offered = form.sizes.includes(`${sc.choices.height}x${sc.choices.width}`) && form.methods.includes(sc.choices.install)
    const on = !archive && offered
    if ((s.isActive !== false) !== on) { s.isActive = on; styles.push(s.name) }
  }
  const items: string[] = []
  for (const i of st.items) {
    if (i.madeFor !== tag) continue
    const next = archive ? 'archived' : 'active'
    if (i.status !== next) { i.status = next; items.push(i.name) }
  }
  return { state: st, styles, items }
}

/** Take away everything the form made for a color (Undo): the choice, its fences, kits and catalog items. */
export function planUndoVinylColor(st0: CatalogState, key: string): { state: CatalogState; styles: string[]; kits: string[]; items: Array<{ id: string; name: string }> } {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, 'vinyl')
  const dim = colorDimOf(m)
  const opt = optionOf(m, dim?.key ?? '', key)
  if (!m || !dim || !opt?.color?.form) throw new Error('That color was not made by the Vinyl Colors form.')
  const tag = madeForTag('vinyl', dim.key, key)
  const styles = stylesOfOption(st.fenceStyles, 'vinyl', dim.key, key).map(s => s.name)
  const kits = st.kits.filter(k => k.madeFor === tag || (k.styleName && styles.includes(k.styleName))).map(k => k.id)
  const items = st.items.filter(i => i.madeFor === tag).map(i => ({ id: i.id, name: i.name }))
  st.fenceStyles = st.fenceStyles.filter(s => !styles.includes(s.name))
  st.kits = st.kits.filter(k => !kits.includes(k.id))
  st.items = st.items.filter(i => i.madeFor !== tag)
  dim.options = dim.options.filter(o => o.key !== key)
  return { state: st, styles, kits, items }
}

/** The form filled in from a color it made, with its costs from Inventory (an edit). */
export function inputFromColor(st: CatalogState, key: string): VinylColorInput | null {
  const m = materialOf(st.fenceCatalog, 'vinyl')
  const opt = optionOf(m, colorDimOf(m)?.key ?? '', key)
  const f = opt?.color?.form
  if (!opt || !f) return null
  const cost = (role: string): number | null => {
    const name = f.items[role]
    const it = name ? st.items.find(i => normalizeItemName(i.name) === normalizeItemName(name)) : undefined
    return it && it.unitCost > 0 ? Math.round(it.unitCost * 100) : null
  }
  const anyCost = (prefix: string): number | null => { for (const r of Object.keys(f.items)) if (r.startsWith(prefix)) { const c = cost(r); if (c != null) return c } return null }
  const posts: VinylColorInput['posts'] = {}
  for (const h of ['6', '8']) {
    if (!f.sizes.some(s => s.startsWith(`${h}x`))) continue
    posts[h] = f.samePostPrice ? { allCents: anyCost(`post:${h}:all:`) }
      : { cornerCents: anyCost(`post:${h}:corner:`), endCents: anyCost(`post:${h}:end:`), lineCents: anyCost(`post:${h}:line:`), blankCents: anyCost(`post:${h}:blank:`) }
  }
  const sections: VinylColorInput['sections'] = {}
  for (const s of f.sizes as SizeKey[]) sections[s] = { costCents: cost(`section:${s}`), ...(f.contents?.[s] ?? {}) }
  return {
    name: opt.label, mode: f.mode, sizes: f.sizes as SizeKey[], methods: f.methods as SetMethod[], samePostPrice: f.samePostPrice,
    posts, capCents: cost('cap'), uprightCents: cost('upright'), gate8Cents: cost('gate8'), sections,
    pieces: { picketCents: cost('piece:picket'), rail6Cents: cost('piece:rail:6'), rail8Cents: cost('piece:rail:8'), uTrimCents: cost('piece:uTrim') },
    rivets: f.items.rivet ? { color: f.items.rivet.replace(/^\*Vinyl, (.+), Rivet, 1"$/, '$1'), cents: cost('rivet') } : null,
  }
}

/** The kit section counts used by the tests and the confirmation screen: lines per kit of a kit set. */
export function kitLineCounts(set: KitSet): Partial<Record<KitKind, number>> {
  return Object.fromEntries(KIT_KINDS.filter(k => set.kits[k]?.length).map(k => [k, set.kits[k]!.length])) as Partial<Record<KitKind, number>>
}
