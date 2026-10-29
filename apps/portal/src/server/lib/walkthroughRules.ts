/**
 * Final walkthrough rules, in one place for the server and the app (the web
 * app imports this file too). Pure functions and plain data; the only import
 * is lib/workWords.ts (pure too).
 *
 * - Which checklist a job gets: from its fence style (WV-/TV- vinyl, "CL -"
 *   chain link, "Alum" aluminum; anything else uses vinyl's). A repair gets a
 *   checklist made from its repair items, a fence move its style's list plus
 *   the old line (workChecklist).
 * - Which photos are required before it can be finished: each side, each
 *   gate, one wide shot.
 * - What is still missing before it can be finished.
 */

import { REPAIR_ITEMS, REPAIR_LABEL, workSummary, type WorkWordsInput } from './workWords.js'

export type WalkCategory = 'vinyl' | 'chain_link' | 'aluminum'
export const WALK_CATEGORIES: WalkCategory[] = ['vinyl', 'chain_link', 'aluminum']
export const CATEGORY_LABEL: Record<WalkCategory, string> = { vinyl: 'Vinyl', chain_link: 'Chain link', aluminum: 'Aluminum' }

export interface TemplateItem { id: string; label: string }
export type WalkTemplates = Record<WalkCategory, TemplateItem[]>

/** Jonathan's starter list; every category starts with it and he edits each in Settings. */
export const STARTER_ITEMS: TemplateItem[] = [
  { id: 'gates', label: 'Gates swing, latch and self close' },
  { id: 'plumb', label: 'Posts plumb' },
  { id: 'level', label: 'Sections level and evenly spaced' },
  { id: 'secure', label: 'Pickets and caps secure' },
  { id: 'hardware', label: 'Hardware tight' },
  { id: 'concrete', label: 'Concrete / donuts finished' },
  { id: 'cleanup', label: 'Cleanup and haul away done' },
  { id: 'flags', label: 'Utility flags and stakes removed' },
  { id: 'pins', label: 'Property pins undisturbed' },
  { id: 'shown', label: 'Customer shown gate operation' },
]

export function defaultTemplates(): WalkTemplates {
  return { vinyl: STARTER_ITEMS.map(i => ({ ...i })), chain_link: STARTER_ITEMS.map(i => ({ ...i })), aluminum: STARTER_ITEMS.map(i => ({ ...i })) }
}

/** The saved templates (config.walkthroughTemplates), with any missing category filled from the starter list. */
export function templatesFrom(saved: unknown): WalkTemplates {
  const out = defaultTemplates()
  if (saved && typeof saved === 'object') {
    for (const c of WALK_CATEGORIES) {
      const list = (saved as any)[c]
      if (Array.isArray(list)) {
        out[c] = list
          .filter((i: any) => i && typeof i.label === 'string' && i.label.trim())
          .map((i: any, n: number) => ({ id: typeof i.id === 'string' && i.id ? i.id.slice(0, 64) : `item${n}`, label: String(i.label).trim().slice(0, 300) }))
      }
    }
  }
  return out
}

/** WV-/TV- vinyl, "CL -" chain link, "Alum" aluminum; others use vinyl's checklist. */
export function categoryForStyle(style: string | null | undefined): WalkCategory {
  const s = String(style ?? '').trim()
  if (/^CL\s*-/i.test(s)) return 'chain_link'
  if (/^alum/i.test(s)) return 'aluminum'
  return 'vinyl'
}

/**
 * The checklist for a job's work (re-check, Oct 26 2026: a repair's
 * walkthrough asked for "Concrete / donuts finished", "Utility flags and
 * stakes removed" and "Property pins undisturbed").
 * - A repair: each repair item done (with how many), the gate opens, closes
 *   and latches when a gate was rehung or replaced, debris hauled away when it
 *   is on the quote, and the work area cleaned up.
 * - A fence move: the style's checklist (the new line is a new fence) and the
 *   old fence line cleared (its posts pulled and hauled away, on every move).
 * - A new fence: the style's checklist as it is.
 */
