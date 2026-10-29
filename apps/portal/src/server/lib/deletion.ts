/**
 * Delete, restore, archive and unarchive: one system for every record.
 *
 * Delete (owner and admin only, records.delete) is a soft delete: deletedAt is
 * stamped on the record and on everything that hangs off it, in one
 * transaction, and one DeletionLog row keeps what was removed (the snapshot).
 * Restore (Settings > Deleted Records) reverses exactly what it captured.
 *
 *   customer  its quotes, its jobs (and the jobs of its quotes), appointments
 *             (estimates, warranty and service calls), crew schedule entries
 *             of its jobs, change orders of its quotes, photos, notes,
 *             website and phone intake rows, its pipeline cards (with their
 *             follow up and pending call), invoices, payments, reserved
 *             material orders, pull sheets and statements.
 *   quote     its change orders and the job made from it (with that job's
 *             children), reserved materials and pull sheets of the quote.
 *   job       its appointments, schedule entries, photos, invoices (and
 *             their payments), reserved materials and pull sheets.
 *   card      its follow up and pending calls.
 *
 * Sales Orders (business.pendingOrders) are not taken off the list: one still
 * Pending or Ordered is marked Cancelled, with a note saying why, and the
 * snapshot keeps it as it was (changed), so a restore puts it back exactly.
 * One Received (or already Cancelled) is left as it is: Received is the
 * record of what came in and the stock counts it changed. Review Oct 28 2026:
 * the Sales Order list held Pending orders for jobs that were gone.
 *
 * Queued automation steps (texts, emails) for anything deleted are stopped
 * (status skipped). A restore never sends them again.
 *
 * Restore:
 *   - a row comes back only if it is still exactly as the deletion left it
 *     (same deletedAt and updatedAt); one changed since is skipped and named;
 *   - a card, invoice or other list entry comes back only if nothing with
 *     its id is there already; a row removed outright (a login, a follow up)
 *     only if its id is free;
 *   - a quote, job or card whose customer is deleted is refused: restore the
 *     customer first;
 *   - the log row is never deleted; restoredAt is stamped.
 *
 * Archive (everyday, no log row) stamps archivedAt: off the active boards and
 * lists, kept in search, reports and KPIs, undone from the record. Archiving
 * a customer archives its active cards, quotes and jobs with the same
 * instant; Unarchive brings back only those (one archived on its own earlier
 * stays archived).
 */

import prisma from './prisma.js'
import { ORDER_TO_CANCEL, cancelOrderForDeletion, sameJson } from './ordersOfDeletedJobs.js'

type Tx = any

export const SOFT_MODELS = ['crmContact', 'savedQuote', 'savedJob', 'appointment', 'scheduledGridJob', 'changeOrder', 'mediaItem', 'crmContactNote', 'intakeLead', 'portalPhoto', 'portalFile'] as const
/** Soft models with no accountId or updatedAt of their own (a customer's portal photos and files). */
const NO_ACCOUNT = new Set<SoftModel>(['portalPhoto', 'portalFile'])
export type SoftModel = typeof SOFT_MODELS[number]
export const HARD_MODELS = ['cardFollowUp', 'pendingTouch', 'crmUser', 'scheduleRainDay', 'customerPossibleMatch'] as const
export type HardModel = typeof HARD_MODELS[number]
export type DocName = 'pipeline' | 'business' | 'inventory' | 'vendors'
/** JSON lists inside the per company documents: "<doc>.<field>". */
export type ListDoc =
  | 'pipeline.leads' | 'pipeline.archivedLeads'
  | 'business.invoices' | 'business.payments' | 'business.pendingOrders' | 'business.pullSheets' | 'business.statements'
  | 'inventory.items' | 'inventory.stockLevels'
  | 'vendors.vendors'

export type EntityType = 'customer' | 'quote' | 'job' | 'card' | 'login' | 'inventory_item' | 'vendor' | 'note' | 'photo' | 'file' | 'schedule_entry' | 'rain_day' | 'import'

/**
 * Every place a customer's id is kept, by the field that holds it. A delete
 * takes the soft deletable ones with the customer (plan, below, by these same
 * fields); a merge moves all of them (lib/customerMerge.ts). A new table or
 * list that names a customer goes here.
 * `account: false`: the table has no accountId of its own.
 */
