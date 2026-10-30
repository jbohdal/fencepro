/**
 * Unsent drafts whose sub "Paid per" was saved as Section only because
 * Settings said so then: set to follow Settings (per foot now) and priced
 * again exactly as saving them from the quote builder today would (the
 * server's save pricing, lib/quotePricing.ts withServerCosts), so the quote
 * list and the board show the right price.
 *
 *   pnpm exec tsx scripts/sub-unit-drafts-2026-10-30.ts                 dry run (default): reads only
 *   pnpm exec tsx scripts/sub-unit-drafts-2026-10-30.ts --apply         does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/sub-unit-drafts-2026-10-30.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh) and a backup
 *
 * Jonathan, Oct 30 2026: "Fix unsent drafts to follow Settings (per foot)
 * unless someone picked Section on purpose on that quote."
 *
 * Changed: a DRAFT, not deleted, subcontractor, saved per section, with no sub
 * rate of its own and "Paid per" not picked by hand (subUnitPicked), and no
 * link made for the customer (a share token, or opened). Left as they are and
 * listed: a draft with a customer link (the customer may have seen its price:
 * Jonathan decides, as for sent quotes), one with its own rate, one picked.
 * Sent and sold quotes are never read for changing. Run again, it changes
 * nothing (a changed draft is no longer saved per section).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'
import { sectionQuotes, ownRate, picked, shared, repricedSave, pricedColumns, id8, usd } from './sub-unit-common-2026-10-30.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('sub-unit-drafts-2026-10-30.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const drafts = await sectionQuotes(['DRAFT'])
  const todo: Array<{ q: any; out: any }> = []
  say(`\n${drafts.length} drafts saved per section (subcontractor, not deleted)\n`)
  for (const q of drafts) {
    const who = `${id8(q.id)} ${q.customerName || '—'} (${q.fenceStyle})`
    if (ownRate(q)) { say(`  LEFT  ${who}: its own rate $${ownRate(q)}/section`); continue }
    if (picked(q)) { say(`  LEFT  ${who}: Section picked on the quote`); continue }
    if (shared(q)) { say(`  LEFT  ${who}: a customer link was made (share token or opened); its price stays until Jonathan decides. As saved ${usd(q.finalPrice)}, labor ${usd(q.laborCost)}`); continue }
    const out = await repricedSave(q.accountId, q, q)
    todo.push({ q, out })
    say(`  ${APPLY ? 'FIX ' : 'WOULD FIX'} ${who}`)
    say(`        paid per: section → ${out.pricing?.subUnit ?? 'Settings'}${out.pricing?.subUnitPicked ? ' (picked)' : ''}`)
    say(`        labor ${usd(q.laborCost)} → ${usd(out.laborCost)}   material ${usd(q.materialCost)} → ${usd(out.materialCost)}   cost ${usd(q.totalCOGS)} → ${usd(out.totalCOGS)}`)
    say(`        price ${usd(q.finalPrice)} → ${usd(out.finalPrice)}   margin ${(Number(q.gmPct) * 100).toFixed(1)}% → ${(Number(out.gmPct) * 100).toFixed(1)}%   sections ${q.sections} → ${out.sections}`)
    const opts = Array.isArray(out.proposal?.options) ? out.proposal.options : []
    if (opts.length) say(`        proposal options: ${opts.map((o: any) => `${o.tier?.label ?? o.label ?? o.fenceStyle} ${usd(o.finalPrice)}`).join(', ')}`)
  }
  if (!APPLY) { say(`\nDry run: nothing changed. ${todo.length} draft(s) would be fixed.`); await prisma.$disconnect(); return }

  let done = 0
  for (const { q, out } of todo) {
    // Only while it is still the draft read above (a save in between leaves it to the person who saved it).
    const n = await prisma.savedQuote.updateMany({ where: { id: q.id, status: 'DRAFT', updatedAt: q.updatedAt, deletedAt: null }, data: pricedColumns(out) })
    if (n.count === 1) {
      done++
      await auditSystem('update', 'SavedQuote', q.id, { oldValues: { subUnit: 'section', laborCost: q.laborCost, finalPrice: q.finalPrice }, newValues: { subUnit: out.pricing?.subUnit ?? null, laborCost: out.laborCost, finalPrice: out.finalPrice, by: 'scripts/sub-unit-drafts-2026-10-30.ts', why: 'Sub "Paid per" follows Settings (Jonathan, Oct 30 2026)' } })
    } else say(`  ${id8(q.id)}: changed since it was read; left as it is`)
  }
  say('\nRESULT (from the database)')
  for (const { q } of todo) {
    const r = await prisma.savedQuote.findUnique({ where: { id: q.id } })
    say(`  ${id8(q.id)} ${r?.customerName}: paid per ${(r?.pricing as any)?.subUnit ?? '—'}, labor ${usd(r?.laborCost)}, price ${usd(r?.finalPrice)}`)
  }
  await prisma.$disconnect()
  say(`\nDone: ${done} of ${todo.length} fixed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
