/**
 * Subcontractors, the office's side (server: routes/subcontractors.ts,
 * lib/subcontractors.ts; Jonathan, Nov 6 2026). Everything reads and writes
 * through the API: nothing about a sub is kept in the browser.
 */

import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'

export type SubStatus = 'active' | 'inactive' | 'do_not_use'
export const SUB_STATUS_LABEL: Record<SubStatus, string> = { active: 'Active', inactive: 'Inactive', do_not_use: 'Do not use' }
export const TRADES = ['vinyl', 'chain', 'aluminum', 'wood', 'farm', 'gates', 'tear_out'] as const
export type Trade = typeof TRADES[number]
export const TRADE_LABEL: Record<Trade, string> = { vinyl: 'Vinyl', chain: 'Chain link', aluminum: 'Aluminum', wood: 'Wood', farm: 'Farm', gates: 'Gates', tear_out: 'Tear out' }

export interface SubRates { perUnit?: Record<string, number>; walkGate?: number; dblGate?: number; tearOutSection?: number; tearOutGate?: number; extraHour?: number }
export interface SettingsRates { unit: 'foot' | 'section'; perUnitDefault: number; perUnit: Record<string, number>; walkGate: number; dblGate: number; tearOutSection: number; tearOutGate: number; extraHour: number }

export interface SubRow {
  id: string; businessName: string; contactName: string; phone: string; email: string; status: SubStatus; statusReason: string
  trades: Trade[]; crewSize: number | null; jobs: number
  missing: string[]; expired: Array<{ label: string; expiresOn: string }>; expiring: Array<{ label: string; expiresOn: string; days: number }>; insuranceProblems: string[]
}

export interface Sub {
  id: string; businessName: string; contactName: string; phone: string; email: string; address: string; payMethod: string; notes: string
  trades: Trade[]; crewSize: number | null; rates: SubRates; status: SubStatus; statusReason: string; vendorId: string | null
}

export interface SubDoc { id: string; kind: string; label: string; fileName: string; mime: string; bytes: number; expiresOn: string | null; version: string | null; signedOn: string | null; uploadedBy: string; createdAt: string; canOpen: boolean }
export interface DocKind { kind: string; label: string; expires: boolean; ownerOnly?: boolean; custom?: boolean }

export interface SubDetail {
  sub: Sub
  documents: SubDoc[]
  kinds: DocKind[]
  papers: { missing: string[]; expired: Array<{ kind: string; label: string; expiresOn: string }>; expiring: Array<{ kind: string; label: string; expiresOn: string; days: number }>; insuranceProblems: string[] }
  rates: { own: SubRates; settings: SettingsRates; categories: string[] }
  jobs: Array<{ jobId: string; customerName: string; address: string; installDate: string | null; status: string; stage: string; payCents: number; submittedAt: string | null; confirmedAt: string | null }>
  stats: SubStats
}

export interface PayLine { key: string; label: string; qty: number; unit: string; rateCents: number; cents: number; own: boolean }

export interface AssignPreview {
  sub: { id: string; businessName: string; status: SubStatus }
  days: string[]
  clashes: Array<{ date: string; clientName: string; jobId: string | null }>
  insuranceProblems: string[]
  missing: string[]
  /** 811: too soon to call, or the ticket does not fit the install days. */
  locate: string[]
  /** The first crew day the 811 call still fits before. */
  earliestStart: string
  payLines: PayLine[]
  payCents: number
}

export interface JobSub {
  subId: string; businessName: string; phone: string; email: string; assignedAt: string; assignedBy: string
  docOverride: { missing: string[]; by: string; at: string } | null
  payLines: PayLine[]; payCents: number; payEdited: boolean
  link: string | null; linkOff: boolean; lastOpenedAt: string | null; subNotes: string
  checkout: { at: string; lines: Array<{ item: string; pull: number; taken: number }>; photos: string[] } | null
  report: { startedOn: string | null; finishedOn: string | null; footage: number | null; gates: number | null; problemsFound: string; signName: string; signedOn: string | null; after: string[]; before: string[]; problems: Array<{ at: string; kind: string; text: string }> } | null
  checkin: { at: string; lines: Array<{ item: string; back: number }>; notInCatalog?: string[] } | null
  submittedAt: string | null; confirmedAt: string | null; confirmedBy: string | null
  flags: Array<{ key: string; text: string }>
  events: Array<{ at: string; what: string; how: string; to: string }>
  /** Paying the sub (Phase B). */
  cover: { contractCents: number; clearedCents: number; receivedCents: number } | null
  readyToPayAt: string | null
  deductions: Array<{ id: string; kind: 'backcharge' | 'advance'; cents: number; reason: string; at: string; by: string }>
  netCents: number
  lienRelease: { sentAt: string; signedAt: string | null; signedName: string | null; documentId: string | null } | null
  paid: { paidOn: string; cents: number; method: string; checkNumber: string | null; by: string } | null
  /** Quality (Phase C). */
  inspections: Array<{ at: string; result: 'passed' | 'failed'; reason: string; reinspectOn: string | null; by: string }>
  callbacks: Array<{ id: string; issue: string; notes: string; stage: string; subWorkmanship: boolean | null; createdAt: string }>
}

