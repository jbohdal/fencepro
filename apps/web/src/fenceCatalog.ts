/**
 * Fence styles as choices. A fence is built from choices that belong to its
 * material, never from coded names:
 *
 *   Vinyl        Style > Height > Color > Install > Panel width
 *   Chain link   Height > Finish > Grade > Install (No dig: the styles priced so far; Dig set: Oct 2026)
 *   Aluminum     Panel style > Height > Install
 *   Wood         Style > Height > Install > Panel width (priced from white vinyl × the Wood factor, wood.ts)
 *   Other        Product
 *
 * Every style keeps its old code ("WV-ND 6'x8' Privacy") as its hidden
 * internal name: prices, material kits, tiers, automations, imports and saved
 * quotes all still find it by that name, and its math is untouched. The
 * choices and the plain name ("White Vinyl Privacy, 6 ft tall, 8 ft panels,
 * No dig") are a layer on top: the old styles get their choices from
 * LEGACY_STYLE_CHOICES; a combination made from Settings (a color, a height,
 * a style added later) gets a generated internal name
 * ("vinyl/privacy/6/clay/nd/8") and its own material kit set.
 *
 * The choice tree is saved in Settings (config.fenceCatalog); until Jonathan
 * changes it, DEFAULT_CATALOG is used. Pure: the server's estimates run it too.
 *
 * Colors (vinyl Color, chain link Finish) are priced one of two ways:
 *   by part   each part's cost comes from Inventory (White and Tan today)
 *   by piece  a supplier's job lot quote: a section, post and gate price, each
 *             covering the parts Jonathan ticks; the parts list is the same as
 *             any color's, and the parts a piece covers are $0 (see
 *             materialKits.linesFromKitSetJobLot).
 * A color made in Settings is not available for quoting until it is fully
 * priced (every color part priced in Inventory, or every piece price in).
 */

import type { FenceStyle } from './configStore'
import { inventoryCost, normalizeItemName, sectionWidthForStyle, type StyleJobLot } from './materialCalculator'
import { kitSetFor, KIT_KINDS, KIT_LABEL, PIECE_OF_KIT, type KitKind, type KitPart, type KitSet } from './materialKits'
import { WOOD_MATERIAL } from './wood'

// ── The tree ─────────────────────────────────────────────────────────────────

export interface QtyOverride {
  /** Height option key ('' where the material has no height). */
  height: string
  /** Section kits: the panel width ('6', '8'); every other kit: 'any'. */
  width: string
  kit: KitKind
  /** The new color's part name. */
  part: string
  qty: number
}

/** Prices from a job lot quote for one height, in integer cents. */
export interface PiecePrices {
  /** One section, by panel width in feet ('6', '8'). */
  sectionCents?: Record<string, number | null>
  postCents?: number | null
  /** Separate corner / end / line / gate post prices instead of one post price. */
  separatePosts?: boolean
  cornerCents?: number | null
  endCents?: number | null
  lineCents?: number | null
  gatePostCents?: number | null
  walkGateCents?: number | null
  dblGateCents?: number | null
}

export type PieceKey = keyof StyleJobLot['covers']
export const PIECE_LABEL: Record<PieceKey, string> = { section: 'Section', post: 'Post', walkGate: 'Walk gate', dblGate: 'Double gate' }

export interface JobLotQuote {
  supplier: string
  /** YYYY-MM-DD, the date on the supplier's quote. */
  quotedOn: string
  /** By height option key. */
  byHeight: Record<string, PiecePrices>
  /** The parts each piece price includes (part names). */
  covers: Record<PieceKey, string[]>
  /** Sections sold as a kit (Vinyl Colors form): the catalog item per height, then panel width; its price is its Inventory cost. */
  sectionItems?: Record<string, Record<string, string>>
  /** Gate leaves built from a section kit, per height: the panel width of the section a leaf takes. */
  leafWidth?: Record<string, string>
}

/**
 * A vinyl color made by Settings → Price List → Vinyl Colors (vinylColorForm.ts):
 * what the form was filled in with, apart from the costs (those are the
 * Inventory items' costs, with price history). Its parts, kits and fences
 * are made from it; editing the color fills the form from it.
 */
export interface VinylColorFormSpec {
  mode: 'piece' | 'section'
  sizes: string[]
  methods: string[]
  samePostPrice: boolean
  /** Per section mode: what each section kit includes, by size ("6x8"). */
  contents?: Record<string, { pickets: number; rails: number; railFt: number; picketStiffeners: number; railStiffeners: number; uChannels: number }>
  /** The catalog items the form prices, by what they are ("cap", "upright", "section:6x8", "post:6:all:78", ...): item names. */
  items: Record<string, string>
  /** YYYY-MM-DD the color was made. */
  madeOn: string
}

export interface ColorSpec {
  /** Words that mark a part as this color in a part name ("*Vinyl, White, Picket" → White; "V , W, ..." → W). */
  words: string[]
  /** The color whose parts it copied (option key). */
  copiedFrom?: string
  pricing: 'part' | 'piece'
  jobLot?: JobLotQuote
  overrides?: QtyOverride[]
  /** Blank: the same Target Profit % as each style. */
  targetProfitPct?: number | null
  /** YYYY-MM-DD it was added in Settings. */
  addedOn?: string
  /** When it was first fully priced and switched on by itself. */
  readyOn?: string
  /** Made by the Vinyl Colors form (Settings → Price List); edited there, not in the Add color steps. */
  form?: VinylColorFormSpec
}

export interface ChoiceOption {
  key: string
  label: string
  /** How it reads in the plain name, when that differs from the label ("6 ft panels"). */
  nameText?: string
  /** Available for quoting at this level (default on). */
  quotable?: boolean
  archived?: boolean
  /** Added in Settings, copying the combinations of this option. */
  copiedFrom?: string
  color?: ColorSpec
  /**
   * Its combinations are not available for quoting until every part in their
   * material kits has an Inventory price; then they switch on by themselves
   * (chain link Dig set, whose post parts start with no price).
   */
  waitForPrices?: boolean
}

export interface ChoiceDim {
  key: string
  label: string
  /** The colors (vinyl Color, chain link Finish): Add color, priced by part or by piece. */
  isColor?: boolean
  options: ChoiceOption[]
}

export interface MaterialDef {
  key: string
  label: string
  /** Settings → Fence Styles category new combinations of this material get. */
  category: FenceStyle['category']
  /** The plain name: {dimension key} is replaced by the option's name text. */
  nameTemplate: string
  quotable?: boolean
  /** In the order they are chosen. */
  dims: ChoiceDim[]
}

export interface FenceCatalog { version: 1; materials: MaterialDef[] }

