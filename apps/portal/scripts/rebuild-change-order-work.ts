/**
 * Jobs with more than one change order from the yard drawing (round 3
 * walkthrough, Oct 26 2026): before the fix, a change order drawn while
 * another was still open started from the signed quote, and once both were
 * approved the newest approved one's drawing was the job's, so the other's
 * change was dropped from the job, pull sheet and installer card (the price
 * was right). This rebuilds each such job's work with the app's own code
 * (lib/changeOrders.ts applyToJob -> lib/changeOrderWork.ts rebuildJobWork):
 * the signed quote with every approved change order's own change, in the
 * order they were approved.
 *
 *   npx tsx scripts/rebuild-change-order-work.ts                 lists the jobs and what the rebuild would make; writes nothing
 *   npx tsx scripts/rebuild-change-order-work.ts --apply         rebuilds them in DATABASE_URL
 *   ... --apply --live                                           required as well for the live database, with
 *                                                                EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('rebuild-change-order-work.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { applyToJob } = await import('../src/server/lib/changeOrders.js')
  const { foldShapes, deriveFor } = await import('../src/server/lib/changeOrderWork.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run: nothing is written)'}`)
  const rows = await prisma.changeOrder.findMany({ where: { deletedAt: null, status: 'approved' }, select: { quoteId: true, accountId: true, work: true } })
  const byQuote = new Map<string, { accountId: string; n: number }>()
  for (const r of rows) if (r.work && typeof r.work === 'object') byQuote.set(r.quoteId, { accountId: r.accountId, n: (byQuote.get(r.quoteId)?.n ?? 0) + 1 })
  const many = [...byQuote].filter(([, v]) => v.n > 1)
  if (!many.length) { console.log('No job has more than one approved change order from the drawing.'); return }
  for (const [quoteId, { accountId }] of many) {
    const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId } })
    const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null } })
    const cos = await prisma.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null } })
    const { shape, steps } = foldShapes(q, cos as any, await deriveFor(accountId))
    const ft = Math.round(shape.runs.reduce((s, f) => s + f, 0))
    const dropped = steps.some(s => s.merged)
    console.log(`\n${q?.customerName ?? quoteId} (job ${job?.id ?? 'none'}): ${steps.map(s => `CO-${s.row.number}${s.merged ? ' (its change put on the earlier ones)' : ''}`).join(', ')}`)
    console.log(`  job now: ${job?.totalFeet} ft, ${job?.walkGates} walk, ${job?.dblGates} double, ${job?.sections} sections`)
    console.log(`  rebuilt: ${ft} ft, ${shape.walkGates} walk, ${shape.dblGates} double${dropped ? '' : ' (no change: each was drawn from the one before)'}`)
    for (const s of steps) for (const c of s.conflicts) console.log(`  both changed: CO-${s.row.number} ${c} (the later one kept)`)
    if (APPLY && dropped) {
      await prisma.$transaction(tx => applyToJob(accountId, quoteId, tx, null), { timeout: 30_000 })
      const after = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null } })
      console.log(`  done: ${after?.totalFeet} ft, ${after?.walkGates} walk, ${after?.dblGates} double, ${after?.sections} sections, ${after?.estimatedDays} crew day(s)`)
    }
  }
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
