/**
 * Draft purchase orders saved in dollars turned into integer cents (audit #53,
 * Oct 28 2026). A hand move into Materials Ordered made a draft PO whose money
 * was decimal dollars ("subtotal": 2319.81). The app now saves cents
 * (web purchaseOrderStore.ts); this changes the drafts saved before
 * (lib/poCents.ts): unitCost → unitCostCents, total → totalCents,
 * subtotal → subtotalCents. Nothing else on a draft changes. Run again, it
 * changes nothing.
 *
 *   pnpm exec tsx scripts/po-cents-2026-10-28.ts                 dry run (default): reads only
 *   pnpm exec tsx scripts/po-cents-2026-10-28.ts --apply         does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/po-cents-2026-10-28.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh) and a backup
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { dollars } from '../src/server/lib/invoiceMath.js'
import { posToCents, sumOfLines } from '../src/server/lib/poCents.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('po-cents-2026-10-28.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const rows = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    return tx.businessState.findMany({ select: { accountId: true, version: true, purchaseOrders: true } })
  })
  let total = 0, toChange = 0, bad = 0
  const plans: Array<{ accountId: string; version: number; list: any[]; changed: number }> = []
  for (const r of rows) {
    const before = Array.isArray(r.purchaseOrders) ? (r.purchaseOrders as any[]) : []
    if (!before.length) continue
    const { list, changed } = posToCents(before)
    total += before.length
    toChange += changed
    say(`\nCompany ${r.accountId}: ${before.length} purchase order(s), ${changed} in dollars`)
    before.forEach((po, i) => {
      const after = list[i]
      const was = 'subtotal' in (po ?? {}) ? `subtotal ${po.subtotal} (dollars)` : `subtotalCents ${po?.subtotalCents}`
      const sum = sumOfLines(after)
      const off = sum !== after?.subtotalCents
      if (off) bad++
      say(`  ${po?.poNumber ?? po?.id} ${po?.status ?? ''} ${po?.jobName ?? ''}: ${was} → subtotalCents ${after?.subtotalCents} (${dollars(after?.subtotalCents ?? 0)}), ${after?.lineItems?.length ?? 0} lines${off ? `   LINES ADD UP TO ${sum}` : ''}`)
    })
    if (changed) plans.push({ accountId: r.accountId, version: r.version, list, changed })
  }
  say(`\n${total} purchase order(s) in all; ${toChange} to change to cents.`)
  if (bad) say(`${bad} whose lines do not add up to the subtotal (shown above; kept as saved, in cents).`)
  if (!APPLY) { say('\nDry run: nothing changed.'); await prisma.$disconnect(); return }

  for (const p of plans) {
    // Only on the version read: a save since then is not overwritten (run it again).
    const d = await prisma.businessState.updateMany({ where: { accountId: p.accountId, version: p.version }, data: { purchaseOrders: p.list as any, version: { increment: 1 } } })
    say(`  Company ${p.accountId}: ${d.count ? `${p.changed} changed to cents` : 'changed since it was read; nothing saved, run it again'}`)
    if (!d.count) bad++
  }
  const left = (await prisma.businessState.findMany({ select: { purchaseOrders: true } }))
    .reduce((n, r) => n + posToCents(r.purchaseOrders).changed, 0)
  await prisma.$disconnect()
  say(`\nRESULT (from the database): ${left} purchase order(s) still in dollars.`)
  if (left) process.exit(1)
  say('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
