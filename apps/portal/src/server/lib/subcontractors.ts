/**
 * Subcontractors (Jonathan, Nov 6 2026): every sub's info, papers and history
 * in one place, like a team member, with no login and no access to the app.
 * Assigning a sub to a job is the one thing done by hand; the rest follows:
 *
 *   - their pay for the job, from their rates over Settings' sub rates
 *     (per foot or section by material, gates, tear out, extra hours), on
 *     the job's work with its approved change orders (lib/changeOrderWork.ts
 *     workNow); editable;
 *   - the install booked on the Schedule as their own crew row, so the board,
 *     the clash warnings and Google Calendar name them on those days;
 *   - a "Call in 811" task for the owner and office, due 3 business days
 *     before the install, closed when the ticket is entered (lib/locates.ts);
 *   - their link (lib/subLink.ts), sent the day before the install.
 *
 * Money is integer cents here. Settings' sub rates are dollars (PricingConfig);
 * they are turned to cents at this edge. Never an SSN or EIN field.
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { resolveSecret } from './secrets.js'
import { settingsOf as costSettingsOf } from './jobCosting.js'
import { subRateFor, subGateRateFor, type PricingSettings, type StyleForRate } from './jobCostingMath.js'
import { holidayOn, isYmd, plusDays, weekdayOf, type Ymd } from './installDays.js'

type Json = any

// ── The sub ──────────────────────────────────────────────────────────────────

export const SUB_STATUSES = ['active', 'inactive', 'do_not_use'] as const
export type SubStatus = typeof SUB_STATUSES[number]
export const SUB_STATUS_LABEL: Record<SubStatus, string> = { active: 'Active', inactive: 'Inactive', do_not_use: 'Do not use' }

export const TRADES = ['vinyl', 'chain', 'aluminum', 'wood', 'farm', 'gates', 'tear_out'] as const
export type Trade = typeof TRADES[number]
export const TRADE_LABEL: Record<Trade, string> = { vinyl: 'Vinyl', chain: 'Chain link', aluminum: 'Aluminum', wood: 'Wood', farm: 'Farm', gates: 'Gates', tear_out: 'Tear out' }

export class SubError extends Error {
  constructor(public status: number, message: string, public extra: Json = {}) { super(message) }
}

// ── Papers ───────────────────────────────────────────────────────────────────

export interface DocKind { kind: string; label: string; expires: boolean; ownerOnly?: boolean; custom?: boolean }

/** The papers every sub keeps (Jonathan, Nov 6 2026); the owner can add types (Settings, config.subs.docTypes). */
export const DOC_KINDS: DocKind[] = [
  { kind: 'w9', label: 'W9', expires: false, ownerOnly: true },
  { kind: 'liability', label: 'General liability certificate', expires: true },
  { kind: 'workers_comp', label: "Workers' comp policy", expires: true },
  { kind: 'wc_exemption', label: "Florida workers' comp exemption certificate", expires: true },
  { kind: 'agreement', label: 'Subcontractor Agreement (signed)', expires: false },
  { kind: 'license', label: 'Local license or competency card', expires: true },
]

/** The owner's own types (sub settings docTypes: [{ key, label, expires }]). */
export function docKindsOf(settings: Json): DocKind[] {
  const own: Json[] = Array.isArray(settings?.docTypes) ? settings.docTypes : []
  const extra = own
    .filter(t => t && typeof t.label === 'string' && t.label.trim())
    .map(t => ({ kind: `other:${String(t.key || t.label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`, label: String(t.label).trim().slice(0, 80), expires: t.expires !== false, custom: true }))
  return [...DOC_KINDS, ...extra.filter((t, i) => extra.findIndex(x => x.kind === t.kind) === i && !DOC_KINDS.some(d => d.kind === t.kind))]
}

export interface PaperRow { id: string; kind: string; label: string; expiresOn: string | null; createdAt: Date | string; deletedAt?: Date | string | null }