const o = (key: string, label: string, nameText?: string, extra: Partial<ChoiceOption> = {}): ChoiceOption => ({ key, label, ...(nameText ? { nameText } : {}), ...extra })
const color = (key: string, label: string, words: string[]): ChoiceOption => ({ key, label, color: { words, pricing: 'part' } })

/**
 * Chain link Install (Oct 2026). No dig is how chain link has always been
 * priced (thick Schedule 40 pipe driven, no concrete); every chain link style
 * made before this is the No dig one, under its same internal name. Dig set
 * (shorter, thinner posts in concrete) waits for its post prices.
 */
export const CHAIN_INSTALL_DIM: ChoiceDim = {
  key: 'install', label: 'Install',
  options: [{ key: 'nd', label: 'No dig' }, { key: 'ds', label: 'Dig set', waitForPrices: true }],
}

export const DEFAULT_CATALOG: FenceCatalog = {
  version: 1,
  materials: [
    {
      key: 'vinyl', label: 'Vinyl', category: 'Vinyl',
      nameTemplate: '{color} Vinyl {style}, {height} tall, {width}, {install}',
      dims: [
        { key: 'style', label: 'Style', options: [o('privacy', 'Privacy'), o('bell', 'Bell')] },
        { key: 'height', label: 'Height', options: [o('4', '4 ft'), o('6', '6 ft'), o('8', '8 ft')] },
        { key: 'color', label: 'Color', isColor: true, options: [color('white', 'White', ['White', 'W']), color('tan', 'Tan', ['Tan', 'T'])] },
        { key: 'install', label: 'Install', options: [o('nd', 'No dig'), o('ds', 'Dig set')] },
        { key: 'width', label: 'Panel width', options: [o('auto', 'Best price (auto)', '6 or 8 ft panels (best price)'), o('6', '6 ft', '6 ft panels'), o('8', '8 ft', '8 ft panels')] },
      ],
    },
    {
      key: 'chain', label: 'Chain link', category: 'Chainlink',
      nameTemplate: '{finish} Chain Link, {height}, {grade}, {install}',
      dims: [
        { key: 'height', label: 'Height', options: [o('4', '4 ft'), o('5', '5 ft'), o('6', '6 ft'), o('6+1', '6 ft + 1 ft barbed wire')] },
        { key: 'finish', label: 'Finish', isColor: true, options: [color('galv', 'Galvanized', ['Galv', 'G']), color('black', 'Black', ['Black', 'Blk'])] },
        { key: 'grade', label: 'Grade', options: [o('res', 'Residential'), o('com', 'Commercial')] },
        CHAIN_INSTALL_DIM,
      ],
    },
    {
      key: 'alum', label: 'Aluminum', category: 'Aluminum',
      nameTemplate: 'Aluminum {panel}, {height} tall, {install}',
      dims: [
        { key: 'panel', label: 'Panel style', options: [o('emily', 'Emily'), o('abigail', 'Industrial Abigail')] },
        { key: 'height', label: 'Height', options: [o('4', '4 ft'), o('6', '6 ft')] },
        { key: 'install', label: 'Install', options: [o('nd', 'No dig'), o('ds', 'Dig set')] },
      ],
    },
    WOOD_MATERIAL,
    {
      key: 'other', label: 'Other', category: 'Other',
      nameTemplate: '{product}',
      dims: [{ key: 'product', label: 'Product', options: [o('durafence', 'Durafence')] }],
    },
  ],
}

export { LEGACY_STYLE_CHOICES, styleChoicesOf, type StyleChoices } from './legacyStyles'
import { LEGACY_STYLE_CHOICES, styleChoicesOf, type StyleChoices } from './legacyStyles'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** The saved choice tree, or the default one. */
export function catalogOf(cfg: { fenceCatalog?: FenceCatalog | null } | null | undefined): FenceCatalog {
  const c = cfg?.fenceCatalog
  return c && Array.isArray(c.materials) && c.materials.length ? c : DEFAULT_CATALOG
}

export function materialOf(catalog: FenceCatalog, key: string | undefined): MaterialDef | undefined {
  return catalog.materials.find(m => m.key === key)
}
export function colorDimOf(m: MaterialDef | undefined): ChoiceDim | undefined { return m?.dims.find(d => d.isColor) }
export function optionOf(m: MaterialDef | undefined, dim: string, key: string | undefined): ChoiceOption | undefined {
  return m?.dims.find(d => d.key === dim)?.options.find(x => x.key === key)
}

/** "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig", from the choices. */
export function plainName(catalog: FenceCatalog, sc: StyleChoices): string {
  const m = materialOf(catalog, sc.material)
  if (!m) return ''
  const text = (dim: string) => { const opt = optionOf(m, dim, sc.choices[dim]); return opt ? (opt.nameText || opt.label) : (sc.choices[dim] ?? '') }
  return m.nameTemplate.replace(/\{(\w+)\}/g, (_, d: string) => text(d)).replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()
}

/** The internal name a combination made in Settings gets: material and choice keys. */
export function generatedName(m: MaterialDef, choices: Record<string, string>): string {
  return [m.key, ...m.dims.map(d => choices[d.key] ?? '')].join('/')
}

// ── Plain names by internal name ─────────────────────────────────────────────

let labels = new Map<string, string>()

/** The plain name for a style's internal name (old code or generated); anything unknown (old imported text) as it is. */
export function styleLabel(name: string | null | undefined): string {
  const n = String(name ?? '')
  if (!n) return ''
  const hit = labels.get(n)
  if (hit) return hit
  const legacy = LEGACY_STYLE_CHOICES[n]
  return legacy ? plainName(DEFAULT_CATALOG, legacy) : n
}

// ── Colors: parts, readiness, job lot ────────────────────────────────────────

/** A part is this color's when one of its comma separated pieces is one of the color's words. */
export function isColorPart(part: string, words: readonly string[]): boolean {
  const w = new Set(words.map(x => x.trim().toLowerCase()).filter(Boolean))
  return part.split(',').some(seg => w.has(seg.trim().toLowerCase()))
}

/** The same part in another color: the color's piece of the name swapped for the new color's name. */
export function swapColor(part: string, words: readonly string[], to: string): string {
  const w = new Set(words.map(x => x.trim().toLowerCase()).filter(Boolean))
  return part.split(',').map(seg => {
    const t = seg.trim()
    if (!w.has(t.toLowerCase())) return seg
    const lead = seg.slice(0, seg.indexOf(t)), trail = seg.slice(seg.indexOf(t) + t.length)
    return lead + to + trail
  }).join(',')
}

const cents = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)

/** The panel widths (as '6', '8') a style's sections come in: both for auto mix. */
export function styleWidths(s: Pick<FenceStyle, 'name' | 'panelWidth' | 'autoRailMix'>): string[] {
  return s.autoRailMix ? ['6', '8'] : [String(sectionWidthForStyle(s.name, s.panelWidth))]
}

