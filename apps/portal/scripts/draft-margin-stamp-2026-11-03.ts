/**
 * Stamp the unsent drafts saved before "drafts follow Settings" with the
 * Target Profit their margin came from, so they follow a Target Profit or
 * Overhead change when next opened, not only after their next save
 * (Jonathan, Nov 3 2026, items 4 and 9: "Yes", "Yes, and overhead follows too").
 *
 *   pnpm exec tsx scripts/draft-margin-stamp-2026-11-03.ts                    dry run (default): reads only
 *   pnpm exec tsx scripts/draft-margin-stamp-2026-11-03.ts --apply            does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/draft-margin-stamp-2026-11-03.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Which drafts: never sent, shared, viewed, accepted or sold, a new fence (not
 * a move or repair), priced by Target Margin, with no Target Profit saved, and
 * whose cost factor is exactly the one Settings give its fence today at the
 * Overhead % it was saved with (draftMargin.ts legacyProfit). A margin typed
 * by hand, or one Settings no longer give, is left alone: it cannot be told
 * from a typed one.
 *
 * Changes only pricing.targetProfitPct. The price, cost and pull sheet on
 * file stay: a draft is priced again when it is opened. For each one the dry
 * run shows the price on file, what opening it shows today before the stamp,
 * and after (today's Overhead % and Target Profit). Rows are written directly,
 * only if unchanged since read: no needsResend, message, push or automation.
 * One audit log entry each. Run again, it changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'
import { priceToday } from '../src/server/lib/quotePriceCheck.js'
import { dataFor } from '../src/server/lib/quotePricing.js'
import { pricingModule } from '../src/server/lib/estimates.js'
import { legacyProfit, isUnsentDraft } from '../../web/src/draftMargin'

const SCRIPT = 'scripts/draft-margin-stamp-2026-11-03.ts'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('draft-margin-stamp-2026-11-03.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Json = any
const say = (...a: unknown[]) => console.log(...a)
const usd = (n: number | null) => n == null ? 'cannot be priced' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number) => `${Math.round(n * 10) / 10}%`

async function main() {
  const prisma: Json = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}\n`)
  const drafts: Json[] = await prisma.savedQuote.findMany({ where: { status: 'DRAFT', deletedAt: null }, orderBy: [{ accountId: 'asc' }, { createdAt: 'asc' }] })
  const m: Json = await pricingModule()
  // Settings as the server prices with them, today's live Overhead % included.
  const configs = new Map<string, Json>()
  const configOf = async (accountId: string) => {
    if (!configs.has(accountId)) configs.set(accountId, (await dataFor(accountId)).config)
    return configs.get(accountId)
  }

  let stamped = 0, already = 0, moves = 0, onFile = 0, openedBefore = 0, openedAfter = 0
  for (const q of drafts) {
    const pricing = (q.pricing && typeof q.pricing === 'object' ? q.pricing : {}) as Json
    if (!isUnsentDraft(q) || q.work || (pricing.priceMethod && pricing.priceMethod !== 'cost_factor')) continue
    if (typeof pricing.targetProfitPct === 'number') { already++; continue }
    const config = await configOf(q.accountId)
    const style = m.estimateConfig(config).fenceStyles.find((s: Json) => s.name === q.fenceStyle)
    const profit = legacyProfit(pricing, style)
    if (profit === null) continue
    const stampedQ = { ...q, pricing: { ...pricing, targetProfitPct: profit } }
    const d = m.draftMarginFor(config, stampedQ)
    const before = await priceToday(q.accountId, q)
    const after = d ? await priceToday(q.accountId, { ...stampedQ, pricing: { ...stampedQ.pricing, costFactor: d.costFactor, overheadPct: d.overheadPct } }) : before
    if (d) moves++
    onFile += Number(q.finalPrice) || 0; openedBefore += before ?? 0; openedAfter += after ?? 0
    say(`  ${APPLY ? 'STAMP' : 'WOULD STAMP'} ${q.id.slice(0, 8)} ${q.customerName}, ${style?.label || q.fenceStyle}, saved ${new Date(q.createdAt).toISOString().slice(0, 10)}`)
    say(`        Target Profit ${pct(profit)}, saved at Overhead ${pct(pricing.overheadPct)}${d ? `; opened, it takes Overhead ${pct(d.overheadPct)} and Target Profit ${pct(d.profitPct)}` : '; nothing changed since, so it opens as saved'}`)
    say(`        price on file ${usd(q.finalPrice)} (stays); opened today: ${usd(before)} before the stamp, ${usd(after)} after`)
    if (!APPLY) { stamped++; continue }
    // Only if unchanged since it was read here: a save in between leaves it to run again.
    const r = await prisma.savedQuote.updateMany({ where: { id: q.id, updatedAt: q.updatedAt, deletedAt: null, status: 'DRAFT' }, data: { pricing: stampedQ.pricing } })
    if (r.count !== 1) { say(`        changed since it was read; left as it is. Run again.`); continue }
    await auditSystem('update', 'SavedQuote', q.id, {
      oldValues: { targetProfitPct: null, finalPrice: q.finalPrice, openedTodayBefore: before },
      newValues: { targetProfitPct: profit, finalPrice: q.finalPrice, openedTodayAfter: after, by: SCRIPT, why: 'Unsent draft follows Settings: its Target Profit, stamped (Nov 3 2026, items 4 and 9). Price on file unchanged.' },
    })
    stamped++
  }
  say(`\n${APPLY ? 'Done' : 'Dry run, nothing changed'}: ${stamped} ${APPLY ? 'stamped' : 'would be stamped'}, ${moves} of them priced differently when next opened; ${already} already stamped.`)
  say(`Together: ${usd(onFile)} on file; opened today ${usd(openedBefore)} before the stamp, ${usd(openedAfter)} after.`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