const daysBetween = (from: Ymd, to: Ymd) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

export interface PapersState {
  /** The newest paper of each kind. */
  current: Record<string, PaperRow>
  /** Kinds a sub must have that are not on file (W9, liability, workers' comp or the exemption, the agreement). */
  missing: string[]
  expired: Array<{ kind: string; label: string; expiresOn: string }>
  /** Expiring within `warnDays` (30): the Subs dashboard and a push. */
  expiring: Array<{ kind: string; label: string; expiresOn: string; days: number }>
  /** Liability and workers' comp (or the Florida exemption) on file and current: assigning without them warns. */
  insuranceProblems: string[]
}

export function papersOf(rows: PaperRow[], today: Ymd, kinds: DocKind[] = DOC_KINDS, warnDays = 30): PapersState {
  const live = rows.filter(r => !r.deletedAt)
  const current: Record<string, PaperRow> = {}
  for (const r of [...live].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) current[r.kind] = r
  const label = (k: string) => kinds.find(x => x.kind === k)?.label ?? current[k]?.label ?? k
  const lapsed = (k: string) => { const e = current[k]?.expiresOn; return !!e && e < today }
  const expired = Object.values(current).filter(r => r.expiresOn && r.expiresOn < today).map(r => ({ kind: r.kind, label: label(r.kind), expiresOn: r.expiresOn! }))
  const expiring = Object.values(current)
    .filter(r => r.expiresOn && r.expiresOn >= today && daysBetween(today, r.expiresOn) <= warnDays)
    .map(r => ({ kind: r.kind, label: label(r.kind), expiresOn: r.expiresOn!, days: daysBetween(today, r.expiresOn!) }))
  const wcOk = (!!current.workers_comp && !lapsed('workers_comp')) || (!!current.wc_exemption && !lapsed('wc_exemption'))
  const missing: string[] = []
  if (!current.w9) missing.push(label('w9'))
  if (!current.liability) missing.push(label('liability'))
  if (!current.workers_comp && !current.wc_exemption) missing.push("Workers' comp policy or Florida exemption")
  if (!current.agreement) missing.push(label('agreement'))
  const insuranceProblems: string[] = []
  if (!current.liability) insuranceProblems.push('No general liability certificate on file')
  else if (lapsed('liability')) insuranceProblems.push(`General liability expired ${current.liability.expiresOn}`)
  if (!wcOk) {
    const k = current.workers_comp ? 'workers_comp' : current.wc_exemption ? 'wc_exemption' : null
    insuranceProblems.push(k ? `${label(k)} expired ${current[k].expiresOn}` : "No workers' comp policy or Florida exemption on file")
  }
  return { current, missing, expired, expiring, insuranceProblems }
}

// ── Sub settings: the owner's paper types and the Subcontractor Agreement ────
//
// Kept in their own record (AccountKeyValue "subs:settings"), not the Settings blob the browser saves whole, so
// the agreement's "Attorney review required" lock is the server's: changing the words takes the review off.

export const SUB_SETTINGS_KEY = 'subs:settings'

export interface AgreementSettings { text: string; callbackMonths: number | null; version: number; reviewedAt: string | null; reviewedBy: string | null }
export interface SubSettings { docTypes: Array<{ key: string; label: string; expires: boolean }>; agreement: AgreementSettings }

/**
 * The starting words (Jonathan, Nov 6 2026). Locked until the owner marks them reviewed by an attorney; [NUMBER] is
 * the callback months set beside it.
 */
