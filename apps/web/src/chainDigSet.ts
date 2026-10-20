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
import { normalizeItemName, chainHookTiesPerSection } from './materialCalculator'
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

/**
 * Dig set posts (Jonathan, Oct 2026): 0.055 wall pipe, the same diameter as
 * the no dig post it replaces. "Pipe, Galv, 1-5/8" X 8' (SS40)" on a 4 ft line
 * post → "DS, Pipe, Galv, Line Post, 1-5/8" 0.055 wall, 4' Chain Link". The
 * diameter is read from the no dig pipe's name; no length (not known yet).
 */
export function digSetPostName(part: string, kind: KitKind, height: string): string {
  const finish = /\bblk\b|black/i.test(part) ? 'Blk' : /\bgalv\b/i.test(part) ? 'Galv' : ''
  const role = kind === 'line' ? 'Line Post' : 'Terminal Post'
  const dia = pipeDiameter(part)
  return ['DS', 'Pipe', finish, role, `${dia ? `${dia}" ` : ''}0.055 wall`, `${height}' Chain Link`].filter(Boolean).join(', ')
}

/** The diameter at the start of a pipe part's name: "Pipe, Galv, 2-1/2" X 8' (SS40)" → "2-1/2". */
export function pipeDiameter(part: string): string | null {
  const m = part.match(/^\s*pipe,[^"]*?(\d+(?:-\d+\/\d+)?)"/i)
  return m ? m[1] : null
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

// ── Oct 2026: dig set post names and chain link hook ties ─────────────────────

/** The dig set post parts as first added (no size): "DS, Pipe, Galv, Line Post, 4' Chain Link". */
const OLD_DS_POST = /^DS, Pipe, (Galv|Blk), (Line Post|Terminal Post), (\d+)' Chain Link$/
/** Residential chain link hook ties (commercial ties are 8-1/4" and keep their own count). */
const RES_HOOK_TIE = /hook ties?, 6-1\/2"/i

export interface ChainFixState {
  fenceStyles: FenceStyle[]
  items: Array<{ id: string; name: string; unitCost: number; [k: string]: unknown }>
  kits: KitSet[]
}

export interface ChainFixPlan {
  state: ChainFixState
  /** Inventory parts renamed, old name → new name. */
  renamed: Array<{ from: string; to: string }>
  /** Kit lines that now read a new name (kit set name, kit, new part). */
  kitLines: Array<{ kitSet: string; kit: KitKind; part: string }>
  /** Saved chain link kit sets whose hook ties moved to the section kit. */
  ties: string[]
  /** Left as they were, and why. */
  skipped: string[]
}

/** The no dig style a dig set post of this finish and height copies: the dig set twin's madeFrom, else the built in name. */
function noDigSource(st: ChainFixState, finish: 'Galv' | 'Blk', height: string): string {
  const fin = finish === 'Blk' ? 'black' : 'galv'
  const twin = st.fenceStyles.find(s => s.madeFrom && s.choices?.install === 'ds' && s.choices?.grade === 'res' && s.choices?.finish === fin && s.choices?.height === height)
  return twin?.madeFrom ?? `CL - ${height}' ${finish === 'Blk' ? 'Black' : 'Galv'}`
}

/** A saved kit set's chain link height when it prices a residential chain link style. */
function chainHeightOf(st: ChainFixState, set: KitSet): number | null {
  const style = st.fenceStyles.find(s => s.name === set.styleName)
  const choices = style?.choices
  if (choices && style?.material === 'chain') return choices.grade === 'res' && /^\d+$/.test(choices.height ?? '') ? Number(choices.height) : null
  const m = (set.styleName ?? '').match(/^CL - (\d)' (Galv|Black)$/)
  return m ? Number(m[1]) : null
}

/**
 * Once per company (server step lib/chainDigSetPipes.ts):
 *   - the 12 dig set post parts get "0.055 wall" and the diameter of the no
 *     dig post they replace (line post from the no dig line post kit, terminal
 *     post from the no dig corner post kit); Inventory keeps each part's id,
 *     price and everything else, and every kit line naming it follows;
 *   - saved residential chain link kit sets (the dig set kits) still carrying
 *     the old hook tie count (per foot and per line post) get the per section
 *     count instead, the same as the built in kits. A kit set whose ties were
 *     edited is left as it is.
 * Pure; saved quotes keep their stored pull sheets.
 */
export function planChainDigSetPipesAndTies(st0: ChainFixState): ChainFixPlan {
  const st: ChainFixState = JSON.parse(JSON.stringify(st0))
  const out: ChainFixPlan = { state: st, renamed: [], kitLines: [], ties: [], skipped: [] }

  // Old name → new name, for every old dig set post name in Inventory or a kit.
  const names = new Set<string>()
  for (const i of st.items) if (OLD_DS_POST.test(i.name.trim())) names.add(i.name.trim())
  for (const set of st.kits) for (const k of KIT_KINDS) for (const p of set.kits[k] ?? []) if (OLD_DS_POST.test(p.part.trim())) names.add(p.part.trim())
  const rename = new Map<string, string>()
  for (const old of names) {
    const [, finish, role, height] = old.match(OLD_DS_POST)!
    const src = noDigSource(st, finish as 'Galv' | 'Blk', height)
    const kit = kitSetFor(src, st.kits)
    if (!kit || kit === 'archived') { out.skipped.push(`${old}: no kit for ${src} to read the pipe size from`); continue }
    const kinds: KitKind[] = role === 'Line Post' ? ['line'] : ['corner', 'end']
    const pipe = kinds.map(k => (kit.kits[k] ?? []).find(p => /^\s*pipe,/i.test(p.part) && pipeDiameter(p.part))).find(Boolean)
    if (!pipe) { out.skipped.push(`${old}: ${src} has no ${role === 'Line Post' ? 'line' : 'corner'} post pipe with a size`); continue }
    rename.set(normalizeItemName(old), digSetPostName(pipe.part, kinds[0], height))
  }
  if (rename.size) {
    const taken = new Set(st.items.map(i => normalizeItemName(i.name)))
    for (const i of st.items) {
      const to = rename.get(normalizeItemName(i.name))
      if (!to) continue
      if (taken.has(normalizeItemName(to))) { out.skipped.push(`${i.name}: Inventory already has "${to}", so only the kits were pointed at it`); continue }
      out.renamed.push({ from: i.name, to })
      i.name = to
    }
    for (const set of st.kits) {
      for (const k of KIT_KINDS) for (const p of set.kits[k] ?? []) {
        const to = rename.get(normalizeItemName(p.part))
        if (to) { p.part = to; out.kitLines.push({ kitSet: set.name, kit: k, part: to }) }
      }
      set.roundUp = set.roundUp.map(p => rename.get(normalizeItemName(p)) ?? p)
    }
  }

  // Hook ties: per foot + per line post → per section, on saved kits still at the old count.
  const near = (a: number | undefined, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9
  for (const set of st.kits) {
    const h = chainHeightOf(st, set)
    if (h === null) continue
    const ties = [...new Set(KIT_KINDS.flatMap(k => (set.kits[k] ?? []).filter(p => RES_HOOK_TIE.test(p.part)).map(p => p.part)))]
    if (!ties.length) continue
    if (ties.length > 1) { out.skipped.push(`${set.name}: more than one hook tie part, left as it is`); continue }
    const part = ties[0]
    const qty = (k: KitKind) => (set.kits[k] ?? []).filter(p => p.part === part).reduce((t, p) => t + p.qty, 0)
    const where = KIT_KINDS.filter(k => qty(k) !== 0)
    const perSection = Math.round(chainHookTiesPerSection(h)) / 100
    if (where.length === 1 && where[0] === 'section' && near(qty('section'), perSection)) continue
    const old = where.length === 2 && where.includes('perFoot') && where.includes('line') && near(qty('perFoot'), 0.05) && near(qty('line'), (h - 1) / 100)
    if (!old) { out.skipped.push(`${set.name}: hook ties were edited (${where.map(k => `${k} ${qty(k)}`).join(', ')}), left as they are`); continue }
    const line = set.kits.perFoot!.find(p => p.part === part)!
    for (const k of ['perFoot', 'line'] as KitKind[]) {
      set.kits[k] = set.kits[k]!.filter(p => p.part !== part)
      if (!set.kits[k]!.length) delete set.kits[k]
    }
    set.kits.section = [...(set.kits.section ?? []), { part, qty: perSection, fallbackCost: line.fallbackCost }]
    if (!set.roundUp.includes(part)) set.roundUp.push(part)
    out.ties.push(set.name)
  }
  return out
}