/** Job lot prices for one style, in dollars, from its color's job lot quote (a section kit: its catalog item's Inventory cost). */
export function jobLotFor(s: FenceStyle, sc: StyleChoices, opt: ChoiceOption, price: PriceFn = inventoryCost): StyleJobLot | undefined {
  const spec = opt.color
  if (!spec || spec.pricing !== 'piece' || !spec.jobLot) return undefined
  const h = sc.choices.height ?? ''
  const p = spec.jobLot.byHeight[h] ?? spec.jobLot.byHeight[''] ?? {}
  const d = (v: number | null | undefined) => { const c = cents(v); return c === undefined ? undefined : c / 100 }
  const sections: Record<string, number> = {}
  for (const [w, v] of Object.entries(p.sectionCents ?? {})) { const x = d(v); if (x !== undefined) sections[w] = x }
  const named = spec.jobLot.sectionItems?.[h]
  const sectionNames: Record<string, string> = {}
  for (const [w, item] of Object.entries(named ?? {})) {
    sectionNames[w] = item
    const c = price(item)
    if (typeof c === 'number' && c > 0) sections[w] = c
  }
  const leafWidth = spec.jobLot.leafWidth?.[h]
  const post = d(p.postCents)
  return {
    color: opt.label, supplier: spec.jobLot.supplier, quotedOn: spec.jobLot.quotedOn,
    width: s.autoRailMix ? 'auto' : sectionWidthForStyle(s.name, s.panelWidth), sections,
    corner: p.separatePosts ? d(p.cornerCents) : post, end: p.separatePosts ? d(p.endCents) : post,
    line: p.separatePosts ? d(p.lineCents) : post, blank: p.separatePosts ? d(p.gatePostCents) : post,
    walkGate: d(p.walkGateCents), dblGate: d(p.dblGateCents),
    covers: { section: spec.jobLot.covers.section ?? [], post: spec.jobLot.covers.post ?? [], walkGate: spec.jobLot.covers.walkGate ?? [], dblGate: spec.jobLot.covers.dblGate ?? [] },
    ...(named ? { sectionNames } : {}),
    ...(leafWidth ? { leafWidth } : {}),
    ...(spec.form ? { kit: true } : {}),
  }
}

// ── 8 ft tall vinyl: priced by the piece ─────────────────────────────────────

/**
 * 8 ft tall vinyl privacy, every color (White, Tan, a color made in
 * Settings), no dig and dig set (Jonathan, Oct 21, 2026): one price per
 * section and one per post, each style's own (FenceStyle.pieceCents, entered
 * in Settings → Price List → 8 ft tall vinyl). Like a job lot color: the
 * section price covers every part of a section kit (rails, mid rail, 4 ft
 * pickets, 4 ft U channels, rail inserts) and the post price every part of a
 * post kit (the 8 ft post, its cap, donuts and pipe or concrete), listed on
 * the pull sheet at $0. Gates are priced from their parts, as before. Until
 * both prices are in, the style is not available for quoting.
 */
export function isTallVinyl(sc: StyleChoices | null | undefined): boolean {
  return !!sc && sc.material === 'vinyl' && sc.choices.height === '8'
}

/** The piece prices an 8 ft tall style still needs ('section', 'post'). */
export function tallPricesMissing(s: Pick<FenceStyle, 'pieceCents'>): Array<'section' | 'post'> {
  const p = s.pieceCents ?? {}
  return (['section', 'post'] as const).filter(k => cents(p[k]) === undefined)
}

/** Why an 8 ft tall style is held back, in words. */
export function tallHeldReason(missing: Array<'section' | 'post'>): string {
  return `8 ft tall is priced by the piece: enter its ${missing.join(' and ')} price${missing.length === 1 ? '' : 's'} in Settings → Price List`
}

/** An 8 ft tall style's piece prices, in dollars, as a job lot the material kits price with. */
export function tallJobLot(s: FenceStyle, color: string): StyleJobLot {
  const p = s.pieceCents ?? {}
  const d = (v: number | null | undefined) => { const c = cents(v); return c === undefined ? undefined : c / 100 }
  const width = sectionWidthForStyle(s.name, s.panelWidth)
  const section = d(p.section), post = d(p.post)
  return {
    color, supplier: '', quotedOn: p.pricedOn ?? '', width, sections: section === undefined ? {} : { [String(width)]: section },
    // One price per post: corner, end and line. No blank post (a double gate's center) on 8 ft tall, as before.
    corner: post, end: post, line: post,
    covers: { section: [], post: [], walkGate: [], dblGate: [] }, coversAll: ['section', 'post'],
    tall: true, label: `8 ft tall ${color}`,
  }
}

/** Whether a kit of an 8 ft tall style is covered by its piece prices (section and post kits). */
const tallCovers = (sc: StyleChoices | null | undefined, kind: KitKind) => isTallVinyl(sc) && (PIECE_OF_KIT[kind] === 'section' || PIECE_OF_KIT[kind] === 'post')

export interface ColorStatus {
  ready: boolean
  /** Color parts with no Inventory price yet (priced by part). */
  unpricedParts: string[]
  /** Piece prices not entered yet (priced by piece), e.g. "6 ft tall: Section, 8 ft wide". */
  missingPieces: string[]
  /** Combinations with no material kit. */
  noKit: string[]
}

type PriceFn = (name: string) => number | undefined
type KitFn = (styleName: string) => KitSet | 'archived' | null

/** The color's own combinations (made in Settings) in a list of styles. */
export function stylesOfOption<S extends FenceStyle>(styles: S[], material: string, dim: string, key: string): S[] {
  return styles.filter(s => { const sc = styleChoicesOf(s); return !!sc && sc.material === material && sc.choices[dim] === key })
}

