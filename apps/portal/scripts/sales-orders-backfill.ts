/**
 * Sales Orders made before Oct 26 2026 (audit item 2): the browser made each
 * once, from the quote's pull sheet as it was the first time it was marked
 * Sold, so some list the wrong fence (Manuel Cotrich: white vinyl, his job is
 * tan; Shawn Hart: white vinyl, his job is chain link), miss an approved
 * change order, or are missing (jobs signed on the proposal link got none).
 * This brings each open job's order up to its pull sheet with the app's own
 * code (lib/salesOrders.ts syncSalesOrder): the newest approved change order's
 * work, else the pull sheet as signed.
 *
 * Which jobs: every job with a quote that is not deleted, archived, finished
 * (completed, invoiced, paid), and every job that already has a
 * pending order. An order already marked ordered or received is never
 * changed; one the office cancelled is never made again.
 *
 *   npx tsx scripts/sales-orders-backfill.ts             lists each job and what would change; writes nothing
 *   npx tsx scripts/sales-orders-backfill.ts --apply     makes the changes in DATABASE_URL
 *   ... --apply --live                                   required as well for the live database, with
 *                                                        EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('sales-orders-backfill.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

const DONE = ['completed', 'invoiced', 'paid'] as const

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { orderBasisFor, planOrders, syncSalesOrder } = await import('../src/server/lib/salesOrders.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run: nothing is written)'}`)
  const states = await prisma.businessState.findMany({ select: { accountId: true, pendingOrders: true } })
  let changes = 0
  for (const st of states) {
    const accountId = st.accountId
    const orders = (Array.isArray(st.pendingOrders) ? st.pendingOrders : []) as any[]
    const pendingQuotes = orders.filter(o => o?.status === 'pending' && o.quoteId).map(o => String(o.quoteId))
    const jobs = await prisma.savedJob.findMany({
      where: { accountId, deletedAt: null, archivedAt: null, quoteId: { not: null }, OR: [{ status: { notIn: [...DONE] } }, { quoteId: { in: pendingQuotes } }] },
      select: { id: true, quoteId: true, customerName: true, status: true },
      orderBy: { createdAt: 'asc' },
    })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true } })
    const stock = Array.isArray(inv?.items) ? (inv!.items as any[]) : []
    const seen = new Set<string>()
    for (const j of jobs) {
      const quoteId = j.quoteId!
      seen.add(quoteId)
      const basis = await orderBasisFor(accountId, quoteId)
      if (!basis) continue
      const mine = orders.filter(o => o?.quoteId === quoteId || (o?.jobId === j.id && o?.status === 'pending'))
      const plan = planOrders(mine, basis, stock, new Date().toISOString())
      const was = mine.map(o => `${o.status} "${o.quoteName}" (${(o.items ?? []).length} parts, ${usd(o.totalCostCents)})`).join('; ') || 'no order'
      console.log(`\n${j.customerName} (job ${j.id}, ${j.status}): ${was}`)
      if (!plan.changed) { console.log(`  no change: ${plan.what}`); continue }
      changes++
      const now = plan.orders.find(o => o.status === 'pending')
      console.log(`  would: ${plan.what}`)
      if (now) {
        console.log(`  becomes: pending "${now.quoteName}", from ${now.source}, ${now.items.length} parts, ${usd(now.totalCostCents)}`)
        for (const i of now.items) console.log(`    ${i.requiredQuantity} x ${i.itemName}`)
      }
      if (APPLY) console.log(`  done: ${await syncSalesOrder(accountId, quoteId)}`)
    }
    // Pending orders whose quote has no open job: listed for the office, not changed.
    for (const o of orders) {
      if (o?.status !== 'pending' || seen.has(String(o.quoteId))) continue
      console.log(`\n${o.customerName}: pending "${o.quoteName}" has no open job for its quote (${o.quoteId}); left as it is`)
    }
  }
  console.log(`\n${changes} job${changes === 1 ? '' : 's'} ${APPLY ? 'brought up to date' : 'would change'}.`)
  await prisma.$disconnect()
}

const usd = (c: unknown) => `$${((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

main().catch(e => { console.error(e); process.exit(1) })
