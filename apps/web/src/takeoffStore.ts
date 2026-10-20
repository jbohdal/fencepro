/**
 * The final quantity takeoff on a job (job costing), offline first through
 * the save queue (outbox), like the walkthrough (walkthroughStore.ts).
 *
 * Every change is shown at once and queued: the start (with the id this phone
 * chose, so a repeat is one takeoff), each line, the labor, sending it to the
 * office. Changes wait for the start to be on the server. Photos go through
 * the media queue (mediaStore); a line holds its photo's phone id.
 *
 * Quantities only: the takeoff never carries a cost (routes/job-costing.ts).
 * Approving, and the quoted vs actual comparison, need signal (owner and
 * office only).
 */

import { registerKind, enqueue, allOps, type Op } from './outbox'
import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'
import type { TakeoffLine, TakeoffLabor, TakeoffStatus, Comparison, ActualCost, ReportJob } from '../../portal/src/server/lib/jobCostingMath'

export * from '../../portal/src/server/lib/jobCostingMath'

export interface ServerPhoto { id: string; url: string; thumbUrl: string | null; markupUrl: string | null; visibility: string }

export interface Takeoff {
  id: string
  jobId: string
  status: TakeoffStatus
  installDate: string
  note: string
  lines: TakeoffLine[]
  labor: TakeoffLabor
  startedBy: string | null
  submittedAt: string | null
  submittedBy: string | null
  approvedAt: string | null
  approvedBy: string | null
  media: Record<string, ServerPhoto>
}

export const TAKEOFF_EVENT = 'ezbiz:takeoff'
const byJob = new Map<string, Takeoff | null>()
let version = 0
const emit = () => { version += 1; try { window.dispatchEvent(new Event(TAKEOFF_EVENT)) } catch { /* not in a browser */ } }
export const takeoffVersion = () => version
export const takeoffKey = (id: string) => `takeoff:${id}`
export const isTakeoffOp = (id: string) => (op: Op) => op.key === takeoffKey(id) || op.key.startsWith(takeoffKey(id) + ':')
export function getTakeoff(jobId: string): Takeoff | null | undefined { return byJob.get(jobId) }

