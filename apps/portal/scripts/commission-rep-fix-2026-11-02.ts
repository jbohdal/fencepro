/**
 * Commission off the quotes whose rep is no Salesman, and (a separate choice)
 * the one sold quote whose saved margin is too high.
 *
 *   pnpm exec tsx scripts/commission-rep-fix-2026-11-02.ts                 dry run (default): reads only
 *   pnpm exec tsx scripts/commission-rep-fix-2026-11-02.ts --apply         does it (dev)
 *   pnpm exec tsx scripts/commission-rep-fix-2026-11-02.ts --jaziel-sold   the same for the sold margin fix, and nothing else
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/commission-rep-fix-2026-11-02.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *   --leave 1234abcd,5678ef01                        leaves these quotes out on purpose; they are listed
 *
 * Jonathan, Nov 2 2026: "Commission only applies when an actual Salesman
 * (Christa or another salesman login) is the rep. Remove it from the 7 quotes
 * where the rep is me, Jb or blank, including Kristi Murphy's sold job. Nobody
 * is paid on those."
 *
 * Found by the rule (lib/commissionRule.ts), then checked against the seven he
 * named: anything else found, or one of them not as named, and it stops with
 * nothing changed. A quote with a Salesman as its rep, or made by a Salesman
 * login with no rep, is never touched. Commission "added" on top of the price
 * stops it too: taking that off would change a price.
 *
 * Changes only the commission switch, the saved margin, the quote's own
 * commission fields, the internal copies on its proposal options (never read
 * by a customer), and the commission switch and margin copied on its job. No
 * price, cost, status, share link or proposal word. Job costing (JobQuotedCost)
 * and the signed contract hold no commission or margin. The row is written
 * directly: no needsResend, no message, push or automation. One audit log entry
 * per quote. Run again, it changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'
import { carriesCommission, repNamesSalesman, withoutCommission } from '../src/server/lib/commissionRule.js'
import { quoteCommissionCents } from '../src/server/lib/quotesFollowCustomer.js'

const SCRIPT = 'scripts/commission-rep-fix-2026-11-02.ts'
const NAMED: Array<{ name: string; price: number; commission: number }> = [
  { name: 'Christa Feagin', price: 8920, commission: 892 },
  { name: 'Christa Feagin', price: 5532, commission: 498 },
  { name: 'Kristi Murphy', price: 10069, commission: 906 },
  { name: 'Kristi Murphy', price: 8914, commission: 802 },
  { name: 'Jaziel Ortiz', price: 10656, commission: 959 },
  { name: 'Michael Grant', price: 11715, commission: 1054 },
  { name: 'Heidi Coffman', price: 12752, commission: 1148 },
]

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const JAZIEL = args.includes('--jaziel-sold')
const leaveAt = args.indexOf('--leave')
const LEAVE = leaveAt >= 0 ? (args[leaveAt + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean) : []
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('commission-rep-fix-2026-11-02.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Json = any
const say = (...a: unknown[]) => console.log(...a)
const id8 = (id: string) => id.slice(0, 8)
const usd = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const gm = (v: unknown) => (v == null ? '—' : `${(Number(v) * 100).toFixed(2)}%`)
const stop = (why: string): never => { console.error(`\nSTOPPED, nothing changed: ${why}`); process.exit(3) }

/** The proposal as a customer reads it: everything but the internal copies. */
function customerSees(p: Json): string {
  if (!p || typeof p !== 'object') return JSON.stringify(p ?? null)
  return JSON.stringify({ ...p, options: Array.isArray(p.options) ? p.options.map(({ snapshot: _s, ...o }: Json) => o) : p.options })
}