export const CUSTOMER_ID_ROWS = [
  { model: 'savedQuote', field: 'crmContactId', idField: 'id', account: true },
  { model: 'savedJob', field: 'crmContactId', idField: 'id', account: true },
  { model: 'appointment', field: 'crmContactId', idField: 'id', account: true },
  { model: 'mediaItem', field: 'customerId', idField: 'id', account: true },
  { model: 'crmContactNote', field: 'crmContactId', idField: 'id', account: true },
  { model: 'intakeLead', field: 'crmContactId', idField: 'id', account: true },
  { model: 'callLog', field: 'crmContactId', idField: 'id', account: true },
  { model: 'proposalView', field: 'crmContactId', idField: 'id', account: true },
  { model: 'pendingTouch', field: 'crmContactId', idField: 'userId', account: true },
  { model: 'warrantyUpdate', field: 'crmContactId', idField: 'id', account: true },
  { model: 'crmTextConsent', field: 'crmContactId', idField: 'id', account: true },
  { model: 'customerImportRow', field: 'crmContactId', idField: 'id', account: true },
  { model: 'portalAccount', field: 'crmCustomerId', idField: 'id', account: false },
  { model: 'portalPhoto', field: 'crmCustomerId', idField: 'id', account: false },
  { model: 'portalFile', field: 'crmCustomerId', idField: 'id', account: false },
  { model: 'portalMessage', field: 'crmCustomerId', idField: 'id', account: false },
  { model: 'inventoryPendingOrder', field: 'customerId', idField: 'id', account: false },
] as const
/** The company document lists whose entries carry `customerId`. */
export const CUSTOMER_ID_LISTS: ListDoc[] = ['pipeline.leads', 'pipeline.archivedLeads', 'business.invoices', 'business.payments', 'business.pendingOrders', 'business.pullSheets', 'business.statements']
/** Shared lists (AccountKeyValue, apps/web cloudStorage) whose entries carry `customerId`: the activity feed, files, site plans. */
export const CUSTOMER_ID_KV = ['fencepro_customer_activity', 'fencepro_files', 'fencepro_siteplans'] as const

export interface SnapRow { model: SoftModel; id: string; row: any }
export interface SnapHard { model: HardModel; id: string; row: any }
export interface SnapItem { doc: ListDoc; id: string; item: any }
/** A list entry the deletion changed in place (a Sales Order marked Cancelled): as it was, and as the deletion left it. */
export interface SnapChanged { doc: ListDoc; id: string; before: any; after: any }
export interface Snapshot {
  v: 1
  /** Soft deleted rows: deletedAt was set to the log's deletedAt. */
  rows: SnapRow[]
  /** Rows removed outright (a login, a follow up); restore makes them again. */
  hard: SnapHard[]
  /** Entries taken out of a JSON list (a card, an invoice, a catalog item). */
  items: SnapItem[]
  /** Queued automation steps stopped (never queued again by a restore). */
  runsStopped: Array<{ id: string; status: string }>
  /** Entries changed in place (a Sales Order cancelled); not in logs made before Oct 28 2026. */
  changed?: SnapChanged[]
}

export interface Actor { accountId: string; userId: string | null }

