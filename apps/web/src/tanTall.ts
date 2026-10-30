/**
 * Tan 8 ft tall vinyl privacy (Jonathan, Oct 29, 2026: "OK Tan 8 ft."): the
 * four Tan styles TV-ND / TV-DS 8'x6' and 8'x8', defined as the four White 8
 * ft styles are (same fields, choices, heights and widths). Their parts lists
 * are the materialCalculator's 8 ft tall lists (WV/TV); like every 8 ft tall
 * fence they are priced by the piece (FenceStyle.pieceCents, Settings → Price
 * List → 8 ft tall vinyl) and held from quoting until Jonathan types their
 * section and post costs. No price is copied: not White's, not Inventory's.
 *
 * planTanTall adds the ones a company's saved Settings do not have, with the
 * man hours, Target Profit %, margin and availability of that company's own
 * matching White 8 ft style (the defaults when that White style is gone).
 * Nothing else changes. Pure; the server runs it once per company
 * (portal lib/tanTallSeed.ts).
 */

import type { FenceStyle } from './configStore'
import { DEFAULT_FENCE_STYLES } from './configDefaults'
import type { InvItem } from './fenceCatalog'
import type { KitSet } from './materialKits'
import { planTallVinylParts } from './tallVinylParts'

/** Each Tan 8 ft style and the White 8 ft style it mirrors, in Settings order. */
export const TAN_TALL: ReadonlyArray<readonly [tan: string, white: string]> = [
  ["TV-ND 8'x6' Privacy", "WV-ND 8'x6' Privacy"],
  ["TV-ND 8'x8' Privacy", "WV-ND 8'x8' Privacy"],
  ["TV-DS 8'x6' Privacy", "WV-DS 8'x6' Privacy"],
  ["TV-DS 8'x8' Privacy", "WV-DS 8'x8' Privacy"],
]

export interface TanTallPlan {
  fenceStyles: FenceStyle[]
  /** The styles added (none: all already there). */
  added: string[]
  /** For each style added, the style its settings were copied from ("defaults" when the White one is gone). */
  copiedFrom: Record<string, string>
}

/** "TV-ND 8'x6' Privacy" → its saved choices, as the White 8 ft styles carry them. */
function choicesOf(name: string): Record<string, string> {
  const m = name.match(/^TV-(ND|DS) 8'x([68])'/)!
  return { color: 'tan', style: 'privacy', width: m[2], height: '8', install: m[1] === 'ND' ? 'nd' : 'ds' }
}

export function planTanTall(styles0: FenceStyle[]): TanTallPlan {
  const styles: FenceStyle[] = JSON.parse(JSON.stringify(styles0))
  const added: string[] = []
  const copiedFrom: Record<string, string> = {}
  const made: FenceStyle[] = []
  const ids = new Set(styles.map(s => s.id))
  for (const [tan, white] of TAN_TALL) {
    if (styles.some(s => s.name === tan)) continue
    const saved = styles.find(s => s.name === white)
    const src = saved ?? DEFAULT_FENCE_STYLES.find(s => s.name === tan)!
    const def = DEFAULT_FENCE_STYLES.find(s => s.name === tan)!
    let id = def.id
    if (ids.has(id)) id = `${def.id}-${Date.now().toString(36)}`
    ids.add(id)
    made.push({
      id, name: tan, category: src.category, margin: src.margin,
      ...(typeof src.targetProfitPct === 'number' ? { targetProfitPct: src.targetProfitPct } : {}),
      sectionsPerMH: src.sectionsPerMH, panelWidth: def.panelWidth, mhPerWalkGate: src.mhPerWalkGate, mhPerDblGate: src.mhPerDblGate,
      isActive: src.isActive !== false, ...(src.quotable === false ? { quotable: false } : {}),
      material: 'vinyl', choices: choicesOf(tan),
    })
    added.push(tan)
    copiedFrom[tan] = saved ? white : 'defaults'
  }
  if (!made.length) return { fenceStyles: styles, added, copiedFrom }
  // After the other Tan locked width styles (TV-DS 6'x8'), else after the White 8 ft ones, else at the end.
  const lastIdx = (f: (s: FenceStyle) => boolean) => styles.reduce((at, s, i) => (f(s) ? i : at), -1)
  let at = lastIdx(s => /^TV-(ND|DS) \d/.test(s.name))
  if (at < 0) at = lastIdx(s => /^WV-(ND|DS) 8'x/.test(s.name))
  if (at < 0) at = styles.length - 1
  styles.splice(at + 1, 0, ...made)
  return { fenceStyles: styles, added, copiedFrom }
}

/**
 * The Tan 8 ft section parts Inventory has no item for, made at $0 and
 * included in the section price, for the styles just added (as the White ones
 * were, tallVinylParts.ts): only the 4 ft pickets, 4 ft U channels and mid
 * rails, parts only an 8 ft tall section uses. A rail or rail insert is never
 * made at $0 here: 6 ft fences price them from Inventory.
 */
export function planTanTallParts(state: { fenceStyles: FenceStyle[]; items: InvItem[]; kits: KitSet[] }, added: string[]): { items: InvItem[]; added: string[] } {
  const p = planTallVinylParts({ fenceStyles: state.fenceStyles.filter(s => added.includes(s.name)), items: state.items, kits: state.kits })
  const tallOnly = (name: string) => /, Mid Rail, \d+'$|, Picket, 4'$|, U Channel, 4'$/.test(name)
  const keep = new Set(p.added.filter(tallOnly))
  const before = new Set(state.items.map(i => i.id))
  return { items: p.items.filter(i => before.has(i.id) || keep.has(i.name)), added: p.added.filter(tallOnly) }
}
