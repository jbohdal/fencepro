/**
 * Customer imports: the batch every writing run makes, Undo import, and its
 * Restore. The importers themselves (lib/mybudgetquoteImport.ts) decide what
 * to make; this file keeps the record of it.
 *
 *   ImportBatch.records  every id the run made (customers, notes, cards,
 *                        possible matches) and every tag it put on a
 *                        customer already on file (with that customer's tags
 *                        and updatedAt just before, and the updatedAt it set)
 *   CustomerImportRow    one per file row: the old system's fields, its key
 *                        (a second run skips a key already imported)
 *
 * Undo import (Settings > Deleted Records, owner and admin; or the script's
 * --undo <batchId>) in one transaction:
 *   - customers the import made: soft deleted with everything that hangs off
 *     them (lib/deletion.ts deleteRootsTx: their notes, cards, and anything
 *     added to them since), so it is restorable;
 *   - on customers already on file: the import's notes soft deleted, its
 *     cards taken off the board, its tag taken off. When nobody changed the
 *     customer since, the tags and updatedAt go back exactly as they were
 *     (the row is byte for byte as before the import);
 *   - its possible matches removed (kept in the snapshot);
 *   - its rows marked undone (their keys are free for a new run);
 *   - one DeletionLog row (entityType "import") holds it all. Restore there
 *     puts the import back, unless its rows were imported again since.
 */

import prisma from './prisma.js'
import { deleteRootsTx, idsInSnapshot, countsOf, DeleteError, labelOf, type Actor, type Snapshot } from './deletion.js'

type Tx = any

export interface TaggedRecord {
  id: string
  tag: string
  /** tags::text before, or null (no tags) */
  tagsBefore: string | null
  updatedAtBefore: string
  updatedAtAfter: string
}

export interface BatchRecords {
  /** Customers the import made */
  contacts: string[]
  /** Notes it put on customers it made */
  notes: string[]
  /** Notes it put on customers already on file */
  notesOnFile: string[]
  /** Cards it made (on either kind of customer) */
  cards: string[]
  possibleMatches: string[]
  /** Its tag on customers already on file */
  tagged: TaggedRecord[]
}

export const emptyRecords = (): BatchRecords => ({ contacts: [], notes: [], notesOnFile: [], cards: [], possibleMatches: [], tagged: [] })

function recordsOf(v: unknown): BatchRecords {
  const r = (v ?? {}) as Partial<BatchRecords>
  const a = (x: unknown) => (Array.isArray(x) ? x : [])
  return { contacts: a(r.contacts), notes: a(r.notes), notesOnFile: a(r.notesOnFile), cards: a(r.cards), possibleMatches: a(r.possibleMatches), tagged: a(r.tagged) }
}

/**
 * A moment as the database keeps it ("updatedAt" is a timestamp without a
 * time zone, in UTC). Passed as text and turned into UTC in SQL, so the
 * session's own time zone never shifts it.
 */
const utc = (d: Date) => d.toISOString()

/** Lock one import (by source and company) for the rest of the transaction: two runs never interleave. */
export async function lockImport(tx: Tx, accountId: string, source: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-import:${source}:${accountId}`}))`
}

/**
 * Put `tag` on a customer already on file, changing nothing else on the row.
 * Returns what undo needs to put it back exactly, or null when the tag is
 * there already (or tags is not a list).
 */
export async function addTagTx(tx: Tx, accountId: string, contactId: string, tag: string, at: Date): Promise<TaggedRecord | null> {
  const rows: Array<{ tags: string | null; updatedAt: Date }> = await tx.$queryRaw`SELECT tags::text AS tags, "updatedAt" FROM "CrmContact" WHERE id = ${contactId} AND "accountId" = ${accountId} FOR UPDATE`
  const r = rows[0]
  if (!r) return null
  const list = r.tags == null ? [] : JSON.parse(r.tags)
  if (!Array.isArray(list) || list.includes(tag)) return null
  await tx.$executeRaw`UPDATE "CrmContact" SET tags = ${JSON.stringify([...list, tag])}::jsonb, "updatedAt" = (${utc(at)}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${contactId}`
  return { id: contactId, tag, tagsBefore: r.tags, updatedAtBefore: new Date(r.updatedAt).toISOString(), updatedAtAfter: at.toISOString() }
}

