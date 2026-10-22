/**
 * Signed contracts backfill (Jonathan, Oct 22 2026): "find every signed quote
 * on live, build its PDF if missing, attach it, and show me the count."
 *
 *   npx tsx scripts/signed-contracts-backfill.ts                    report only, writes nothing
 *   npx tsx scripts/signed-contracts-backfill.ts --apply            builds the missing PDFs in the database in DATABASE_URL
 *   ... --include-deleted                                           also quotes deleted since (in Settings > Deleted Records)
 *   ... --apply --live                                              required as well for the live database, with
 *                                                                   EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 *
 * Signed quote = accepted by the customer (acceptedAt set). Signed change
 * order = signed by the customer (a signature and signedAt). For each one with
 * no stored signed PDF yet, --apply builds it the same way signing does
 * (lib/signedDocuments.ts): from the proposal and option frozen on the quote
 * (or the change order's lines) and the signature already stored, never
 * today's prices or words, with "IP address: not recorded at the time" where
 * no IP was stored. It is attached to the customer (their files and portal),
 * the quote and the job. A stored one that has no customer copy yet gets it
 * once the quote has a customer. Nothing is sent to anyone.
 *
 * Report: the counts (signed, already stored, would be made, cannot be made
 * and why), each customer's, and the counts again after --apply.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
const WITH_DELETED = process.argv.includes('--include-deleted')
if (APPLY) assertLiveWriteAllowed('signed-contracts-backfill.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

interface Item { kind: 'contract' | 'change_order'; id: string; quoteId: string; customerId: string | null; customer: string; label: string; stored: boolean; customerCopy: boolean; blocked: string | null; noIp: boolean }

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const S = await import('../src/server/lib/signedDocuments.js')

  async function survey(): Promise<Item[]> {
    const quotes = await prisma.savedQuote.findMany({
      where: { acceptedAt: { not: null } }, orderBy: { acceptedAt: 'asc' },
      select: { id: true, customerName: true, crmContactId: true, proposal: true, acceptedAt: true, acceptedIp: true, deletedAt: true },
    })
    const cos = await prisma.changeOrder.findMany({
      where: { signedAt: { not: null }, signature: { not: null } }, orderBy: { signedAt: 'asc' },
      select: { id: true, number: true, quoteId: true, accountId: true, signedIp: true, signedBy: true, status: true },
    })
    const coQuotes = await prisma.savedQuote.findMany({ where: { id: { in: [...new Set(cos.map(c => c.quoteId))] } }, select: { id: true, customerName: true, crmContactId: true } })
    const docs = await prisma.signedDocument.findMany({ select: { sourceKey: true, portalFileId: true } })
    const bySource = new Map(docs.map(d => [d.sourceKey, d]))
    const items: Item[] = []
    for (const q of quotes) {
      const d = bySource.get(S.contractKey(q.id))
      const p = q.proposal as any
      items.push({
        kind: 'contract', id: q.id, quoteId: q.id, customerId: q.crmContactId, customer: q.customerName || '(no name)',
        label: `contract, accepted ${q.acceptedAt!.toISOString().slice(0, 10)}${q.deletedAt ? ' (quote deleted)' : ''}`,
        stored: !!d, customerCopy: !!d?.portalFileId,
        blocked: d ? null : !p || !Array.isArray(p.options) || !p.options.length ? 'no proposal saved on the quote to build it from'
          : q.deletedAt && !WITH_DELETED ? 'the quote is deleted (Settings > Deleted Records); add --include-deleted to make it too' : null,
        noIp: !q.acceptedIp,
      })
    }
    for (const c of cos) {
      const q = coQuotes.find(x => x.id === c.quoteId)
      const d = bySource.get(S.changeOrderKey(c.id))
      items.push({
        kind: 'change_order', id: c.id, quoteId: c.quoteId, customerId: q?.crmContactId ?? null, customer: q?.customerName || '(no name)',
        label: `change order #${c.number} (${c.status})`, stored: !!d, customerCopy: !!d?.portalFileId,
        blocked: d ? null : !q ? 'its quote is gone' : c.status === 'draft' ? 'still a draft' : null, noIp: !c.signedIp,
      })
    }
    return items
  }

  function counts(items: Item[], title: string) {
    const of = (k: Item['kind']) => items.filter(i => i.kind === k)
    console.log(`\n${title}`)
    for (const [k, name] of [['contract', 'Signed quotes (acceptedAt set)'], ['change_order', 'Signed change orders (customer signature)']] as const) {
      const xs = of(k)
      const missing = xs.filter(i => !i.stored)
      console.log(`  ${name}: ${xs.length}`)
      console.log(`    stored signed PDF:        ${xs.filter(i => i.stored).length}`)
      console.log(`    would be made:            ${missing.filter(i => !i.blocked).length}${missing.some(i => !i.blocked && i.noIp) ? ` (${missing.filter(i => !i.blocked && i.noIp).length} with "IP not recorded at the time")` : ''}`)
      console.log(`    cannot be made:           ${missing.filter(i => i.blocked).length}`)
      for (const i of missing.filter(i => i.blocked)) console.log(`      ${i.customer}: ${i.label} (${i.kind === 'contract' ? 'quote' : 'change order'} ${i.id}): ${i.blocked}`)
      const noCustomer = xs.filter(i => !i.customerId)
      if (noCustomer.length) console.log(`    no customer on the quote: ${noCustomer.length} (stored and on the quote and job; not in a customer's files until the quote has a customer)`)
      const copyDue = xs.filter(i => i.stored && !i.customerCopy && i.customerId)
      if (copyDue.length) console.log(`    stored, customer copy due: ${copyDue.length}`)
    }
  }

  console.log(`Signed contracts backfill, database "${dbName}", ${APPLY ? 'APPLY' : 'report only (nothing is written)'}`)
  const before = await survey()
  counts(before, 'Before:')

  console.log('\nBy customer (signed / stored / would be made):')
  const groups = new Map<string, Item[]>()
  for (const i of before) { const k = `${i.customer}${i.customerId ? '' : ' (no customer linked)'}`; groups.set(k, [...(groups.get(k) ?? []), i]) }
  for (const [name, xs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const todo = xs.filter(i => !i.stored && !i.blocked)
    console.log(`  ${name}: ${xs.length} / ${xs.filter(i => i.stored).length} / ${todo.length}${todo.length ? `  [${todo.map(i => i.label).join('; ')}]` : ''}`)
  }

  if (!APPLY) { console.log('\nNothing was written. Add --apply to build the missing PDFs.'); await prisma.$disconnect(); return }

  let made = 0, completed = 0, failed = 0
  for (const i of before) {
    if (i.blocked) continue
    if (i.stored && (i.customerCopy || !i.customerId)) continue
    try {
      const out = i.kind === 'contract' ? await S.fileSignedContract(i.id, 'backfill') : await S.fileSignedChangeOrder(i.id, 'backfill')
      if (!out) { failed++; console.log(`  not made: ${i.customer}: ${i.label} (${i.id})`); continue }
      if (out.made) made++; else completed++
    } catch (e) {
      failed++
      console.log(`  failed: ${i.customer}: ${i.label} (${i.id}): ${(e as Error)?.message || e}`)
    }
  }
  console.log(`\nMade ${made} signed PDF${made === 1 ? '' : 's'}; gave ${completed} stored one${completed === 1 ? '' : 's'} its customer copy; ${failed} not made.`)
  counts(await survey(), 'After:')
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.message || err); process.exit(1) })
