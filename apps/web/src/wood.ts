/**
 * Wood privacy fence (Jonathan, Oct 2026, standing rule): wood is always
 * priced from the matching White Vinyl 6 ft privacy style, its material AND
 * its labor times the Wood factor (Settings → Moves and Repairs, default
 * 115%). That holds for new fences, moves and repairs. There is no separate
 * wood parts pricing and no separate "wood picket" style: wood privacy is built
 * with pickets.
 *
 *   Wood Privacy, 6 ft tall, 6 ft panels, No dig  ←  WV-ND 6'x6' Privacy
 *   Wood Privacy, 6 ft tall, 8 ft panels, No dig  ←  WV-ND 6'x8' Privacy
 *   Wood Privacy, 6 ft tall, 6 ft panels, Dig set ←  WV-DS 6'x6' Privacy
 *   Wood Privacy, 6 ft tall, 8 ft panels, Dig set ←  WV-DS 6'x8' Privacy
 *
 * The pull sheet and the crew packet still name the wood parts (pickets,
 * rails, posts ...) from the wood style's own material kit so the crew knows
 * what to load; their cost is never used. The wood kit starts as the matching
 * vinyl kit with each white vinyl part renamed to a wood part (quantities
 * copied; setting material and gate hardware kept), and the wood parts are
 * added to Inventory named but unpriced. Jonathan checks them in Inventory >
 * Material Kits.
 *
 * Pure: the server's seed (lib/woodSeed.ts) runs planWood through the
 * estimate bundle.
 */

import type { FenceStyle } from './configStore'
import { normalizeItemName } from './materialCalculator'
import { kitSetFor, KIT_KINDS, type KitSet } from './materialKits'
import type { FenceCatalog, MaterialDef } from './fenceCatalog'

export const DEFAULT_WOOD_FACTOR_PCT = 115

/** Wood style internal name → the White Vinyl 6 ft privacy style it is priced from. */
export const WOOD_OF: Record<string, string> = {
  'wood/privacy/6/nd/6': "WV-ND 6'x6' Privacy",
  'wood/privacy/6/nd/8': "WV-ND 6'x8' Privacy",
  'wood/privacy/6/ds/6': "WV-DS 6'x6' Privacy",
  'wood/privacy/6/ds/8': "WV-DS 6'x8' Privacy",
}

/** The wood material in the choice tree (Settings → Fence styles). */
export const WOOD_MATERIAL: MaterialDef = {
  key: 'wood', label: 'Wood', category: 'Wood',
  nameTemplate: 'Wood {style}, {height} tall, {width}, {install}',
  dims: [
    { key: 'style', label: 'Style', options: [{ key: 'privacy', label: 'Privacy' }] },
    { key: 'height', label: 'Height', options: [{ key: '6', label: '6 ft' }] },
    { key: 'install', label: 'Install', options: [{ key: 'nd', label: 'No dig' }, { key: 'ds', label: 'Dig set' }] },
    { key: 'width', label: 'Panel width', options: [{ key: '6', label: '6 ft', nameText: '6 ft panels' }, { key: '8', label: '8 ft', nameText: '8 ft panels' }] },
  ],
}

/** The Wood factor as a multiplier (1.15), from Settings; 115% when blank or not a sensible number. */
export function woodFactorOf(cfg: { moveRepair?: { woodFactorPct?: number | null } | null } | null | undefined): number {
  const p = cfg?.moveRepair?.woodFactorPct
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p / 100 : DEFAULT_WOOD_FACTOR_PCT / 100
}

/** "*Vinyl, White, Picket, 62-1/4"" → "Wood, Picket, 62-1/4""; a part that is not white vinyl (setting material, gate hardware, screws) stays as it is. */
export function woodPartName(part: string): string {
  const segs = part.split(',').map(s => s.trim())
  const isVinyl = (s: string) => /^\**vinyl$/i.test(s) || /^v$/i.test(s)
  const isWhite = (s: string) => /^(white|w)$/i.test(s)
  if (!segs.some(isWhite)) return part
  const rest = segs.filter(s => !isVinyl(s) && !isWhite(s) && s !== '')
  return ['Wood', ...rest].join(', ')
}

