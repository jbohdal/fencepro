/**
 * Jack Chappell's quoted cost: the $10 sub gate labor dropped from its labor
 * record at signing (fixed for later signings; this is the one saved row).
 *
 *   pnpm exec tsx scripts/jack-gate-labor-2026-11-02.ts                    dry run (default): reads only
 *   pnpm exec tsx scripts/jack-gate-labor-2026-11-02.ts --apply            does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/jack-gate-labor-2026-11-02.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Jonathan, Nov 2 2026: "FIX JACK ... If it wasn't, fix the job record only and
 * do not change what the customer owes." The $10 is what a sub is paid for the
 * gate, never a line a customer pays: the gate is on the signed contract and
 * inside the $6,049 either way. Writes one field, JobQuotedCost.labor.subOtherCents,
 * 0 to 1000, and an audit log entry. No price, contract, payment or job field.
 * Anything not as expected and it stops. Run again, it changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const QUOTE = 'a94cd22f-c909-4e87-bb80-11b6bad37757'
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('jack-gate-labor-2026-11-02.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Json = any
const stop = (why: string): never => { console.error(`STOPPED, nothing changed: ${why}`); process.exit(3) }

async function main() {
  const prisma: Json = (await import('../src/server/lib/prisma.js')).default
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const row: Json = await prisma.jobQuotedCost.findFirst({ where: { quoteId: QUOTE } }) ?? stop('no quoted cost on file.')
  const q: Json = await prisma.savedQuote.findUnique({ where: { id: QUOTE }, select: { customerName: true, walkGates: true, dblGates: true, finalPrice: true } })
  if (q?.customerName !== 'Jack Chappell' || q.walkGates !== 1 || q.dblGates !== 0 || row.priceCents !== 604900) stop('the quote is not as expected.')
  const was = row.labor?.subOtherCents
  if (was === 1000) { console.log('Already done.'); await prisma.$disconnect(); return }
  if (was !== 0 || row.labor?.mode !== 'sub') stop(`labor is ${JSON.stringify(row.labor)}.`)
  const labor = { ...row.labor, subOtherCents: 1000 }
  console.log(`${APPLY ? 'FIX' : 'WOULD FIX'} Jack Chappell: sub gate labor $0.00 → $10.00. Price $6,049.00 and quoted labor $${row.laborCents / 100} stay.`)
  if (!APPLY) { await prisma.$disconnect(); return }
  await prisma.jobQuotedCost.update({ where: { id: row.id }, data: { labor } })
  await auditSystem('update', 'JobQuotedCost', row.id, { oldValues: { labor: row.labor }, newValues: { labor, by: 'scripts/jack-gate-labor-2026-11-02.ts', why: 'The sub gate labor dropped at signing (Jonathan, Nov 2 2026). What the customer owes is unchanged.' } })
  console.log('Done.')
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
