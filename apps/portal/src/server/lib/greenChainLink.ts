/**
 * Green vinyl coated chain link, 4 ft, residential (Jonathan, Oct 26 2026):
 * "Use these prices as quoted (PP20 posts) to make green chain link quotable:
 * copy the black chain link setup and kits, swap in the green parts from this
 * quote" (Stephens Pipe & Steel quotation 06-251707).
 *
 * Made the way Settings → Fence styles → Chain link → Finish → Add color makes
 * a color (web/src/fenceCatalog.ts planAddColor): "Green", copying Black, 4 ft
 * only. That gives a Green twin of each 4 ft black style (No dig and Dig set,
 * the same install methods, labor and profit), kit sets that are the black
 * kits with every Black / Blk part swapped for a Green one (same quantities),
 * and those Green parts in Inventory with no price. Then:
 *   - each green part is named for what 06-251707 sells where the quote says
 *     something else than the black part's name (PP20 posts, 2-1/2" bands,
 *     hinge and dome cap, the .055 gate, a 30" drop rod, steel hog rings);
 *   - the bolts are the galvanized "G, Bolt" items (06-251707 sells plain
 *     BOLT/NUT, no color), not new green ones;
 *   - the new parts are in Chainlink Green, supplier Stephens for the ones
 *     the quote prices;
 *   - Green is switched off for quoting (the Finish option's switch in
 *     Settings → Fence styles), never on.
 * Quantities are the black kits' own; nothing here is a new fence rule.
 * Prices come only from ordering 06-251707 through Inventory > Invoices
 * (lib/vendorInvoices: landed cost, estimated tax, freight spread, no fuel).
 */

export const GREEN_KEY = 'migration:green-chain-link-2026-10-26'
export const GREEN_LABEL = 'Green'
export const STEPHENS = 'Stephens Pipe & Steel, LLC'