/** Whether a color made in Settings is fully priced: every color part priced in Inventory, or every piece price entered. */
export function colorStatus(styles: FenceStyle[], m: MaterialDef, opt: ChoiceOption, price: PriceFn = inventoryCost, kitOf: KitFn = n => kitSetFor(n)): ColorStatus {
  const dim = colorDimOf(m)!
  const mine = stylesOfOption(styles, m.key, dim.key, opt.key).filter(s => s.madeFrom)
  const out: ColorStatus = { ready: false, unpricedParts: [], missingPieces: [], noKit: [] }
  const spec = opt.color
  if (!spec) return { ...out, ready: true }
  if (spec.form) return formColorStatus(mine, spec, price, kitOf)
  const unpriced = new Set<string>()
  const heights = new Map<string, Set<string>>()
  for (const s of mine) {
    const set = kitOf(s.name)
    if (!set || set === 'archived') { out.noKit.push(s.name); continue }
    const sc = styleChoicesOf(s)
    for (const k of KIT_KINDS) for (const p of set.kits[k] ?? []) {
      // 8 ft tall: its own section and post prices cover those kits (and hold the style until they are in).
      if (tallCovers(sc, k)) continue
      if (isColorPart(p.part, spec.words) && !((price(p.part) ?? 0) > 0)) unpriced.add(p.part)
    }
    if (isTallVinyl(sc)) continue
    const h = sc!.choices.height ?? ''
    const ws = heights.get(h) ?? new Set<string>()
    for (const w of styleWidths(s)) ws.add(w)
    heights.set(h, ws)
  }
  out.unpricedParts = [...unpriced].sort()
  if (spec.pricing === 'piece') {
    const hLabel = (h: string) => (h ? `${optionOf(m, 'height', h)?.label ?? h} tall: ` : '')
    for (const [h, ws] of heights) {
      const p = spec.jobLot?.byHeight[h] ?? spec.jobLot?.byHeight[''] ?? {}
      for (const w of [...ws].sort()) if (cents(p.sectionCents?.[w]) === undefined) out.missingPieces.push(`${hLabel(h)}Section, ${w} ft wide`)
      if (p.separatePosts) {
        for (const [k, l] of [['cornerCents', 'Corner post'], ['endCents', 'End post'], ['lineCents', 'Line post'], ['gatePostCents', 'Gate post']] as const) if (cents(p[k]) === undefined) out.missingPieces.push(`${hLabel(h)}${l}`)
      } else if (cents(p.postCents) === undefined) out.missingPieces.push(`${hLabel(h)}Post`)
      if (cents(p.walkGateCents) === undefined) out.missingPieces.push(`${hLabel(h)}Walk gate`)
      if (cents(p.dblGateCents) === undefined) out.missingPieces.push(`${hLabel(h)}Double gate`)
    }
    if (!spec.jobLot?.supplier?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(spec.jobLot?.quotedOn ?? '')) out.missingPieces.push('Supplier and quote date')
  }
  out.ready = mine.length > 0 && out.noKit.length === 0 && (spec.pricing === 'piece' ? out.missingPieces.length === 0 : out.unpricedParts.length === 0)
  return out
}

/**
 * A color made by the Vinyl Colors form is ready when every catalog item the
 * form prices has an Inventory cost: each color part its fences use that a
 * section kit does not include (posts, caps, uprights; pickets, rails and U
 * trim per piece), and each section kit. Parts a section kit includes are $0
 * on purpose.
 */
function formColorStatus(mine: FenceStyle[], spec: ColorSpec, price: PriceFn, kitOf: KitFn): ColorStatus {
  const out: ColorStatus = { ready: false, unpricedParts: [], missingPieces: [], noKit: [] }
  const covered = new Map<PieceKey, Set<string>>()
  for (const [k, v] of Object.entries(spec.jobLot?.covers ?? {}) as Array<[PieceKey, string[]]>) covered.set(k, new Set((v ?? []).map(normalizeItemName)))
  const unpriced = new Set<string>()
  for (const s of mine) {
    if (s.isActive === false) continue
    const set = kitOf(s.name)
    if (!set || set === 'archived') { out.noKit.push(s.name); continue }
    const sc = styleChoicesOf(s)
    for (const k of KIT_KINDS) for (const p of set.kits[k] ?? []) {
      if (!isColorPart(p.part, spec.words)) continue
      // 8 ft tall: its own section and post prices cover those kits (and hold the style until they are in).
      if (tallCovers(sc, k)) continue
      const piece = PIECE_OF_KIT[k]
      if (piece && covered.get(piece)?.has(normalizeItemName(p.part))) continue
      if (!((price(p.part) ?? 0) > 0)) unpriced.add(p.part)
    }
    if (isTallVinyl(sc)) continue
    const h = sc?.choices.height ?? ''
    for (const w of styleWidths(s)) {
      const item = spec.jobLot?.sectionItems?.[h]?.[w]
      if (item && !((price(item) ?? 0) > 0)) out.missingPieces.push(item)
    }
  }
  out.unpricedParts = [...unpriced].sort()
  out.missingPieces = [...new Set(out.missingPieces)].sort()
  out.ready = mine.some(s => s.isActive !== false) && out.noKit.length === 0 && out.unpricedParts.length === 0 && out.missingPieces.length === 0
  return out
}

/**
 * Coverage problems on a job lot color. Coverage is kit by kit, so no part is
 * ever charged twice: a part is $0 in a section, post or gate whose price
 * includes it, and priced from Inventory anywhere else. Warned:
 *   - a part ticked under two piece prices where only one of them has it
 *     (the post cap ticked under Section too): the extra tick does nothing;
 *   - a color part in a section, post or gate whose price does not include
 *     it: it is priced from Inventory there.
 */
export function coverageWarnings(covers: Record<PieceKey, string[]>, kits: KitSet[], words: readonly string[]): string[] {
  const out: string[] = []
  const ticked = new Map<string, PieceKey[]>()
  for (const [piece, parts] of Object.entries(covers) as Array<[PieceKey, string[]]>) for (const p of parts ?? []) {
    const k = normalizeItemName(p); ticked.set(k, [...new Set([...(ticked.get(k) ?? []), piece])])
  }
  const names = new Map<string, string>()
  const has = new Map<string, Set<PieceKey>>()
  for (const set of kits) for (const kind of KIT_KINDS) for (const p of set.kits[kind] ?? []) {
    const k = normalizeItemName(p.part)
    names.set(k, p.part)
    const piece = PIECE_OF_KIT[kind]
    if (piece) has.set(k, new Set([...(has.get(k) ?? []), piece]))
  }
  const nice = (k: string) => (names.get(k) ?? k).replace(/^\*+/, '')
  for (const [k, pieces] of ticked) {
    if (pieces.length < 2) continue
    const real = pieces.filter(p => has.get(k)?.has(p))
    const idle = pieces.filter(p => !has.get(k)?.has(p))
    if (idle.length) out.push(`${nice(k)} is included in ${pieces.length} piece prices (${pieces.map(p => PIECE_LABEL[p]).join(' and ')}), but only the ${real.map(p => PIECE_LABEL[p].toLowerCase()).join(' and ') || 'no piece'} has it. It is charged once, in ${real.length ? `the ${real.map(p => PIECE_LABEL[p].toLowerCase()).join(' and ')} price` : 'no price'}; untick it under ${idle.map(p => PIECE_LABEL[p]).join(' and ')}.`)
  }
  const none = new Set<string>()
  for (const set of kits) for (const kind of KIT_KINDS) {
    const piece = PIECE_OF_KIT[kind]
    if (!piece) continue
    for (const p of set.kits[kind] ?? []) {
      if (!isColorPart(p.part, words)) continue
      if (!(ticked.get(normalizeItemName(p.part)) ?? []).includes(piece)) none.add(`${p.part.replace(/^\*+/, '')} (${KIT_LABEL[kind].toLowerCase()})`)
    }
  }
  if (none.size) out.push(`Not in any piece price, so priced from Inventory: ${[...none].join('; ')}.`)
  return out
}