export class DeleteError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const TABLE: Record<DocName, { model: string; table: string }> = {
  pipeline: { model: 'pipelineState', table: 'PipelineState' },
  business: { model: 'businessState', table: 'BusinessState' },
  inventory: { model: 'inventoryState', table: 'InventoryState' },
  vendors: { model: 'vendorState', table: 'VendorState' },
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const uniq = (xs: Iterable<string | null | undefined>) => [...new Set([...xs].filter((x): x is string => typeof x === 'string' && !!x))]

/** The id a list entry is known by (stock levels have none of their own). */
export function itemIdOf(doc: ListDoc, item: any): string {
  if (doc === 'inventory.stockLevels') return `${item?.itemId ?? ''}|${item?.locationId ?? ''}`
  return String(item?.id ?? '')
}

export const nameOf = (x: any) => `${x?.firstName ?? ''} ${x?.lastName ?? ''}`.trim().replace(/\s+/g, ' ')
const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

/** What a person reads in the log: a customer's name, "Quote for Smith, ...". */
export function labelOf(model: SoftModel | HardModel | ListDoc, row: any): string {
  switch (model) {
    case 'crmContact': return nameOf(row) || row?.phone || row?.email || 'Customer'
    case 'savedQuote': return ['Quote for ' + (row?.customerName || 'a customer'), row?.fenceStyle, row?.finalPrice ? money(row.finalPrice) : '', row?.date].filter(Boolean).join(', ')
    case 'savedJob': return ['Job for ' + (row?.customerName || 'a customer'), row?.fenceStyle, row?.contractValue ? money(row.contractValue) : ''].filter(Boolean).join(', ')
    case 'appointment': return `${row?.type || 'Appointment'} ${row?.startAt ? new Date(row.startAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : ''}`.trim()
    case 'scheduledGridJob': return `Schedule: ${row?.clientName || ''} ${row?.date || ''}`.trim()
    case 'changeOrder': return `Change order #${row?.number ?? ''}`
    case 'mediaItem': return `Photo${row?.caption ? `: ${row.caption}` : ''}`
    case 'crmContactNote': return `Note: ${String(row?.body ?? '').slice(0, 40)}`
    case 'intakeLead': return `Website or phone lead: ${row?.name || ''}`.trim()
    case 'portalPhoto': return `Customer photo ${row?.originalFilename ?? ''}`.trim()
    case 'portalFile': return `Customer file ${row?.originalFilename ?? ''}`.trim()
    case 'cardFollowUp': return 'Follow up'
    case 'pendingTouch': return 'Pending call'
    case 'crmUser': return `${nameOf(row)} (${row?.email ?? ''})`
    case 'scheduleRainDay': return `Rain day ${row?.originalDate ?? ''}`
    case 'customerPossibleMatch': return 'Possible match'
    case 'pipeline.leads': case 'pipeline.archivedLeads': return `Card: ${nameOf(row) || 'no name'}${row?.stage ? ` (${row.stage})` : ''}`
    case 'business.invoices': return `Invoice ${row?.invoiceNumber ?? ''}`.trim()
    case 'business.payments': return 'Payment'
    case 'business.pendingOrders': return 'Reserved materials'
    case 'business.pullSheets': return 'Pull sheet'
    case 'business.statements': return 'Statement'
    case 'inventory.items': return `Catalog item: ${row?.name ?? ''}`
    case 'inventory.stockLevels': return 'Stock count'
    case 'vendors.vendors': return `Vendor: ${row?.name ?? row?.company ?? ''}`
  }
  return String(model)
}

// ── Company documents (pipeline, settings, inventory, vendors) ──────────────

/** Lock a company document for the rest of the transaction and read it. */
export async function lockDoc(tx: Tx, doc: DocName, accountId: string): Promise<any | null> {
  const t = TABLE[doc]
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${t.table}" WHERE "accountId" = $1 FOR UPDATE`, accountId)
  return tx[t.model].findUnique({ where: { accountId } })
}

export async function writeDoc(tx: Tx, doc: DocName, accountId: string, fields: Record<string, unknown>): Promise<void> {
  await tx[TABLE[doc].model].update({ where: { accountId }, data: { ...json(fields), version: { increment: 1 } } })
}

/** Ids a deletion took off a board and that nothing restored: a waiting change from an older screen must not put them back. */
export async function removedIdsAmong(db: Tx, accountId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db.deletionLog.findMany({ where: { accountId, restoredAt: null, ids: { hasSome: ids } }, select: { ids: true } })
  const want = new Set(ids)
  return new Set(rows.flatMap((r: any) => r.ids.filter((i: string) => want.has(i))))
}

// ── Collecting what goes with a record ──────────────────────────────────────

interface Roots { contactIds: string[]; quoteIds: string[]; jobIds: string[]; cardIds: string[] }

interface Plan {
  rows: Array<{ model: SoftModel; ids: string[] }>
  cards: { leads: string[]; archivedLeads: string[] }
  business: { invoices: string[]; payments: string[]; pendingOrders: string[]; pullSheets: string[]; statements: string[] }
  /** Sales Orders still Pending or Ordered, to mark Cancelled, and why. */
  cancelOrders: Array<{ id: string; why: string }>
  contactIds: string[]; quoteIds: string[]; jobIds: string[]; cardIds: string[]
}

const live = { deletedAt: null }
const idsOf = async (q: Promise<Array<{ id: string }>>) => (await q).map(r => r.id)

async function plan(tx: Tx, accountId: string, roots: Roots): Promise<Plan> {
  const C = uniq(roots.contactIds)
  const Q = uniq([...roots.quoteIds, ...(C.length ? await idsOf(tx.savedQuote.findMany({ where: { accountId, ...live, crmContactId: { in: C } }, select: { id: true } })) : [])])
  const J = uniq([...roots.jobIds, ...((C.length || Q.length) ? await idsOf(tx.savedJob.findMany({ where: { accountId, ...live, OR: [{ crmContactId: { in: C } }, { quoteId: { in: Q } }] }, select: { id: true } })) : [])])
  const by = (model: SoftModel, where: any) => idsOf(tx[model].findMany({ where: { accountId, ...live, ...where }, select: { id: true } }))
  const rows: Plan['rows'] = [
    { model: 'crmContact', ids: C },
    { model: 'savedQuote', ids: Q },
    { model: 'savedJob', ids: J },
    { model: 'appointment', ids: (C.length || Q.length || J.length) ? await by('appointment', { OR: [{ crmContactId: { in: C } }, { quoteId: { in: Q } }, { jobId: { in: J } }] }) : [] },
    { model: 'scheduledGridJob', ids: J.length ? await by('scheduledGridJob', { stagingJobId: { in: J } }) : [] },
    { model: 'changeOrder', ids: Q.length ? await by('changeOrder', { quoteId: { in: Q } }) : [] },
    { model: 'mediaItem', ids: (C.length || J.length) ? await by('mediaItem', { OR: [{ customerId: { in: C } }, { jobId: { in: J } }] }) : [] },
    { model: 'crmContactNote', ids: C.length ? await by('crmContactNote', { crmContactId: { in: C } }) : [] },
    { model: 'intakeLead', ids: C.length ? await by('intakeLead', { crmContactId: { in: C } }) : [] },
  ]
  const pipe = C.length || roots.cardIds.length ? await lockDoc(tx, 'pipeline', accountId) : null
  const cardMatch = (l: any) => l?.id && (roots.cardIds.includes(l.id) || (l.customerId && C.includes(l.customerId)))
  const cards = {
    leads: arr(pipe?.leads).filter(cardMatch).map(l => l.id),
    archivedLeads: arr(pipe?.archivedLeads).filter(cardMatch).map(l => l.id),
  }
  const biz = (C.length || Q.length || J.length) ? await lockDoc(tx, 'business', accountId) : null
  const hit = (x: any) => (x?.customerId && C.includes(x.customerId)) || (x?.jobId && J.includes(x.jobId)) || (x?.quoteId && Q.includes(x.quoteId))
  const invoices = arr(biz?.invoices).filter(hit).map(x => x.id)
  const business = {
    invoices,
    payments: arr(biz?.payments).filter(x => hit(x) || (x?.invoiceId && invoices.includes(x.invoiceId))).map(x => x.id),
    // Sales Orders stay on the list (cancelOrders, below).
    pendingOrders: [] as string[],
    pullSheets: arr(biz?.pullSheets).filter(hit).map(x => x.id),
    statements: arr(biz?.statements).filter(hit).map(x => x.id),
  }
  const cancelOrders = arr(biz?.pendingOrders).filter(x => x?.id && hit(x) && ORDER_TO_CANCEL.has(x.status)).map(x => ({
    id: String(x.id),
    why: x?.jobId && J.includes(x.jobId) ? 'its job was deleted' : x?.quoteId && Q.includes(x.quoteId) ? 'its quote was deleted' : 'its customer was deleted',
  }))
  return { rows, cards, business, cancelOrders, contactIds: C, quoteIds: Q, jobIds: J, cardIds: uniq([...cards.leads, ...cards.archivedLeads]) }
}

// ── Delete ──────────────────────────────────────────────────────────────────

export interface DeleteResult { logId: string; label: string; counts: Record<string, number> }

/** Soft delete a customer, quote, job or card with everything that goes with it, and log it. One transaction. */
export async function deleteRecord(actor: Actor, type: DeletableType, id: string, reason?: string | null): Promise<DeleteResult> {
  return prisma.$transaction((tx: Tx) => deleteRecordTx(tx, actor, type, id, { reason }), { timeout: 30_000 })
}

export type DeletableType = 'customer' | 'quote' | 'job' | 'card'

/** deleteRecord inside a transaction the caller holds. `at` is when it counts as deleted (now, unless given). */
export async function deleteRecordTx(tx: Tx, actor: Actor, type: DeletableType, id: string, opts: { reason?: string | null; at?: Date } = {}): Promise<DeleteResult> {
  {
    const { accountId } = actor
    const at = opts.at ?? new Date()
    const reason = opts.reason
    let label = ''
    const roots: Roots = { contactIds: [], quoteIds: [], jobIds: [], cardIds: [] }
    if (type === 'card') {
      const pipe = await lockDoc(tx, 'pipeline', accountId)
      const card = [...arr(pipe?.leads), ...arr(pipe?.archivedLeads)].find(l => l?.id === id)
      if (!card) throw new DeleteError(404, 'Card not found')
      label = labelOf('pipeline.leads', card)
      roots.cardIds.push(id)
    } else {
      const model = type === 'customer' ? 'crmContact' : type === 'quote' ? 'savedQuote' : 'savedJob'
      const row = await tx[model].findFirst({ where: { id, accountId, ...live } })
      if (!row) throw new DeleteError(404, `${type[0].toUpperCase()}${type.slice(1)} not found`)
      label = labelOf(model, row)
      ;(type === 'customer' ? roots.contactIds : type === 'quote' ? roots.quoteIds : roots.jobIds).push(id)
    }
    const snap = await deleteRootsTx(tx, actor, roots, at)

    const log = await tx.deletionLog.create({ data: {
      accountId, entityType: type, entityId: id, entityLabel: label, snapshot: json(snap),
      ids: idsInSnapshot(snap), deletedByUserId: actor.userId, deletedAt: at, reason: reason?.trim() || null,
    } })
    return { logId: log.id, label, counts: countsOf(snap) }
  }
}

export type DeleteRoots = Roots

/**
 * Soft delete customers, quotes, jobs and cards (many at once) with everything
 * that goes with each, inside the caller's transaction, stamped `at`. Returns
 * the snapshot; the caller writes the one DeletionLog row (deleteRecordTx for
 * one record, an import's undo for a whole import: lib/customerImport.ts).
 */
export async function deleteRootsTx(tx: Tx, actor: Actor, roots: Roots, at: Date): Promise<Snapshot> {
  {
    const { accountId } = actor
    const p = await plan(tx, accountId, roots)
    const snap: Snapshot = { v: 1, rows: [], hard: [], items: [], runsStopped: [] }

    for (const { model, ids } of p.rows) {
      if (!ids.length) continue
      await tx[model].updateMany({ where: { id: { in: ids }, accountId, deletedAt: null }, data: { deletedAt: at } })
      const after = await tx[model].findMany({ where: { id: { in: ids }, deletedAt: at } })
      for (const r of after) snap.rows.push({ model, id: r.id, row: json(r) })
    }

    if (p.cardIds.length) {
      const pipe = await lockDoc(tx, 'pipeline', accountId)
      const take = (list: any[], ids: string[], doc: ListDoc) => list.filter(l => {
        if (!ids.includes(l?.id)) return true
        snap.items.push({ doc, id: l.id, item: json(l) })
        return false
      })
      const leads = take(arr(pipe?.leads), p.cards.leads, 'pipeline.leads')
      const archivedLeads = take(arr(pipe?.archivedLeads), p.cards.archivedLeads, 'pipeline.archivedLeads')
      await writeDoc(tx, 'pipeline', accountId, { leads, archivedLeads })
      const fus = await tx.cardFollowUp.findMany({ where: { accountId, cardId: { in: p.cardIds } } })
      for (const f of fus) snap.hard.push({ model: 'cardFollowUp', id: f.cardId, row: json(f) })
      await tx.cardFollowUp.deleteMany({ where: { accountId, cardId: { in: p.cardIds } } })
      const touches = await tx.pendingTouch.findMany({ where: { accountId, cardId: { in: p.cardIds } } })
      for (const t of touches) snap.hard.push({ model: 'pendingTouch', id: t.userId, row: json(t) })
      await tx.pendingTouch.deleteMany({ where: { accountId, cardId: { in: p.cardIds } } })
    }

    const bizFields = Object.entries(p.business).filter(([, ids]) => ids.length)
    if (bizFields.length || p.cancelOrders.length) {
      const biz = await lockDoc(tx, 'business', accountId)
      const next: Record<string, any[]> = {}
      for (const [field, ids] of bizFields) {
        next[field] = arr(biz?.[field]).filter(x => {
          if (!ids.includes(x?.id)) return true
          snap.items.push({ doc: `business.${field}` as ListDoc, id: x.id, item: json(x) })
          return false
        })
      }
      if (p.cancelOrders.length) {
        const why = new Map(p.cancelOrders.map(c => [c.id, c.why]))
        snap.changed = []
        next.pendingOrders = arr(next.pendingOrders ?? biz?.pendingOrders).map(o => {
          const w = o?.id ? why.get(String(o.id)) : undefined
          if (!w || !ORDER_TO_CANCEL.has(o.status)) return o
          const after = cancelOrderForDeletion(o, w, at)
          snap.changed!.push({ doc: 'business.pendingOrders', id: String(o.id), before: json(o), after: json(after) })
          return after
        })
      }
      await writeDoc(tx, 'business', accountId, next)
    }

    snap.runsStopped = await stopRuns(tx, accountId, [...p.contactIds, ...p.quoteIds, ...p.jobIds, ...p.cardIds], at)
    return snap
  }
}

/** Queued or waiting automation steps for these records stop (a text never goes about a deleted record). */
async function stopRuns(tx: Tx, accountId: string, entityIds: string[], at: Date): Promise<Snapshot['runsStopped']> {
  if (!entityIds.length) return []
  const runs = await tx.automationRun.findMany({ where: { accountId, entityId: { in: entityIds }, status: { in: ['queued', 'waiting'] } } })
  for (const r of runs) {
    await tx.automationRun.update({ where: { id: r.id }, data: {
      status: 'skipped', lastError: 'Stopped: the record was deleted',
      log: [...arr(r.log), { at: at.toISOString(), step: r.stepIndex, result: 'skipped', detail: 'stopped: the record was deleted' }],
    } })
  }
  return runs.map((r: any) => ({ id: r.id, status: r.status }))
}

export function idsInSnapshot(s: Snapshot): string[] {
  return uniq([...s.rows.map(r => r.id), ...s.hard.map(h => h.id), ...s.items.map(i => i.id), ...(s.changed ?? []).map(c => c.id)])
}

/** How many of each kind the snapshot holds ("3 quotes, 1 job, 1 card"). */
export function countsOf(s: Snapshot): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (k: string) => { out[k] = (out[k] ?? 0) + 1 }
  for (const r of s.rows) add(r.model)
  for (const h of s.hard) add(h.model)
  for (const i of s.items) add(i.doc)
  for (const c of s.changed ?? []) add(`${c.doc}.cancelled`)
  return out
}