async function commissionFix(prisma: Json) {
  const biz = await prisma.businessState.findMany({ select: { accountId: true, config: true } })
  const modeOf = new Map(biz.map((b: Json) => [b.accountId, b.config?.pricing?.commissionMode ?? 'included']))
  const rows: Json[] = await prisma.savedQuote.findMany({ where: { deletedAt: null } })
  const logins: Json[] = await prisma.crmUser.findMany({ where: { role: 'sales_rep' }, select: { id: true, firstName: true, lastName: true, crmAccountId: true } })
  const found: Json[] = [], left: Json[] = []
  for (const q of rows.filter(r => carriesCommission(r))) {
    const salesmen = logins.filter(u => u.crmAccountId === q.accountId)
    if (repNamesSalesman(q.salesRep, salesmen)) continue
    if (LEAVE.includes(id8(q.id))) { left.push(q); continue }
    found.push(q)
  }
  say(`Quotes carrying commission: ${rows.filter(r => carriesCommission(r)).length}. With no Salesman as the rep: ${found.length + left.length}.`)
  for (const q of left) say(`  LEFT OUT (--leave) ${id8(q.id)} ${q.customerName}, ${q.status}, rep "${q.salesRep}", ${usd(q.finalPrice)}, commission ${usd(quoteCommissionCents(q) / 100)}`)

  // Each named quote, by the rule, or already done by an earlier run.
  const unmatched = [...found]
  const todo: Json[] = [], done: Json[] = [], missing: string[] = []
  for (const n of NAMED) {
    const i = unmatched.findIndex(q => q.customerName === n.name && Math.round(q.finalPrice) === n.price && Math.round(quoteCommissionCents(q) / 100) === n.commission)
    if (i >= 0) { todo.push(unmatched.splice(i, 1)[0]); continue }
    const was = rows.find(q => q.customerName === n.name && Math.round(q.finalPrice) === n.price && !carriesCommission(q) && !done.includes(q) && !repNamesSalesman(q.salesRep, logins.filter(u => u.crmAccountId === q.accountId)))
    if (was) done.push(was); else missing.push(`${n.name} ${usd(n.price)}, commission ${usd(n.commission)}`)
  }
  if (unmatched.length) {
    say('\nFound by the rule, not among the seven named:')
    for (const q of unmatched) say(`  ${id8(q.id)} ${q.customerName}, ${q.status}, ${q.date}, rep "${q.salesRep}", made by ${q.ownerId ? (logins.some(u => u.id === q.ownerId) ? 'a Salesman login' : 'another login') : 'no login'}, ${usd(q.finalPrice)}, commission ${usd(quoteCommissionCents(q) / 100)}`)
    stop(`${unmatched.length} quote(s) beyond the seven. Ask Jonathan; to go on without one, name it with --leave.`)
  }
  if (missing.length) stop(`not as named: ${missing.join('; ')}.`)

  const plan: Array<{ q: Json; out: Json; jobs: Json[] }> = []
  for (const q of todo) {
    if ((q.pricing?.commissionMode ?? modeOf.get(q.accountId) ?? 'included') === 'added') stop(`${id8(q.id)} ${q.customerName} has commission added on top of the price: taking it off would change the price.`)
    if (logins.some(u => u.id === q.ownerId && u.crmAccountId === q.accountId)) stop(`${id8(q.id)} ${q.customerName} was made by a Salesman login: refused.`)
    const out = withoutCommission(q)
    const jobs: Json[] = await prisma.savedJob.findMany({ where: { accountId: q.accountId, quoteId: q.id }, select: { id: true, status: true, hasSalesman: true, gmPct: true, updatedAt: true } })
    if (customerSees(out.proposal ?? q.proposal) !== customerSees(q.proposal)) stop(`${id8(q.id)}: the proposal a customer reads would change.`)
    say(`\n  ${APPLY ? 'FIX' : 'WOULD FIX'} ${id8(q.id)} ${q.customerName}, ${q.status}, ${q.date}, rep "${q.salesRep}"`)
    say(`        commission ${usd(quoteCommissionCents(q) / 100)} → $0.00   switch on → off   saved margin ${gm(q.gmPct)} → ${gm(out.gmPct)}`)
    say(`        price ${usd(q.finalPrice)} and cost ${usd(q.totalCOGS)} stay   status, share link and proposal words stay`)
    say(`        proposal option copies changed: ${(out.proposal?.options ?? []).filter((o: Json) => o?.snapshot).length}`)
    for (const j of jobs) say(`        job ${id8(j.id)} (${j.status}): switch ${j.hasSalesman ? 'on → off' : 'off'}, saved margin ${gm(j.gmPct)} → ${gm(out.gmPct)}`)
    plan.push({ q, out, jobs })
  }
  for (const q of done) say(`\n  ALREADY DONE ${id8(q.id)} ${q.customerName}, ${usd(q.finalPrice)}`)
  if (!APPLY) { say(`\nDry run: nothing changed. ${plan.length} quote(s) would change, ${plan.reduce((t, p) => t + p.jobs.length, 0)} job(s) with them.`); return }

  let n = 0
  for (const { q, out, jobs } of plan) {
    const ok = await prisma.$transaction(async (tx: Json) => {
      // Only if unchanged since it was read here: a save in between leaves it to run again.
      const r = await tx.savedQuote.updateMany({ where: { id: q.id, updatedAt: q.updatedAt, deletedAt: null }, data: out })
      if (r.count !== 1) return false
      for (const j of jobs) {
        const w = await tx.savedJob.updateMany({ where: { id: j.id, updatedAt: j.updatedAt }, data: { hasSalesman: false, gmPct: out.gmPct } })
        if (w.count !== 1) throw new Error(`job ${j.id} changed since it was read`)
      }
      return true
    }).catch((e: Error) => { say(`  ${id8(q.id)}: ${e.message}; left as it is`); return false })
    if (!ok) { say(`  ${id8(q.id)}: changed since it was read; left as it is`); continue }
    n++
    await auditSystem('update', 'SavedQuote', q.id, {
      oldValues: { hasSalesman: q.hasSalesman, gmPct: q.gmPct, commissionCents: quoteCommissionCents(q), jobs: jobs.map(j => ({ id: j.id, hasSalesman: j.hasSalesman, gmPct: j.gmPct })) },
      newValues: { hasSalesman: false, gmPct: out.gmPct, commissionCents: 0, by: SCRIPT, why: 'Commission only with a Salesman as the rep (Jonathan, Nov 2 2026). Price, cost and status unchanged.' },
    })
  }
  say(`\nDone: ${n} of ${plan.length} changed.`)
}

