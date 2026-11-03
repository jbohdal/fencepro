/**
 * Commission off the nine further quotes the rule found, beyond the seven in
 * scripts/commission-rep-fix-2026-11-02.ts.
 *
 *   pnpm exec tsx scripts/commission-nine-2026-11-02.ts                    dry run (default): reads only
 *   pnpm exec tsx scripts/commission-nine-2026-11-02.ts --apply            does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/commission-nine-2026-11-02.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Jonathan, Nov 2 2026: "REMOVE THE 9. Do not change any customer price,
 * including Dave Diamond's $25,717. Commission comes out of the price, so only
 * the internal breakdown should change."
 *
 * Each quote is named here by id and price. Any quote not as named, one the
 * rule no longer finds, one made by a Salesman login, or one with commission
 * added on top of the price, and it stops with nothing changed. Changes only
 * what withoutCommission (lib/commissionRule.ts) changes: the switch, the saved
 * margin, the quote's own commission %, the internal copies on its proposal
 * options. No price, cost, status, share link or proposal word; none has a job.
 * The row is written directly: no needsResend, no message, push or automation.
 * One audit log entry per quote. Run again, it changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'
import { carriesCommission, repRulesOut, ruleLogins, withoutCommission } from '../src/server/lib/commissionRule.js'
import { quoteCommissionCents } from '../src/server/lib/quotesFollowCustomer.js'

const SCRIPT = 'scripts/commission-nine-2026-11-02.ts'
const NINE: Array<{ id: string; price: number }> = [
  { id: 'ef4dc512-2a7f-4185-9ae4-84ca10dfe4b8', price: 10884 },
  { id: '5d0459d3-cf46-49dc-9acb-7d794435635f', price: 9413 },
  { id: '607790ae-e2e3-4ceb-858b-28dd9c9b59f7', price: 5888 },
  { id: '971faa56-645b-4ce9-a681-913ddad8b1cb', price: 13706 },
  { id: '8d5f4cc2-7710-4797-93c8-07d8e68d093a', price: 12552 },
  { id: '95646298-10fb-44e6-9f2e-7bc50a0f3e24', price: 13285 },
  { id: 'eb85634f-cdbd-472c-af4f-af0f78020d6c', price: 25717 },
  { id: '0f80a617-0427-4fec-bf13-33ef89cd7573', price: 14581 },
  { id: 'c208f2a3-1ac6-43fa-96a8-b7d45c376ce9', price: 18301 },
]

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('commission-nine-2026-11-02.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Json = any
const say = (...a: unknown[]) => console.log(...a)
const usd = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const gm = (v: unknown) => `${(Number(v) * 100).toFixed(1)}%`
const stop = (why: string): never => { console.error(`\nSTOPPED, nothing changed: ${why}`); process.exit(3) }

/** The proposal as a customer reads it: everything but the internal copies. */
function customerSees(p: Json): string {
  if (!p || typeof p !== 'object') return JSON.stringify(p ?? null)
  return JSON.stringify({ ...p, options: Array.isArray(p.options) ? p.options.map(({ snapshot: _s, ...o }: Json) => o) : p.options })
}

async function main() {
  const prisma: Json = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}\n`)
  const rows: Json[] = await prisma.savedQuote.findMany({ where: { id: { in: NINE.map(n => n.id) }, deletedAt: null } })
  const plan: Array<{ q: Json; out: Json }> = []
  let done = 0
  for (const n of NINE) {
    const q = rows.find(r => r.id === n.id) ?? stop(`${n.id} is not on file.`)
    if (Math.round(q.finalPrice) !== n.price) stop(`${n.id} ${q.customerName} is ${usd(q.finalPrice)}, not ${usd(n.price)}.`)
    if (!carriesCommission(q)) { done++; say(`  ALREADY DONE ${q.customerName}, ${q.status}, ${usd(q.finalPrice)}`); continue }
    const logins = await ruleLogins(q.accountId)
    const biz = await prisma.businessState.findUnique({ where: { accountId: q.accountId }, select: { config: true } })
    if (!repRulesOut(q.salesRep, q.ownerId, logins)) stop(`${q.customerName} ${usd(q.finalPrice)}: its rep "${q.salesRep}" is not ruled out.`)
    if (logins.some(u => u.id === q.ownerId && u.role === 'sales_rep')) stop(`${q.customerName} ${usd(q.finalPrice)} was made by a Salesman login.`)
    if ((q.pricing?.commissionMode ?? biz?.config?.pricing?.commissionMode ?? 'included') === 'added') stop(`${q.customerName} ${usd(q.finalPrice)} has commission added on top of the price.`)
    if (await prisma.savedJob.count({ where: { accountId: q.accountId, quoteId: q.id } })) stop(`${q.customerName} ${usd(q.finalPrice)} has a job now.`)
    const out = withoutCommission(q)
    if (customerSees(out.proposal ?? q.proposal) !== customerSees(q.proposal)) stop(`${q.customerName} ${usd(q.finalPrice)}: the proposal a customer reads would change.`)
    say(`  ${APPLY ? 'FIX' : 'WOULD FIX'} ${q.id.slice(0, 8)} ${q.customerName}, ${q.status}, rep "${q.salesRep}"`)
    say(`        commission ${usd(quoteCommissionCents(q) / 100)} → $0.00   saved margin ${gm(q.gmPct)} → ${gm(out.gmPct)}   price ${usd(q.finalPrice)} and cost ${usd(q.totalCOGS)} stay`)
    plan.push({ q, out })
  }
  if (!APPLY) { say(`\nDry run: nothing changed. ${plan.length} would change, ${done} already done.`); await prisma.$disconnect(); return }
  let n = 0
  for (const { q, out } of plan) {
    // Only if unchanged since it was read here: a save in between leaves it to run again.
    const r = await prisma.savedQuote.updateMany({ where: { id: q.id, updatedAt: q.updatedAt, deletedAt: null }, data: out })
    if (r.count !== 1) { say(`  ${q.id.slice(0, 8)}: changed since it was read; left as it is`); continue }
    n++
    await auditSystem('update', 'SavedQuote', q.id, {
      oldValues: { hasSalesman: q.hasSalesman, gmPct: q.gmPct, commissionCents: quoteCommissionCents(q) },
      newValues: { hasSalesman: false, gmPct: out.gmPct, commissionCents: 0, by: SCRIPT, why: 'Commission only with a Salesman as the rep (Jonathan, Nov 2 2026). Price, cost and status unchanged.' },
    })
  }
  say(`\nDone: ${n} of ${plan.length} changed.`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