/** Take the import's tag off again. Exactly as before when nobody changed the customer since; otherwise only the tag. Why not, or null when done. */
async function removeTagTx(tx: Tx, t: TaggedRecord): Promise<string | null> {
  const rows: Array<{ tags: string | null; updatedAt: Date; deletedAt: Date | null }> = await tx.$queryRaw`SELECT tags::text AS tags, "updatedAt", "deletedAt" FROM "CrmContact" WHERE id = ${t.id} FOR UPDATE`
  const r = rows[0]
  if (!r) return 'the customer no longer exists'
  const list = r.tags == null ? [] : JSON.parse(r.tags)
  if (!Array.isArray(list) || !list.includes(t.tag)) return 'the tag was already taken off'
  if (new Date(r.updatedAt).toISOString() === t.updatedAtAfter) {
    await tx.$executeRaw`UPDATE "CrmContact" SET tags = ${t.tagsBefore}::jsonb, "updatedAt" = (${t.updatedAtBefore}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${t.id}`
    return null
  }
  await tx.$executeRaw`UPDATE "CrmContact" SET tags = ${JSON.stringify(list.filter((x: unknown) => x !== t.tag))}::jsonb, "updatedAt" = (${utc(new Date())}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${t.id}`
  return null
}

export interface UndoResult { logId: string; label: string; counts: Record<string, number>; left: Array<{ what: string; why: string }> }

/** Undo import: everything the batch made or added, in one step, logged in Deleted Records. */
export async function undoImport(actor: Actor, batchId: string, reason?: string | null): Promise<UndoResult> {
  return prisma.$transaction(async (tx: Tx) => {
    const { accountId } = actor
    await tx.$queryRaw`SELECT 1 FROM "ImportBatch" WHERE id = ${batchId} FOR UPDATE`
    const b = await tx.importBatch.findFirst({ where: { id: batchId, accountId } })
    if (!b) throw new DeleteError(404, 'Import not found')
    if (b.undoneAt) throw new DeleteError(409, 'This import is already undone')
    await lockImport(tx, accountId, b.source)
    const rec = recordsOf(b.records)
    const at = new Date()
    const left: UndoResult['left'] = []

    // Customers it made (still there), with everything on them; its cards on customers already on file.
    const contacts = rec.contacts.length ? (await tx.crmContact.findMany({ where: { id: { in: rec.contacts }, accountId, deletedAt: null }, select: { id: true } })).map((c: any) => c.id) : []
    if (contacts.length < rec.contacts.length) left.push({ what: `${rec.contacts.length - contacts.length} imported customer${rec.contacts.length - contacts.length === 1 ? '' : 's'}`, why: 'already deleted' })
    const snap: Snapshot = await deleteRootsTx(tx, actor, { contactIds: contacts, quoteIds: [], jobIds: [], cardIds: rec.cards }, at)

    // Its notes on customers already on file.
    if (rec.notesOnFile.length) {
      await tx.crmContactNote.updateMany({ where: { id: { in: rec.notesOnFile }, accountId, deletedAt: null }, data: { deletedAt: at } })
      for (const r of await tx.crmContactNote.findMany({ where: { id: { in: rec.notesOnFile }, deletedAt: at } })) snap.rows.push({ model: 'crmContactNote', id: r.id, row: JSON.parse(JSON.stringify(r)) })
    }

    // Its possible matches.
    if (rec.possibleMatches.length) {
      const pms = await tx.customerPossibleMatch.findMany({ where: { id: { in: rec.possibleMatches }, accountId } })
      for (const m of pms) snap.hard.push({ model: 'customerPossibleMatch', id: m.id, row: JSON.parse(JSON.stringify(m)) })
      await tx.customerPossibleMatch.deleteMany({ where: { id: { in: pms.map((m: any) => m.id) } } })
    }

    // Its tag on customers already on file.
    for (const t of rec.tagged) {
      const why = await removeTagTx(tx, t)
      if (why) left.push({ what: `Tag "${t.tag}" on a customer`, why })
    }

    await tx.customerImportRow.updateMany({ where: { batchId, accountId, undoneAt: null }, data: { undoneAt: at } })
    const log = await tx.deletionLog.create({ data: {
      accountId, entityType: 'import', entityId: batchId, entityLabel: b.label, snapshot: JSON.parse(JSON.stringify(snap)),
      ids: idsInSnapshot(snap), deletedByUserId: actor.userId, deletedAt: at, reason: reason?.trim() || 'Undo import',
    } })
    await tx.importBatch.update({ where: { id: batchId }, data: { undoneAt: at, undoneById: actor.userId, undoLogId: log.id } })
    return { logId: log.id, label: b.label, counts: countsOf(snap), left }
  }, { timeout: 600_000, maxWait: 60_000 })
}