export const AGREEMENT_START = `SUBCONTRACTOR AGREEMENT

This agreement is between {{company}} ("Contractor") and {{sub}} ("Subcontractor") for fence installation work the Contractor assigns to the Subcontractor, one job at a time.

1. Work. The Subcontractor installs each job as shown on the job link (site plan or walk list, pull sheet, gates), to the Contractor's standards and the manufacturer's instructions. The Subcontractor pays their own helpers.

2. Pay. The Contractor pays the Subcontractor the amount shown for each job on the job link, after the customer's final payment for that job has cleared. Backcharges (damage, wasted or missing material) and advances come off that pay, each with a reason.

3. Lien release. With each final payment, the Subcontractor signs a release of lien for that job.

4. Callbacks. The Subcontractor fixes their own workmanship callbacks at no charge for [NUMBER] months after the job's final furnishing date.

5. Insurance. The Subcontractor keeps general liability insurance and workers' compensation insurance (or a current Florida workers' compensation exemption certificate) in force, and gives the Contractor current certificates. The Contractor may stop assigning work when either lapses.

6. Materials. The Subcontractor picks up each job's materials at the Contractor's shop and returns every leftover to the Contractor's shop.

7. 811. The Contractor calls in every Sunshine 811 locate. The Subcontractor never digs before the ticket is in and the dig date has come.

8. Independent contractor. The Subcontractor is an independent contractor, not an employee, and is responsible for their own taxes.`

export function settingsFrom(v: Json): SubSettings {
  const a = v?.agreement ?? {}
  return {
    docTypes: Array.isArray(v?.docTypes) ? v.docTypes.filter((t: Json) => t && typeof t.label === 'string' && t.label.trim()).map((t: Json) => ({ key: String(t.key || t.label), label: String(t.label).trim().slice(0, 80), expires: t.expires !== false })) : [],
    agreement: {
      text: typeof a.text === 'string' && a.text.trim() ? a.text : AGREEMENT_START,
      callbackMonths: Number.isInteger(a.callbackMonths) && a.callbackMonths > 0 ? a.callbackMonths : null,
      version: Number.isInteger(a.version) && a.version > 0 ? a.version : 1,
      reviewedAt: typeof a.reviewedAt === 'string' ? a.reviewedAt : null,
      reviewedBy: typeof a.reviewedBy === 'string' ? a.reviewedBy : null,
    },
  }
}

export async function subSettingsOf(accountId: string): Promise<SubSettings> {
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: SUB_SETTINGS_KEY } } })
  return settingsFrom(row?.value)
}

/** The agreement's words for one sub, as sent: the company, the sub and the callback months filled in. */
export function agreementWords(a: AgreementSettings, company: string, sub: string): string {
  return a.text.replace(/\{\{company\}\}/g, company).replace(/\{\{sub\}\}/g, sub).replace(/\[NUMBER\]/g, a.callbackMonths ? String(a.callbackMonths) : '[NUMBER]')
}

// ── Rates ────────────────────────────────────────────────────────────────────

/** A sub's own rates, in cents, over Settings' (each one blank: Settings'). `perUnit` is by style category. */
export interface SubRates {
  perUnit?: Record<string, number>
  walkGate?: number
  dblGate?: number
  tearOutSection?: number
  tearOutGate?: number
  extraHour?: number
}

const cents = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}
const toCents = (dollars: unknown) => { const n = Number(dollars); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 }

/** Only the rates given, whole cents, none negative. */
export function cleanRates(input: Json): SubRates {
  const out: SubRates = {}
  const per: Record<string, number> = {}
  if (input?.perUnit && typeof input.perUnit === 'object') {
    for (const [k, v] of Object.entries(input.perUnit)) { const c = cents(v); if (k.trim() && c !== undefined) per[k.trim().slice(0, 40)] = c }
  }
  if (Object.keys(per).length) out.perUnit = per
  for (const k of ['walkGate', 'dblGate', 'tearOutSection', 'tearOutGate', 'extraHour'] as const) { const c = cents(input?.[k]); if (c !== undefined) out[k] = c }
  return out
}

