/**
 * Two tone vinyl privacy (Jonathan, Nov 5 2026), built from the vinyl colors
 * priced per piece and on for quoting (White, Tan, and per piece colors made in
 * Price List → Vinyl Colors; a color sold by the section, Chai Gray, cannot be
 * split into frame and infill):
 *
 *   Frame   posts, post caps, rails (6 or 8 ft), gate uprights and gate caps,
 *           and the rail stiffeners / inserts as the frame color's fence has them
 *   Infill  pickets, U trim / U channel, and picket stiffeners as the infill
 *           color's fence has them
 *
 * A two tone fence is the frame color's fence of the same size and set method
 * (6x6, 6x8 or best price; No dig or Dig set): its material kit is that
 * fence's kit, read live, with the infill lines (pickets, U trim / U channel,
 * picket stiffeners) swapped for the same lines of the infill color's fence of
 * the same size and method. So the quantities, hardware, pipe, concrete,
 * donuts and gates are the one color fence's, and a kit edited in Material
 * Kits flows through. Labor and Target Profit follow the frame color's fence
 * as it is now (fenceCatalog.ts resolveFenceStyles), unless the two tone fence
 * has its own: its own Target Profit, or a sub rate typed on it. Held, saying
 * which of its colors' parts, until every one has a price.
 *
 *   twotone/6/{frame}/{infill}/{nd|ds}/{6|8|auto}
 *   "Two Tone Vinyl Privacy, White frame, Tan pickets, 6 ft tall, 8 ft sections, No dig"
 *
 * The server keeps the choices and fences in step with the colors at every
 * start and with every Vinyl Colors save (lib/twoToneSeed.ts: planTwoTone);
 * Undo takes away what the color's adding made there too.
 */

import type { FenceStyle } from './configStore'
import type { KitSet, KitKind } from './materialKits'
import type { ChoiceOption, FenceCatalog, MaterialDef } from './fenceCatalog'

export const TWO_TONE = 'twotone'
export const twoToneName = (frame: string, infill: string, install: string, width: string) => `twotone/6/${frame}/${infill}/${install}/${width}`
export function twoToneOf(name: string | null | undefined): { frame: string; infill: string; install: 'nd' | 'ds'; width: '6' | '8' | 'auto' } | null {
  const m = String(name ?? '').match(/^twotone\/6\/([^/]+)\/([^/]+)\/(nd|ds)\/(6|8|auto)$/)
  return m ? { frame: m[1], infill: m[2], install: m[3] as 'nd' | 'ds', width: m[4] as '6' | '8' | 'auto' } : null
}

/** An infill line: a color's picket, U trim / U channel or picket stiffener (not the shared truss, rail insert or hardware). */
const INFILL = /^\**\s*Vinyl, (?!Truss\b)[^,]+, (Picket Stiffener|Picket|U-Trim|U Channel)\b/i
// Asked for every kit line on every read of Settings: the answer per part name is kept.
const infillSeen = new Map<string, boolean>()
export const isInfillPart = (part: string) => {
  let v = infillSeen.get(part)
  if (v === undefined) { v = INFILL.test(part); if (infillSeen.size > 20_000) infillSeen.clear(); infillSeen.set(part, v) }
  return v
}

/**
 * The two tone kit: the frame fence's kit, every infill line taken out and
 * the infill fence's infill lines of the same kind put in, where the first one
 * was. Kit kinds with no infill (posts, per foot, per job) are the frame's.
 */