// ── Resolving the styles (when Settings are read) ────────────────────────────

/** The parts of a style's material kits with no Inventory price yet (sorted, no repeats). */
export function partsWaitingForPrice(styleName: string, price: PriceFn = inventoryCost, kitOf: KitFn = n => kitSetFor(n)): string[] {
  const set = kitOf(styleName)
  if (!set || set === 'archived') return []
  const out = new Set<string>()
  for (const k of KIT_KINDS) for (const p of set.kits[k] ?? []) if (p.qty > 0 && !((price(p.part) ?? 0) > 0)) out.add(p.part)
  return [...out].sort()
}

/**
 * Each style with its material, choices and plain name, and, worked out on
 * every read (never typed): why it is held back from quoting by the tree
 * (a material, choice or color switched off, archived, or a color not fully
 * priced yet), its color's Target Profit % and job lot prices.
 */
export function resolveFenceStyles(styles: FenceStyle[], catalog: FenceCatalog, price: PriceFn = inventoryCost, kitOf: KitFn = n => kitSetFor(n)): FenceStyle[] {
  const next = new Map<string, string>()
  const statusCache = new Map<string, ColorStatus>()
  const out = styles.map(raw => {
    const s: FenceStyle = { ...raw }
    delete s.label; delete s.held; delete s.jobLot; delete s.colorTargetProfitPct; delete s.woodBase; delete s.woodFactor
    const sc = styleChoicesOf(s)
    const m = sc ? materialOf(catalog, sc.material) : undefined
    if (!sc || !m) { next.set(s.name, s.name); return s }
    if (!s.material) { s.material = sc.material; s.choices = { ...sc.choices } }
    s.label = plainName(catalog, sc) || s.name
    next.set(s.name, s.label)
    const why: string[] = []
    if (m.quotable === false) why.push(`${m.label} is turned off`)
    // An option that waits for prices (chain link Dig set): every part of the
    // style's kits priced, or it is held; this check covers its color parts too.
    const waits = s.madeFrom ? m.dims.map(d => optionOf(m, d.key, sc.choices[d.key])).find(x => x?.waitForPrices) : undefined
    if (waits) {
      const left = partsWaitingForPrice(s.name, price, kitOf)
      if (left.length) why.push(`${waits.label} is waiting for prices on ${left.length} part${left.length === 1 ? '' : 's'} in Inventory`)
    }
    for (const d of m.dims) {
      const opt = optionOf(m, d.key, sc.choices[d.key])
      if (!opt) continue
      if (opt.archived) why.push(`${opt.label} is archived`)
      else if (opt.quotable === false) why.push(`${opt.label} is turned off`)
      if (d.isColor && opt.color && !(waits && !opt.copiedFrom)) {
        if (typeof opt.color.targetProfitPct === 'number' && Number.isFinite(opt.color.targetProfitPct)) s.colorTargetProfitPct = opt.color.targetProfitPct
        if (s.madeFrom) {
          // 8 ft tall: priced by its own section and post prices (below), not the color's job lot.
          const lot = isTallVinyl(sc) ? undefined : jobLotFor(s, sc, opt, price)
          if (lot) s.jobLot = lot
          const key = `${m.key}:${opt.key}`
          if (!statusCache.has(key)) statusCache.set(key, colorStatus(styles, m, opt, price, kitOf))
          if (!statusCache.get(key)!.ready) why.push(`${opt.label} is not fully priced yet`)
        }
      }
    }
    if (s.madeFrom) {
      const set = kitOf(s.name)
      if (!set || set === 'archived') why.push('it has no material kit')
    }
    // 8 ft tall vinyl, every color: one price per section and one per post (Jonathan, Oct 21, 2026).
    if (isTallVinyl(sc)) {
      const dim = colorDimOf(m)
      s.jobLot = tallJobLot(s, (dim ? optionOf(m, dim.key, sc.choices[dim.key])?.label : undefined) ?? sc.choices.color ?? '')
      const missing = tallPricesMissing(s)
      if (missing.length) why.push(tallHeldReason(missing))
    }
    if (why.length) s.held = why.join('; ')
    return s
  })
  labels = next
  return out
}

/** Fields worked out on every read; not saved. */
export function stripDerived(styles: FenceStyle[]): FenceStyle[] {
  return styles.map(s => { const c: FenceStyle = { ...s }; delete c.label; delete c.held; delete c.jobLot; delete c.colorTargetProfitPct; delete c.woodBase; delete c.woodFactor; return c })
}

// ── The quote builder's picker ───────────────────────────────────────────────

export type OptionState = 'ok' | 'held' | 'none'

/**
 * For each choice in order, its options and whether each can be picked given
 * the choices before it: 'ok' (a style available for quoting exists), 'held'
 * (it exists but is not available for quoting) or 'none' (no such fence).
 */
export function pickerState<S extends FenceStyle>(styles: S[], catalog: FenceCatalog, material: string, sel: Record<string, string>, isOk: (s: S) => boolean): Array<{ dim: ChoiceDim; options: Array<{ opt: ChoiceOption; state: OptionState }> }> {
  const m = materialOf(catalog, material)
  if (!m) return []
  const mine = styles.map(s => ({ s, sc: styleChoicesOf(s) })).filter(x => x.sc?.material === material)
  return m.dims.map((dim, i) => {
    const before = m.dims.slice(0, i)
    const fits = mine.filter(x => before.every(d => !sel[d.key] || x.sc!.choices[d.key] === sel[d.key]))
    return {
      dim,
      options: dim.options.filter(opt => !opt.archived || sel[dim.key] === opt.key).map(opt => {
        const here = fits.filter(x => x.sc!.choices[dim.key] === opt.key)
        return { opt, state: (here.some(x => isOk(x.s)) ? 'ok' : here.length ? 'held' : 'none') as OptionState }
      }),
    }
  })
}

/** The style the choices name, if every choice is made. */
export function styleForChoices<S extends FenceStyle>(styles: S[], catalog: FenceCatalog, material: string, sel: Record<string, string>): S | undefined {
  const m = materialOf(catalog, material)
  if (!m || m.dims.some(d => !sel[d.key])) return undefined
  return styles.find(s => { const sc = styleChoicesOf(s); return sc?.material === material && m.dims.every(d => sc.choices[d.key] === sel[d.key]) })
}