// ── Logging a delete made elsewhere (a card dropped by a board save, a login, a catalog item) ──

export async function logDeletion(tx: Tx, actor: Actor, entry: { entityType: EntityType; entityId: string; entityLabel: string; snapshot: Snapshot; at?: Date; reason?: string | null }): Promise<string> {
  const log = await tx.deletionLog.create({ data: {
    accountId: actor.accountId, entityType: entry.entityType, entityId: entry.entityId, entityLabel: entry.entityLabel,
    snapshot: json(entry.snapshot), ids: idsInSnapshot(entry.snapshot), deletedByUserId: actor.userId,
    deletedAt: entry.at ?? new Date(), reason: entry.reason?.trim() || null,
  } })
  return log.id
}

export const emptySnapshot = (): Snapshot => ({ v: 1, rows: [], hard: [], items: [], runsStopped: [] })

/**
 * A board save dropped these cards (Delete lead on the board): one log row
 * per card, with its follow up and pending calls, in the save's transaction.
 * Call before the save's follow up step removes the follow ups.
 */
export async function logRemovedCards(tx: Tx, actor: Actor, before: any[], after: any[], at = new Date()): Promise<number> {
  const kept = new Set(after.filter(l => l?.id).map(l => l.id))
  const gone = before.filter(l => l?.id && !kept.has(l.id))
  for (const card of gone) {
    const snap = emptySnapshot()
    snap.items.push({ doc: 'pipeline.leads', id: card.id, item: json(card) })
    const fu = await tx.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId: actor.accountId, cardId: card.id } } })
    if (fu) snap.hard.push({ model: 'cardFollowUp', id: card.id, row: json(fu) })
    const touches = await tx.pendingTouch.findMany({ where: { accountId: actor.accountId, cardId: card.id } })
    for (const t of touches) snap.hard.push({ model: 'pendingTouch', id: t.userId, row: json(t) })
    await tx.pendingTouch.deleteMany({ where: { accountId: actor.accountId, cardId: card.id } })
    snap.runsStopped = await stopRuns(tx, actor.accountId, [card.id], at)
    await logDeletion(tx, actor, { entityType: 'card', entityId: card.id, entityLabel: labelOf('pipeline.leads', card), snapshot: snap, at })
  }
  return gone.length
}

