/**
 * A job's milestones (the Milestone Checklist on the job page and the count
 * on its board card), worked out from the job's real records, so the
 * checklist, the 811 locate, the Permit section and the rest can never
 * disagree (Jonathan, Oct 25 2026: Manuel Cotrich showed Locate Complete and
 * Permit Approved ticked while the job said "Locates: Not called" and the
 * permit "Needed").
 *
 *   Locate Complete      the 811 locate is Clear to dig (lib/locates.ts)
 *   Permit Approved      the Permit is issued, inspected or passed, or Not needed
 *   Materials Confirmed  materials received or loaded, or a vendor invoice for the job
 *   Crew Assigned        a crew and an install date (Schedule install)
 *   Job Started          the job is In Progress or further, or its takeoff is started
 *   Final Walkthrough    the walkthrough is signed by the homeowner and us
 *   Photos Uploaded      photos or video on the job
 *   Invoice Sent         the Final invoice is due (the job is complete) or paid
 *
 * A tick by hand is an override, shown "ticked by hand" with who and when,
 * and only where the app may not have the record (materials from the shop,
 * photos on someone's phone, a job finished before the app had walkthroughs
 * or payment schedules). Locate, permit and crew have their own records on
 * the same page: those are changed there, never ticked. A milestone added in
 * Settings (or by an automation) has no record behind it: it is ticked by hand.
 *
 * Pure, no imports but the pure locate model: the server (lib/jobTruth.ts,
 * the dry run script) and the web app (OperationsPage) use this one file.
 */

import { locateWords, type LocateRecord } from './locates.js'

export type MilestoneKey = 'locate' | 'permit' | 'materials' | 'crew' | 'started' | 'walkthrough' | 'photos' | 'invoice'

export const MILESTONE_DEFS: Array<{ key: MilestoneKey; label: string; byHand: boolean }> = [
  { key: 'locate', label: 'Locate Complete', byHand: false },
  { key: 'permit', label: 'Permit Approved', byHand: false },
  { key: 'materials', label: 'Materials Confirmed', byHand: true },
  { key: 'crew', label: 'Crew Assigned', byHand: false },
  { key: 'started', label: 'Job Started', byHand: true },
  { key: 'walkthrough', label: 'Final Walkthrough', byHand: true },
  { key: 'photos', label: 'Photos Uploaded', byHand: true },
  { key: 'invoice', label: 'Invoice Sent', byHand: true },
]

export const labelKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const BY_LABEL = new Map(MILESTONE_DEFS.map(d => [labelKey(d.label), d]))
/** The data milestone a label stands for (any capital letters), or null for one added in Settings. */
export const milestoneOfLabel = (label: string) => BY_LABEL.get(labelKey(label)) ?? null

/** What the job's records say (gathered by lib/jobTruth.ts). */
export interface ReadinessFacts {
  today: string
  /** The job's status (staging, scheduled, in_progress, completed, invoiced, paid, on_hold) and, when on hold, the one before. */
  status: string
  previousStatus?: string | null
  locate: LocateRecord
  /** The Permit record's status, or null when the job has none. */
  permitStatus: string | null
  materialsStatus: string
  /** Vendor invoices (job lot orders) for this job. */
  vendorInvoices: number
  crewAssigned: string
  scheduledDate: string
  takeoffStarted: boolean
  walkthrough: { signed: boolean; signedAt: string | null; homeowner: string | null; open: boolean } | null
  photos: number
  /** The payment schedule (lib/contractBilling.ts), or null when the job has none. */
  billing: { finalCents: number; finalDue: boolean; balanceCents: number; paidInFull: boolean } | null
}

/** A ticked item as stored (BusinessState.jobChecklists[jobId]). */
export interface StoredTick { label: string; isComplete: boolean; completedBy?: string | null; completedAt?: string | null; sortOrder?: number }

export interface Milestone {
  /** The data milestone, or null for one added in Settings. */
  key: MilestoneKey | null
  label: string
  done: boolean
  /** data: the records say so; hand: ticked by hand (an override); none: not done. */
  by: 'data' | 'hand' | 'none'
  /** What the records say, in words. */
  detail: string
  /** May be ticked by hand (only when the records do not already say done). */
  byHand: boolean
  tickedBy: string | null
  tickedAt: string | null
}

