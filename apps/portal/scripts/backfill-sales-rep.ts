/**
 * Credit the Salesman (Christa) as sales rep on her old quotes and jobs that
 * show "—" (walkthrough, Oct 24, 2026). New saves do it by themselves since
 * then (lib/salesRep.ts); this is for what was saved before.
 *
 *   cd apps/portal && npx tsx scripts/backfill-sales-rep.ts            the list only, writes nothing
 *   cd apps/portal && npx tsx scripts/backfill-sales-rep.ts --apply    writes the rep on those records
 *
 * Which records: a quote or job whose rep is blank, where a Salesman login
 * made the quote, or the customer's pipeline card names her as its rep, or the
 * customer's rep is her, or she entered the customer; a job also when its
 * quote is hers (lib/salesRep.ts pickRepBackfill). A record that already
 * names a rep is never touched. Only the rep's name is written: no price,
 * cost or commission switch changes.
 *
 * Against the live database, --apply also needs EZBIZ_LIVE_WRITE_OK=1 and a
 * backup from the last 30 minutes (lib/liveWriteGuard.ts). Show Jonathan the
 * list first. Safe to run twice: the second run finds nothing left.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { liveDatabaseMisuse, databaseNameOf } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { pickRepBackfill, SALESMAN_ROLE } from '../src/server/lib/salesRep.js'

const APPLY = process.argv.includes('--apply')
// --apply on the live database also needs EZBIZ_LIVE_WRITE_OK=1 and a fresh backup.
if (APPLY) assertLiveWriteAllowed('backfill-sales-rep.ts')
const misuse = liveDatabaseMisuse(process.env.DATABASE_URL, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))

async function main() {
  const prisma = new PrismaClient()
  try {
    const db = databaseNameOf(process.env.DATABASE_URL)
    console.log(`Sales rep backfill, ${APPLY ? 'APPLY' : 'dry run (nothing is written)'}, database "${db}", ${new Date().toString()}\n`)
    const salesmen = await prisma.crmUser.findMany({ where: { role: SALESMAN_ROLE as any }, select: { id: true, firstName: true, lastName: true, crmAccountId: true } })
    if (!salesmen.length) { console.log('No Salesman logins. Nothing to do.'); return }
    console.log(`Salesman logins: ${salesmen.map(s => `${s.firstName} ${s.lastName}`.trim()).join(', ')}\n`)

    const accounts = [...new Set(salesmen.map(s => s.crmAccountId).filter((a): a is string => !!a))]
    let total = 0
    for (const accountId of accounts) {
      const quotes = await prisma.savedQuote.findMany({ where: { accountId, deletedAt: null }, select: { id: true, ownerId: true, crmContactId: true, salesRep: true, customerName: true, status: true } })
      const jobs = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null }, select: { id: true, quoteId: true, crmContactId: true, salesRep: true, customerName: true, status: true } })
      const contacts = await prisma.crmContact.findMany({ where: { accountId, deletedAt: null }, select: { id: true, salesRep: true, ownerId: true } })
      const states = await prisma.pipelineState.findMany({ where: { accountId } })
      const cards = states.flatMap(s => ((s.leads as any[]) || []).map(l => ({ quoteId: l?.quoteId ?? null, customerId: l?.customerId ?? null, assignedRep: l?.assignedRep ?? '' })))
      const fixes = pickRepBackfill({ salesmen: salesmen.filter(s => s.crmAccountId === accountId), quotes, jobs, contacts, cards })
      total += fixes.length
      const nq = fixes.filter(f => f.kind === 'quote').length
      console.log(`Account ${accountId.slice(0, 8)}: ${nq} quote${nq === 1 ? '' : 's'} and ${fixes.length - nq} job${fixes.length - nq === 1 ? '' : 's'} to credit\n`)
      if (fixes.length) {
        console.log(`${pad('Customer', 28)} ${pad('Record', 18)} ${pad('Status', 10)} ${pad('Rep now', 9)} ${pad('New rep', 18)} Why`)
        for (const f of fixes.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.kind.localeCompare(b.kind))) {
          console.log(`${pad(f.customerName || '(no name)', 28)} ${pad(`${f.kind} ${f.id.replace(/^accepted-/, '').slice(0, 8)}`, 18)} ${pad(f.status || '', 10)} ${pad(f.current.trim() || '—', 9)} ${pad(f.rep, 18)} ${f.why}`)
        }
        console.log('')
      }
      if (!APPLY || !fixes.length) continue
      let wrote = 0
      for (const f of fixes) {
        // Only while the rep is still blank: a rep typed in the meantime wins.
        const where = { id: f.id, accountId, OR: [{ salesRep: '' }, { salesRep: { in: [' ', '  '] } }] }
        const r = f.kind === 'quote'
          ? await prisma.savedQuote.updateMany({ where, data: { salesRep: f.rep } })
          : await prisma.savedJob.updateMany({ where, data: { salesRep: f.rep } })
        wrote += r.count
      }
      console.log(`Wrote the rep on ${wrote} of ${fixes.length} records.\n`)
    }
    console.log(APPLY ? 'Done. Reload any open EZ Biz tabs.' : `${total} record${total === 1 ? '' : 's'} would change. Nothing was written. Run again with --apply to write them.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error('FAILED:', err?.stack || err); process.exit(1) })