/** Catalog items dropped by an inventory save: one log row each, with their stock counts. */
export async function logRemovedInventoryItems(tx: Tx, actor: Actor, before: { items?: unknown; stockLevels?: unknown } | null, after: { items: any[]; stockLevels: any[] }, at = new Date()): Promise<number> {
  const kept = new Set(after.items.map(i => i?.id))
  const gone = arr(before?.items).filter(i => i?.id && !kept.has(i.id))
  const levelsKept = new Set(after.stockLevels.map(l => itemIdOf('inventory.stockLevels', l)))
  for (const item of gone) {
    const snap = emptySnapshot()
    snap.items.push({ doc: 'inventory.items', id: item.id, item: json(item) })
    for (const l of arr(before?.stockLevels)) {
      const lid = itemIdOf('inventory.stockLevels', l)
      if (l?.itemId === item.id && !levelsKept.has(lid)) snap.items.push({ doc: 'inventory.stockLevels', id: lid, item: json(l) })
    }
    await logDeletion(tx, actor, { entityType: 'inventory_item', entityId: item.id, entityLabel: labelOf('inventory.items', item), snapshot: snap, at })
  }
  return gone.length
}

/** Vendors dropped by a vendors save: one log row each (their bills stay: they are the books). */
export async function logRemovedVendors(tx: Tx, actor: Actor, before: unknown, after: any[], at = new Date()): Promise<number> {
  const kept = new Set(after.map(v => v?.id))
  const gone = arr(before).filter(v => v?.id && !kept.has(v.id))
  for (const v of gone) {
    const snap = emptySnapshot()
    snap.items.push({ doc: 'vendors.vendors', id: v.id, item: json(v) })
    await logDeletion(tx, actor, { entityType: 'vendor', entityId: v.id, entityLabel: labelOf('vendors.vendors', v), snapshot: snap, at })
  }
  return gone.length
}