export function newId(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID() } catch { /* below */ }
  return `to-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** Load a job's takeoff from the server, then put this phone's unconfirmed changes on top. */
export async function loadTakeoff(jobId: string): Promise<Takeoff | null> {
  try {
    const r = await fetchWithAuth(`${API_ORIGIN}/api/job-costing/takeoff?jobId=${encodeURIComponent(jobId)}`)
    if (r.ok) { const j = await r.json(); byJob.set(jobId, j?.data ?? null) }
  } catch { /* no signal: what this phone has */ }
  if (!byJob.has(jobId)) byJob.set(jobId, null)
  reapplyFor(jobId)
  emit()
  return byJob.get(jobId) ?? null
}

function reapplyFor(jobId: string) {
  for (const op of allOps()) if (op.kind.startsWith('takeoff.') && op.payload?.jobId === jobId) handlers[op.kind]?.apply?.(op)
}

function update(jobId: string, fn: (t: Takeoff) => Takeoff) {
  const t = byJob.get(jobId)
  if (!t) return
  byJob.set(jobId, fn(t))
  emit()
}

function took(_op: Op, data: unknown) {
  const t = data as Takeoff | null
  if (!t?.jobId) return
  byJob.set(t.jobId, t)
  reapplyFor(t.jobId)
  emit()
}

// ── Changes (each queued) ────────────────────────────────────────────────────

interface Base { takeoffId: string; jobId: string }
type CreateP = Base & { lines: TakeoffLine[]; labor: TakeoffLabor; installDate: string; by: string | null }
type LineP = Base & { line: TakeoffLine; removed?: boolean }
type LaborP = Base & { labor: TakeoffLabor; installDate: string; note: string }
type SubmitP = Base & { by: string | null }

const path = (p: Base, rest = '') => `/api/job-costing/takeoff/${encodeURIComponent(p.takeoffId)}${rest}?jobId=${encodeURIComponent(p.jobId)}`

const handlers: Record<string, { apply?: (op: Op) => void }> = {}
function kind<P extends Base>(name: string, h: { send: (op: Op<P>) => Promise<any>; apply: (op: Op<P>) => void; what: string }) {
  const handler = { what: () => h.what, send: h.send, confirmed: took, apply: h.apply }
  registerKind<P>(name, handler)
  handlers[name] = handler as any
}

kind<CreateP>('takeoff.create', {
  what: 'This takeoff',
  send: op => sendJson('POST', '/api/job-costing/takeoff', { id: op.payload.takeoffId, jobId: op.payload.jobId }).then(r => r.result),
  apply: op => {
    const p = op.payload
    if (byJob.get(p.jobId)) return
    byJob.set(p.jobId, { id: p.takeoffId, jobId: p.jobId, status: 'draft', installDate: p.installDate, note: '', lines: p.lines, labor: p.labor, startedBy: p.by, submittedAt: null, submittedBy: null, approvedAt: null, approvedBy: null, media: {} })
  },
})

kind<LineP>('takeoff.line', {
  what: 'This line',
  send: op => {
    const l = op.payload.line
    return sendJson('PUT', path(op.payload, `/lines/${encodeURIComponent(l.id)}`), op.payload.removed ? { usedQty: 0, removed: true } : {
      part: l.part, inventoryItemId: l.inventoryItemId, usedQty: l.usedQty, shopReturnQty: l.shopReturnQty, vendorReturnQty: l.vendorReturnQty,
      extra: l.extra, reason: l.reason, note: l.note, photoClientId: l.photoClientId,
    }).then(r => r.result)
  },
  apply: op => update(op.payload.jobId, t => {
    const p = op.payload
    if (p.removed) return { ...t, lines: t.lines.filter(l => l.id !== p.line.id) }
    const has = t.lines.some(l => l.id === p.line.id)
    return { ...t, lines: has ? t.lines.map(l => (l.id === p.line.id ? { ...l, ...p.line } : l)) : [...t.lines, p.line] }
  }),
})

kind<LaborP>('takeoff.labor', {
  what: 'The labor',
  send: op => sendJson('PUT', path(op.payload, '/labor'), { mode: op.payload.labor.mode, subUnits: op.payload.labor.subUnits, crew: op.payload.labor.crew, installDate: op.payload.installDate, note: op.payload.note }).then(r => r.result),
  apply: op => update(op.payload.jobId, t => ({ ...t, labor: op.payload.labor, installDate: op.payload.installDate, note: op.payload.note })),
})

kind<SubmitP>('takeoff.submit', {
  what: 'Sending the takeoff',
  send: op => sendJson('POST', path(op.payload, '/submit')).then(r => r.result),
  apply: op => update(op.payload.jobId, t => (t.status === 'draft' ? { ...t, status: 'submitted', submittedAt: t.submittedAt ?? new Date(op.createdAt).toISOString(), submittedBy: t.submittedBy ?? op.payload.by } : t)),
})

async function queue<P extends Base>(k: string, key: string, payload: P, label: string, afterKeys: string[] = []) {
  handlers[k].apply!({ id: '', key, kind: k, payload, label, createdAt: Date.now(), attempts: 0, state: 'pending' } as Op<P>)
  emit()
  await enqueue<P>({ key, kind: k, payload, label, after: afterKeys.length ? afterKeys : undefined })
}

const fresh = (t: Takeoff) => byJob.get(t.jobId) ?? t
const after = (t: Takeoff) => [takeoffKey(t.id)]

// ── What the screens call ────────────────────────────────────────────────────

/**
 * Start the takeoff. The lines come from the server (the pull sheet as
 * signed); with no signal the phone shows the quote's pull sheet it has, and
 * the server's lines take over once it answers.
 */
export async function startTakeoff(job: { id: string; completedDate?: string | null; scheduledDate?: string; sections?: number }, seed: { lines: Array<{ part: string; qty: number }>; laborMode: 'sub' | 'crew' }, by: string | null): Promise<Takeoff> {
  const existing = byJob.get(job.id)
  if (existing) return existing
  const id = newId()
  const lines: TakeoffLine[] = seed.lines.map((l, i) => ({ id: `${id}:q${i}`, key: `q${i}`, part: l.part, inventoryItemId: null, plannedQty: l.qty, usedQty: l.qty, shopReturnQty: 0, vendorReturnQty: 0, extra: false, reason: '', note: '', photoClientId: null }))
  const labor: TakeoffLabor = { mode: seed.laborMode, subUnit: 'section', subUnits: seed.laborMode === 'sub' ? job.sections ?? 0 : 0, crew: [] }
  const installDate = job.completedDate || job.scheduledDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  await queue<CreateP>('takeoff.create', takeoffKey(id), { takeoffId: id, jobId: job.id, lines, labor, installDate, by }, 'Takeoff started')
  return byJob.get(job.id)!
}

export async function setLine(t0: Takeoff, line: TakeoffLine) {
  const t = fresh(t0)
  await queue<LineP>('takeoff.line', `${takeoffKey(t.id)}:line:${line.id}`, { takeoffId: t.id, jobId: t.jobId, line }, `Takeoff: ${line.part}`, after(t))
}

export async function addItem(t0: Takeoff, item: { part: string; inventoryItemId: string | null; reason: string }) {
  const t = fresh(t0)
  const line: TakeoffLine = { id: `${t.id}:x${newId().slice(0, 12)}`, key: null, part: item.part, inventoryItemId: item.inventoryItemId, plannedQty: 0, usedQty: 1, shopReturnQty: 0, vendorReturnQty: 0, extra: true, reason: item.reason, note: '', photoClientId: null }
  await setLine(t, line)
  return line
}

export async function removeItem(t0: Takeoff, line: TakeoffLine) {
  const t = fresh(t0)
  await queue<LineP>('takeoff.line', `${takeoffKey(t.id)}:line:${line.id}`, { takeoffId: t.id, jobId: t.jobId, line, removed: true }, `Takeoff: remove ${line.part}`, after(t))
}

export async function setLabor(t0: Takeoff, labor: TakeoffLabor, installDate: string, note: string) {
  const t = fresh(t0)
  await queue<LaborP>('takeoff.labor', `${takeoffKey(t.id)}:labor`, { takeoffId: t.id, jobId: t.jobId, labor, installDate, note }, 'Takeoff: labor', after(t))
}

export async function submitTakeoff(t0: Takeoff, by: string | null) {
  const t = fresh(t0)
  // After every line and the labor: the office gets the takeoff as the crew left it.
  const waiting = allOps().filter(isTakeoffOp(t.id)).map(o => o.key)
  await queue<SubmitP>('takeoff.submit', `${takeoffKey(t.id)}:submit`, { takeoffId: t.id, jobId: t.jobId, by }, 'Takeoff sent to the office', [...new Set([...after(t), ...waiting])])
}

export const takeoffPending = (t: Takeoff) => allOps().some(isTakeoffOp(t.id))

// ── Owner and office (needs signal) ──────────────────────────────────────────

export async function approveTakeoff(t: Takeoff, otherLaborCostCents: number): Promise<{ ok: boolean; error?: string }> {
  const r = await sendJson('POST', path({ takeoffId: t.id, jobId: t.jobId }, '/approve'), { otherLaborCostCents })
  if (r.result.ok && r.json?.data) { took({} as Op, r.json.data) ; return { ok: true } }
  return { ok: false, error: r.json?.error }
}

export async function reopenTakeoff(t: Takeoff): Promise<{ ok: boolean; error?: string }> {
  const r = await sendJson('POST', path({ takeoffId: t.id, jobId: t.jobId }, '/reopen'))
  if (r.result.ok && r.json?.data) { took({} as Op, r.json.data); return { ok: true } }
  return { ok: false, error: r.json?.error }
}

export interface JobCost {
  jobId: string
  quoteId: string | null
  fenceStyle: string
  salesRep: string
  hasQuoted: boolean
  quotedSignedAt: string | null
  takeoff: { id: string; status: TakeoffStatus; installDate: string; approvedAt: string | null; approvedBy: string | null } | null
  comparison: Comparison
  actualCost: ActualCost | null
}

export async function loadJobCost(jobId: string): Promise<JobCost | null> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/job-costing/job/${encodeURIComponent(jobId)}`).catch(() => null)
  if (!r?.ok) return null
  return (await r.json())?.data ?? null
}

export async function loadReport(): Promise<ReportJob[] | null> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/job-costing/report`).catch(() => null)
  if (!r?.ok) return null
  return (await r.json())?.data?.jobs ?? null
}

// ── For the P&L (plEngine): crew labor of approved takeoffs ────────────────────

export interface FinanceLaborRow { jobId: string; quoteId: string | null; installDate: string; crewLaborCostCents: number }
let finance: FinanceLaborRow[] = []
/** What was loaded last (empty until loadFinanceLabor answers, or for a login without costs). */
export const financeLabor = (): FinanceLaborRow[] => finance
export async function loadFinanceLabor(): Promise<boolean> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/job-costing/finance`).catch(() => null)
  if (!r?.ok) return false
  const rows = (await r.json().catch(() => null))?.data
  if (!Array.isArray(rows)) return false
  finance = rows
  return true
}

/** A server photo's address for this app (the API may be on another port in dev). */
export const photoSrc = (m: ServerPhoto) => API_ORIGIN + (m.markupUrl ?? m.thumbUrl ?? m.url)