// The same fence from the same two kits is the same kit: kept per frame and infill kit (the kit objects change
// whenever Inventory's kits are read again, so a kept one is never stale).
const madeKits = new WeakMap<KitSet, WeakMap<KitSet, Map<string, KitSet>>>()
export function twoToneKitSet(name: string, frame: KitSet, infill: KitSet): KitSet {
  let byInfill = madeKits.get(frame)
  if (!byInfill) { byInfill = new WeakMap(); madeKits.set(frame, byInfill) }
  let byName = byInfill.get(infill)
  if (!byName) { byName = new Map(); byInfill.set(infill, byName) }
  const kept = byName.get(name)
  if (kept) return kept
  const made = makeTwoToneKitSet(name, frame, infill)
  byName.set(name, made)
  return made
}
function makeTwoToneKitSet(name: string, frame: KitSet, infill: KitSet): KitSet {
  const kits: KitSet['kits'] = {}
  for (const kind of Object.keys(frame.kits) as KitKind[]) {
    const lines = frame.kits[kind] ?? []
    const at = lines.findIndex(p => isInfillPart(p.part))
    const own = lines.filter(p => !isInfillPart(p.part))
    const swap = (infill.kits[kind] ?? []).filter(p => isInfillPart(p.part)).map(p => ({ ...p }))
    kits[kind] = at >= 0 ? [...own.slice(0, at), ...swap, ...own.slice(at)] : [...own, ...swap]
  }
  const roundUp = [...frame.roundUp.filter(p => !isInfillPart(p)), ...infill.roundUp.filter(isInfillPart)]
  return { id: `kit_${name.replace(/\W+/g, '_')}`, name, styleName: name, kits, roundUp, madeFor: TWO_TONE }
}

// ── Which fences a two tone fence is made of ─────────────────────────────────

/** Each two tone fence's frame and infill fence (internal names), as Settings read now (resolveFenceStyles sets it). */
let pairs = new Map<string, { frame: string; infill: string }>()
export function setTwoTonePairs(next: Map<string, { frame: string; infill: string }>) { pairs = next }
export const twoTonePair = (name: string) => pairs.get(name) ?? null

type StyleLike = Pick<FenceStyle, 'name' | 'isActive' | 'material' | 'choices'> & { quotable?: boolean }
/** The one color vinyl privacy fence, 6 ft tall, of this color, set method and width (6, 8, auto), turned on. */
export function oneColorFence<S extends StyleLike>(styles: S[], color: string, install: string, width: string, choicesOf: (s: S) => { material: string; choices: Record<string, string> } | null): S | undefined {
  return styles.find(s => {
    if (s.isActive === false || s.material === TWO_TONE) return false
    const sc = choicesOf(s)
    return sc?.material === 'vinyl' && sc.choices.style === 'privacy' && sc.choices.height === '6' && sc.choices.color === color && sc.choices.install === install && sc.choices.width === width
  })
}

/** The vinyl colors two tone can use: on for quoting and priced per piece (White, Tan, a Vinyl Colors color made per piece). */
export function twoToneColors(vinyl: MaterialDef | undefined): ChoiceOption[] {
  const dim = vinyl?.dims.find(d => d.isColor)
  return (dim?.options ?? []).filter(o => !o.archived && o.quotable !== false && (o.color?.form ? o.color.form.mode === 'piece' : !o.copiedFrom || o.color?.pricing === 'part'))
}

export const TWO_TONE_NAME_TEMPLATE = 'Two Tone Vinyl Privacy, {frame} frame, {infill} pickets, {height} tall, {width}, {install}'

/** The two tone material for these colors (the vinyl width and install choices, worded as vinyl's). */
export function twoToneMaterial(vinyl: MaterialDef, colors: ChoiceOption[], was?: MaterialDef): MaterialDef {
  const opts = (d: string) => {
    const now = colors.map(c => ({ key: c.key, label: c.label }))
    const gone = (was?.dims.find(x => x.key === d)?.options ?? []).filter(o => !now.some(n => n.key === o.key)).map(o => ({ ...o, archived: true }))
    return [...now, ...gone]
  }
  const width = vinyl.dims.find(d => d.key === 'width')
  const install = vinyl.dims.find(d => d.key === 'install')
  return {
    key: TWO_TONE, label: 'Two tone vinyl', category: 'Vinyl', nameTemplate: TWO_TONE_NAME_TEMPLATE,
    ...(was?.quotable === false ? { quotable: false } : {}), ...(was?.rateDefaults ? { rateDefaults: was.rateDefaults } : {}),
    // Not on the website instant quote unless switched on (its picks go by color and height).
    website: was?.website ?? false,
    dims: [
      { key: 'height', label: 'Height', options: [{ key: '6', label: '6 ft' }] },
      { key: 'frame', label: 'Frame color', options: opts('frame') },
      { key: 'infill', label: 'Infill color', options: opts('infill') },
      { key: 'install', label: 'Install', options: (install?.options ?? []).filter(o => o.key === 'nd' || o.key === 'ds').map(o => ({ key: o.key, label: o.label, ...(o.nameText ? { nameText: o.nameText } : {}) })) },
      { key: 'width', label: 'Panel width', options: (width?.options ?? []).filter(o => ['6', '8', 'auto'].includes(o.key)).map(o => ({ key: o.key, label: o.label, ...(o.nameText ? { nameText: o.nameText } : {}) })) },
    ],
  }
}