// ── Changes made in Settings → Fence styles ──────────────────────────────────
// Each takes the saved Settings, Inventory items and material kits and returns
// them changed; the screen saves the three. Nothing here invents a part or a
// price: a new color's parts are its source color's parts with the color name
// swapped (quantities copied, prices left empty), a new height or style copies
// the parts of the one Jonathan picks.

export interface InvItem { id: string; name: string; unitCost: number; category?: string; unitOfMeasure?: string; status?: string; supplier?: string; madeFor?: string; [k: string]: unknown }
export interface CatalogState { fenceStyles: FenceStyle[]; fenceCatalog: FenceCatalog; items: InvItem[]; kits: KitSet[] }

export const slug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9+]+/g, '-').replace(/^-+|-+$/g, '') || 'new'
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const today = () => new Date().toISOString().slice(0, 10)
export const madeForTag = (material: string, dim: string, key: string) => `${material}:${dim}:${key}`

function uniqueKey(dim: ChoiceDim, label: string): string {
  const base = slug(label)
  let key = base, n = 2
  while (dim.options.some(x => x.key === key)) key = `${base}-${n++}`
  return key
}

/** The kit set a style prices with, saved or built in (a copy). */
function sourceKit(name: string, kits: KitSet[]): KitSet | null {
  const k = kitSetFor(name, kits)
  return k && k !== 'archived' && !k.mismatch ? clone(k) : null
}

export interface AddColorRequest {
  material: string
  /** Only copy combinations under this choice (Vinyl > Privacy: { dim: 'style', key: 'privacy' }). */
  under?: { dim: string; key: string }
  label: string
  copyFrom: string
  pricing: 'part' | 'piece'
  jobLot?: JobLotQuote
  overrides?: QtyOverride[]
  targetProfitPct?: number | null
}

/** The source color's combinations a new color copies. */
function sourcesFor(st: CatalogState, m: MaterialDef, dim: ChoiceDim, copyFrom: string, under?: { dim: string; key: string }): FenceStyle[] {
  return stylesOfOption(st.fenceStyles, m.key, dim.key, copyFrom)
    .filter(s => s.isActive !== false && (!under || styleChoicesOf(s)!.choices[under.dim] === under.key))
}

/** Which width a kit kind's sections are on a style ('any' for kits that are not sections). */
function kitWidth(s: FenceStyle, kind: KitKind): string {
  if (kind !== 'section' && kind !== 'section8') return 'any'
  if (s.autoRailMix) return kind === 'section8' ? '8' : '6'
  return String(sectionWidthForStyle(s.name, s.panelWidth))
}

export interface ColorPartRow { height: string; width: string; kit: KitKind; part: string; sourcePart: string; qty: number }

/** The new color's parts per kit (color parts only), with the source color's quantities: the overrides screen. */
export function previewColorParts(st: CatalogState, req: Pick<AddColorRequest, 'material' | 'under' | 'label' | 'copyFrom'>): ColorPartRow[] {
  const m = materialOf(st.fenceCatalog, req.material)
  const dim = colorDimOf(m)
  const src = optionOf(m, dim?.key ?? '', req.copyFrom)
  if (!m || !dim || !src?.color) return []
  const rows = new Map<string, ColorPartRow>()
  for (const s of sourcesFor(st, m, dim, req.copyFrom, req.under)) {
    const set = sourceKit(s.name, st.kits)
    if (!set) continue
    const h = styleChoicesOf(s)!.choices.height ?? ''
    for (const kind of KIT_KINDS) for (const p of set.kits[kind] ?? []) {
      if (!isColorPart(p.part, src.color.words)) continue
      const part = swapColor(p.part, src.color.words, req.label.trim())
      const width = kitWidth(s, kind)
      const kit: KitKind = kind === 'section8' ? 'section' : kind
      const key = `${h}|${width}|${kit}|${part}`
      if (!rows.has(key)) rows.set(key, { height: h, width, kit, part, sourcePart: p.part, qty: p.qty })
    }
  }
  return [...rows.values()]
}

/** Every part (color and shared) in the kits each piece price could cover, for the "What does each price include?" ticks. */
export function piecePartChoices(st: CatalogState, req: Pick<AddColorRequest, 'material' | 'under' | 'label' | 'copyFrom'>): Record<PieceKey, Array<{ part: string; color: boolean }>> {
  const out: Record<PieceKey, Map<string, boolean>> = { section: new Map(), post: new Map(), walkGate: new Map(), dblGate: new Map() }
  const m = materialOf(st.fenceCatalog, req.material)
  const dim = colorDimOf(m)
  const src = optionOf(m, dim?.key ?? '', req.copyFrom)
  if (m && dim && src?.color) {
    for (const s of sourcesFor(st, m, dim, req.copyFrom, req.under)) {
      const set = sourceKit(s.name, st.kits)
      if (!set) continue
      for (const kind of KIT_KINDS) {
        const piece = PIECE_OF_KIT[kind]
        if (!piece) continue
        for (const p of set.kits[kind] ?? []) {
          const isC = isColorPart(p.part, src.color.words)
          out[piece].set(isC ? swapColor(p.part, src.color.words, req.label.trim()) : p.part, isC)
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].map(([part, c]) => ({ part, color: c })).sort((a, b) => Number(b.color) - Number(a.color) || a.part.localeCompare(b.part))])) as Record<PieceKey, Array<{ part: string; color: boolean }>>
}

/** Default ticks: each piece covers the color parts in its own kits. */
export function defaultCovers(choices: Record<PieceKey, Array<{ part: string; color: boolean }>>): Record<PieceKey, string[]> {
  return Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v.filter(x => x.color).map(x => x.part)])) as Record<PieceKey, string[]>
}

/** The heights (option keys) and section widths a new color will come in. */
export function colorShape(st: CatalogState, req: Pick<AddColorRequest, 'material' | 'under' | 'copyFrom'>): Array<{ height: string; label: string; widths: string[] }> {
  const m = materialOf(st.fenceCatalog, req.material)
  const dim = colorDimOf(m)
  if (!m || !dim) return []
  const by = new Map<string, Set<string>>()
  for (const s of sourcesFor(st, m, dim, req.copyFrom, req.under)) {
    const h = styleChoicesOf(s)!.choices.height ?? ''
    const ws = by.get(h) ?? new Set<string>()
    for (const w of styleWidths(s)) ws.add(w)
    by.set(h, ws)
  }
  return [...by].map(([h, ws]) => ({ height: h, label: h ? (optionOf(m, 'height', h)?.label ?? h) : '', widths: [...ws].sort((a, b) => Number(a) - Number(b)) }))
    .sort((a, b) => parseFloat(a.height) - parseFloat(b.height))
}