/** Settings' sub rates in cents (Settings → Pricing → Subcontractor rates). */
export function settingsRates(pricing: PricingSettings) {
  const perUnit: Record<string, number> = {}
  for (const [k, v] of Object.entries(pricing.subRateByCategory ?? {})) perUnit[k] = toCents(v)
  return {
    unit: pricing.subUnit === 'section' ? 'section' as const : 'foot' as const,
    perUnitDefault: toCents(pricing.subRateDefault),
    perUnit,
    walkGate: toCents(pricing.subWalkGate), dblGate: toCents(pricing.subDblGate),
    tearOutSection: toCents(pricing.subTearOutSection), tearOutGate: toCents(pricing.subTearOutGate),
    // Blank: the man hour rate, as the quote prices extra hours (pricingEngine.extraHourRate).
    extraHour: toCents(pricing.subExtraHourRate) || toCents(pricing.manHourRate),
  }
}

// ── Pay for one job ──────────────────────────────────────────────────────────

export interface PayLine { key: string; label: string; qty: number; unit: string; rateCents: number; cents: number; own: boolean }

/** The job's work as priced now (the signed quote with its approved change orders). */
export interface WorkForPay {
  fenceStyle?: string | null
  runs?: unknown
  sections?: number | null
  walkGates?: number | null
  dblGates?: number | null
  tearOutSections?: number | null
  tearOutGates?: number | null
  adjLaborHrs?: number | null
  laborCost?: number | null
  pricing?: Json
  work?: Json
}

const n0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/**
 * The sub's pay lines for a job: the fence by the foot (or section) at their rate for its material, else the
 * quote's, the style's or Settings' (jobCostingMath.subRateFor); each gate, tear out and extra hour likewise.
 * A move or repair, or a quote priced with a typed labor amount, is that labor as quoted (editable).
 */
export function payLinesFor(w: WorkForPay, style: (StyleForRate & { category?: string }) | undefined, pricing: PricingSettings, rates: SubRates): PayLine[] {
  const s = settingsRates(pricing)
  const qp = (w.pricing && typeof w.pricing === 'object' ? w.pricing : {}) as Json
  const kind = w.work && typeof w.work === 'object' ? String(w.work.type ?? '') : ''
  if (kind === 'move' || kind === 'repair' || typeof qp.laborCost === 'number') {
    const c = toCents(w.laborCost ?? qp.laborCost)
    return [{ key: 'labor', label: kind === 'move' ? 'Fence move, labor as quoted' : kind === 'repair' ? 'Repair, labor as quoted' : 'Labor as quoted', qty: 1, unit: 'job', rateCents: c, cents: c, own: false }]
  }
  const runs = Array.isArray(w.runs) ? (w.runs as unknown[]).map(r => n0(typeof r === 'object' && r ? (r as Json).ft : r)) : []
  const feet = Math.round(runs.reduce((t, f) => t + f, 0))
  const units = s.unit === 'section' ? Math.round(n0(w.sections)) : feet
  const cat = style?.category ?? ''
  const own = cat ? rates.perUnit?.[cat] : undefined
  const fenceRate = own ?? toCents(subRateFor(style, pricing, qp.subRate))
  const lines: PayLine[] = []
  const add = (key: string, label: string, qty: number, unit: string, rate: number, mine: boolean) => {
    if (qty > 0) lines.push({ key, label, qty, unit, rateCents: rate, cents: Math.round(qty * rate), own: mine })
  }
  add('fence', `Fence${cat ? ` (${cat})` : ''}`, units, s.unit === 'section' ? 'section' : 'ft', fenceRate, own !== undefined)
  add('walk', 'Walk gates', n0(w.walkGates), 'gate', rates.walkGate ?? toCents(subGateRateFor(style, pricing, 'walk')), rates.walkGate !== undefined)
  add('dbl', 'Double gates', n0(w.dblGates), 'gate', rates.dblGate ?? toCents(subGateRateFor(style, pricing, 'dbl')), rates.dblGate !== undefined)
  add('tearSec', 'Tear out', n0(w.tearOutSections), 'section', rates.tearOutSection ?? s.tearOutSection, rates.tearOutSection !== undefined)
  add('tearGate', 'Tear out gates', n0(w.tearOutGates), 'gate', rates.tearOutGate ?? s.tearOutGate, rates.tearOutGate !== undefined)
  add('hours', 'Extra hours', n0(w.adjLaborHrs), 'hr', rates.extraHour ?? s.extraHour, rates.extraHour !== undefined)
  return lines
}