export interface SubStats {
  jobs: number; done: number; feet: number; callbacks: number; openCallbacks: number; workmanshipCallbacks: number; callbackRate: number | null
  inspected: number; firstPassRate: number | null; problems: number; onTimeRate: number | null; shortages: number; paidYear: number; paidAll: number
}

export interface SubSettings {
  docTypes: Array<{ key: string; label: string; expires: boolean }>
  agreement: { text: string; callbackMonths: number | null; version: number; reviewedAt: string | null; reviewedBy: string | null }
  /** The other legal templates' review marks (sub_lien_release, Phase C's lien papers). */
  reviews: Record<string, { at: string; by: string } | undefined>
}

export interface SubsDashboard {
  week: Array<{ date: string; jobs: DashJob[] }>
  locate: Array<DashJob & { problem: string }>
  materialOut: DashJob[]
  waitingOnSub: DashJob[]
  waitingOnYou: Array<DashJob & { flags: number }>
  papers: Array<{ subId: string; sub: string; label: string; expiresOn: string; days: number }>
  readyToPay: Array<DashJob & { netCents: number }>
  owedCents: number
  finalNotCleared: Array<DashJob & { contractCents: number; clearedCents: number; receivedCents: number; lienDay: number | null }>
  callbacks: Array<{ subId: string; sub: string; open: number }>
  ytd: Array<{ subId: string; businessName: string; paidCents: number; jobs: number; form1099: boolean }>
}
export interface DashJob { jobId: string; sub: string; customerName: string; address: string; installDate: string | null }

type Answer<T> = { ok: true; data: T } | { ok: false; error: string; status: number; json: any }

async function call<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  const r = await sendJson(method, `/api/subcontractors${path}`, body)
  if (r.result.ok) return { ok: true, data: r.json?.data as T }
  return { ok: false, error: r.json?.error || (r.status === 0 ? 'No connection. Try again.' : 'Something went wrong.'), status: r.status, json: r.json }
}

export const listSubs = () => call<SubRow[]>('GET', '')
export const getSub = (id: string) => call<SubDetail>('GET', `/${encodeURIComponent(id)}`)
export const addSub = (s: Partial<Sub>) => call<Sub>('POST', '', s)
export const saveSub = (id: string, s: Partial<Sub>) => call<Sub>('PUT', `/${encodeURIComponent(id)}`, s)
export const removeDoc = (subId: string, docId: string) => call<null>('DELETE', `/${encodeURIComponent(subId)}/documents/${encodeURIComponent(docId)}`)
export const docUrl = (subId: string, docId: string) => `${API_ORIGIN}/api/subcontractors/${encodeURIComponent(subId)}/documents/${encodeURIComponent(docId)}/file`
export const sendAgreement = (subId: string) => call<{ link: string; sent: boolean; how: string }>('POST', `/${encodeURIComponent(subId)}/agreement`)

export async function uploadDoc(subId: string, f: { kind: string; expiresOn?: string; version?: string; signedOn?: string; file: File }): Promise<Answer<SubDoc>> {
  const fd = new FormData()
  fd.append('kind', f.kind)
  if (f.expiresOn) fd.append('expiresOn', f.expiresOn)
  if (f.version) fd.append('version', f.version)
  if (f.signedOn) fd.append('signedOn', f.signedOn)
  fd.append('file', f.file)
  try {
    const res = await fetchWithAuth(`${API_ORIGIN}/api/subcontractors/${encodeURIComponent(subId)}/documents`, { method: 'POST', body: fd })
    const json = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data: json.data } : { ok: false, error: json.error || 'Could not file the paper.', status: res.status, json }
  } catch { return { ok: false, error: 'No connection. Try again.', status: 0, json: null } }
}

