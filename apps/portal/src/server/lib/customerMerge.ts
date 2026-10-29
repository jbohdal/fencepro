/**
 * Possible matches and merging two customers.
 *
 * A website or phone lead always makes a new customer (lib/intake.ts). A
 * customer on file with the same email (any capitals) or phone (last 10
 * digits) is kept as a possible match on the new one. The customer page and
 * the pipeline card show "Possible match: <name>, <phone>. Use <name>?":
 *
 *   Merge                 everything that names the new customer by id moves
 *                         to the one on file (every place in deletion.ts's
 *                         CUSTOMER_ID_ROWS, CUSTOMER_ID_LISTS, CUSTOMER_ID_KV).
 *                         The customer on file is not changed at all; the new
 *                         one is kept, archived, with mergedIntoId, and its
 *                         details as they were are in the merge record. One
 *                         transaction; the merge record lists every id moved.
 *   Not the same person   the match is kept as dismissed, so it does not come back.
 *   Undo merge            (on the kept customer's page) moves exactly the
 *                         records listed back and brings the merged customer
 *                         back as it was. Refused, with nothing changed, when
 *                         any of them has been put with another customer since.
 *
 * Who: anyone who may archive customers (records.archive), the same for Undo.
 */

import prisma from './prisma.js'
import { CUSTOMER_ID_ROWS, CUSTOMER_ID_LISTS, CUSTOMER_ID_KV, lockDoc, writeDoc, labelOf, nameOf, type ListDoc, type DocName, type Actor } from './deletion.js'

type Tx = any

