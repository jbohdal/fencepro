/**
 * The one saved quote still marked Hourly crew: switch its labor choice to
 * Subcontractor, so it is not priced with the crew's man hours if it is ever
 * opened again.
 *
 *   pnpm exec tsx scripts/hourly-draft-to-sub-2026-11-03.ts                    dry run (default): reads only
 *   pnpm exec tsx scripts/hourly-draft-to-sub-2026-11-03.ts --apply            does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/hourly-draft-to-sub-2026-11-03.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Audit of hourly values in Subcontractor prices (Nov 3 2026): the Oct 9 draft
 * at $4,385.55 was saved with laborMode 'hourly', the only one. Every other
 * quote is Subcontractor or follows Settings (Subcontractor).
 *
 * The quote is named here by id and price. If it is not as named (price, not
 * a draft, sent, shared, accepted, sold, has a job, has flat labor typed on
 * it), or any other quote is marked hourly, it stops with nothing changed.
 * Changes only pricing.laborMode, 'hourly' to 'subcontractor': the price, cost
 * and pull sheet on file stay as they are (a draft is priced again when it is
 * opened; the dry run shows what that would be in each mode). The row is
 * written directly: no needsResend, no message, push or automation. One audit
 * log entry. Run again, it changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'
import { priceToday } from '../src/server/lib/quotePriceCheck.js'

const SCRIPT = 'scripts/hourly-draft-to-sub-2026-11-03.ts'
const QUOTE = { id: '65c963ea-ce44-4fb5-a804-8743a01d582e', priceCents: 438555 }

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('hourly-draft-to-sub-2026-11-03.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Json = any
const say = (...a: unknown[]) => console.log(...a)
const usd = (n: number | null) => n == null ? 'cannot be priced' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const stop = (why: string): never => { console.error(`\nSTOPPED, nothing changed: ${why}`); process.exit(3) }

async function main() {
  const prisma: Json = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}\n`)
  const q: Json = await prisma.savedQuote.findFirst({ where: { id: QUOTE.id, deletedAt: null } }) ?? stop(`${QUOTE.id} is not on file.`)
  const name = `${q.id.slice(0, 8)} ${q.customerName}, ${q.status}${q.archivedAt ? ' (archived)' : ''}, saved ${new Date(q.createdAt).toISOString().slice(0, 10)}`
  if (Math.round(Number(q.finalPrice) * 100) !== QUOTE.priceCents) stop(`${name} is ${usd(q.finalPrice)}, not ${usd(QUOTE.priceCents / 100)}.`)
  const pricing = (q.pricing && typeof q.pricing === 'object' ? q.pricing : {}) as Json
  const others = await prisma.savedQuote.findMany({ where: { id: { not: q.id }, pricing: { path: ['laborMode'], equals: 'hourly' } }, select: { id: true, customerName: true, finalPrice: true, status: true, deletedAt: true } })
  if (others.length) stop(`${others.length} other quote${others.length === 1 ? ' is' : 's are'} marked hourly too: ${others.map((o: Json) => `${o.id.slice(0, 8)} ${o.customerName} ${usd(o.finalPrice)} ${o.status}${o.deletedAt ? ' (deleted)' : ''}`).join('; ')}.`)
  if (pricing.laborMode === 'subcontractor') { say(`  ALREADY DONE ${name}, ${usd(q.finalPrice)}\n\nNothing to change.`); await prisma.$disconnect(); return }
  if (pricing.laborMode !== 'hourly') stop(`${name}: its labor choice is "${pricing.laborMode ?? 'none'}", not hourly.`)
  if (q.status !== 'DRAFT') stop(`${name} is not a draft.`)
  if (q.shareToken || q.acceptedAt || q.soldAt || q.firstViewedAt) stop(`${name} has been shared, viewed, accepted or sold.`)
  if (typeof pricing.laborCost === 'number') stop(`${name} has flat labor typed on it, so the labor choice does not price it.`)
  if (await prisma.savedJob.count({ where: { accountId: q.accountId, quoteId: q.id } })) stop(`${name} has a job.`)

  // What opening it shows, priced the way the quote builder prices it, in each mode.
  const asHourly = await priceToday(q.accountId, q)
  const asSub = await priceToday(q.accountId, { ...q, pricing: { ...pricing, laborMode: 'subcontractor' } })
  say(`  ${APPLY ? 'SWITCH' : 'WOULD SWITCH'} ${name}, ${q.fenceStyle}, ${q.sections} sections`)
  say(`        labor choice Hourly crew → Subcontractor`)
  say(`        on file: price ${usd(q.finalPrice)}, labor ${usd(q.laborCost)}, cost ${usd(q.totalCOGS)} (these stay)`)
  say(`        opened today as Hourly crew: ${usd(asHourly)}`)
  say(`        opened today as Subcontractor: ${usd(asSub)}`)
  if (!APPLY) { say('\nDry run: nothing changed.'); await prisma.$disconnect(); return }

  // Only if unchanged since it was read here: a save in between leaves it to run again.
  const r = await prisma.savedQuote.updateMany({ where: { id: q.id, updatedAt: q.updatedAt, deletedAt: null }, data: { pricing: { ...pricing, laborMode: 'subcontractor' } } })
  if (r.count !== 1) { say(`\n${q.id.slice(0, 8)}: changed since it was read; left as it is. Run again.`); await prisma.$disconnect(); return }
  await auditSystem('update', 'SavedQuote', q.id, {
    oldValues: { laborMode: 'hourly', finalPrice: q.finalPrice, pricedTodayAsHourly: asHourly },
    newValues: { laborMode: 'subcontractor', finalPrice: q.finalPrice, pricedTodayAsSub: asSub, by: SCRIPT, why: 'The only quote marked Hourly crew; the company works with subcontractors (Nov 3 2026). Price on file unchanged.' },
  })
  say('\nDone: 1 changed.')
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
