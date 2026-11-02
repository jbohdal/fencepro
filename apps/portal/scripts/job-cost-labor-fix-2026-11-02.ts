/**
 * Saved job costs (Budget > Job Costing) whose labor came from hours x a rate.
 *
 *   pnpm exec tsx scripts/job-cost-labor-fix-2026-11-02.ts                 dry run (default): reads only
 *   pnpm exec tsx scripts/job-cost-labor-fix-2026-11-02.ts --apply         does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/job-cost-labor-fix-2026-11-02.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Jonathan, Nov 2 2026: "Fix any job costs already saved wrong because labor
 * came from hours (list them, old vs new, don't change without my OK)."
 *
 * Affected: an entry with no saved labor cost and no crew lines with pay: the
 * screen works its labor out of hours (hours x the quote's rate, or $22). The
 * new labor is what a new entry fills in today (lib/jobCostPrefill.ts): "Sub
 * paid $" or sub bills on a sub job, else the quote's labor $.
 *
 * Not touched: an entry with crew lines (its labor is the crew total, the rule
 * for crew jobs; listed), an entry with a saved labor cost, and an entry whose
 * quote is gone (listed). Only actualLaborCostCents, laborKind, laborCostTyped
 * and laborSource are written; material, other costs, hours and notes stay. One
 * audit log entry per entry. The list is written only if it is unchanged since
 * it was read. Run again, it changes nothing (a saved labor cost is left alone).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const SCRIPT = 'scripts/job-cost-labor-fix-2026-11-02.ts'
const KEY = 'fencepro_jobcosting'
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('job-cost-labor-fix-2026-11-02.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)
type Json = any
const usd = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const toCents = (d: unknown) => Math.round((Number(d) || 0) * 100)
const margin = (price: number, cost: number) => `${usd(price - cost)} (${price > 0 ? (((price - cost) / price) * 100).toFixed(1) : '0.0'}%)`

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { prefillFor } = await import('../src/server/lib/jobCostPrefill.js')
  const { crewTotalCents, laborBasis, oldHoursCents } = await import('../../web/src/jobCostLabor.js')
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const rows = await prisma.accountKeyValue.findMany({ where: { key: KEY } })
  let would = 0, done = 0, saved = 0, crew = 0, gone = 0
  for (const row of rows) {
    const entries = (Array.isArray(row.value) ? row.value : []) as Json[]
    const fixes: Array<{ entry: Json; oldCents: number; newCents: number; sub: boolean; why: string }> = []
    for (const e of entries) {
      const basis = laborBasis({ actualLaborCostCents: e.actualLaborCostCents, crew: e.crew })
      if (basis === 'saved') { saved++; continue }
      const q = await prisma.savedQuote.findFirst({ where: { id: e.quoteId, accountId: row.accountId } }) as Json
      const name = q?.customerName ?? `quote ${String(e.quoteId).slice(0, 8)}`
      if (!q) { gone++; say(`\n  LEFT  ${name}: the quote is gone (${e.completionDate})`); continue }
      const job = await prisma.savedJob.findFirst({ where: { accountId: row.accountId, quoteId: q.id }, select: { id: true, deletedAt: true } })
      const price = toCents(q.finalPrice)
      const other = toCents(e.actualMaterialCost) + toCents(e.actualOtherCosts)
      if (basis === 'crew') {
        crew++
        const c = crewTotalCents(e.crew)
        say(`\n  LEFT  ${name}, job ${job?.id ?? 'none'}: labor is the crew total ${usd(c)}, not hours; profit ${margin(price, c + other)}`)
        continue
      }
      const oldCents = oldHoursCents({ actualLaborHrs: e.actualLaborHrs }, { laborCost: q.laborCost, adjLaborHrs: q.adjLaborHrs })
      const p = q.deletedAt ? null : await prefillFor(row.accountId, q.id)
      const newCents = p?.labor.cents ?? toCents(q.laborCost)
      const why = `labor was ${Number(e.actualLaborHrs) || 0} hours x a rate; ${p?.labor.words ?? "from the quote's labor $"}`
      if (oldCents === newCents) {
        say(`\n  SAME  ${name}, job ${job?.id ?? 'none'}: ${usd(oldCents)} both ways; ${APPLY ? 'saved as the labor cost' : 'would be saved as the labor cost'}`)
      } else {
        say(`\n  ${APPLY ? 'FIX' : 'WOULD FIX'}  ${name}, job ${job?.id ?? 'none'} (${q.fenceStyle || 'no style'}), completed ${e.completionDate}, price ${usd(price)}`)
        say(`        labor ${usd(oldCents)} → ${usd(newCents)}`)
        say(`        profit ${margin(price, oldCents + other)} → ${margin(price, newCents + other)}`)
        say(`        why: ${why}`)
      }
      would++
      fixes.push({ entry: e, oldCents, newCents, sub: p?.sub ?? q.pricing?.laborMode === 'subcontractor', why })
    }
    if (!APPLY || !fixes.length) continue
    const byId = new Map(fixes.map(f => [f.entry.id, f]))
    const next = entries.map(e => {
      const f = byId.get(e.id)
      return f ? { ...e, actualLaborCostCents: f.newCents, laborCostTyped: false, laborKind: f.sub ? 'sub' : 'crew', laborSource: `Set by the Nov 2 2026 fix: ${f.why}` } : e
    })
    // Only if the list is still the one read above (a save in between leaves it; run again).
    const n = await prisma.accountKeyValue.updateMany({ where: { accountId: row.accountId, key: KEY, version: row.version }, data: { value: next, version: { increment: 1 }, updatedBy: SCRIPT } })
    if (n.count !== 1) { say(`\n  Account ${row.accountId}: the list changed since it was read; nothing written. Run again.`); continue }
    for (const f of fixes) {
      done++
      await auditSystem('update', 'JobCosting', f.entry.id, {
        oldValues: { quoteId: f.entry.quoteId, laborCents: f.oldCents, actualLaborCostCents: null },
        newValues: { quoteId: f.entry.quoteId, laborCents: f.newCents, actualLaborCostCents: f.newCents, by: SCRIPT, why: f.why },
      })
    }
  }
  say(`\n${rows.reduce((s, r) => s + (Array.isArray(r.value) ? r.value.length : 0), 0)} saved entries: ${would} from hours, ${crew} with crew lines left, ${saved} with a labor cost already, ${gone} with no quote.`)
  if (!APPLY) say('Dry run: nothing changed.')
  else say(`Done: ${done} of ${would} written.`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