/** The sold quote whose margin was copied from the option's list price: no commission, saved margin over price less cost. */
async function jazielSold(prisma: Json) {
  const sold: Json[] = await prisma.savedQuote.findMany({ where: { deletedAt: null, status: 'SOLD', totalCOGS: { gt: 0 }, finalPrice: { gt: 0 } } })
  const wrong = sold.filter(q => !carriesCommission(q) && q.gmPct > (q.finalPrice - q.totalCOGS) / q.finalPrice + 0.0005)
  say(`Sold quotes with costs: ${sold.length}. No commission and a saved margin over price less cost: ${wrong.length}.`)
  for (const q of wrong) say(`  ${id8(q.id)} ${q.customerName}, ${usd(q.finalPrice)} less ${usd(q.totalCOGS)}, saved ${gm(q.gmPct)}, true ${gm((q.finalPrice - q.totalCOGS) / q.finalPrice)}`)
  const others = wrong.filter(q => q.customerName !== 'Jaziel Ortiz' || Math.round(q.finalPrice) !== 12145)
  if (others.length) stop('more than Jaziel Ortiz\'s $12,145: ask Jonathan.')
  const q = wrong[0]
  if (!q) { say('Nothing to change.'); return }
  const gmPct = (Math.round(q.finalPrice * 100) - Math.round(q.totalCOGS * 100)) / Math.round(q.finalPrice * 100)
  const options = (q.proposal as Json)?.options
  const proposal = Array.isArray(options) && typeof q.chosenOption === 'number' && options[q.chosenOption]?.snapshot
    ? { ...q.proposal, options: options.map((o: Json, i: number) => (i === q.chosenOption ? { ...o, snapshot: { ...o.snapshot, gmPct } } : o)) }
    : null
  const jobs: Json[] = await prisma.savedJob.findMany({ where: { accountId: q.accountId, quoteId: q.id }, select: { id: true, gmPct: true, updatedAt: true } })
  say(`\n  ${APPLY ? 'FIX' : 'WOULD FIX'} ${id8(q.id)} ${q.customerName}: saved margin ${gm(q.gmPct)} → ${gm(gmPct)}, the chosen option's internal copy too`)
  for (const j of jobs) say(`        job ${id8(j.id)}: saved margin ${gm(j.gmPct)} → ${gm(gmPct)}`)
  if (!APPLY) { say('\nDry run: nothing changed.'); return }
  const ok = await prisma.$transaction(async (tx: Json) => {
    const r = await tx.savedQuote.updateMany({ where: { id: q.id, updatedAt: q.updatedAt, status: 'SOLD', deletedAt: null }, data: { gmPct, ...(proposal ? { proposal } : {}) } })
    if (r.count !== 1) return false
    for (const j of jobs) await tx.savedJob.updateMany({ where: { id: j.id, updatedAt: j.updatedAt }, data: { gmPct } })
    return true
  })
  if (!ok) { say('Changed since it was read; left as it is.'); return }
  await auditSystem('update', 'SavedQuote', q.id, { oldValues: { gmPct: q.gmPct }, newValues: { gmPct, by: SCRIPT, why: "A typed price's margin: the true figure, price less cost (Jonathan, Nov 2 2026)" } })
  say('\nDone.')
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}\n`)
  await (JAZIEL ? jazielSold(prisma) : commissionFix(prisma))
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
