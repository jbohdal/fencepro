/**
 * Proposal opens: the rules, with no database (lib/proposalViews.ts does the
 * saving). Unit tested in tests/proposalViews.test.ts.
 *
 *   - Which device: iPhone, iPad, Android or Computer, from the browser's name.
 *   - Bots and link previews never count (they run no script, and the few
 *     that do say what they are).
 *   - Time per option: the page adds up, second by second, which option card
 *     is in view (the one across the middle of the screen, else the one with
 *     the most of itself showing); the one with the most time is the one
 *     the customer "looked at longest". Every number is capped by the time
 *     since the open began and by two hours.
 *   - Staff: a staff sign in on the request, the app's own short-lived preview
 *     link, or the staff mark of a signed in browser (lib/staffSession.ts).
 *     Never the same address and browser as a staff login: a customer on the
 *     same Wi-Fi with the same phone is a customer.
 *   - Push to the card's owner: on the first customer open, and on an open two
 *     or more days after the last one. One key per open that earns it, so it is
 *     sent once however often it is asked for.
 */

import { customerFenceName, railsOf } from './customerFenceName.js'
export const MAX_VIEW_MS = 2 * 3600_000        // one open counts at most two hours
export const BEAT_WINDOW_MS = 6 * 3600_000     // heartbeats after this are ignored (a tab left open)
export const REUSE_MS = 10 * 60_000            // a reload on the same device within this is the same open
export const REOPEN_MS = 2 * 86_400_000        // a reopen after this long earns a push
export const MIN_LONGEST_MS = 1000             // under a second on an option is not "looked at"
export const MAX_OPTIONS = 20

export type Device = 'iPhone' | 'iPad' | 'Android' | 'Computer'

export function deviceOf(ua: string | null | undefined): Device {
  const s = String(ua || '')
  if (/iPhone|iPod/i.test(s)) return 'iPhone'
  if (/iPad/i.test(s)) return 'iPad'
  if (/Android/i.test(s)) return 'Android'
  return 'Computer'
}

/** Crawlers and link preview fetchers that run scripts and say who they are. */
export function isBot(ua: string | null | undefined): boolean {
  const s = String(ua || '')
  if (!s.trim()) return true
  return /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp\/|skypeuripreview|embedly|pinterest|vkshare|qwantify|curl\/|wget\/|python-|okhttp|go-http|java\/|lighthouse|google-inspectiontool|bingpreview/i.test(s)
}

export interface Totals { optionMs: Record<string, number>; activeMs: number; reachedSignature: boolean }
export interface Beat { o?: unknown; a?: unknown; sig?: unknown }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/**
 * A heartbeat carries the page's running totals since the open began, so one
 * sent twice (or a last one sent as the page closes) changes nothing: each
 * total only grows, and never past the time since the open began (plus a few
 * seconds for clocks) or two hours.
 */
export function mergeBeat(prev: Totals, beat: Beat, ctx: { startedAt: Date; now: Date; optionCount: number }): Totals {
  const cap = Math.min(MAX_VIEW_MS, Math.max(0, ctx.now.getTime() - ctx.startedAt.getTime()) + 5000)
  const optionMs: Record<string, number> = {}
  for (const [k, v] of Object.entries(prev.optionMs || {})) optionMs[k] = Math.min(cap, num(v))
  const o = beat.o && typeof beat.o === 'object' && !Array.isArray(beat.o) ? (beat.o as Record<string, unknown>) : {}
  const count = Math.min(Math.max(0, ctx.optionCount), MAX_OPTIONS)
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d{1,2}$/.test(k) || Number(k) >= count) continue
    optionMs[k] = Math.min(cap, Math.max(optionMs[k] ?? 0, num(v)))
  }
  const activeMs = Math.min(cap, Math.max(num(prev.activeMs), num(beat.a)))
  return { optionMs, activeMs, reachedSignature: !!prev.reachedSignature || beat.sig === true }
}

/** The option the customer looked at longest, or null (none for a second or more). Ties go to the first. */
export function longestOption(optionMs: Record<string, number> | null | undefined): { index: number; ms: number } | null {
  let best: { index: number; ms: number } | null = null
  for (const [k, v] of Object.entries(optionMs || {})) {
    const ms = num(v), index = Number(k)
    if (!Number.isInteger(index) || ms < MIN_LONGEST_MS) continue
    if (!best || ms > best.ms || (ms === best.ms && index < best.index)) best = { index, ms }
  }
  return best
}

export type Trigger = 'first' | 'reopen'

/**
 * The push an open earns. `prev`: the last customer open of this quote
 * before this one (its last activity), or null. A legacy open (counted before
 * opens were recorded one by one) has no id; its time stands in.
 */
