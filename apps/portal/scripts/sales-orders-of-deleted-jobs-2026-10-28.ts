/**
 * Sales Orders left Pending or Ordered for a job that is deleted (review Oct
 * 28 2026). Since then deleting a job marks its Pending or Ordered Sales Order
 * Cancelled, with a note, and restoring the job puts it back
 * (lib/deletion.ts). This does the same for the orders left from before
 * (lib/ordersOfDeletedJobs.ts ordersOfDeletedJobs):
 *
 *   - job deleted (in Deleted Records): marked Cancelled with the note "its
 *     job was deleted"; the job's deletion log keeps the order as it was
 *     (snapshot.changed), so restoring the job brings it back;
 *   - job gone (no row at all, e.g. removed by a test's clean up): marked
 *     Cancelled with the note "its job no longer exists".
 *
 * Received and Cancelled orders are never touched. Nothing else changes. Run
 * again, it changes nothing.
 *
 *   pnpm exec tsx scripts/sales-orders-of-deleted-jobs-2026-10-28.ts            dry run (default): reads only
 *   pnpm exec tsx scripts/sales-orders-of-deleted-jobs-2026-10-28.ts --apply    does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/sales-orders-of-deleted-jobs-2026-10-28.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh), a backup and Jonathan's OK
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { ordersOfDeletedJobs, cancelOrderForDeletion, ORPHAN_WHY, type JobFact, type OrphanOrder } from '../src/server/lib/ordersOfDeletedJobs.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('sales-orders-of-deleted-jobs-2026-10-28.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v))

interface Company { accountId: string; version: number; orders: any[]; found: OrphanOrder[]; logs: Map<string, { id: string; snapshot: any }> }

/** What is to change, read in one read only transaction. */
async function read(prisma: any): Promise<Company[]> {
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const states = await tx.businessState.findMany({ select: { accountId: true, version: true, pendingOrders: true } })
    const out: Company[] = []
    for (const s of states) {
      const orders = Array.isArray(s.pendingOrders) ? (s.pendingOrders as any[]) : []
      if (!orders.length) continue
      const jobIds = [...new Set(orders.map(o => o?.jobId).filter((x): x is string => typeof x === 'string' && !!x))]
      const quoteIds = [...new Set(orders.filter(o => !o?.jobId).map(o => o?.quoteId).filter((x): x is string => typeof x === 'string' && !!x))]
      const jobs: Array<JobFact & { quoteId: string | null }> = await tx.savedJob.findMany({
        where: { accountId: s.accountId, OR: [{ id: { in: jobIds } }, { quoteId: { in: quoteIds } }] },
        select: { id: true, quoteId: true, deletedAt: true },
      })
      const byId = new Map(jobs.map(j => [j.id, j]))
      const byQuote = new Map<string, JobFact[]>()
      for (const j of jobs) if (j.quoteId) byQuote.set(j.quoteId, [...(byQuote.get(j.quoteId) ?? []), j])
      const found = ordersOfDeletedJobs(orders, byId, byQuote)
      // The deletion that took each deleted job (not restored): it keeps the order as it was, for a restore.
      const logs = new Map<string, { id: string; snapshot: any }>()
      for (const f of found) {
        if (f.kind !== 'job_deleted' || !f.jobId || logs.has(f.jobId)) continue
        const log = await tx.deletionLog.findFirst({ where: { accountId: s.accountId, restoredAt: null, ids: { has: f.jobId } }, orderBy: { deletedAt: 'desc' }, select: { id: true, snapshot: true } })
        if (log) logs.set(f.jobId, log)
      }
      out.push({ accountId: s.accountId, version: s.version, orders, found, logs })
    }
    return out
  })
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const companies = await read(prisma)
  let all = 0, deleted = 0, gone = 0, received = 0
  for (const c of companies) {
    all += c.orders.length
    received += c.orders.filter(o => o?.status === 'received').length
    if (!c.found.length) continue
    say(`\nCompany ${c.accountId}: ${c.orders.length} Sales Order(s), ${c.found.length} to cancel`)
    const byName = new Map<string, { n: number; kinds: Set<string>; statuses: Set<string> }>()
    for (const f of c.found) {
      const o = c.orders.find(x => String(x?.id) === f.id)
      if (f.kind === 'job_deleted') deleted++; else gone++
      const name = o?.customerName || o?.quoteName || '(no name)'
      const e = byName.get(name) ?? { n: 0, kinds: new Set(), statuses: new Set() }
      e.n++; e.kinds.add(f.kind === 'job_deleted' ? (f.jobId && c.logs.has(f.jobId) ? 'job deleted (restorable)' : 'job deleted, no deletion log') : 'job gone'); e.statuses.add(o?.status)
      byName.set(name, e)
    }
    const rows = [...byName].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    const SHOWN = args.includes('--all') ? rows.length : 25
    for (const [name, e] of rows.slice(0, SHOWN)) say(`  ${String(e.n).padStart(4)}  ${name}: ${[...e.statuses].join('/')}, ${[...e.kinds].join(', ')}`)
    if (rows.length > SHOWN) say(`  … and ${rows.slice(SHOWN).reduce((n, [, e]) => n + e.n, 0)} more under ${rows.length - SHOWN} other names (--all lists every one)`)
  }
  say(`\n${all} Sales Order(s) in all. To cancel: ${deleted + gone} (${deleted} whose job is deleted, ${gone} whose job no longer exists). ${received} Received: never touched.`)
  if (!APPLY) { await prisma.$disconnect(); say('\nDry run: nothing changed.'); return }

  const at = new Date()
  let failed = 0
  for (const c of companies) {
    if (!c.found.length) continue
    const why = new Map(c.found.map(f => [f.id, f]))
    const changedByLog = new Map<string, any[]>()
    const next = c.orders.map(o => {
      const f = o?.id ? why.get(String(o.id)) : undefined
      if (!f) return o
      const log = f.kind === 'job_deleted' && f.jobId ? c.logs.get(f.jobId) : undefined
      const after = cancelOrderForDeletion(o, ORPHAN_WHY[f.kind], at, !!log)
      if (log) changedByLog.set(log.id, [...(changedByLog.get(log.id) ?? []), { doc: 'business.pendingOrders', id: String(o.id), before: json(o), after: json(after) }])
      return after
    })
    const ok = await prisma.$transaction(async (tx: any) => {
      // Only on the version read: a save since then is not overwritten (run it again).
      const d = await tx.businessState.updateMany({ where: { accountId: c.accountId, version: c.version }, data: { pendingOrders: next as any, version: { increment: 1 } } })
      if (!d.count) return false
      for (const [logId, changed] of changedByLog) {
        const log = await tx.deletionLog.findUnique({ where: { id: logId }, select: { snapshot: true, ids: true } })
        const snap = { ...(log.snapshot as any), changed: [...((log.snapshot as any)?.changed ?? []), ...changed] }
        await tx.deletionLog.update({ where: { id: logId }, data: { snapshot: snap, ids: [...new Set([...(log.ids ?? []), ...changed.map(x => x.id)])] } })
      }
      return true
    })
    say(`  Company ${c.accountId}: ${ok ? `${c.found.length} cancelled` : 'changed since it was read; nothing saved, run it again'}`)
    if (!ok) failed++
  }
  const left = (await read(prisma)).reduce((n, c) => n + c.found.length, 0)
  await prisma.$disconnect()
  say(`\nRESULT (from the database): ${left} Sales Order(s) still Pending or Ordered for a deleted or missing job.`)
  if (left || failed) process.exit(1)
  say('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