export function workChecklist(work: WorkWordsInput | null | undefined, styleList: TemplateItem[]): TemplateItem[] {
  if (work?.type === 'repair') {
    const items = work.repair?.items ?? {}
    const n = (k: keyof typeof items) => Math.max(0, Math.round(Number(items[k]) || 0))
    const gate = work.repair?.gateKind === 'double' ? 'double gate' : 'gate'
    const out: TemplateItem[] = REPAIR_ITEMS.filter(k => k !== 'haulDebris' && k !== 'footerDisposal' && n(k) > 0)
      .map(k => ({ id: `repair_${k}`, label: `${REPAIR_LABEL[k]}${/Gate$/.test(k) && gate !== 'gate' ? ` (${gate})` : ''}: ${n(k)} done` }))
    if (n('rehangGate') + n('replaceGate') > 0) out.push({ id: 'gates', label: `The ${gate} opens, closes and latches` })
    if (n('haulDebris') > 0) out.push({ id: 'debris', label: 'Debris hauled away' })
    if (n('footerDisposal') > 0) out.push({ id: 'footers', label: `Concrete footers hauled away: ${n('footerDisposal')}` })
    if (!out.length) out.push({ id: 'repair_done', label: 'Repair done as described on the quote' })
    out.push({ id: 'cleanup', label: 'Work area cleaned up' })
    return out
  }
  if (work?.type === 'move') return [...styleList.map(i => ({ ...i })), { id: 'old_line', label: 'Old fence line cleared: old posts pulled and hauled away' }]
  return styleList.map(i => ({ ...i }))
}

/**
 * What heads the walkthrough: a repair's or a move's work ("Repair: 2 ×
 * Replace a post"), else the fence style. null: use the style.
 */
export function walkHeading(work: WorkWordsInput | null | undefined): string | null {
  return workSummary(work)
}

/** "Repair checklist", "Fence move checklist", else the style's ("Vinyl checklist"). */
export function checklistName(work: WorkWordsInput | null | undefined, category: WalkCategory): string {
  return work?.type === 'repair' ? 'Repair checklist' : work?.type === 'move' ? 'Fence move checklist' : `${CATEGORY_LABEL[category] ?? 'Vinyl'} checklist`
}

// ── The walkthrough record ────────────────────────────────────────────────────

export type ItemResult = 'pass' | 'fix' | null
export interface WalkItem {
  id: string
  label: string
  result: ItemResult
  note: string
  /** A photo of the item (optional): the phone's id for it (MediaItem.clientId). */
  photoClientId: string | null
  /** The punch item a Needs fixing made (chosen on the phone, so a repeat makes one). */
  punchId?: string | null
}

export type SlotKind = 'side' | 'gate' | 'wide'
export interface PhotoSlot { key: string; label: string; kind: SlotKind; clientId: string | null }

export const ROLES = ['Project coordinator', 'Lead installer / Foreman', 'Subcontractor'] as const
export type RepRole = typeof ROLES[number]

export interface Signature {
  name: string
  /** Homeowner, or the representative's role. */
  role: string
  /** When it was signed (ISO). */
  signedAt: string
  lat: number | null
  lng: number | null
  accuracyM: number | null
  /** PNG data URL of the finger signature. */
  image: string
  /** Signed on the crew's phone, or by the homeowner through the link. */
  via: 'device' | 'link'
}

export function itemsFromTemplate(t: TemplateItem[]): WalkItem[] {
  return t.map(i => ({ id: i.id, label: i.label, result: null, note: '', photoClientId: null, punchId: null }))
}

/** Where it was signed: "location not shared" when the phone did not allow it. */
export function locationText(s: Pick<Signature, 'lat' | 'lng' | 'accuracyM'> | null | undefined): string {
  if (!s || s.lat == null || s.lng == null) return 'location not shared'
  return `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}${s.accuracyM != null ? ` (within ${Math.round(s.accuracyM)} m)` : ''}`
}

// ── Required photos ───────────────────────────────────────────────────────────

/** The parts of a yard layout this needs (see web/src/yardLayout.ts). */
export interface LayoutSides { sides: Array<{ id: string; name: string; on: boolean; gate?: { type: 'walk' | 'double' } | null }> }

/**
 * Each side, each gate and one wide shot. From the quote's yard layout when
 * there is one; otherwise from counts the crew sets.
 */