/** Restore of an undone import (from restoreDeletion, in its transaction): refused when its rows were imported again since. */
export async function beforeImportRestore(tx: Tx, accountId: string, batchId: string): Promise<void> {
  const b = await tx.importBatch.findFirst({ where: { id: batchId, accountId } })
  if (!b) throw new DeleteError(404, 'Import not found')
  if (!b.undoneAt) throw new DeleteError(409, 'This import is not undone')
  await lockImport(tx, accountId, b.source)
  const keys = (await tx.customerImportRow.findMany({ where: { batchId }, select: { sourceKey: true } })).map((r: any) => r.sourceKey)
  const again = keys.length ? await tx.customerImportRow.findFirst({ where: { accountId, source: b.source, sourceKey: { in: keys }, undoneAt: null, batchId: { not: batchId } }, select: { batchId: true } }) : null
  if (again) throw new DeleteError(409, 'Not restored: these rows were imported again since. Undo that import first.')
}

/** After the rows came back: its tag back on customers already on file, its rows and the batch active again. Returns what was left as it is. */
export async function afterImportRestore(tx: Tx, actor: Actor, batchId: string): Promise<Array<{ what: string; why: string }>> {
  const b = await tx.importBatch.findFirst({ where: { id: batchId, accountId: actor.accountId } })
  const rec = recordsOf(b?.records)
  const at = new Date()
  const left: Array<{ what: string; why: string }> = []
  const tagged: TaggedRecord[] = []
  for (const t of rec.tagged) {
    const c = await tx.crmContact.findFirst({ where: { id: t.id, accountId: actor.accountId, deletedAt: null }, select: { id: true } })
    if (!c) { left.push({ what: `Tag "${t.tag}" on a customer`, why: 'the customer is deleted' }); continue }
    const again = await addTagTx(tx, actor.accountId, t.id, t.tag, at)
    if (again) tagged.push(again)
  }
  await tx.customerImportRow.updateMany({ where: { batchId }, data: { undoneAt: null } })
  await tx.importBatch.update({ where: { id: batchId }, data: { undoneAt: null, undoneById: null, undoLogId: null, records: JSON.parse(JSON.stringify({ ...rec, tagged })) } })
  return left
}

export interface ImportBatchView {
  id: string; source: string; label: string; fileName: string; createdAt: string; createdBy: string
  counts: Record<string, unknown>; undoneAt: string | null; undoLogId: string | null
}

/** Settings > Deleted Records, Imports: newest first. */
export async function listImports(accountId: string): Promise<ImportBatchView[]> {
  const rows = await prisma.importBatch.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, source: true, label: true, fileName: true, createdAt: true, createdBy: true, counts: true, undoneAt: true, undoLogId: true } })
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), undoneAt: r.undoneAt ? r.undoneAt.toISOString() : null, counts: (r.counts ?? {}) as Record<string, unknown> }))
}

/** What a person reads under an undone import's Deleted Records row: by kind, never thousands of lines. */
export function importSummary(s: Snapshot): string[] {
  const out: string[] = []
  const names = s.rows.filter(r => r.model === 'crmContact').map(r => labelOf('crmContact', r.row))
  if (names.length) out.push(`Customers: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ` and ${names.length - 12} more` : ''}`)
  return out
}

export interface ImportHistoryRow { id: string; source: string; sourceKey: string; matched: boolean; matchedBy: string | null; cardId: string | null; data: Record<string, unknown>; createdAt: string }

/** The customer page's "MyBudgetQuote history": the old system's fields for this customer (imports not undone). */
export async function importHistory(accountId: string, contactId: string): Promise<ImportHistoryRow[]> {
  const rows = await prisma.customerImportRow.findMany({ where: { accountId, crmContactId: contactId, undoneAt: null }, orderBy: { createdAt: 'desc' } })
  return rows.map(r => ({ id: r.id, source: r.source, sourceKey: r.sourceKey, matched: r.matched, matchedBy: r.matchedBy, cardId: r.cardId, data: (r.data ?? {}) as Record<string, unknown>, createdAt: r.createdAt.toISOString() }))
}