export interface TwoToneState { fenceStyles: FenceStyle[]; fenceCatalog: FenceCatalog }

/**
 * Two tone in step with the colors: the material (its frame and infill
 * choices the per piece colors on for quoting; one no longer so is archived,
 * its fences kept), and a fence for every frame and infill pair (two colors)
 * and size and method where both one color fences exist. Labor and Target
 * Profit are not copied: they follow the frame fence when Settings are read;
 * a copy left on a fence made before (Nov 5 2026), the same as the frame
 * fence's own number, is taken off so it follows. A number Jonathan set on a
 * two tone fence (its own Target Profit, a different sub rate) stays.
 */
export function planTwoTone(st0: TwoToneState, choicesOf: (s: FenceStyle) => { material: string; choices: Record<string, string> } | null, profitOf: (s: FenceStyle) => number | undefined): { state: TwoToneState; added: string[]; catalog: boolean; cleaned: boolean } {
  const st: TwoToneState = JSON.parse(JSON.stringify(st0))
  const vinyl = st.fenceCatalog.materials.find(m => m.key === 'vinyl')
  if (!vinyl) return { state: st, added: [], catalog: false, cleaned: false }
  const colors = twoToneColors(vinyl)
  const at = st.fenceCatalog.materials.findIndex(m => m.key === TWO_TONE)
  const was = at >= 0 ? st.fenceCatalog.materials[at] : undefined
  const mat = twoToneMaterial(vinyl, colors, was)
  const catalog = JSON.stringify(mat) !== JSON.stringify(was)
  if (at >= 0) st.fenceCatalog.materials[at] = mat
  else st.fenceCatalog.materials.splice(st.fenceCatalog.materials.findIndex(m => m.key === 'vinyl') + 1, 0, mat)
  const added: string[] = []
  for (const f of colors) for (const i of colors) {
    if (f.key === i.key) continue
    for (const install of ['nd', 'ds']) for (const width of ['6', '8', 'auto']) {
      const name = twoToneName(f.key, i.key, install, width)
      if (st.fenceStyles.some(s => s.name === name)) continue
      const frame = oneColorFence(st.fenceStyles, f.key, install, width, choicesOf)
      const infill = oneColorFence(st.fenceStyles, i.key, install, width, choicesOf)
      if (!frame || !infill) continue
      void profitOf
      st.fenceStyles.push({
        id: `fs_${name.replace(/\W+/g, '_')}`, name, category: 'Vinyl', margin: frame.margin,
        sectionsPerMH: frame.sectionsPerMH, panelWidth: frame.panelWidth, mhPerWalkGate: frame.mhPerWalkGate, mhPerDblGate: frame.mhPerDblGate,
        ...(frame.autoRailMix ? { autoRailMix: true, installMethod: frame.installMethod, colorFamily: frame.colorFamily, kitKey: name } : {}),
        isActive: true, material: TWO_TONE, choices: { height: '6', frame: f.key, infill: i.key, install, width }, madeFrom: frame.name,
      })
      added.push(name)
    }
  }
  // Copies left on fences made before they followed: taken off, so they follow the frame fence.
  let cleaned = false
  for (const s of st.fenceStyles) {
    const t = s.material === TWO_TONE ? twoToneOf(s.name) : null
    if (!t) continue
    const frame = oneColorFence(st.fenceStyles, t.frame, t.install, t.width, choicesOf)
    if (typeof s.targetProfitPct === 'number' && s.ownProfitPct === undefined) { delete s.targetProfitPct; cleaned = true }
    for (const k of ['subRate', 'subWalkGate', 'subDblGate'] as const) if (s[k] !== undefined && frame && s[k] === frame[k]) { delete s[k]; cleaned = true }
  }
  return { state: st, added, catalog, cleaned }
}