export const previewAssign = (jobId: string, subId: string, start: string) => call<AssignPreview>('GET', `/assign/preview?jobId=${encodeURIComponent(jobId)}&subId=${encodeURIComponent(subId)}&start=${encodeURIComponent(start)}`)
export const assignSub = (jobId: string, subId: string, start: string, override = false) => call<{ days: string[]; link: string; calendar: string; payCents: number }>('POST', '/assign', { jobId, subId, start, override })
export const jobSub = (jobId: string) => call<JobSub | null>('GET', `/job/${encodeURIComponent(jobId)}`)
export const saveJobSub = (jobId: string, b: { payCents?: number; payReset?: boolean; subNotes?: string; linkOff?: boolean; newLink?: boolean }) => call<Pick<JobSub, 'payCents' | 'payEdited' | 'payLines' | 'linkOff' | 'link' | 'subNotes'>>('PUT', `/job/${encodeURIComponent(jobId)}`, b)
export const unassign = (jobId: string) => call<null>('DELETE', `/job/${encodeURIComponent(jobId)}`)
export const confirmInstalled = (jobId: string, finalFurnishingDate: string | null) => call<{ finalFurnishingDate: string }>('POST', `/job/${encodeURIComponent(jobId)}/confirm`, { finalFurnishingDate })
export const subsDashboard = () => call<SubsDashboard>('GET', '/dashboard')
export const subSettings = () => call<SubSettings>('GET', '/settings')
export const saveSubSettings = (b: Partial<{ docTypes: SubSettings['docTypes']; agreement: { text: string; callbackMonths: number | null } }>) => call<SubSettings>('PUT', '/settings', b)
export const markReviewed = (reviewed: boolean, template = 'agreement') => call<SubSettings>('POST', '/settings/reviewed', { reviewed, template })
export const addDeduction = (jobId: string, kind: 'backcharge' | 'advance', cents: number, reason: string) => call<unknown>('POST', `/job/${encodeURIComponent(jobId)}/deductions`, { kind, cents, reason })
export const removeDeduction = (jobId: string, id: string) => call<unknown>('DELETE', `/job/${encodeURIComponent(jobId)}/deductions/${encodeURIComponent(id)}`)
export const sendLienRelease = (jobId: string) => call<{ link: string; sent: boolean; amountCents: number }>('POST', `/job/${encodeURIComponent(jobId)}/lien-release`)
export const markSubPaid = (jobId: string, b: { paidOn: string; amountCents: number; method: string; checkNumber?: string | null }) => call<{ paidCents: number }>('POST', `/job/${encodeURIComponent(jobId)}/paid`, b)

export const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Typed dollars to cents ("4.50" → 450); null when blank or not a number. */
export function centsOf(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
/** "Nov 6, 2027": a paper's date, with its year. */
export const usDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const usDay = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '')

export const saveInspection = (jobId: string, b: { result: 'passed' | 'failed'; reason: string; reinspectOn: string | null }) => call<unknown>('PUT', `/job/${encodeURIComponent(jobId)}/inspection`, b)
export const setCallbackWorkmanship = (ticketId: string, workmanship: boolean) => call<unknown>('PUT', `/callback/${encodeURIComponent(ticketId)}`, { workmanship })
export const ytdCsvUrl = (year: number) => `${API_ORIGIN}/api/subcontractors/ytd.csv?year=${year}`

// ── Liens (the owner only; server: routes/liens.ts) ──────────────────────────

export type LienKind = 'reminder' | 'notice_of_intent' | 'claim_of_lien' | 'final_affidavit' | 'release'
export const LIEN_KIND_LABEL: Record<LienKind, string> = { reminder: 'Payment reminder', notice_of_intent: 'Notice of intent to lien', claim_of_lien: 'Claim of Lien', final_affidavit: "Contractor's Final Payment Affidavit", release: 'Release of Lien' }
export interface LienClock { finalFurnishingDate: string | null; day: number | null; deadline: string | null; daysLeft: number | null; owedCents: number; contractCents: number; clearedCents: number; open: boolean; serveBy: string | null; suitBy: string | null }
export interface LienCaseView {
  legalDescription: string; parcelId: string; furnished: string
  notarizedOn?: string | null; recordedOn?: string | null; instrumentNumber?: string; servedOn?: string | null; serveMethod?: string; serveTracking?: string; contestOn?: string | null; suitFiledOn?: string | null; releasedOn?: string | null
  actions: Array<{ id: string; kind: LienKind; at: string; day: string; how: string; by: string; note: string; owedCents: number }>
}
export interface LienView { clock: LienClock; case: LienCaseView; reviewed: Record<LienKind, boolean>; job: { id: string; customerName: string; address: string; finalFurnishingDate: string | null; ffdSet: boolean } }

async function lienCall<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  const r = await sendJson(method, `/api/liens${path}`, body)
  if (r.result.ok) return { ok: true, data: r.json?.data as T }
  return { ok: false, error: r.json?.error || 'Something went wrong.', status: r.status, json: r.json }
}
export const lienOf = (jobId: string) => lienCall<LienView>('GET', `/job/${encodeURIComponent(jobId)}`)
export const saveLien = (jobId: string, b: Partial<LienCaseView> & { finalFurnishingDate?: string }) => lienCall<LienView>('PUT', `/job/${encodeURIComponent(jobId)}`, b)
export const makeLienPaper = (jobId: string, kind: LienKind, how: string, note = '') => lienCall<{ action: LienCaseView['actions'][number]; view: LienView }>('POST', `/job/${encodeURIComponent(jobId)}/papers`, { kind, how, note })
export const lienPaperUrl = (jobId: string, actionId: string) => `${API_ORIGIN}/api/liens/job/${encodeURIComponent(jobId)}/papers/${encodeURIComponent(actionId)}`
export const lienList = () => lienCall<{ clocks: Array<LienClock & { jobId: string; customerName: string; address: string; recordedOn: string | null }>; noNotice: Array<{ quoteId: string; customerName: string; address: string; priceCents: number; signedOn: string | null }>; noNoticeOlder: number }>('GET', '')
export const lienSample = (kind: LienKind) => lienCall<{ title: string; text: string }>('GET', `/sample/${kind}`)