export const payTotal = (lines: PayLine[]) => lines.reduce((t, l) => t + l.cents, 0)

/** The job's work now (the quote with its approved change orders) and its style, Settings' pricing. */
export async function payContext(accountId: string, quoteId: string | null | undefined) {
  const settings = await costSettingsOf(accountId)
  if (!quoteId) return { work: null as WorkForPay | null, settings }
  const { workNow } = await import('./changeOrderWork.js')
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } })
  const now = await workNow(accountId, quoteId).catch(() => ({ work: null }))
  const work = { ...(q as Json ?? {}), ...((now as Json).work ?? {}) } as WorkForPay
  return { work: q ? work : null, settings }
}

/** Work a sub's pay for a job out again from their rates (left alone when it was edited by hand). */
export async function refreshPay(accountId: string, jobId: string, opts: { force?: boolean } = {}): Promise<{ changed: boolean; before: number; after: number } | null> {
  const sj = await prisma.subJob.findUnique({ where: { jobId }, include: { sub: true } })
  if (!sj || sj.accountId !== accountId) return null
  if (sj.payEdited && !opts.force) return { changed: false, before: sj.payCents, after: sj.payCents }
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId }, select: { quoteId: true } })
  const { work, settings } = await payContext(accountId, job?.quoteId)
  const lines = work ? payLinesFor(work, settings.styles.find(x => x?.name === work.fenceStyle), settings.pricing, cleanRates(sj.sub.rates)) : []
  const after = payTotal(lines)
  await prisma.subJob.update({ where: { id: sj.id }, data: { payLines: lines as Json, payCents: after, payEdited: false } })
  return { changed: after !== sj.payCents, before: sj.payCents, after }
}

// ── Links ────────────────────────────────────────────────────────────────────

/**
 * A link's token: an HMAC of the row and its nonce with the server secret, so the office can show the same link
 * again and every email carries it, while the database alone (which keeps only the sha256) cannot make it.
 */
export function linkToken(rowId: string, nonce: string): string {
  return crypto.createHmac('sha256', resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')).update(`sub-link:${rowId}:${nonce}`).digest('base64url')
}
export const newNonce = () => crypto.randomBytes(12).toString('base64url')
export const hashToken = (token: string) => crypto.createHash('sha256').update(String(token)).digest('hex')
/** A new link for a row: its nonce and the token's hash (store both). */
export function newLink(rowId: string): { nonce: string; token: string; hash: string } {
  const nonce = newNonce()
  const token = linkToken(rowId, nonce)
  return { nonce, token, hash: hashToken(token) }
}

// ── Business days (Sunshine 811 counts Monday to Friday, holidays off) ───────

export function isBusinessDay(day: Ymd): boolean {
  const w = weekdayOf(day)
  return w >= 1 && w <= 5 && !holidayOn(day)
}
/** `n` business days before `day`. */
export function businessDaysBefore(day: Ymd, n: number): Ymd {
  let d = day, left = n
  while (left > 0) { d = plusDays(d, -1); if (isBusinessDay(d)) left-- }
  return d
}

/** The schedule's crew row for a sub (Schedule settings crews): one per sub, made the first time they are assigned. */
export const subCrewId = (subId: string) => `sub-${subId}`
export const isSubCrew = (crewId: string | null | undefined) => typeof crewId === 'string' && crewId.startsWith('sub-')

export { isYmd }