/** How one 06-251707 line is matched: the Inventory item (by its final name) and the unit. */
export interface GreenLine {
  /** The line as printed on 06-251707. */
  description: string
  /** The Inventory item it prices (its name after the swap and rename). */
  part: string
  /** The green part's name as the Add color swap makes it, when the quote's part reads differently. */
  swappedFrom?: string
  /** An item that is already in Inventory (color neutral), used instead of a new green one. */
  existing?: boolean
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
  { description: 'BOLT/NUT 5/16x1-1/4in', part: 'G, Bolt, 5/16 x 1-1/4" w/ Nut', swappedFrom: 'Green, Bolt, 5/16 x 1-1/4" w/ Nut', existing: true, vendorPer: 1, invPer: 1, unitWords: 'each', note: 'plain bolt (no color printed): the galvanized bolt item' },
  { description: 'BOLT/NUT 3/8x2in', part: 'G, Bolt, 3/8" x 2" w/ Nut', swappedFrom: 'Green, Bolt, 3/8" x 2" w/ Nut', existing: true, vendorPer: 1, invPer: 1, unitWords: 'each', note: 'plain bolt (no color printed): the galvanized bolt item' },
  { description: 'BOLT/NUT 3/8x3in', part: 'G, Bolt, 3/8" x 3" w/ Nut', swappedFrom: 'Green, Bolt, 3/8" x 3" w/ Nut', existing: true, vendorPer: 1, invPer: 1, unitWords: 'each', note: 'plain bolt (no color printed): the galvanized bolt item' },
  { description: 'GRN VNL ALUM TIE 9gax6-1/2in', part: 'Chainlink, Green, Hardware, Hook Ties, 6-1/2" x 9ga, AL (100)', vendorPer: 100, invPer: 1, unitWords: '100 each = 1 box' },
  { description: 'GRN PLY RES DROP ROD 3/8x30in', part: 'Drop Rod, 30", Green', swappedFrom: 'Drop Rod, 24", Green', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY DROP FORK 1-3/8in', part: 'Green, Fork, PS, 1-3/8"', vendorPer: 1, invPer: 1, unitWords: 'each' },
  { description: 'GRN PLY COLLAR 1-3/8in', part: 'Green, Collar, PS, 1-3/8" (Set of 2)', vendorPer: 1, invPer: 1, unitWords: '1 set = 1 set of 2' },
  { description: "ENS DOM VNL TENS WIRE 9ga SMOOTH (1000')", part: 'Green, Wire, Tension, 9GA', vendorPer: 1, invPer: 1000, unitWords: '1 roll = 1000 ft (the kit counts feet)', note: 'vinyl coated; the quote does not print its color' },
  { description: 'GRN VNL STEEL HOG RING (140/#)', part: 'Green, Hog Ring, 9GA, Steel', swappedFrom: 'Green, Hog Ring, 9GA, Alum', vendorPer: 1, invPer: 140, unitWords: '1 lb = 140 each' },
]

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** The 06-251707 line rule for a printed description (exact, spacing ignored). */
export function greenLineFor(description: string): GreenLine | null {
  return GREEN_LINES.find(g => norm(g.description) === norm(description)) ?? null
}

export interface GreenState { fenceStyles: any[]; fenceCatalog: any; items: any[]; kits: any[] }

export interface GreenPlan {
  state: GreenState
  /** False when Green was already made (nothing to do). */
  made: boolean
  styles: Array<{ name: string; madeFrom: string; install: string }>
  kits: string[]
  /** New Inventory items (no price yet), by final name. */
  items: string[]
  /** Green kit parts with no line on 06-251707: they stay with no price, so Green is not fully priced. */
  noGreen: Array<{ part: string; kits: string[] }>
  /** Kit parts renamed for what the quote sells. */
  renamed: Array<{ from: string; to: string }>
  message: string
}

interface PlanModule {
  planAddColor(st: GreenState, req: unknown): { state: GreenState; styles: string[]; items: string[]; message: string }
  planUpdateOption(st: GreenState, material: string, dim: string, key: string, patch: unknown): GreenState
}

const greenOption = (cat: any) => arr(arr(cat?.materials).find((m: any) => m?.key === 'chain')?.dims).find((d: any) => d?.key === 'finish')?.options?.find((o: any) => String(o?.label ?? '').trim().toLowerCase() === GREEN_LABEL.toLowerCase() && !o.archived) ?? null

/** Green chain link (4 ft, residential, No dig and Dig set) as Add color makes it, with 06-251707's parts, switched off. */
export function planGreenChainLink(m: PlanModule, st0: GreenState): GreenPlan {
  const existing = greenOption(st0.fenceCatalog)
  if (existing) {
    const names = st0.fenceStyles.filter(s => s?.material === 'chain' && s?.choices?.finish === existing.key).map(s => s.name)
    return { state: st0, made: false, styles: names.map(n => ({ name: n, madeFrom: '', install: '' })), kits: [], items: [], noGreen: [], renamed: [], message: `Green chain link is already in Settings (${names.join(', ') || 'no fences'}): nothing made.` }
  }
  const added = m.planAddColor(clone(st0), { material: 'chain', under: { dim: 'height', key: '4' }, label: GREEN_LABEL, copyFrom: 'black', pricing: 'part' })
  const opt = greenOption(added.state.fenceCatalog)
  if (!opt) throw new Error('Add color did not make Green.')
  const st = m.planUpdateOption(added.state, 'chain', 'finish', opt.key, { quotable: false })
  const made = new Set(added.styles)
  const tag = `chain:finish:${opt.key}`

  // Kit parts: the quote's own part where it reads differently; the bolts are the galvanized ones.
  const rename = new Map<string, string>()
  for (const g of GREEN_LINES) if (g.swappedFrom) rename.set(norm(g.swappedFrom), g.part)
  const renamed = new Map<string, string>()
  for (const k of st.kits) {
    if (!made.has(k.styleName)) continue
    for (const kind of Object.keys(k.kits ?? {})) {
      k.kits[kind] = arr(k.kits[kind]).map((p: any) => {
        const to = rename.get(norm(p.part))
        if (!to) return p
        renamed.set(p.part.trim(), to)
        return { ...p, part: to }
      })
    }
    k.roundUp = arr(k.roundUp).map((p: string) => rename.get(norm(p)) ?? p)
  }
  // Inventory: the new items renamed the same way; one replaced by an existing item goes; Chainlink Green, Stephens.
  const byFinal = new Map(GREEN_LINES.map(g => [norm(g.part), g]))
  const existingNames = new Set(GREEN_LINES.filter(g => g.existing).map(g => norm(g.part)))
  for (const name of existingNames) if (!st.items.some(i => norm(String(i?.name ?? '')) === name && i?.madeFor !== tag)) throw new Error(`Inventory has no "${GREEN_LINES.find(g => norm(g.part) === name)!.part}" for the bolts.`)
  const items: string[] = []
  st.items = st.items.flatMap((i: any) => {
    if (i?.madeFor !== tag) return [i]
    const to = rename.get(norm(String(i.name)))
    if (to && existingNames.has(norm(to))) return []
    const name = to ?? String(i.name)
    items.push(name)
    const priced = byFinal.has(norm(name))
    return [{ ...i, name, category: 'Chainlink Green', ...(priced ? { supplier: STEPHENS } : {}) }]
  })

  // Parts no 06-251707 line prices.
  const priced = new Set(GREEN_LINES.map(g => norm(g.part)))
  const left = new Map<string, Set<string>>()
  for (const k of st.kits) {
    if (!made.has(k.styleName)) continue
    for (const [kind, parts] of Object.entries(k.kits ?? {})) for (const p of arr(parts)) {
      const isNew = st.items.some((i: any) => i?.madeFor === tag && norm(String(i.name)) === norm(p.part))
      if (isNew && !priced.has(norm(p.part))) left.set(p.part, new Set([...(left.get(p.part) ?? []), `${k.styleName} ${kind}`]))
    }
  }
  const styles = st.fenceStyles.filter((s: any) => made.has(s.name)).map((s: any) => ({ name: s.name, madeFrom: s.madeFrom, install: s.choices?.install }))
  return {
    state: st, made: true, styles, kits: st.kits.filter((k: any) => made.has(k.styleName)).map((k: any) => k.name), items,
    noGreen: [...left].map(([part, kits]) => ({ part, kits: [...kits] })).sort((a, b) => a.part.localeCompare(b.part)),
    renamed: [...renamed].map(([from, to]) => ({ from, to })),
    message: `Green chain link: ${styles.length} fences (${styles.map((s: any) => s.name).join(', ')}), switched off for quoting; ${items.length} new parts in Inventory.`,
  }
}