export function photoSlots(from: { layout?: LayoutSides | null; sideCount?: number; gateCount?: number; repairGates?: number; repair?: boolean }): PhotoSlot[] {
  const out: PhotoSlot[] = []
  const sides = from.layout?.sides?.filter(s => s.on) ?? []
  if (sides.length) {
    for (const s of sides) out.push({ key: `side:${s.id}`, label: `Side: ${s.name}`, kind: 'side', clientId: null })
    for (const s of sides) if (s.gate) out.push({ key: `gate:${s.id}`, label: `${s.gate.type === 'double' ? 'Double gate' : 'Walk gate'} on ${s.name}`, kind: 'gate', clientId: null })
    // A repair's gates (rehung or replaced) when its drawing has none.
    const drawn = out.filter(x => x.kind === 'gate').length
    for (let i = drawn + 1; i <= Math.min(30, Math.round(from.repairGates ?? 0)); i++) out.push({ key: `gate:${i}`, label: `Gate ${i} (repaired)`, kind: 'gate', clientId: null })
  } else {
    // A repair with no drawing has no sides to photograph (round 3, Oct 26 2026: it asked for "Side 1"):
    // its repaired gates and one wide shot of the repair.
    const n = from.repair ? 0 : Math.max(1, Math.min(30, Math.round(from.sideCount ?? 1)))
    const g = Math.max(0, Math.min(30, Math.round(Math.max(from.gateCount ?? 0, from.repairGates ?? 0))))
    for (let i = 1; i <= n; i++) out.push({ key: `side:${i}`, label: `Side ${i}`, kind: 'side', clientId: null })
    for (let i = 1; i <= g; i++) out.push({ key: `gate:${i}`, label: `Gate ${i}`, kind: 'gate', clientId: null })
  }
  out.push({ key: 'wide', label: from.repair && !sides.length ? 'Wide shot of the repaired fence' : 'Wide shot of the whole fence', kind: 'wide', clientId: null })
  return out
}

/**
 * The gates a repair works on (rehung or replaced, from the quote's repair
 * items): its walkthrough asks for a photo of each. A repair job has no new
 * walk or double gates, so it read "Gates 0" after a gate was rehung (round
 * 2b, Oct 26 2026). 0 for anything else.
 */
export function repairGateCount(work: { type?: string; repair?: { items?: Partial<Record<string, number>> } | null } | null | undefined): number {
  if (!work || work.type !== 'repair') return 0
  const items = work.repair?.items ?? {}
  return Math.max(0, Number(items.rehangGate) || 0) + Math.max(0, Number(items.replaceGate) || 0)
}

/** New slots, keeping photos already taken for the same slot. */
export function mergeSlots(next: PhotoSlot[], prev: PhotoSlot[]): PhotoSlot[] {
  const had = new Map(prev.map(s => [s.key, s.clientId]))
  return next.map(s => ({ ...s, clientId: s.clientId ?? had.get(s.key) ?? null }))
}

// ── What is still missing before it can be finished ──────────────────────────

export interface PunchLike { id: string; label: string; status: 'open' | 'fixed'; fixPhotoClientId: string | null }

export function missingToFinish(w: {
  items: WalkItem[]
  photos: PhotoSlot[]
  homeownerSig: Signature | null
  repSig: Signature | null
}, punch: PunchLike[], uploaded: (clientId: string) => boolean): string[] {
  const out: string[] = []
  const unmarked = w.items.filter(i => i.result !== 'pass' && i.result !== 'fix')
  if (unmarked.length) out.push(`${unmarked.length} checklist item${unmarked.length === 1 ? '' : 's'} not marked`)
  for (const s of w.photos) {
    if (!s.clientId) out.push(`Photo needed: ${s.label}`)
    else if (!uploaded(s.clientId)) out.push(`Photo still uploading: ${s.label}`)
  }
  const open = punch.filter(p => p.status !== 'fixed')
  if (open.length) out.push(`${open.length} punch list item${open.length === 1 ? '' : 's'} to fix and re-photograph`)
  for (const p of punch) if (p.status === 'fixed' && p.fixPhotoClientId && !uploaded(p.fixPhotoClientId)) out.push(`Photo still uploading: fixed ${p.label}`)
  if (!w.repSig) out.push('Our representative\'s signature')
  if (!w.homeownerSig) out.push('Homeowner\'s signature')
  return out
}