function applyOverrides(set: KitSet, s: FenceStyle, overrides: QtyOverride[] | undefined, words: readonly string[]): void {
  if (!overrides?.length) return
  const h = styleChoicesOf(s)?.choices.height ?? ''
  for (const kind of KIT_KINDS) {
    const parts = set.kits[kind]
    if (!parts) continue
    const width = kitWidth(s, kind)
    const kit: KitKind = kind === 'section8' ? 'section' : kind
    set.kits[kind] = parts.map(p => {
      if (!isColorPart(p.part, words)) return p
      const ov = overrides.find(x => x.height === h && x.kit === kit && x.width === width && normalizeItemName(x.part) === normalizeItemName(p.part))
      return ov && Number.isFinite(ov.qty) && ov.qty >= 0 ? { ...p, qty: ov.qty } : p
    }).filter(p => p.qty > 0)
  }
}

export interface PlanResult { state: CatalogState; message: string; styles: string[]; items: string[] }

/** Add a color: its combinations, kit sets (color parts swapped, quantities copied) and Inventory items (no price). */
export function planAddColor(st0: CatalogState, req: AddColorRequest): PlanResult {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, req.material)
  const dim = colorDimOf(m)
  if (!m || !dim) throw new Error('This material has no colors to add to.')
  const label = req.label.trim()
  if (!label) throw new Error('Type the color name.')
  if (dim.options.some(x => !x.archived && x.label.trim().toLowerCase() === label.toLowerCase())) throw new Error(`There is already a color called ${label}.`)
  const src = optionOf(m, dim.key, req.copyFrom)
  if (!src?.color) throw new Error('Pick the color it copies its parts from.')
  const sources = sourcesFor(st, m, dim, req.copyFrom, req.under)
  if (!sources.length) throw new Error(`${src.label} has no fence to copy here.`)
  const key = uniqueKey(dim, label)
  const tag = madeForTag(m.key, dim.key, key)
  const words = [label]
  const opt: ChoiceOption = {
    key, label, copiedFrom: req.copyFrom,
    color: {
      words, copiedFrom: req.copyFrom, pricing: req.pricing, addedOn: today(),
      ...(req.pricing === 'piece' && req.jobLot ? { jobLot: req.jobLot } : {}),
      ...(req.overrides?.length ? { overrides: req.overrides } : {}),
      ...(typeof req.targetProfitPct === 'number' ? { targetProfitPct: req.targetProfitPct } : {}),
    },
  }
  dim.options.push(opt)
  const madeStyles: string[] = [], madeItems: string[] = []
  const have = new Set(st.items.map(i => normalizeItemName(i.name)))
  const byName = new Map(st.items.map(i => [normalizeItemName(i.name), i]))
  for (const s of sources) {
    const sc = styleChoicesOf(s)!
    const choices = { ...sc.choices, [dim.key]: key }
    const name = generatedName(m, choices)
    if (st.fenceStyles.some(x => x.name === name)) continue
    const n: FenceStyle = {
      id: uid('fs'), name, category: s.category, margin: s.margin, targetProfitPct: s.targetProfitPct,
      sectionsPerMH: s.sectionsPerMH, panelWidth: sectionWidthForStyle(s.name, s.panelWidth), mhPerWalkGate: s.mhPerWalkGate, mhPerDblGate: s.mhPerDblGate,
      isActive: true, ...(s.quotable === false ? { quotable: false } : {}),
      ...(s.subRate !== undefined ? { subRate: s.subRate } : {}), ...(s.pricePerFoot !== undefined ? { pricePerFoot: s.pricePerFoot } : {}),
      ...(s.autoRailMix ? { autoRailMix: true, installMethod: s.installMethod, colorFamily: s.colorFamily, kitKey: name } : {}),
      material: m.key, choices, madeFrom: s.name,
    }
    st.fenceStyles.push(n)
    madeStyles.push(name)
    const set = sourceKit(s.name, st.kits)
    if (!set) continue
    const kits: KitSet['kits'] = {}
    for (const kind of KIT_KINDS) {
      const parts = set.kits[kind]
      if (!parts) continue
      kits[kind] = parts.map((p: KitPart) => {
        if (!isColorPart(p.part, src.color!.words)) return { ...p }
        const part = swapColor(p.part, src.color!.words, label)
        if (!have.has(normalizeItemName(part))) {
          const from = byName.get(normalizeItemName(p.part))
          const item: InvItem = { id: uid('inv'), name: part, unitCost: 0, category: from?.category ?? m.label, ...(from?.unitOfMeasure ? { unitOfMeasure: from.unitOfMeasure } : {}), status: 'active', madeFor: tag }
          st.items.push(item); have.add(normalizeItemName(part)); madeItems.push(part)
        }
        return { part, qty: p.qty, fallbackCost: 0 }
      })
    }
    const out: KitSet = { id: uid('kit'), name, styleName: name, kits, roundUp: set.roundUp.map(p => (isColorPart(p, src.color!.words) ? swapColor(p, src.color!.words, label) : p)), updatedAt: new Date().toISOString(), madeFor: tag }
    applyOverrides(out, n, req.overrides, words)
    st.kits.push(out)
  }
  return { state: st, styles: madeStyles, items: madeItems, message: `${label} added: ${madeStyles.length} combination${madeStyles.length === 1 ? '' : 's'}, ${madeItems.length} new part${madeItems.length === 1 ? '' : 's'} in Inventory with no price. It is not available for quoting until it is fully priced.` }
}

export interface UpdateOptionPatch {
  label?: string
  nameText?: string
  quotable?: boolean
  archived?: boolean
  pricing?: 'part' | 'piece'
  jobLot?: JobLotQuote
  overrides?: QtyOverride[]
  targetProfitPct?: number | null
  readyOn?: string
}

/** Rename, pause, archive or reprice a choice (a color, height, style, ...). Overrides are applied to the color's own kits. */
export function planUpdateOption(st0: CatalogState, material: string, dimKey: string, key: string, patch: UpdateOptionPatch): CatalogState {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, material)
  const opt = optionOf(m, dimKey, key)
  if (!m || !opt) throw new Error('That choice is not in Settings any more.')
  if (patch.label !== undefined) {
    const l = patch.label.trim()
    if (!l) throw new Error('A choice needs a name.')
    opt.label = l
  }
  if (patch.nameText !== undefined) { if (patch.nameText.trim()) opt.nameText = patch.nameText.trim(); else delete opt.nameText }
  if (patch.quotable !== undefined) { if (patch.quotable) delete opt.quotable; else opt.quotable = false }
  if (patch.archived !== undefined) { if (patch.archived) opt.archived = true; else delete opt.archived }
  if (opt.color) {
    if (patch.pricing) opt.color.pricing = patch.pricing
    if (patch.jobLot) opt.color.jobLot = patch.jobLot
    if (patch.targetProfitPct !== undefined) { if (typeof patch.targetProfitPct === 'number' && Number.isFinite(patch.targetProfitPct)) opt.color.targetProfitPct = patch.targetProfitPct; else delete opt.color.targetProfitPct }
    if (patch.readyOn) opt.color.readyOn = patch.readyOn
    if (patch.overrides) {
      opt.color.overrides = patch.overrides
      for (const s of stylesOfOption(st.fenceStyles, material, dimKey, key)) {
        const set = st.kits.find(k => k.styleName === s.name && !k.archived)
        if (set) applyOverrides(set, s, patch.overrides, opt.color.words)
      }
    }
  }
  return st
}

