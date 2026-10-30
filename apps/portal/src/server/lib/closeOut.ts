/**
 * What a deletion closes out, besides what it takes off the lists
 * (lib/deletion.ts). Jonathan, Oct 30 2026: "deleting a customer must close
 * out its contract, tasks, appointments, permits and job steps". The customer
 * "jj jj" was deleted Oct 26; afterwards its contract was still Active, four
 * tasks Pending, its estimate visit Scheduled, its permit Needed and its job's
 * steps (Locate Complete, Permit Approved, ...) still kept for the job.
 *
 * For the customers, quotes, jobs and cards deleted, in the deletion's
 * transaction, nothing removed outright:
 *
 *   contract      the contract synced for its quote (Contract.externalCrmId)   Active -> Cancelled
 *   task          a task naming the customer, quote, job or card (Task.jobId)  Pending / In progress -> Cancelled
 *   appointment   its appointments (estimate visits, installs, call backs)     Scheduled / Confirmed / On my way / Rescheduled -> Cancelled
 *   permit        the job's permit                                             Needed / Applied / Approved / Inspection scheduled -> Cancelled
 *   notification  the bell's unread notices about the job                      marked read
 *   job steps     the job's milestones (BusinessState.jobChecklists[jobId])    taken off, kept in the deletion log
 *
 * Each is written to the deletion's log row (snapshot.closed, snapshot.steps:
 * the value before and after), which is what closed it; a restore of that
 * deletion puts back exactly those, and only the ones still as the deletion
 * left them (one changed since is skipped and named).
 *
 * Nothing is sent: these are plain row updates, no route or automation runs,
 * so no text, email, push or calendar call goes out. The calendar sync leaves
 * out deleted and cancelled appointments already. A cancelled appointment
 * that is deleted keeps its updatedAt, so the restore of another deletion that
 * holds it (lib/deletion.ts: "still exactly as the deletion left it") still
 * finds it unchanged.
 *
 * Money is not touched here: invoices and payments are already taken off with
 * the deletion and kept in its log (lib/deletion.ts); contract invoices and
 * payments (ContractInvoice, ContractPayment) are the books and stay as they are.
 */

type Tx = any

export type CloseModel = 'contract' | 'task' | 'appointment' | 'permit' | 'notification'

/** A row a deletion closed: the fields it changed, before and after. */
export interface SnapClosed { model: CloseModel; id: string; label: string; before: Record<string, any>; after: Record<string, any> }
/** A job's steps (milestones) a deletion took off: as they were. */
export interface SnapSteps { jobId: string; label: string; items: any }
export interface CloseRoots { contactIds: string[]; quoteIds: string[]; jobIds: string[]; cardIds: string[] }
export interface ClosedOut { closed: SnapClosed[]; steps: SnapSteps[] }

/** Still open, so closed by a deletion. */
export const OPEN_TASK = ['pending', 'in_progress']
export const OPEN_APPOINTMENT = ['scheduled', 'confirmed', 'on_my_way', 'rescheduled']
export const OPEN_PERMIT = ['needed', 'applied', 'approved', 'inspection_scheduled']
export const OPEN_CONTRACT = ['active']
export const CLOSED_STATUS = 'cancelled'

const uniq = (xs: Iterable<string | null | undefined>) => [...new Set([...xs].filter((x): x is string => typeof x === 'string' && !!x))]
const day = (d: any) => (d ? new Date(d).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : '')
const PERMIT_WORD: Record<string, string> = { needed: 'Needed', applied: 'Applied', approved: 'Approved', inspection_scheduled: 'Inspection scheduled' }

/** What a person reads: "Task: Order materials for jj jj", "Permit (Needed)". */
export function closedLabel(model: CloseModel, row: any): string {
  switch (model) {
    case 'contract': return `Contract: ${row?.name ?? ''}`.trim()
    case 'task': return `Task: ${row?.title ?? ''}`.trim()
    case 'appointment': return `${String(row?.type || 'appointment').replace(/_/g, ' ')} appointment ${day(row?.startAt)}`.trim()
    case 'permit': return `Permit (${PERMIT_WORD[row?.status] ?? row?.status ?? ''})`
    case 'notification': return `Notice: ${row?.title ?? ''}`.trim()
  }
}

/**
 * What would be closed for these records, read only. `jobNames`: a label for
 * each job's steps ("Job steps: jj jj").
 */
