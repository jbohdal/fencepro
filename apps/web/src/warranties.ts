/**
 * Warranties (Settings → Warranties, Oct 2026): named warranties with their
 * own words, and which one goes with each kind of install (vinyl no dig,
 * vinyl dig set, aluminum, chain link, wood, anything else, moves and
 * repairs). Saved in Settings (BusinessState.config.warranties), so changes
 * are versioned and go to the Settings change log like any other setting.
 *
 * Each proposal option carries its warranty (id, name, the full words) from
 * the moment the quote is saved (the server stamps it, routes/saved-quotes.ts
 * → lib/warranties.ts → stampWarranties here). A proposal that was sent or
 * signed keeps the words it went out with: a later Settings edit never
 * changes them. The customer's page shows each option's warranty as a badge
 * and the chosen option's words; the signed contract, its PDF, the warranty
 * certificate and the job page use the accepted option's warranty.
 *
 * Pure (no browser, no database): the server runs this same code through the
 * pricing bundle (estimate.ts).
 */

import { styleChoicesOf } from './legacyStyles'

export type WarrantyTerm = 'lifetime' | 'years'

export interface Warranty {
  /** Permanent: never changes once made, so the mapping and old quotes can point at it. */
  id: string
  name: string
  text: string
  /** lifetime: for as long as the customer owns the home; years: `years` from the install date. */
  term: WarrantyTerm
  years?: number
}

export interface WarrantySettings {
  list: Warranty[]
  /** Install key (installKeyOf) → warranty id. */
  byInstall: Record<string, string>
  /** A line added after the warranty on every option of a material (wood: no warranty on the wood itself). */
  extras: Record<string, string>
}

/** What a proposal option carries: the warranty as it was when the quote was saved. */
export interface OptionWarranty {
  id: string | null
  name: string
  /** The full words shown and signed: the warranty's text plus the material's extra line. */
  text: string
  term: WarrantyTerm | 'unknown'
  years?: number
}

export const LIFETIME_ID = 'lifetime-craftsmanship'
export const ONE_YEAR_ID = 'one-year-workmanship'

export const LIFETIME_TEXT = 'For as long as you own your home, Getter Done Fence will repair or replace, at no cost to you, any part of this fence that fails because of our installation, including posts or sections that lean or fail in high winds. Materials are covered by the manufacturer\'s warranty. Not covered: falling trees or other impact, vehicles, flooding or washouts, changes or attachments made by others, or misuse.'
/** The warranty every proposal carried before Oct 20, 2026 (Contract Templates → Warranty, its default). */
export const ONE_YEAR_TEXT = 'Materials are covered by the manufacturer\'s warranty. Workmanship is warranted for 1 year from installation date against defects in workmanship. Warranty does not cover damage from impact, severe weather, or misuse.'
export const WOOD_EXTRA = 'No warranty on the wood itself.'

/** The kinds of install a warranty is chosen for, in the order Settings shows them. */
export const INSTALL_KINDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'vinyl:nd', label: 'Vinyl, no dig' },
  { key: 'vinyl:ds', label: 'Vinyl, dig set' },
  { key: 'alum:nd', label: 'Aluminum, no dig' },
  { key: 'alum:ds', label: 'Aluminum, dig set' },
  { key: 'chain:nd', label: 'Chain link, no dig' },
  { key: 'chain:ds', label: 'Chain link, dig set' },
  { key: 'wood:nd', label: 'Wood, no dig' },
  { key: 'wood:ds', label: 'Wood, dig set' },
  { key: 'other', label: 'Any other style (Durafence and styles added later)' },
  { key: 'work', label: 'Fence moves and repairs' },
]

/** Materials that can have an extra line. */
export const EXTRA_MATERIALS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'vinyl', label: 'Vinyl' }, { key: 'alum', label: 'Aluminum' }, { key: 'chain', label: 'Chain link' }, { key: 'wood', label: 'Wood' }, { key: 'other', label: 'Other' },
]