export class MergeError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** What one merge moved, by the id of each record (ids per table, per list, per shared key). */
export interface Moved {
  rows: Array<{ model: string; field: string; ids: string[] }>
  items: Array<{ doc: ListDoc; ids: string[] }>
  kv: Array<{ key: string; ids: string[] }>
  /** Each one's texting answer at the merge (yes | no | unknown). The kept one's is not changed; a "no" from the merged one keeps texts blocked until a yes is recorded (lib/textConsent.ts mergedTextNo). */
  textConsent?: { kept: string; merged: string }
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const digits10 = (phone: string | null | undefined) => {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

// ── Finding them (a new lead) ───────────────────────────────────────────────

export interface MatchFound { id: string; reason: string }

/**
 * Customers on file (not deleted, archived or merged away) with this email or
 * phone. Read only: nothing is attached to them.
 */
export async function findPossibleMatches(db: Pick<typeof prisma, 'crmContact'>, accountId: string, input: { phone?: string | null; email?: string | null }, excludeId?: string): Promise<MatchFound[]> {
  const phone10 = digits10(input.phone)
  const email = (input.email || '').trim().toLowerCase()
  const why = new Map<string, Set<string>>()
  const add = (id: string, r: string) => { if (id !== excludeId) why.set(id, (why.get(id) ?? new Set()).add(r)) }
  if (email) {
    for (const c of await db.crmContact.findMany({ where: { accountId, deletedAt: null, archivedAt: null, mergedIntoId: null, email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) add(c.id, 'email')
  }
  if (phone10.length >= 7) {
    // Phones are stored as typed ("(352) 555-0100"), so compare on digits.
    for (const c of await db.crmContact.findMany({ where: { accountId, deletedAt: null, archivedAt: null, mergedIntoId: null, phone: { not: null } }, select: { id: true, phone: true } })) {
      if (digits10(c.phone) === phone10) add(c.id, 'phone')
    }
  }
  return [...why].slice(0, 5).map(([id, r]) => ({ id, reason: r.size > 1 ? 'email and phone' : [...r][0] }))
}

// ── What a person reads ─────────────────────────────────────────────────────

const ROW_WORD: Record<string, [string, string]> = {
  savedQuote: ['quote', 'quotes'], savedJob: ['job', 'jobs'], appointment: ['appointment', 'appointments'],
  mediaItem: ['photo', 'photos'], crmContactNote: ['note', 'notes'], intakeLead: ['website or phone lead', 'website or phone leads'],
  callLog: ['logged call', 'logged calls'], proposalView: ['proposal open', 'proposal opens'], pendingTouch: ['pending call', 'pending calls'],
  warrantyUpdate: ['warranty update', 'warranty updates'], crmTextConsent: ['texting answer', 'texting answers'], portalAccount: ['portal login', 'portal logins'], portalPhoto: ['portal photo', 'portal photos'],
  portalFile: ['portal file', 'portal files'], portalMessage: ['portal message', 'portal messages'], inventoryPendingOrder: ['material order', 'material orders'],
}
const LIST_WORD: Record<string, [string, string]> = {
  'pipeline.leads': ['card', 'cards'], 'pipeline.archivedLeads': ['archived card', 'archived cards'],
  'business.invoices': ['invoice', 'invoices'], 'business.payments': ['payment', 'payments'], 'business.pendingOrders': ['reserved materials', 'reserved materials'],
  'business.pullSheets': ['pull sheet', 'pull sheets'], 'business.statements': ['statement', 'statements'],
  fencepro_customer_activity: ['activity line', 'activity lines'], fencepro_files: ['file', 'files'], fencepro_siteplans: ['site plan', 'site plans'],
}
const words = (n: number, w: [string, string] | undefined, fallback: string) => `${n} ${w ? (n === 1 ? w[0] : w[1]) : fallback}`

/** "2 quotes, 1 card, 3 notes": what a merge moved. */
export function movedSummary(m: Moved): string[] {
  return [
    ...m.rows.map(r => words(r.ids.length, ROW_WORD[r.model], r.model)),
    ...m.items.map(i => words(i.ids.length, LIST_WORD[i.doc], i.doc)),
    ...m.kv.map(k => words(k.ids.length, LIST_WORD[k.key], k.key)),
  ]
}

function rowLabel(model: string, row: any): string {
  const known = ['savedQuote', 'savedJob', 'appointment', 'mediaItem', 'crmContactNote', 'intakeLead', 'portalPhoto', 'portalFile', 'pendingTouch']
  return known.includes(model) ? labelOf(model as any, row) : (ROW_WORD[model]?.[0] ?? model).replace(/^./, c => c.toUpperCase())
}

function itemLabel(where: string, item: any): string {
  if (where.includes('.')) return labelOf(where as ListDoc, item)
  return `${(LIST_WORD[where]?.[0] ?? where).replace(/^./, c => c.toUpperCase())}${item?.name ? `: ${item.name}` : item?.body ? `: ${String(item.body).slice(0, 40)}` : ''}`
}

// ── Moving ──────────────────────────────────────────────────────────────────

/**
 * Point every record of customer `from` at customer `to`. With `only`, just
 * those records (an undo); without, everything that names `from`.
 */
async function moveAll(tx: Tx, accountId: string, from: string, to: string, only: Moved | null): Promise<Moved> {
  const out: Moved = { rows: [], items: [], kv: [] }

  for (const p of CUSTOMER_ID_ROWS) {
    const want = only ? (only.rows.find(r => r.model === p.model)?.ids ?? []) : null
    if (want && !want.length) continue
    const where = { ...(p.account ? { accountId } : {}), [p.field]: from, ...(want ? { [p.idField]: { in: want } } : {}) }
    const ids: string[] = (await tx[p.model].findMany({ where, select: { [p.idField]: true } })).map((r: any) => r[p.idField])
    if (!ids.length) continue
    await tx[p.model].updateMany({ where: { [p.idField]: { in: ids }, [p.field]: from }, data: { [p.field]: to } })
    out.rows.push({ model: p.model, field: p.field, ids })
  }

  const docs = [...new Set(CUSTOMER_ID_LISTS.map(d => d.split('.')[0] as DocName))]
  for (const doc of docs) {
    const lists = CUSTOMER_ID_LISTS.filter(d => d.startsWith(`${doc}.`) && (!only || only.items.some(i => i.doc === d && i.ids.length)))
    if (!lists.length) continue
    const cur = await lockDoc(tx, doc, accountId)
    if (!cur) continue
    const fields: Record<string, any[]> = {}
    for (const ld of lists) {
      const field = ld.split('.')[1]
      const want = only ? new Set(only.items.find(i => i.doc === ld)?.ids ?? []) : null
      const ids: string[] = []
      const next = arr(cur[field]).map(x => {
        if (!x?.id || x.customerId !== from || (want && !want.has(String(x.id)))) return x
        ids.push(String(x.id))
        return { ...x, customerId: to }
      })
      if (ids.length) { fields[field] = next; out.items.push({ doc: ld, ids }) }
    }
    if (Object.keys(fields).length) await writeDoc(tx, doc, accountId, fields)
  }

  for (const key of CUSTOMER_ID_KV) {
    const want = only ? new Set(only.kv.find(k => k.key === key)?.ids ?? []) : null
    if (want && !want.size) continue
    await tx.$queryRaw`SELECT 1 FROM "AccountKeyValue" WHERE "accountId" = ${accountId} AND key = ${key} FOR UPDATE`
    const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key } } })
    if (!row || !Array.isArray(row.value)) continue
    const ids: string[] = []
    const next = (row.value as any[]).map(x => {
      if (!x?.id || x.customerId !== from || (want && !want.has(String(x.id)))) return x
      ids.push(String(x.id))
      return { ...x, customerId: to }
    })
    if (!ids.length) continue
    // A new version: a screen holding the old list puts its own change on top of this one.
    await tx.accountKeyValue.update({ where: { accountId_key: { accountId, key } }, data: { value: json(next), version: { increment: 1 } } })
    out.kv.push({ key, ids })
  }
  return out
}

// ── Merge, Not the same person, Undo ────────────────────────────────────────

export interface MergeResult { mergeId: string; keptId: string; mergedId: string; keptName: string; mergedName: string; moved: string[] }

/** Merge the new customer of a possible match into the customer on file. One transaction. */
export async function mergeMatch(actor: Actor, matchRowId: string): Promise<MergeResult & { movedIds: Moved }> {
  return prisma.$transaction(async (tx: Tx) => {
    const { accountId } = actor
    await tx.$queryRaw`SELECT 1 FROM "CustomerPossibleMatch" WHERE id = ${matchRowId} FOR UPDATE`
    const m = await tx.customerPossibleMatch.findFirst({ where: { id: matchRowId, accountId } })
    if (!m) throw new MergeError(404, 'That possible match is not there any more.')
    if (m.status === 'merged') throw new MergeError(409, 'These two are already merged.')
    if (m.status !== 'open') throw new MergeError(409, 'This was marked Not the same person.')
    await tx.$queryRaw`SELECT 1 FROM "CrmContact" WHERE id = ${m.contactId} FOR UPDATE`
    await tx.$queryRaw`SELECT 1 FROM "CrmContact" WHERE id = ${m.matchId} FOR UPDATE`
    const from = await tx.crmContact.findFirst({ where: { id: m.contactId, accountId } })
    const into = await tx.crmContact.findFirst({ where: { id: m.matchId, accountId } })
    if (!from || from.deletedAt) throw new MergeError(409, 'The new customer is deleted.')
    if (from.mergedIntoId) throw new MergeError(409, `${nameOf(from) || 'The new customer'} is already merged into another customer.`)
    if (!into || into.deletedAt) throw new MergeError(409, `${nameOf(into) || 'The customer on file'} is deleted.`)
    if (into.mergedIntoId) throw new MergeError(409, `${nameOf(into)} was merged into another customer. Open that one instead.`)

    const moved: Moved = { ...(await moveAll(tx, accountId, from.id, into.id, null)), textConsent: { kept: into.textConsent ?? 'unknown', merged: from.textConsent ?? 'unknown' } }
    const now = new Date()
    // The merged customer stays (archived, pointing at the kept one); the kept customer's record is not touched.
    await tx.crmContact.update({ where: { id: from.id }, data: { mergedIntoId: into.id, archivedAt: from.archivedAt ?? now } })
    await tx.customerPossibleMatch.update({ where: { id: m.id }, data: { status: 'merged', decidedAt: now, decidedById: actor.userId } })
    const merge = await tx.customerMerge.create({ data: {
      accountId, keptId: into.id, mergedId: from.id, matchRowId: m.id,
      mergedLabel: nameOf(from) || from.phone || from.email || 'Customer',
      mergedDetails: json(from), moved: json(moved), mergedById: actor.userId, mergedAt: now,
    } })
    return { mergeId: merge.id, keptId: into.id, mergedId: from.id, keptName: nameOf(into), mergedName: nameOf(from), moved: movedSummary(moved), movedIds: moved }
  }, { timeout: 30_000 })
}

/** Not the same person: kept as dismissed so it is not offered again. */
export async function dismissMatch(actor: Actor, matchRowId: string): Promise<void> {
  const done = await prisma.customerPossibleMatch.updateMany({ where: { id: matchRowId, accountId: actor.accountId, status: 'open' }, data: { status: 'dismissed', decidedAt: new Date(), decidedById: actor.userId } })
  if (done.count) return
  const m = await prisma.customerPossibleMatch.findFirst({ where: { id: matchRowId, accountId: actor.accountId }, select: { status: true } })
  if (!m) throw new MergeError(404, 'That possible match is not there any more.')
  if (m.status === 'merged') throw new MergeError(409, 'These two are already merged.')
}

/** Undo a merge: exactly the records it moved go back, and the merged customer comes back as it was. */
export async function undoMerge(actor: Actor, mergeId: string): Promise<MergeResult & { gone: number }> {
  return prisma.$transaction(async (tx: Tx) => {
    const { accountId } = actor
    await tx.$queryRaw`SELECT 1 FROM "CustomerMerge" WHERE id = ${mergeId} FOR UPDATE`
    const mg = await tx.customerMerge.findFirst({ where: { id: mergeId, accountId } })
    if (!mg) throw new MergeError(404, 'That merge is not there.')
    if (mg.undoneAt) throw new MergeError(409, 'This merge was already undone.')
    const moved = mg.moved as unknown as Moved
    const kept = await tx.crmContact.findFirst({ where: { id: mg.keptId, accountId } })
    const merged = await tx.crmContact.findFirst({ where: { id: mg.mergedId, accountId } })
    if (!merged) throw new MergeError(409, `${mg.mergedLabel} is no longer on file, so the merge cannot be undone.`)
    if (merged.deletedAt) throw new MergeError(409, `${mg.mergedLabel} is deleted. Restore them from Settings > Deleted Records first.`)
    if (merged.mergedIntoId !== mg.keptId) throw new MergeError(409, `${mg.mergedLabel} is no longer merged into ${nameOf(kept) || 'this customer'}.`)

    // Every record it moved must still be with the kept customer; one put with someone else since stops the undo.
    const changed: string[] = []
    for (const r of moved.rows ?? []) {
      const p = CUSTOMER_ID_ROWS.find(x => x.model === r.model)
      if (!p || !r.ids.length) continue
      const rows = await tx[p.model].findMany({ where: { [p.idField]: { in: r.ids } } })
      for (const row of rows) if (row[p.field] !== mg.keptId) changed.push(rowLabel(p.model, row))
    }
    for (const i of moved.items ?? []) {
      const [doc, field] = i.doc.split('.') as [DocName, string]
      const cur = await lockDoc(tx, doc, accountId)
      const want = new Set(i.ids)
      for (const x of arr(cur?.[field])) {
        if (!x?.id || !want.has(String(x.id))) continue
        if (x.customerId !== mg.keptId) changed.push(itemLabel(i.doc, x))
      }
    }
    for (const k of moved.kv ?? []) {
      await tx.$queryRaw`SELECT 1 FROM "AccountKeyValue" WHERE "accountId" = ${accountId} AND key = ${k.key} FOR UPDATE`
      const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: k.key } } })
      const want = new Set(k.ids)
      for (const x of arr(row?.value)) {
        if (!x?.id || !want.has(String(x.id))) continue
        if (x.customerId !== mg.keptId) changed.push(itemLabel(k.key, x))
      }
    }
    if (changed.length) {
      const list = changed.slice(0, 5).join('; ') + (changed.length > 5 ? `; and ${changed.length - 5} more` : '')
      throw new MergeError(409, `Not undone: ${changed.length === 1 ? 'this record has' : 'these records have'} been put with another customer since the merge: ${list}. Nothing was changed.`)
    }

    const back = await moveAll(tx, accountId, mg.keptId, mg.mergedId, moved)
    const was = (mg.mergedDetails as any)?.archivedAt ?? null
    await tx.crmContact.update({ where: { id: merged.id }, data: { mergedIntoId: null, archivedAt: was ? new Date(was) : null } })
    if (mg.matchRowId) await tx.customerPossibleMatch.updateMany({ where: { id: mg.matchRowId, status: 'merged' }, data: { status: 'open', decidedAt: null, decidedById: null } })
    await tx.customerMerge.update({ where: { id: mg.id }, data: { undoneAt: new Date(), undoneById: actor.userId } })
    const total = (x: Moved) => [...x.rows, ...x.items, ...x.kv].reduce((s, e) => s + e.ids.length, 0)
    return { mergeId: mg.id, keptId: mg.keptId, mergedId: mg.mergedId, keptName: nameOf(kept), mergedName: mg.mergedLabel, moved: movedSummary(back), gone: total(moved) - total(back) }
  }, { timeout: 30_000 })
}