export function openTrigger(quoteId: string, prev: { id: string | null; at: Date } | null, now: Date): { trigger: Trigger; key: string } | null {
  if (!prev) return { trigger: 'first', key: `proposal-opened:${quoteId}:first` }
  if (now.getTime() - prev.at.getTime() >= REOPEN_MS) return { trigger: 'reopen', key: `proposal-opened:${quoteId}:reopen:${prev.id ?? `legacy-${prev.at.getTime()}`}` }
  return null
}

/** 'device' is on opens recorded before Oct 27, 2026 only (an address and browser match, no longer used). */
export type StaffHow = 'bearer' | 'preview' | 'device' | 'session'

/** Staff or customer, from what the request carried. The first that says staff wins. */
export function staffDecision(input: {
  bearer?: { userId: string } | null
  preview?: { userId: string } | null
  session?: { userId: string } | null
}): { staff: boolean; userId: string | null; how: StaffHow | null } {
  for (const how of ['bearer', 'preview', 'session'] as const) {
    const hit = input[how]
    if (hit?.userId) return { staff: true, userId: hit.userId, how }
  }
  return { staff: false, userId: null, how: null }
}

/** "20 sec", "4 min", "1 h 5 min". */
export function durationWords(ms: number): string {
  const s = Math.round(num(ms) / 1000)
  if (s < 60) return `${s} sec`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

const money = (dollars: number) => '$' + Math.round(Number(dollars) || 0).toLocaleString('en-US')

export interface ProposalOptionLike { label?: string; fenceStyle?: string; finalPrice?: number; tier?: { label?: string } }

/** "Better ($8,200)": the tier name when it has one, else the option's own words. */
export function optionWords(o: ProposalOptionLike | null | undefined): string {
  if (!o) return ''
  const name = customerFenceName(String(o.tier?.label || o.label || o.fenceStyle || 'an option'), railsOf(o as any))
  return `${name} (${money(o.finalPrice ?? 0)})`
}

export interface ViewLike {
  startedAt: Date; activeMs: number; optionMs: unknown; reachedSignature: boolean; signed: boolean
  staff: boolean; device: string
}

/** One line in the customer's history for one open. */
export function viewHistoryItem(v: ViewLike, options: ProposalOptionLike[] | null | undefined, staffName = ''): { at: string; kind: string; title: string; detail: string; by: string } {
  const parts = [`on ${v.device || 'a device'}`]
  if (num(v.activeMs) > 0) parts.push(durationWords(v.activeMs))
  if (v.staff) {
    return { at: v.startedAt.toISOString(), kind: 'proposal_staff', title: 'Staff view', detail: `Proposal opened by ${staffName || 'staff'} ${parts.join(', ')}. Not counted.`, by: staffName }
  }
  const top = longestOption(v.optionMs as Record<string, number>)
  const o = top ? (options ?? [])[top.index] : null
  if (o && (options?.length ?? 0) > 1) parts.push(`looked longest at ${optionWords(o)}`)
  if (v.signed) parts.push('signed')
  else if (v.reachedSignature) parts.push('reached the signature')
  return { at: v.startedAt.toISOString(), kind: 'proposal_opened', title: `Proposal opened ${parts.join(', ')}`, detail: '', by: '' }
}

// ── Cards: how often their customer opened the proposal ─────────────────────

export interface QuoteOpens { crmContactId: string | null; status: string; shareToken?: string | null; viewCount?: number; lastViewedAt?: Date | string | null; acceptedAt?: Date | string | null; archivedAt?: Date | string | null }
/** signed: a proposal the customer accepted (they had it open to sign it, even when no open was counted, e.g. a phone that was signed in as staff). */
export interface Opened { count: number; lastAt: string | null; signed?: boolean }

/** Was this quote's proposal given to the customer? A link that was sent (or opened, or accepted online). */
export function proposalSent(q: QuoteOpens): boolean {
  if (q.archivedAt) return false
  if ((q.viewCount ?? 0) > 0 || q.acceptedAt) return true
  return !!q.shareToken && q.status === 'SENT'
}

/** Per card: customer opens of its customer's sent proposals (null: no proposal sent, so nothing is shown). */
export function openedForCard(card: { customerId?: string | null }, quotes: QuoteOpens[]): Opened | null {
  if (!card.customerId) return null
  const mine = quotes.filter(q => q.crmContactId === card.customerId && proposalSent(q))
  if (!mine.length) return null
  let count = 0, last: number | null = null
  for (const q of mine) {
    count += q.viewCount ?? 0
    const t = q.lastViewedAt ? new Date(q.lastViewedAt).getTime() : NaN
    if (Number.isFinite(t) && (last === null || t > last)) last = t
  }
  const signed = count === 0 && mine.some(q => !!q.acceptedAt)
  return { count, lastAt: count > 0 && last !== null ? new Date(last).toISOString() : null, ...(signed ? { signed } : {}) }
}