/** What Settings start with (the one-time step on the server saves exactly this). */
export function defaultWarrantySettings(): WarrantySettings {
  return {
    list: [
      { id: LIFETIME_ID, name: 'Lifetime Craftsmanship Warranty', text: LIFETIME_TEXT, term: 'lifetime' },
      { id: ONE_YEAR_ID, name: '1 Year Workmanship Warranty', text: ONE_YEAR_TEXT, term: 'years', years: 1 },
    ],
    byInstall: {
      'vinyl:nd': LIFETIME_ID, 'vinyl:ds': ONE_YEAR_ID,
      'alum:nd': ONE_YEAR_ID, 'alum:ds': ONE_YEAR_ID,
      'chain:nd': ONE_YEAR_ID, 'chain:ds': ONE_YEAR_ID,
      'wood:nd': ONE_YEAR_ID, 'wood:ds': ONE_YEAR_ID,
      other: ONE_YEAR_ID, work: ONE_YEAR_ID,
    },
    extras: { wood: WOOD_EXTRA },
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The saved warranty settings, else the starting ones. */
export function warrantySettingsOf(cfg: unknown): WarrantySettings {
  const w = isObj(cfg) ? (cfg as any).warranties : null
  if (!isObj(w) || !Array.isArray(w.list)) return defaultWarrantySettings()
  return {
    list: (w.list as any[]).filter(x => isObj(x) && typeof x.id === 'string' && x.id).map(x => ({
      id: String(x.id), name: String(x.name ?? ''), text: String(x.text ?? ''),
      term: x.term === 'lifetime' ? 'lifetime' : 'years',
      ...(x.term === 'lifetime' ? {} : { years: Number(x.years) > 0 ? Number(x.years) : 1 }),
    })),
    byInstall: isObj(w.byInstall) ? Object.fromEntries(Object.entries(w.byInstall).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
    extras: isObj(w.extras) ? Object.fromEntries(Object.entries(w.extras).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
  }
}

type StyleLike = { name: string; material?: string; choices?: Record<string, string> }

/** "vinyl:nd", "chain:ds", "other"...: the row in Settings → Warranties a style goes by. */
export function installKeyOf(style: StyleLike | null | undefined): string {
  const sc = style ? styleChoicesOf(style as any) : null
  if (!sc) return 'other'
  const install = sc.choices?.install
  const key = install === 'nd' || install === 'ds' ? `${sc.material}:${install}` : sc.material
  return INSTALL_KINDS.some(k => k.key === key) ? key : 'other'
}

/** The material a style is (for the extra line), or 'other'. */
function materialOf(style: StyleLike | null | undefined): string {
  const sc = style ? styleChoicesOf(style as any) : null
  return sc?.material ?? 'other'
}

/** A new warranty's permanent id. */
export function newWarrantyId(name: string, taken: Iterable<string>): string {
  const base = 'w-' + (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'warranty')
  const used = new Set(taken)
  let id = base, n = 2
  while (used.has(id)) id = `${base}-${n++}`
  return id
}

/**
 * The warranty a fence style gets: the warranty set for its install, with the
 * material's extra line. `kind`: a move or repair proposal (its own row).
 */
/**
 * A repair's warranty words: its time runs from the repair date, as the signed
 * contract's "Warranty starts on the repair date" says (round 6 review, Oct 27
 * 2026: a repair proposal read "1 year from installation date"). Only the date
 * is changed; the rest of the words stay as typed in Settings → Warranties.
 */
export function warrantyTextForRepair(text: string): string {
  return text.replace(/\b(from )?(the )?install(?:ation)? date\b/gi, (m: string, from: string | undefined) => {
    const out = `${from ?? ''}the repair date`
    return /^[A-Z]/.test(m) ? out[0].toUpperCase() + out.slice(1) : out
  })
}

export function warrantyForStyle(settings: WarrantySettings, style: StyleLike | null | undefined, kind?: 'move' | 'repair' | null): OptionWarranty | null {
  const key = kind ? 'work' : installKeyOf(style)
  const id = settings.byInstall[key] ?? settings.byInstall.other
  const w = settings.list.find(x => x.id === id)
  if (!w) return null
  const extra = kind ? '' : (settings.extras[materialOf(style)] ?? '').trim()
  const text = kind === 'repair' ? warrantyTextForRepair(w.text.trim()) : w.text.trim()
  return {
    id: w.id, name: w.name, text: extra ? `${text}\n${extra}` : text, term: w.term,
    ...(w.term === 'years' ? { years: w.years ?? 1 } : {}),
  }
}

// ── Stamping a proposal ──────────────────────────────────────────────────────

type Json = any
/** How an option is matched with the same option saved before (as lib/quotePricing.ts). */
export const optionKey = (o: Json) => `${o?.fenceStyle ?? ''}|${o?.tier?.key ?? ''}|${o?.label ?? ''}`

/**
 * Each option's warranty on a proposal being saved.
 *
 * Not yet sent (`frozen` false): every option gets the warranty Settings give
 * its style now, and the proposal's Warranty words are the recommended
 * option's (for anything that reads only those).
 *
 * Sent or signed (`frozen` true, `saved` the proposal as saved): an option that
 * was already on it keeps exactly the warranty it went out with (none, for a
 * proposal sent before warranties were per option), and the proposal's
 * Warranty words stay as sent. A new option gets today's warranty, unless the
 * proposal went out with one warranty for every option (before Oct 20, 2026):
 * then it keeps that single warranty.
 */
export function stampWarranties(proposal: Json, settings: WarrantySettings, styleOf: (name: string) => StyleLike | undefined, saved: Json, frozen: boolean): Json {
  if (!isObj(proposal) || !Array.isArray(proposal.options)) return proposal
  // A move or repair option is the work's own row; "New fence instead" on a repair (its work is null) is a new fence.
  const fresh = (o: Json) => warrantyForStyle(settings, styleOf(String(o?.fenceStyle ?? '')) ?? { name: String(o?.fenceStyle ?? '') },
    proposal.kind && !(isObj(o?.snapshot) && o.snapshot.work === null) ? proposal.kind : null)
  if (frozen && isObj(saved) && Array.isArray(saved.options)) {
    const before = new Map<string, Json>(saved.options.map((o: Json) => [optionKey(o), o]))
    const perOption = saved.options.some((o: Json) => isObj(o?.warranty))
    const options = proposal.options.map((o: Json) => {
      const next = { ...o }
      const was = before.get(optionKey(o))
      const w = was ? was.warranty : perOption ? fresh(o) : undefined
      if (w) next.warranty = w; else delete next.warranty
      return next
    })
    const out: Json = { ...proposal, options }
    if (saved.warranty !== undefined) out.warranty = saved.warranty; else delete out.warranty
    return out
  }
  const options = proposal.options.map((o: Json) => {
    const w = fresh(o)
    const next = { ...o }
    if (w) next.warranty = w; else delete next.warranty
    return next
  })
  const rec = Math.min(Math.max(0, Number(proposal.recommended) || 0), options.length - 1)
  const words = options[rec]?.warranty?.text
  return { ...proposal, options, ...(words ? { warranty: words } : {}) }
}

// ── A proposal option's warranty, a job's warranty ───────────────────────────

/** A warranty written as one block of words on an older proposal: what kind it is, from its words. */
export function warrantyFromText(text: string, settings?: WarrantySettings | null): OptionWarranty | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  const named = settings?.list.find(w => w.text.trim() === t || t.startsWith(w.text.trim()))
  if (named) return { id: named.id, name: named.name, text: t, term: named.term, ...(named.term === 'years' ? { years: named.years ?? 1 } : {}) }
  if (/lifetime|as long as you own/i.test(t)) return { id: null, name: /lifetime craftsmanship/i.test(t) ? 'Lifetime Craftsmanship Warranty' : 'Lifetime warranty', text: t, term: 'lifetime' }
  const y = /(\d+)\s*(?:-|\s)?\s*years?\b/i.exec(t) || /\b(one|two|three|five|ten)\s+years?\b/i.exec(t)
  if (y) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, five: 5, ten: 10 }
    const n = Number(y[1]) || words[y[1].toLowerCase()] || 1
    return { id: null, name: `${n} Year Workmanship Warranty`, text: t, term: 'years', years: n }
  }
  return { id: null, name: 'Warranty', text: t, term: 'unknown' }
}

/** Is this the 1 year words every proposal carried before Oct 20, 2026 (or a copy of them)? */
export function isOneYearText(text: unknown): boolean {
  return /warranted for 1 year/i.test(String(text ?? ''))
}

/** Is this style a no dig install (vinyl, aluminum or chain link, or any material with Install = No dig)? */
export function isNoDigStyle(style: StyleLike | null | undefined): boolean {
  return installKeyOf(style).endsWith(':nd')
}

/**
 * The warranty of the option a quote was signed for: the accepted option's
 * (the customer's link), else the option of the quote's own style (signed in
 * person), else the proposal's one block of warranty words, else null.
 */
export function signedOptionWarranty(q: { proposal?: Json; chosenOption?: number | null; fenceStyle?: string }, settings?: WarrantySettings | null): { warranty: OptionWarranty; option: Json | null; from: 'option' | 'proposal' } | null {
  const p = q.proposal
  if (!isObj(p) || !Array.isArray(p.options)) return null
  const chosen = typeof q.chosenOption === 'number' ? p.options[q.chosenOption] : null
  const opt = chosen ?? p.options.find((o: Json) => o?.fenceStyle === q.fenceStyle) ?? null
  if (opt && isObj(opt.warranty) && typeof opt.warranty.text === 'string') return { warranty: opt.warranty as OptionWarranty, option: opt, from: 'option' }
  const fromText = typeof p.warranty === 'string' ? warrantyFromText(p.warranty, settings) : null
  return fromText ? { warranty: fromText, option: opt, from: 'proposal' } : null
}

// ── Dates and coverage ───────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The day a warranty with `years` ends: the same date that many years on (Feb 29 → Feb 28). */
export function endDateOf(start: string, years: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const end = new Date(Date.UTC(y + years, m - 1, d))
  if (end.getUTCMonth() !== m - 1) end.setUTCDate(0)
  return end.toISOString().slice(0, 10)
}

/** "October 20, 2026" */
export function dayText(day: string): string {
  if (!DAY.test(day)) return day
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

export interface WarrantyPeriod {
  /** The install date (YYYY-MM-DD), null until the fence is installed. */
  start: string | null
  /** The last covered day, null for lifetime or before install. */
  end: string | null
  /** In words: "For as long as the customer owns the home", "Through October 20, 2027", "Starts on the install date". */
  endText: string
}

export function warrantyPeriod(w: Pick<OptionWarranty, 'term' | 'years'> | null, start: string | null | undefined): WarrantyPeriod {
  const s = start && DAY.test(start) ? start : null
  if (!w) return { start: s, end: null, endText: 'No warranty on file' }
  if (w.term === 'lifetime') return { start: s, end: null, endText: 'For as long as the customer owns the home' }
  if (w.term === 'unknown') return { start: s, end: null, endText: 'As written on the signed proposal' }
  if (!s) return { start: null, end: null, endText: `${w.years ?? 1} year${(w.years ?? 1) === 1 ? '' : 's'} from the install date` }
  const end = endDateOf(s, w.years ?? 1)
  return { start: s, end, endText: `Through ${dayText(end)}` }
}

export interface Coverage {
  /** true: covered; false: not covered; null: cannot say (no warranty, not installed yet). */
  covered: boolean | null
  /** "Covered by warranty", "Not covered" */
  label: string
  /** Why, in words. */
  why: string
  overridden: boolean
}

/**
 * Is a service call on `day` (YYYY-MM-DD) covered? Within the warranty period
 * and after the install. Staff can override with a reason (it wins).
 */
export function serviceCoverage(w: Pick<OptionWarranty, 'term' | 'years' | 'name'> | null, start: string | null | undefined, day: string, override?: { covered: boolean; reason: string; by?: string } | null): Coverage {
  if (override && typeof override.covered === 'boolean') {
    return { covered: override.covered, label: override.covered ? 'Covered by warranty' : 'Not covered', why: `Set by ${override.by || 'staff'}: ${override.reason}`, overridden: true }
  }
  if (!w) return { covered: null, label: 'No warranty on file', why: 'This job has no warranty on its signed proposal and no style to look one up by.', overridden: false }
  const p = warrantyPeriod(w, start)
  if (!p.start) return { covered: null, label: 'Warranty not started', why: 'The warranty starts on the install date, and this job has none yet.', overridden: false }
  if (day < p.start) return { covered: false, label: 'Not covered', why: `Before the install date (${dayText(p.start)}).`, overridden: false }
  if (w.term === 'lifetime') return { covered: true, label: 'Covered by warranty', why: `${w.name}: for as long as the customer owns the home.`, overridden: false }
  if (w.term === 'unknown') return { covered: null, label: 'Check the warranty', why: 'The signed proposal\'s warranty words do not say how long it lasts.', overridden: false }
  if (p.end && day <= p.end) return { covered: true, label: 'Covered by warranty', why: `${w.name}: through ${dayText(p.end)}.`, overridden: false }
  return { covered: false, label: 'Not covered', why: `${w.name} ended ${p.end ? dayText(p.end) : ''}.`, overridden: false }
}