/** A login as kept in the log: never its password or invite secrets (a restored login is invited again). */
export function loginForLog(u: any): any {
  const { passwordHash: _p, inviteTokenHash: _i, inviteTokenExpiresAt: _e, failedLoginAttempts: _f, lockedUntil: _l, ...rest } = json(u)
  return rest
}

// ── Restore ─────────────────────────────────────────────────────────────────

export interface RestoreResult { restored: number; skipped: Array<{ what: string; why: string }> }

export async function restoreDeletion(actor: Actor, logId: string): Promise<RestoreResult> {
  return prisma.$transaction(async (tx: Tx) => {
    const { accountId } = actor
    await tx.$queryRaw`SELECT 1 FROM "DeletionLog" WHERE id = ${logId} FOR UPDATE`
    const log = await tx.deletionLog.findFirst({ where: { id: logId, accountId } })
    if (!log) throw new DeleteError(404, 'Not found in Deleted Records')
    if (log.restoredAt) throw new DeleteError(409, 'Already restored')
    // An undone import (lib/customerImport.ts): refused when its rows were imported again since.
    const importHooks = log.entityType === 'import' ? await import('./customerImport.js') : null
    if (importHooks) await importHooks.beforeImportRestore(tx, accountId, log.entityId)
    const snap = log.snapshot as Snapshot
    const at = new Date(log.deletedAt)
    const skipped: RestoreResult['skipped'] = []
    let restored = 0

    // A quote, job, card, note or photo of a customer that is still deleted waits for the customer.
    const rootRow = snap.rows.find(r => r.id === log.entityId)
    const rootItem = snap.items.find(i => i.id === log.entityId)
    const contactId = log.entityType === 'customer' ? null
      : rootRow?.row?.crmContactId ?? rootRow?.row?.crmCustomerId ?? rootRow?.row?.customerId ?? rootItem?.item?.customerId ?? null
    if (contactId) {
      const c = await tx.crmContact.findFirst({ where: { id: contactId, accountId }, select: { deletedAt: true, firstName: true, lastName: true } })
      if (c?.deletedAt) throw new DeleteError(409, `${nameOf(c) || 'The customer'} is deleted. Restore the customer first.`)
    }

    // The record itself first: if it changed after the deletion, nothing is restored.
    const ordered = [...snap.rows].sort((a, b) => (a.id === log.entityId ? -1 : b.id === log.entityId ? 1 : 0))
    for (const r of ordered) {
      const same = NO_ACCOUNT.has(r.model) ? { deletedAt: at } : { accountId, deletedAt: at, updatedAt: new Date(r.row.updatedAt) }
      const done = await tx[r.model].updateMany({ where: { id: r.id, ...same }, data: { deletedAt: null } })
      if (done.count) { restored++; continue }
      const now = await tx[r.model].findFirst({ where: { id: r.id }, select: { deletedAt: true } })
      const why = !now ? 'it no longer exists' : !now.deletedAt ? 'it is already back' : 'it changed after it was deleted'
      if (r.id === log.entityId) throw new DeleteError(409, `Not restored: ${labelOf(r.model, r.row)}, ${why}.`)
      skipped.push({ what: labelOf(r.model, r.row), why })
    }

    for (const h of snap.hard) {
      const ok = await recreate(tx, accountId, h)
      if (ok === true) restored++
      else {
        if (log.entityId === h.id && log.entityType === 'login') throw new DeleteError(409, `Not restored: ${labelOf(h.model, h.row)}, ${ok}.`)
        skipped.push({ what: labelOf(h.model, h.row), why: ok })
      }
    }

    const byDoc = new Map<DocName, SnapItem[]>()
    for (const i of snap.items) {
      const d = i.doc.split('.')[0] as DocName
      byDoc.set(d, [...(byDoc.get(d) ?? []), i])
    }
    for (const [doc, items] of byDoc) {
      const cur = await lockDoc(tx, doc, accountId)
      if (!cur) { for (const i of items) skipped.push({ what: labelOf(i.doc, i.item), why: 'its list is gone' }); continue }
      const fields: Record<string, any[]> = {}
      // A card is only in one of the two pipeline lists.
      const present = (field: string, id: string) => doc === 'pipeline'
        ? [...arr(fields.leads ?? cur.leads), ...arr(fields.archivedLeads ?? cur.archivedLeads)].some(l => l?.id === id)
        : arr(fields[field] ?? cur[field]).some(x => itemIdOf(`${doc}.${field}` as ListDoc, x) === id)
      for (const i of items) {
        const field = i.doc.split('.')[1]
        if (present(field, i.id)) {
          if (i.id === log.entityId) throw new DeleteError(409, `Not restored: ${labelOf(i.doc, i.item)}, it is already back.`)
          skipped.push({ what: labelOf(i.doc, i.item), why: 'one with the same id is already there' }); continue
        }
        fields[field] = [...arr(fields[field] ?? cur[field]), i.item]
        restored++
      }
      if (Object.keys(fields).length) await writeDoc(tx, doc, accountId, fields)
    }

    // Entries the deletion changed in place (a Sales Order it cancelled): back as they were, only if still as it left them.
    const changedByDoc = new Map<DocName, SnapChanged[]>()
    for (const c of snap.changed ?? []) {
      const d = c.doc.split('.')[0] as DocName
      changedByDoc.set(d, [...(changedByDoc.get(d) ?? []), c])
    }
    for (const [doc, list] of changedByDoc) {
      const cur = await lockDoc(tx, doc, accountId)
      const fields: Record<string, any[]> = {}
      for (const c of list) {
        const field = c.doc.split('.')[1]
        const now = arr(fields[field] ?? cur?.[field])
        const at = now.findIndex(x => itemIdOf(c.doc, x) === c.id)
        const what = c.doc === 'business.pendingOrders' ? `Sales Order ${c.before?.quoteName || c.before?.customerName || c.id}`.trim() : labelOf(c.doc, c.before)
        if (at < 0) { skipped.push({ what, why: 'it no longer exists' }); continue }
        if (!sameJson(now[at], c.after)) { skipped.push({ what, why: 'it changed after it was deleted' }); continue }
        fields[field] = now.map((x, i) => (i === at ? c.before : x))
        restored++
      }
      if (Object.keys(fields).length) await writeDoc(tx, doc, accountId, fields)
    }

    if (importHooks) skipped.push(...await importHooks.afterImportRestore(tx, actor, log.entityId))

    if (snap.runsStopped.length) skipped.push({ what: `${snap.runsStopped.length} automation step${snap.runsStopped.length === 1 ? '' : 's'} (texts, emails)`, why: 'stopped when deleted; not sent again' })

    await tx.deletionLog.update({ where: { id: log.id }, data: { restoredAt: new Date(), restoredByUserId: actor.userId, restoreResult: json({ restored, skipped }) } })
    return { restored, skipped }
  }, { timeout: 30_000 })
}

