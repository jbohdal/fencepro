/**
 * Chain link dig set (Jonathan, Oct 2026). Chain link has been priced one way
 * so far: no dig, thick Schedule 40 pipe driven with no concrete. Those styles
 * stay exactly as they are and become the "No dig" choice under their same
 * internal names (CL - 4' Galv ...). Dig set uses shorter, thinner posts set
 * in concrete; its prices are not known yet, so:
 *
 *   - each residential chain link style gets a Dig set twin
 *     (chain/<height>/<finish>/res/ds) with the same rates as its no dig style;
 *   - its material kits are the no dig kits, with every post pipe replaced by
 *     a new dig set post part (same quantity, no price) and concrete added the
 *     way the existing aluminum dig set kit sets its posts (same part, same
 *     quantity per post, rounded up per job);
 *   - the new post parts go into Inventory with no price, and the Dig set
 *     choice waits for prices (fenceCatalog waitForPrices): Not available for
 *     quoting until every part of its kits is priced, then on by itself.
 *
 * Commercial chain link (on hold) gets no dig set twin. Nothing here sets a
 * price or invents a quantity: post counts are the no dig kits', concrete is
 * the aluminum dig set kit's.
 *
 * Pure: the server's seed (lib/chainDigSetSeed.ts) runs it through the
 * estimate bundle, once per company.
 */

import type { FenceStyle } from './configStore'
import { normalizeItemName } from './materialCalculator'
import { kitSetFor, KIT_KINDS, type KitKind, type KitPart, type KitSet } from './materialKits'
import { CHAIN_INSTALL_DIM, DEFAULT_CATALOG, generatedName, materialOf, styleChoicesOf, type FenceCatalog, type MaterialDef } from './fenceCatalog'

/** The kit whose concrete the chain link dig set copies (part and quantity per post). */
export const CONCRETE_FROM = 'Alum - DS - Emily - 48'
export const CHAIN_DS_TAG = 'chain:install:ds'
const POST_KITS: KitKind[] = ['corner', 'end', 'line', 'blank']

export interface ChainDsState {
  fenceStyles: FenceStyle[]
  fenceCatalog?: FenceCatalog | null
  items: Array<{ id: string; name: string; unitCost: number; [k: string]: unknown }>
  kits: KitSet[]
}

export interface ChainDsPlan {
  state: ChainDsState
  styles: string[]
  items: string[]
  kits: string[]
  /** The saved choice tree got the Install choice. */
  catalog: boolean
  /** The concrete each post kit got, from the aluminum dig set kit. */
  concrete: Array<{ kit: KitKind; part: string; qty: number }>
}

const isPostPipe = (part: string) => /^pipe,/i.test(part.trim())

/** "Pipe, Galv, 1-5/8" X 8' (SS40)" on a 4 ft line post → "DS, Pipe, Galv, Line Post, 4' Chain Link" (no size: it is not known yet). */
export function digSetPostName(part: string, kind: KitKind, height: string): string {
  const finish = /\bblk\b|black/i.test(part) ? 'Blk' : /\bgalv\b/i.test(part) ? 'Galv' : ''
  const role = kind === 'line' ? 'Line Post' : 'Terminal Post'
  return ['DS', 'Pipe', finish, role, `${height}' Chain Link`].filter(Boolean).join(', ')
}

/** Add the Install choice to a saved chain link material that does not have it (no dig first, the name ending ", No dig"). */
function withInstall(m: MaterialDef): boolean {
  if (m.dims.some(d => d.key === 'install')) return false
  m.dims.push(JSON.parse(JSON.stringify(CHAIN_INSTALL_DIM)))
  if (!m.nameTemplate.includes('{install}')) m.nameTemplate = `${m.nameTemplate}, {install}`
  return true
}