const DONE = ['completed', 'invoiced', 'paid']
const STARTED = ['in_progress', ...DONE]
const PERMIT_WORDS: Record<string, string> = { not_needed: 'Not needed', needed: 'Needed', applied: 'Applied', approved: 'Issued', inspection_scheduled: 'Issued, inspection scheduled', passed: 'Passed' }
const MATERIAL_WORDS: Record<string, string> = { not_ordered: 'Not ordered yet', ordered: 'Ordered, not received', received: 'Received', loaded: 'Loaded on the truck' }
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const mdy = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d)

/** What the records say about one data milestone. */
export function fromRecords(key: MilestoneKey, f: ReadinessFacts): { done: boolean; detail: string } {
  const phase = f.status === 'on_hold' ? (f.previousStatus || 'staging') : f.status
  switch (key) {
    case 'locate': {
      const w = locateWords(f.locate, f.today)
      // A ticket that ran out after the fence went in still did its job.
      if (w.status === 'expired' && f.locate.goodDate && STARTED.includes(phase)) return { done: true, detail: `${w.text} (after the install started)` }
      return { done: w.status === 'clear', detail: `811: ${w.text}` }
    }
    case 'permit': {
      const s = f.permitStatus
      const ok = s === 'not_needed' || s === 'approved' || s === 'inspection_scheduled' || s === 'passed'
      return { done: ok, detail: `Permit: ${s ? PERMIT_WORDS[s] ?? s : 'Not set'}` }
    }
    case 'materials': {
      const inHand = f.materialsStatus === 'received' || f.materialsStatus === 'loaded'
      if (inHand) return { done: true, detail: `Materials: ${MATERIAL_WORDS[f.materialsStatus]}` }
      if (f.vendorInvoices > 0) return { done: true, detail: `Vendor invoice${f.vendorInvoices === 1 ? '' : 's'} for this job (${f.vendorInvoices})` }
      return { done: false, detail: `Materials: ${MATERIAL_WORDS[f.materialsStatus] ?? f.materialsStatus}` }
    }
    case 'crew': {
      const dated = /^\d{4}-\d{2}-\d{2}$/.test(f.scheduledDate)
      if (f.crewAssigned && dated) return { done: true, detail: `${f.crewAssigned}, starts ${mdy(f.scheduledDate)}` }
      return { done: false, detail: f.crewAssigned ? `${f.crewAssigned}, no install date` : dated ? `Install ${mdy(f.scheduledDate)}, no crew` : 'Not scheduled' }
    }
    case 'started':
      if (STARTED.includes(phase)) return { done: true, detail: DONE.includes(phase) ? 'The work is done' : 'In progress' }
      if (f.takeoffStarted) return { done: true, detail: 'The takeoff is started' }
      return { done: false, detail: 'Not started' }
    case 'walkthrough':
      if (f.walkthrough?.signed) return { done: true, detail: `Signed${f.walkthrough.homeowner ? ` by ${f.walkthrough.homeowner}` : ''}${f.walkthrough.signedAt ? ` on ${mdy(f.walkthrough.signedAt)}` : ''}` }
      return { done: false, detail: f.walkthrough ? 'Started, not signed yet' : 'Not started' }
    case 'photos':
      return f.photos > 0 ? { done: true, detail: `${f.photos} photo${f.photos === 1 ? '' : 's'} or video${f.photos === 1 ? '' : 's'}` } : { done: false, detail: 'No photos yet' }
    case 'invoice':
      if (!f.billing) return { done: false, detail: 'No payment schedule' }
      if (f.billing.paidInFull) return { done: true, detail: 'Paid in full' }
      if (f.billing.finalDue) return { done: true, detail: `Final ${money(f.billing.finalCents)} due` }
      return { done: false, detail: `Final ${money(f.billing.finalCents)} is due when the job is complete` }
  }
}

/**
 * The job's milestones: the saved list's labels (the defaults when it has
 * none), each driven by the records, a hand tick shown as such.
 */
export function milestones(f: ReadinessFacts, stored: StoredTick[] | null | undefined, defaultLabels: string[] = MILESTONE_DEFS.map(d => d.label)): Milestone[] {
  const list: StoredTick[] = stored && stored.length ? [...stored].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : defaultLabels.map(label => ({ label, isComplete: false }))
  const seen = new Set<string>()
  const out: Milestone[] = []
  for (const t of list) {
    const k = labelKey(t.label)
    if (!k || seen.has(k)) continue
    seen.add(k)
    const def = milestoneOfLabel(t.label)
    const tick = { tickedBy: t.isComplete ? t.completedBy ?? null : null, tickedAt: t.isComplete ? t.completedAt ?? null : null }
    if (!def) {
      out.push({ key: null, label: t.label, done: !!t.isComplete, by: t.isComplete ? 'hand' : 'none', detail: 'Ticked by hand (added in Settings)', byHand: true, ...tick })
      continue
    }
    const r = fromRecords(def.key, f)
    if (r.done) out.push({ key: def.key, label: t.label, done: true, by: 'data', detail: r.detail, byHand: def.byHand, tickedBy: null, tickedAt: null })
    else if (def.byHand && t.isComplete) out.push({ key: def.key, label: t.label, done: true, by: 'hand', detail: r.detail, byHand: true, ...tick })
    else out.push({ key: def.key, label: t.label, done: false, by: 'none', detail: r.detail, byHand: def.byHand, tickedBy: null, tickedAt: null })
  }
  return out
}

