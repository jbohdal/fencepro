/**
 * Receipts for payments recorded before receipts existed (Oct 21, 2026).
 *
 *   npx tsx scripts/receipts-backfill.ts                 the report: nothing is written
 *   npx tsx scripts/receipts-backfill.ts --apply         makes the missing receipts (database in DATABASE_URL)
 *   ... --apply --live                                   required as well for the live database, with
 *                                                        EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 *
 * The report lists:
 *   - sold jobs with payments on their schedule and no receipt for them, by customer;
 *   - every invoice typed by hand in Billing (BusinessState.invoices): customer,
 *     invoice number, amount, paid, and whether it was taken into a job's
 *     payment schedule (lib/billingAdoption.ts) and, if not, why.
 *
 * --apply makes each missing receipt the way a new payment's is made
 * (lib/contractBilling.ts makeReceiptIn: the next number in the company's
 * sequence, what it says as of that payment) and puts it in the customer's
 * Documents. Nothing is texted or emailed. Run only after Jonathan's OK.
 * Kristi Murphy's handwritten receipt was GDF-2026-1021-01 (already sent);
 * hers from here takes the normal sequence.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('receipts-backfill.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { makeReceiptIn, fileReceipt } = await import('../src/server/lib/contractBilling.js')
  const { planAdoption } = await import('../src/server/lib/billingAdoption.js')
  const { moneyText } = await import('../src/server/lib/paymentMath.js')
  console.log(`Receipts backfill, database "${dbName}", ${APPLY ? 'APPLY' : 'report only'}\n`)

  // all rows: every company's payments that have no receipt and are not voided.
  const pays = await prisma.contractPayment.findMany({ where: { voidedAt: null }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] })
  const have = new Set((await prisma.receipt.findMany({ where: { paymentId: { in: pays.map(p => p.id) } }, select: { paymentId: true } })).map(r => r.paymentId))
  const missing = pays.filter(p => !have.has(p.id))
  const jobs = new Map((await prisma.savedJob.findMany({ where: { id: { in: missing.map(p => p.jobId) } }, select: { id: true, customerName: true, customerAddress: true } })).map(j => [j.id, j]))
  const byCustomer = new Map<string, typeof missing>()
  for (const p of missing) {
    const name = jobs.get(p.jobId)?.customerName || '(no name)'
    byCustomer.set(name, [...(byCustomer.get(name) ?? []), p])
  }
  console.log(`Payments with no receipt: ${missing.length}, ${byCustomer.size} customer${byCustomer.size === 1 ? '' : 's'}`)
  for (const [name, list] of byCustomer) {
    console.log(`  ${name}: ${list.length}`)
    for (const p of list) console.log(`    ${p.paidOn}  ${moneyText(p.amountCents)}  ${p.method}${p.checkNumber ? ` #${p.checkNumber}` : ''}${p.reference ? ` (${p.reference})` : ''}  ${p.source === 'adopted' ? 'typed in Billing' : 'recorded in the app'}  job ${p.jobId}`)
  }

  console.log('\nInvoices typed by hand in Billing:')
  const states = await prisma.businessState.findMany({ select: { accountId: true, invoices: true, payments: true } })
  let handMade = 0
  for (const b of states) {
    const invoices = Array.isArray(b.invoices) ? (b.invoices as any[]) : []
    const payments = Array.isArray(b.payments) ? (b.payments as any[]) : []
    if (!invoices.length) continue
    const plan = await planAdoption(prisma, b.accountId, invoices, payments)
    for (const r of plan) {
      handMade++
      const paid = r.payments.reduce((s, p) => s + (Math.round(Number(p.amountCents)) || 0), 0)
      console.log(`  ${r.invoice.customerName || r.invoice.customerId || '(no customer)'}  ${r.invoice.invoiceNumber ?? r.invoice.id}  "${r.invoice.title ?? ''}"  ${moneyText(Math.round(Number(r.invoice.totalCents)) || 0)}  paid ${moneyText(paid)}  ${r.adopted ? `on the payment schedule of job ${r.jobId ?? '?'}` : `NOT on a schedule: ${r.why ?? `belongs to job ${r.jobId} (the one-time start-up step takes it in if it has not run for this company yet)`}`}`)
    }
  }
  if (!handMade) console.log('  none')

  if (!APPLY) { console.log('\nNothing was written. Add --apply to make the missing receipts (nothing is sent).'); await prisma.$disconnect(); return }
  let n = 0
  for (const p of missing) {
    const r = await prisma.$transaction(tx => makeReceiptIn(tx, p.accountId, p.id), { timeout: 20_000 })
    await fileReceipt(r.id)
    console.log(`  Receipt ${r.number}: ${jobs.get(p.jobId)?.customerName ?? ''} ${moneyText(p.amountCents)} (${p.paidOn})`)
    n++
  }
  console.log(`\n${n} receipt${n === 1 ? '' : 's'} made. None were sent.`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.message || err); process.exit(1) })