export function planChainDigSet(st0: ChainDsState): ChainDsPlan {
  const st: ChainDsState = JSON.parse(JSON.stringify(st0))
  const out: ChainDsPlan = { state: st, styles: [], items: [], kits: [], catalog: false, concrete: [] }

  // The saved choice tree, if there is one (otherwise the default tree already has Install).
  const saved = st.fenceCatalog && Array.isArray(st.fenceCatalog.materials) ? st.fenceCatalog : null
  const chain = saved ? materialOf(saved, 'chain') : undefined
  if (chain && withInstall(chain)) out.catalog = true

  // Chain link styles made in Settings before Install existed are the no dig ones.
  for (const s of st.fenceStyles) {
    if (s.material === 'chain' && s.choices && !s.choices.install) s.choices = { ...s.choices, install: 'nd' }
  }

  // Concrete per post kit, as the aluminum dig set kit has it.
  const alum = kitSetFor(CONCRETE_FROM, st.kits)
  const concrete = new Map<KitKind, KitPart>()
  if (alum && alum !== 'archived') {
    for (const k of POST_KITS) {
      const c = (alum.kits[k] ?? []).find(p => /concrete/i.test(p.part))
      if (c) { concrete.set(k, { ...c }); out.concrete.push({ kit: k, part: c.part, qty: c.qty }) }
    }
  }
  const concreteRoundUp = alum && alum !== 'archived' ? alum.roundUp.filter(p => /concrete/i.test(p)) : []

  const chainMat: MaterialDef = chain ?? materialOf(DEFAULT_CATALOG, 'chain')!
  const have = new Set(st.items.map(i => normalizeItemName(i.name)))
  const byName = new Map(st.items.map(i => [normalizeItemName(i.name), i]))
  const sources = st.fenceStyles.filter(s => {
    const sc = styleChoicesOf(s)
    return s.isActive !== false && sc?.material === 'chain' && sc.choices.grade === 'res' && (sc.choices.install ?? 'nd') === 'nd' && !s.madeFrom
  })
  for (const src of sources) {
    const sc = styleChoicesOf(src)!
    const choices = { ...sc.choices, install: 'ds' }
    const name = generatedName(chainMat, choices)
    if (st.fenceStyles.some(s => s.name === name)) continue
    const kit = kitSetFor(src.name, st.kits)
    if (!kit || kit === 'archived' || kit.mismatch) continue
    st.fenceStyles.push({
      id: `fs_${name.replace(/[^a-z0-9]+/gi, '_')}`, name, category: src.category, margin: src.margin,
      ...(typeof src.targetProfitPct === 'number' ? { targetProfitPct: src.targetProfitPct } : {}),
      sectionsPerMH: src.sectionsPerMH, panelWidth: src.panelWidth, mhPerWalkGate: src.mhPerWalkGate, mhPerDblGate: src.mhPerDblGate,
      isActive: true, ...(src.quotable === false ? { quotable: false } : {}),
      ...(src.subRate !== undefined ? { subRate: src.subRate } : {}), ...(src.pricePerFoot !== undefined ? { pricePerFoot: src.pricePerFoot } : {}),
      material: 'chain', choices, madeFrom: src.name,
    })
    out.styles.push(name)

    const kits: KitSet['kits'] = {}
    for (const k of KIT_KINDS) {
      const parts = kit.kits[k]
      if (!parts?.length) continue
      if (!POST_KITS.includes(k)) { kits[k] = parts.map(p => ({ ...p })); continue }
      const next: KitPart[] = []
      for (const p of parts) {
        if (!isPostPipe(p.part)) { next.push({ ...p }); continue }
        const part = digSetPostName(p.part, k, sc.choices.height)
        next.push({ part, qty: p.qty, fallbackCost: 0 })
        const key = normalizeItemName(part)
        if (!have.has(key)) {
          const from = byName.get(normalizeItemName(p.part))
          have.add(key)
          st.items.push({
            id: `inv_${key.replace(/[^a-z0-9]+/g, '_')}`, name: part, unitCost: 0, category: (from?.category as string | undefined) ?? 'Chainlink',
            ...(from?.unitOfMeasure ? { unitOfMeasure: from.unitOfMeasure } : {}), status: 'active', madeFor: CHAIN_DS_TAG,
          })
          out.items.push(part)
        }
      }
      const c = concrete.get(k)
      if (c) next.push({ part: c.part, qty: c.qty, fallbackCost: c.fallbackCost })
      kits[k] = next
    }
    st.kits.push({
      id: `kit_${name.replace(/[^a-z0-9]+/gi, '_')}`, name, styleName: name, kits,
      roundUp: [...new Set([...kit.roundUp, ...concreteRoundUp])], updatedAt: new Date().toISOString(), madeFor: CHAIN_DS_TAG,
    })
    out.kits.push(name)
  }
  return out
}