export async function findCloseOut(tx: Tx, accountId: string, roots: CloseRoots, jobNames: Map<string, string> = new Map()): Promise<ClosedOut> {
  const C = uniq(roots.contactIds), Q = uniq(roots.quoteIds), J = uniq(roots.jobIds), K = uniq(roots.cardIds)
  const closed: SnapClosed[] = []
  const all = uniq([...C, ...Q, ...J, ...K])
  if (!all.length) return { closed, steps: [] }
  const push = (model: CloseModel, row: any, before: Record<string, any>, after: Record<string, any>) =>
    closed.push({ model, id: row.id, label: closedLabel(model, row), before, after })

  // The contract synced from the quote (routes/sync.ts: its external id is the quote's).
  for (const r of await tx.contract.findMany({ where: { accountId, externalCrmId: { in: uniq([...Q, ...J]) }, status: { in: OPEN_CONTRACT } }, orderBy: { id: 'asc' } }))
    push('contract', r, { status: r.status }, { status: CLOSED_STATUS })
  // A task names its job, or the card (or quote) it was made for. Tasks have no company of their own: the ids are this company's.
  for (const r of await tx.task.findMany({ where: { jobId: { in: all }, status: { in: OPEN_TASK } }, orderBy: { id: 'asc' } }))
    push('task', r, { status: r.status }, { status: CLOSED_STATUS })
  if (C.length || Q.length || J.length) {
    // all rows: a deleted customer's appointments are deleted too, and still to be closed.
    for (const r of await tx.appointment.findMany({ where: { accountId, status: { in: OPEN_APPOINTMENT }, OR: [{ crmContactId: { in: C } }, { quoteId: { in: Q } }, { jobId: { in: J } }] }, orderBy: { id: 'asc' } }))
      push('appointment', r, { status: r.status }, { status: CLOSED_STATUS })
  }
  if (J.length) {
    for (const r of await tx.permit.findMany({ where: { accountId, jobId: { in: J }, status: { in: OPEN_PERMIT } }, orderBy: { id: 'asc' } }))
      push('permit', r, { status: r.status }, { status: CLOSED_STATUS })
    for (const r of await tx.notification.findMany({ where: { jobId: { in: J }, read: false }, orderBy: { id: 'asc' } }))
      push('notification', r, { read: false, readAt: null }, { read: true })
  }

  const steps: SnapSteps[] = []
  if (J.length) {
    const s = await tx.businessState.findUnique({ where: { accountId }, select: { jobChecklists: true } })
    const map = s?.jobChecklists && typeof s.jobChecklists === 'object' && !Array.isArray(s.jobChecklists) ? s.jobChecklists : {}
    for (const j of J) if (Object.prototype.hasOwnProperty.call(map, j)) steps.push({ jobId: j, label: `Job steps: ${jobNames.get(j) ?? 'a job'}`, items: map[j] })
  }
  return { closed, steps }
}

/**
 * Close them out, in the caller's transaction, stamped `at`. Each row changes
 * only if it is still as read (a save in between is left alone, and not
 * recorded). Returns what was closed, for the deletion's log row.
 */
export async function closeOutTx(tx: Tx, accountId: string, roots: CloseRoots, at: Date, jobNames?: Map<string, string>): Promise<ClosedOut> {
  const found = await findCloseOut(tx, accountId, roots, jobNames)
  const closed: SnapClosed[] = []
  for (const c of found.closed) {
    const after = c.model === 'notification' ? { read: true, readAt: at.toISOString() } : c.after
    if (await setFields(tx, accountId, c.model, c.id, c.before, after)) closed.push({ ...c, after })
  }
  const steps: SnapSteps[] = []
  if (found.steps.length) {
    await tx.$queryRawUnsafe('SELECT 1 FROM "BusinessState" WHERE "accountId" = $1 FOR UPDATE', accountId)
    const s = await tx.businessState.findUnique({ where: { accountId }, select: { jobChecklists: true } })
    const map = { ...(s?.jobChecklists as Record<string, any> ?? {}) }
    for (const st of found.steps) {
      if (!Object.prototype.hasOwnProperty.call(map, st.jobId)) continue
      steps.push({ ...st, items: map[st.jobId] })
      delete map[st.jobId]
    }
    if (steps.length) await tx.businessState.update({ where: { accountId }, data: { jobChecklists: map, version: { increment: 1 } } })
  }
  return { closed, steps }
}

const asData = (fields: Record<string, any>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, k === 'readAt' && v ? new Date(v) : v]))

/**
 * One row from `from` to `to`, only if it still holds `from`. A deleted
 * appointment keeps its updatedAt (another deletion's restore checks it).
 */
async function setFields(tx: Tx, accountId: string, model: CloseModel, id: string, from: Record<string, any>, to: Record<string, any>): Promise<boolean> {
  const where: any = { id, ...asData(from) }
  if (model !== 'task' && model !== 'notification') where.accountId = accountId
  const data: any = asData(to)
  if (model === 'appointment') {
    const row = await tx.appointment.findFirst({ where, select: { deletedAt: true, updatedAt: true } })
    if (!row) return false
    if (row.deletedAt) data.updatedAt = row.updatedAt
  }
  return (await tx[model].updateMany({ where, data })).count > 0
}

/**
 * Restore: put back what a deletion closed, in the caller's transaction (after
 * the rows themselves are back). Each only if still as the deletion left it.
 */