export const progressOf = (list: Milestone[]) => ({ total: list.length, complete: list.filter(m => m.done).length })

/**
 * Stored ticks that disagree with the records (the dry run of
 * scripts/job-truth-backfill.ts): a tick on a milestone the records say is
 * not done and that cannot be ticked by hand (locate, permit, crew). Those
 * ticks are cleared; the milestone follows its record from then on.
 */
export function staleTicks(f: ReadinessFacts, stored: StoredTick[] | null | undefined): Array<{ label: string; tickedBy: string | null; tickedAt: string | null; records: string }> {
  const out: Array<{ label: string; tickedBy: string | null; tickedAt: string | null; records: string }> = []
  for (const t of stored ?? []) {
    if (!t.isComplete) continue
    const def = milestoneOfLabel(t.label)
    if (!def || def.byHand) continue
    const r = fromRecords(def.key, f)
    if (!r.done) out.push({ label: t.label, tickedBy: t.completedBy ?? null, tickedAt: t.completedAt ?? null, records: r.detail })
  }
  return out
}

// ── Payment status ──────────────────────────────────────────────────────────

export interface BillingStatus {
  /** none: no schedule; deposit_due, due (an invoice due now), not_due (only the Final, due on completion), paid. */
  state: 'none' | 'deposit_due' | 'due' | 'not_due' | 'paid'
  text: string
  contractCents: number
  paidCents: number
  balanceCents: number
  /** The invoice due now (oldest open one due), if any. */
  due: { label: string; balanceCents: number; dueDate: string | null } | null
  finalCents: number
  finalDue: boolean
  paidInFull: boolean
}


/**
 * The job's payment status from its schedule's invoices and payments (pure;
 * the job's Financial section, Payments and Billing show these words, the
 * server's job status follows the same view in lib/contractBilling.ts settleIn).
 */
export function billingStatusOf(v: { contractCents: number; paidCents: number; invoices: Array<{ kind: string; label: string; amountCents: number; balanceCents: number; dueOn: string; dueDate: string | null }>; completedDate?: string | null } | null): BillingStatus {
  if (!v) return { state: 'none', text: 'No payment schedule yet', contractCents: 0, paidCents: 0, balanceCents: 0, due: null, finalCents: 0, finalDue: false, paidInFull: false }
  const balance = v.contractCents - v.paidCents
  const final = v.invoices.find(i => i.kind === 'final')
  const finalCents = final?.amountCents ?? 0
  const complete = !!v.completedDate
  const paidInFull = balance <= 0 && !!final
  // Due now: an open invoice that is not "due on completion", or the Final once the job is complete.
  const open = v.invoices.filter(i => i.balanceCents > 0 && (i.dueOn !== 'completion' || complete))
  const first = open[0] ?? null
  const due = first ? { label: first.label, balanceCents: first.balanceCents, dueDate: first.dueOn === 'completion' ? (first.dueDate ?? v.completedDate ?? null) : first.dueDate } : null
  const base = { contractCents: v.contractCents, paidCents: v.paidCents, balanceCents: balance, due, finalCents, finalDue: complete && !!final, paidInFull }
  if (paidInFull) return { ...base, state: 'paid', text: 'Paid in full' }
  if (due) {
    const when = due.dueDate ? ` ${mdy(due.dueDate)}` : ' now'
    const isDeposit = first!.kind === 'deposit'
    return { ...base, state: isDeposit ? 'deposit_due' : 'due', text: `${due.label} ${money(due.balanceCents)} due${when}${v.paidCents > 0 ? ` (paid ${money(v.paidCents)} so far)` : ''}` }
  }
  return { ...base, state: 'not_due', text: `Paid ${money(v.paidCents)}; Final ${money(final?.balanceCents ?? 0)} due on completion` }
}