/** Where a choice is used by saved work: the internal names of its combinations that quotes or jobs carry. */
export function optionStyles(st: Pick<CatalogState, 'fenceStyles'>, material: string, dimKey: string, key: string): string[] {
  return stylesOfOption(st.fenceStyles, material, dimKey, key).map(s => s.name)
}

/**
 * Remove a choice added in Settings and everything made for it: its
 * combinations, their kit sets and the Inventory items made for it (an item
 * another kit still uses stays). Refused when a saved quote or job uses one of
 * its combinations: archive it instead.
 */
export function planRemoveOption(st0: CatalogState, material: string, dimKey: string, key: string, inUse: ReadonlySet<string>): PlanResult {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, material)
  const dim = m?.dims.find(d => d.key === dimKey)
  const opt = dim?.options.find(x => x.key === key)
  if (!m || !dim || !opt) throw new Error('That choice is not in Settings any more.')
  const names = optionStyles(st, material, dimKey, key)
  if (names.some(n => !st.fenceStyles.find(s => s.name === n)?.madeFrom)) throw new Error(`${opt.label} came with the app and is used by its own styles; turn it off or archive it instead.`)
  const used = names.filter(n => inUse.has(n))
  if (used.length) throw new Error(`${opt.label} is on saved quotes or jobs, so it cannot be removed. Archive it instead: those keep working.`)
  const tag = madeForTag(material, dimKey, key)
  st.fenceStyles = st.fenceStyles.filter(s => !names.includes(s.name))
  st.kits = st.kits.filter(k => !(k.styleName && names.includes(k.styleName)) && k.madeFor !== tag)
  const stillUsed = new Set<string>()
  for (const k of st.kits) for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) stillUsed.add(normalizeItemName(p.part))
  const gone = st.items.filter(i => i.madeFor === tag && !stillUsed.has(normalizeItemName(i.name))).map(i => i.name)
  st.items = st.items.filter(i => !(i.madeFor === tag && !stillUsed.has(normalizeItemName(i.name))))
  dim.options = dim.options.filter(x => x.key !== key)
  return { state: st, styles: names, items: gone, message: `${opt.label} removed, with ${names.length} combination${names.length === 1 ? '' : 's'} and ${gone.length} part${gone.length === 1 ? '' : 's'} made for it.` }
}

export interface AddChoiceRequest {
  material: string
  dim: string
  label: string
  /** How it reads in the plain name ("7 ft", "10 ft panels"). */
  nameText?: string
  /** Copy the combinations, and their parts, of this option. */
  copyFrom: string
  under?: { dim: string; key: string }
}

/**
 * Add a choice that is not a color (a height, a vinyl style such as Semi
 * privacy, a panel width, an aluminum panel style, a product): new
 * combinations copying the ones of the option picked, with the same parts.
 * It starts turned off: check its parts in Inventory > Material Kits, then
 * switch it on.
 */
export function planAddChoice(st0: CatalogState, req: AddChoiceRequest): PlanResult {
  const st = clone(st0)
  const m = materialOf(st.fenceCatalog, req.material)
  const dim = m?.dims.find(d => d.key === req.dim)
  if (!m || !dim) throw new Error('Pick where the choice goes.')
  if (dim.isColor) throw new Error('Use Add color for a color.')
  const label = req.label.trim()
  if (!label) throw new Error('Type the name of the choice.')
  if (dim.options.some(x => !x.archived && x.label.trim().toLowerCase() === label.toLowerCase())) throw new Error(`There is already a ${dim.label.toLowerCase()} called ${label}.`)
  const width = req.dim === 'width' ? parseFloat(label) : NaN
  if (req.dim === 'width' && !(width > 0)) throw new Error('A panel width is a number of feet, like 7 ft.')
  const key = uniqueKey(dim, label)
  const tag = madeForTag(m.key, dim.key, key)
  dim.options.push({ key, label, ...(req.nameText?.trim() && req.nameText.trim() !== label ? { nameText: req.nameText.trim() } : {}), quotable: false, copiedFrom: req.copyFrom })
  const sources = stylesOfOption(st.fenceStyles, m.key, dim.key, req.copyFrom).filter(s => s.isActive !== false && (!req.under || styleChoicesOf(s)!.choices[req.under.dim] === req.under.key) && !(req.dim === 'width' && s.autoRailMix))
  const made: string[] = []
  for (const s of sources) {
    const sc = styleChoicesOf(s)!
    const choices = { ...sc.choices, [dim.key]: key }
    const name = generatedName(m, choices)
    if (st.fenceStyles.some(x => x.name === name)) continue
    st.fenceStyles.push({
      id: uid('fs'), name, category: s.category, margin: s.margin, targetProfitPct: s.targetProfitPct, sectionsPerMH: s.sectionsPerMH,
      panelWidth: req.dim === 'width' ? width : sectionWidthForStyle(s.name, s.panelWidth), mhPerWalkGate: s.mhPerWalkGate, mhPerDblGate: s.mhPerDblGate,
      isActive: true, ...(s.quotable === false ? { quotable: false } : {}),
      ...(s.subRate !== undefined ? { subRate: s.subRate } : {}), ...(s.pricePerFoot !== undefined ? { pricePerFoot: s.pricePerFoot } : {}),
      ...(s.autoRailMix ? { autoRailMix: true, installMethod: s.installMethod, colorFamily: s.colorFamily, kitKey: name } : {}),
      material: m.key, choices, madeFrom: s.name,
    })
    made.push(name)
    const set = sourceKit(s.name, st.kits)
    if (set) st.kits.push({ ...set, id: uid('kit'), name, styleName: name, builtIn: undefined, mismatch: undefined, archived: undefined, updatedAt: new Date().toISOString(), madeFor: tag })
  }
  return { state: st, styles: made, items: [], message: made.length
    ? `${label} added with ${made.length} combination${made.length === 1 ? '' : 's'}, copying the parts of ${optionOf(m, dim.key, req.copyFrom)?.label ?? req.copyFrom}. It is turned off: check its parts in Inventory > Material Kits, then switch it on.`
    : `${label} added. No fence was copied, so there is nothing to quote yet.` }
}