// ── For the customer page and the card ──────────────────────────────────────

export interface MatchView {
  /** This customer's own texting answer (yes | no | unknown), beside each match's, so a difference shows before merging. */
  textConsent: string
  matches: Array<{ id: string; reason: string; customer: { id: string; name: string; phone: string; email: string; address: string; textConsent: string } }>
  mergedInto: { id: string; name: string; mergeId: string | null } | null
  merges: Array<{ id: string; mergedId: string; mergedLabel: string; details: { name: string; phone: string; email: string; address: string; leadSource: string; createdAt: string }; textConsent: { kept: string; merged: string } | null; mergedAt: string; mergedBy: string | null; undoneAt: string | null; undoneBy: string | null; moved: string[] }>
}

export async function matchView(accountId: string, contactId: string): Promise<MatchView> {
  const c = await prisma.crmContact.findFirst({ where: { id: contactId, accountId }, select: { id: true, mergedIntoId: true, deletedAt: true, archivedAt: true, textConsent: true } })
  if (!c) throw new MergeError(404, 'Customer not found')
  // A possible match is open only while both customers are on file: deleted, archived or merged on either side, it is
  // not offered (review Oct 28 2026: it stayed open after the customer was archived). Nothing is changed on it, so
  // putting the customer back (Unarchive, Restore) offers it again.
  const open = c.mergedIntoId || c.deletedAt || c.archivedAt ? [] : await prisma.customerPossibleMatch.findMany({ where: { accountId, contactId, status: 'open' }, orderBy: { createdAt: 'asc' } })
  const others = open.length ? await prisma.crmContact.findMany({ where: { id: { in: open.map(m => m.matchId) }, accountId, deletedAt: null, archivedAt: null, mergedIntoId: null }, select: { id: true, firstName: true, lastName: true, phone: true, email: true, serviceAddress: true, textConsent: true } }) : []
  const matches = open.flatMap(m => {
    const o = others.find(x => x.id === m.matchId)
    return o ? [{ id: m.id, reason: m.reason, customer: { id: o.id, name: nameOf(o), phone: o.phone ?? '', email: o.email ?? '', address: o.serviceAddress ?? '', textConsent: o.textConsent ?? 'unknown' } }] : []
  })
  let mergedInto: MatchView['mergedInto'] = null
  if (c.mergedIntoId) {
    const k = await prisma.crmContact.findFirst({ where: { id: c.mergedIntoId, accountId }, select: { id: true, firstName: true, lastName: true } })
    const mg = await prisma.customerMerge.findFirst({ where: { accountId, mergedId: c.id, keptId: c.mergedIntoId, undoneAt: null }, orderBy: { mergedAt: 'desc' }, select: { id: true } })
    mergedInto = { id: c.mergedIntoId, name: k ? nameOf(k) : 'another customer', mergeId: mg?.id ?? null }
  }
  const rows = await prisma.customerMerge.findMany({ where: { accountId, keptId: contactId }, orderBy: { mergedAt: 'desc' }, take: 50 })
  const userIds = [...new Set(rows.flatMap(r => [r.mergedById, r.undoneById]).filter((x): x is string => !!x))]
  const users = userIds.length ? await prisma.crmUser.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : []
  const who = (id: string | null) => { const u = users.find(x => x.id === id); return u ? nameOf(u) || u.email : null }
  const merges = rows.map(r => {
    const d = (r.mergedDetails ?? {}) as any
    return {
      id: r.id, mergedId: r.mergedId, mergedLabel: r.mergedLabel,
      details: { name: nameOf(d), phone: d.phone ?? '', email: d.email ?? '', address: d.serviceAddress ?? '', leadSource: d.leadSource ?? '', createdAt: d.createdAt ?? '' },
      textConsent: (r.moved as any)?.textConsent ?? null,
      mergedAt: r.mergedAt.toISOString(), mergedBy: who(r.mergedById), undoneAt: r.undoneAt ? r.undoneAt.toISOString() : null, undoneBy: who(r.undoneById),
      moved: movedSummary(r.moved as unknown as Moved),
    }
  })
  return { textConsent: c.textConsent ?? 'unknown', matches, mergedInto, merges }
}