const DATE_FIELDS: Record<HardModel, string[]> = {
  cardFollowUp: ['lastContactAt', 'createdAt', 'updatedAt'],
  pendingTouch: ['startedAt'],
  crmUser: ['lastLoginAt', 'createdAt', 'updatedAt'],
  scheduleRainDay: ['flaggedAt'],
  customerPossibleMatch: ['decidedAt', 'createdAt'],
}

/** Make a row removed outright again. true, or why not. */
async function recreate(tx: Tx, accountId: string, h: SnapHard): Promise<true | string> {
  const data: any = { ...h.row }
  for (const f of DATE_FIELDS[h.model]) if (data[f]) data[f] = new Date(data[f])
  if (h.model === 'cardFollowUp') {
    if (await tx.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: h.id } } })) return 'it is already there'
  } else if (h.model === 'pendingTouch') {
    if (await tx.pendingTouch.findUnique({ where: { userId: h.id } })) return 'that person has a newer pending call'
    if (!(await tx.crmUser.findUnique({ where: { id: h.id }, select: { id: true } }))) return 'that login is deleted'
  } else if (h.model === 'crmUser') {
    if (await tx.crmUser.findUnique({ where: { id: h.id } })) return 'it is already there'
    if (await tx.crmUser.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' } } })) return 'another login uses that email now'
    if (data.invitedById && !(await tx.crmUser.findUnique({ where: { id: data.invitedById }, select: { id: true } }))) data.invitedById = null
    // Signed out, no password: the owner sends the invite again from Team.
    Object.assign(data, { status: 'invited', mustChangePassword: true, passwordHash: null })
  } else if (h.model === 'scheduleRainDay') {
    if (await tx.scheduleRainDay.findUnique({ where: { id: h.id } })) return 'it is already there'
  } else if (h.model === 'customerPossibleMatch') {
    if (await tx.customerPossibleMatch.findUnique({ where: { id: h.id } })) return 'it is already there'
    if (await tx.customerPossibleMatch.findUnique({ where: { contactId_matchId: { contactId: data.contactId, matchId: data.matchId } } })) return 'the same pair is there again'
  }
  await tx[h.model].create({ data })
  return true
}