/** The wood kit made from a vinyl kit: white vinyl parts renamed to wood, quantities kept. */
export function woodKitFrom(vinyl: KitSet, woodName: string, now = new Date().toISOString()): KitSet {
  const kits: KitSet['kits'] = {}
  for (const k of KIT_KINDS) {
    const parts = vinyl.kits[k]
    if (!parts?.length) continue
    const merged = new Map<string, number>()
    for (const p of parts) { const n = woodPartName(p.part); merged.set(n, (merged.get(n) ?? 0) + p.qty) }
    kits[k] = [...merged].map(([part, qty]) => ({ part, qty, fallbackCost: 0 }))
  }
  return {
    id: `kit_wood_${woodName.replace(/[^a-z0-9]+/gi, '_')}`, name: woodName, styleName: woodName, kits,
    roundUp: vinyl.roundUp.map(woodPartName), updatedAt: now, madeFor: 'wood',
  }
}

export interface WoodState {
  fenceStyles: FenceStyle[]
  /** The saved choice tree, when Jonathan has one saved (missing: the default tree, which already has wood). */
  fenceCatalog?: FenceCatalog | null
  items: Array<{ id: string; name: string; unitCost: number; [k: string]: unknown }>
  kits: KitSet[]
}

export interface WoodPlan { state: WoodState; styles: string[]; items: string[]; kits: string[]; catalog: boolean }

/**
 * Add wood to saved Settings and Inventory: the four wood styles (copying the
 * matching vinyl style's Target Profit % and man hour rates), the wood
 * material in a saved choice tree, a wood kit per style, and each wood part
 * in Inventory at no price. Anything already there is left alone, so running
 * it twice changes nothing the second time.
 */
export function planWood(st0: WoodState): WoodPlan {
  const st: WoodState = JSON.parse(JSON.stringify(st0))
  const out: WoodPlan = { state: st, styles: [], items: [], kits: [], catalog: false }
  if (st.fenceCatalog && Array.isArray(st.fenceCatalog.materials) && !st.fenceCatalog.materials.some(m => m.key === 'wood')) {
    st.fenceCatalog.materials.push(JSON.parse(JSON.stringify(WOOD_MATERIAL)))
    out.catalog = true
  }
  const have = new Set(st.items.map(i => normalizeItemName(i.name)))
  for (const [name, vinylName] of Object.entries(WOOD_OF)) {
    const vinyl = st.fenceStyles.find(s => s.name === vinylName)
    if (!vinyl) continue
    const [, , height, install, width] = name.split('/')
    if (!st.fenceStyles.some(s => s.name === name)) {
      st.fenceStyles.push({
        id: `fs_${name.replace(/\//g, '_')}`, name, category: 'Wood', margin: vinyl.margin,
        ...(typeof vinyl.targetProfitPct === 'number' ? { targetProfitPct: vinyl.targetProfitPct } : {}),
        sectionsPerMH: vinyl.sectionsPerMH, panelWidth: Number(width), mhPerWalkGate: vinyl.mhPerWalkGate, mhPerDblGate: vinyl.mhPerDblGate,
        isActive: true, material: 'wood', choices: { style: 'privacy', height, install, width }, woodOf: vinylName,
      })
      out.styles.push(name)
    }
    if (!st.kits.some(k => k.styleName === name)) {
      const src = kitSetFor(vinylName, st.kits)
      if (src && src !== 'archived') {
        const kit = woodKitFrom(src, name)
        st.kits.push(kit)
        out.kits.push(name)
        for (const kind of KIT_KINDS) for (const p of kit.kits[kind] ?? []) {
          const key = normalizeItemName(p.part)
          if (have.has(key) || !/^Wood,/.test(p.part)) continue
          have.add(key)
          st.items.push({ id: `inv_wood_${key.replace(/[^a-z0-9]+/g, '_')}`, name: p.part, unitCost: 0, category: 'Wood', status: 'active', madeFor: 'wood' })
          out.items.push(p.part)
        }
      }
    }
  }
  return out
}
