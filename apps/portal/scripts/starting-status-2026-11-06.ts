/**
 * Jonathan, Nov 6 2026: "OK starting status." The 7 payments recorded before
 * payments had a state get the one he saw in the dry run: checks paid 10 or
 * more days ago with no bounce are Cleared (on the day they were paid), the
 * newer ones Received until he taps Cleared (lib/paymentClearing.ts
 * startingStatusPlan, applyStartingStatus). Only the payments in that list
 * (by customer, amount and day) are changed; any other is left for him.
 *
 *   pnpm exec tsx scripts/starting-status-2026-11-06.ts                (shows what it would do)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/starting-status-2026-11-06.ts --apply --live
 *
 * Run again, it changes nothing (those payments have their state).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

// The list he OK'd: customer, cents, paid on, state.
const OKD: Array<[string, number, string, 'cleared' | 'received']> = [
  ['Kristi Murphy', 445700, '2026-10-21', 'cleared'],
  ['Daniel King', 481900, '2026-10-22', 'cleared'],
  ['Kristi Murphy', 445700, '2026-10-30', 'received'],
  ['Jaziel Ortiz', 607200, '2026-11-01', 'received'],
  ['Tony Mazur', 122100, '2026-11-03', 'received'],
  ['Manuel Cotrich', 361383, '2026-11-03', 'received'],
  ['Jaziel Ortiz', 607300, '2026-11-04', 'received'],
]

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('starting-status-2026-11-06.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { startingStatusPlan, applyStartingStatus } = await import('../src/server/lib/paymentClearing.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (shows what it would do, reads only)'}\n`)
  const owner = await prisma.crmUser.findFirst({ where: { role: 'super_admin', crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, firstName: true, lastName: true, crmAccountId: true } })
  if (!owner?.crmAccountId) { console.error('No owner login linked to a company.'); process.exit(2) }
  const plan = await startingStatusPlan(owner.crmAccountId)
  const ids: string[] = []
  for (const r of plan) {
    const ok = OKD.find(([n, c, d, s]) => n === r.customerName.trim() && c === r.amountCents && d === r.paidOn && s === r.propose)
    console.log(`${ok ? 'change' : 'leave '} ${r.customerName} $${(r.amountCents / 100).toFixed(2)} ${r.checkNumber ? `#${r.checkNumber} ` : ''}${r.paidOn}: ${r.propose} (${r.why})`)
    if (ok) ids.push(r.id)
  }
  if (!plan.length) { console.log('No payment without a state. Nothing to do.'); return }
  if (!APPLY) return
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'Owner'
  const n = await applyStartingStatus(owner.crmAccountId, ids, { userId: owner.id, name } as any)
  await auditSystem('update', 'ContractPayment', 'starting-status', { newValues: { ids, by: 'scripts/starting-status-2026-11-06.ts', why: 'Jonathan, Nov 6 2026: "OK starting status."' } })
  console.log(`\nChanged ${n} payments.`)
}

main().then(() => process.exit(0), err => { console.error(err); process.exit(1) })