// ── Archive ─────────────────────────────────────────────────────────────────

export type ArchiveType = 'customer' | 'job' | 'card'

/** Archive (on) or unarchive (off) a customer, job or card. Returns the archivedAt it now has. */
export async function setArchived(actor: Actor, type: ArchiveType, id: string, on: boolean): Promise<{ archivedAt: string | null; label: string }> {
  return prisma.$transaction(async (tx: Tx) => {
    const { accountId } = actor
    if (type === 'card') return archiveCards(tx, accountId, c => c.id === id, on, on ? new Date() : null, true)
    const model = type === 'customer' ? 'crmContact' : 'savedJob'
    const row = await tx[model].findFirst({ where: { id, accountId, ...live } })
    if (!row) throw new DeleteError(404, `${type === 'customer' ? 'Customer' : 'Job'} not found`)
    const label = labelOf(model, row)
    if (on === !!row.archivedAt) return { archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null, label }
    const at = on ? new Date() : null
    await tx[model].update({ where: { id }, data: { archivedAt: at } })
    if (type === 'customer') {
      // Its cards, quotes and jobs go with it; unarchive brings back only those archived with it (same instant).
      const was: Date = row.archivedAt
      const childWhere = on ? { archivedAt: null } : { archivedAt: was }
      const Q = await idsOf(tx.savedQuote.findMany({ where: { accountId, ...live, crmContactId: id }, select: { id: true } }))
      await tx.savedQuote.updateMany({ where: { accountId, ...live, crmContactId: id, ...childWhere }, data: { archivedAt: at } })
      await tx.savedJob.updateMany({ where: { accountId, ...live, OR: [{ crmContactId: id }, { quoteId: { in: Q } }], ...childWhere }, data: { archivedAt: at } })
      const wasIso = was ? new Date(was).toISOString() : null
      await archiveCards(tx, accountId, c => c.customerId === id && (on || c.archivedAt === wasIso), on, at, false)
    }
    return { archivedAt: at ? at.toISOString() : null, label }
  }, { timeout: 30_000 })
}

async function archiveCards(tx: Tx, accountId: string, match: (c: any) => boolean, on: boolean, at: Date | null, mustFind: boolean): Promise<{ archivedAt: string | null; label: string }> {
  const pipe = await lockDoc(tx, 'pipeline', accountId)
  const leads = arr(pipe?.leads), archived = arr(pipe?.archivedLeads)
  const from = on ? leads : archived
  const moving = from.filter(c => c?.id && match(c))
  if (!moving.length) {
    if (!mustFind) return { archivedAt: at ? at.toISOString() : null, label: '' }
    const there = (on ? archived : leads).find(c => c?.id && match(c))
    if (!there) throw new DeleteError(404, 'Card not found')
    return { archivedAt: there.archivedAt ?? null, label: labelOf('pipeline.leads', there) }
  }
  const ids = new Set(moving.map(c => c.id))
  const moved = moving.map(c => {
    const { archivedAt: _a, ...rest } = c
    return on ? { ...rest, archivedAt: at!.toISOString() } : rest
  })
  const rest = from.filter(c => !ids.has(c?.id))
  // Unarchived cards go back on the board in front of the others in their stage.
  await writeDoc(tx, 'pipeline', accountId, on ? { leads: rest, archivedLeads: [...moved, ...archived] } : { leads: [...moved, ...leads], archivedLeads: rest })
  return { archivedAt: on ? at!.toISOString() : null, label: labelOf('pipeline.leads', moving[0]) }
}

/**
 * Soft delete single rows (a schedule entry, a photo, a note), one Deleted
 * Records row each. Only rows not deleted already; returns how many.
 */
export async function softDeleteLogged(tx: Tx, actor: Actor, model: SoftModel, entityType: EntityType, ids: string[], label?: (row: any) => string): Promise<number> {
  if (!ids.length) return 0
  const at = new Date()
  const done = await tx[model].updateMany({ where: { id: { in: ids }, accountId: actor.accountId, deletedAt: null }, data: { deletedAt: at } })
  if (!done.count) return 0
  const rows = await tx[model].findMany({ where: { id: { in: ids }, deletedAt: at } })
  for (const r of rows) {
    const snap = emptySnapshot()
    snap.rows.push({ model, id: r.id, row: json(r) })
    await logDeletion(tx, actor, { entityType, entityId: r.id, entityLabel: label ? label(r) : labelOf(model, r), snapshot: snap, at })
  }
  return rows.length
}