export async function reopenTx(tx: Tx, accountId: string, snap: { closed?: SnapClosed[]; steps?: SnapSteps[] }): Promise<{ restored: number; skipped: Array<{ what: string; why: string }> }> {
  let restored = 0
  const skipped: Array<{ what: string; why: string }> = []
  for (const c of snap.closed ?? []) {
    if (await setFields(tx, accountId, c.model, c.id, c.after, c.before)) { restored++; continue }
    const now = await tx[c.model].findFirst({ where: { id: c.id }, select: { id: true } })
    skipped.push({ what: c.label, why: now ? 'it changed after it was deleted' : 'it no longer exists' })
  }
  if (snap.steps?.length) {
    await tx.$queryRawUnsafe('SELECT 1 FROM "BusinessState" WHERE "accountId" = $1 FOR UPDATE', accountId)
    const s = await tx.businessState.findUnique({ where: { accountId }, select: { jobChecklists: true } })
    if (!s) for (const st of snap.steps) skipped.push({ what: st.label, why: 'its list is gone' })
    else {
      const map = { ...(s.jobChecklists as Record<string, any> ?? {}) }
      let put = 0
      for (const st of snap.steps) {
        if (Object.prototype.hasOwnProperty.call(map, st.jobId)) { skipped.push({ what: st.label, why: 'the job has steps again' }); continue }
        map[st.jobId] = st.items
        put++
      }
      if (put) await tx.businessState.update({ where: { accountId }, data: { jobChecklists: map, version: { increment: 1 } } })
      restored += put
    }
  }
  return { restored, skipped }
}

// ── Customers deleted before Oct 30 2026 (scripts/close-out-deleted-customers-2026-10-30.ts) ──

/** A deleted customer with something still open, and the deletion that took it (its log row, when there is one). */
export interface Leftover {
  accountId: string
  contactId: string
  name: string
  /** The deletion (not restored) that holds the customer: what closes these, and what a restore reopens. */
  logId: string | null
  roots: CloseRoots
  jobNames: Map<string, string>
  found: ClosedOut
}

/**
 * Every customer still deleted, with what a delete now closes out and theirs
 * still has open: for the customer, its deleted quotes and jobs, and its cards
 * (from the deletion's log). Read only.
 */
export async function leftoversOfDeletedCustomers(tx: Tx, onlyAccount?: string): Promise<Leftover[]> {
  const contacts = await tx.crmContact.findMany({
    where: { deletedAt: { not: null }, ...(onlyAccount ? { accountId: onlyAccount } : {}) },
    select: { id: true, accountId: true, firstName: true, lastName: true }, orderBy: [{ accountId: 'asc' }, { id: 'asc' }],
  })
  const out: Leftover[] = []
  for (const c of contacts) {
    const { accountId } = c
    const quotes = await tx.savedQuote.findMany({ where: { accountId, crmContactId: c.id, deletedAt: { not: null } }, select: { id: true } })
    const Q = quotes.map((q: any) => q.id)
    const jobs = await tx.savedJob.findMany({ where: { accountId, deletedAt: { not: null }, OR: [{ crmContactId: c.id }, ...(Q.length ? [{ quoteId: { in: Q } }] : [])] }, select: { id: true, customerName: true } })
    const log = await tx.deletionLog.findFirst({ where: { accountId, restoredAt: null, ids: { has: c.id } }, orderBy: { deletedAt: 'desc' }, select: { id: true, snapshot: true } })
    const items: any[] = Array.isArray(log?.snapshot?.items) ? log.snapshot.items : []
    const cards = items.filter(i => String(i?.doc).startsWith('pipeline.') && i?.item?.customerId === c.id).map(i => String(i.id))
    const roots: CloseRoots = { contactIds: [c.id], quoteIds: Q, jobIds: jobs.map((j: any) => j.id), cardIds: cards }
    const jobNames = new Map<string, string>(jobs.map((j: any) => [j.id, j.customerName || 'a job']))
    const found = await findCloseOut(tx, accountId, roots, jobNames)
    if (!found.closed.length && !found.steps.length) continue
    const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim().replace(/\s+/g, ' ') || '(no name)'
    out.push({ accountId, contactId: c.id, name, logId: log?.id ?? null, roots, jobNames, found })
  }
  return out
}

/** Close one deleted customer's leftovers out and add them to its deletion's log row, so its restore reopens them. */
export async function closeOutLeftover(tx: Tx, l: Leftover, at: Date): Promise<ClosedOut> {
  const done = await closeOutTx(tx, l.accountId, l.roots, at, l.jobNames)
  if (l.logId && (done.closed.length || done.steps.length)) {
    await tx.$queryRawUnsafe('SELECT 1 FROM "DeletionLog" WHERE id = $1 FOR UPDATE', l.logId)
    const log = await tx.deletionLog.findUnique({ where: { id: l.logId }, select: { snapshot: true } })
    const snap: any = { ...(log.snapshot as any) }
    if (done.closed.length) snap.closed = [...(snap.closed ?? []), ...done.closed]
    if (done.steps.length) snap.steps = [...(snap.steps ?? []), ...done.steps]
    await tx.deletionLog.update({ where: { id: l.logId }, data: { snapshot: JSON.parse(JSON.stringify(snap)) } })
  }
  return done
}
