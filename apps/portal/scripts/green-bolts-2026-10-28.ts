/**
 * The three Green bolts priced from their 06-251707 lines (Stephens Pipe &
 * Steel, Oct 26 2026), shown before anything changes, then done through the
 * app's own code.
 *
 *   pnpm exec tsx scripts/green-bolts-2026-10-28.ts                 dry run (default): reads only
 *   pnpm exec tsx scripts/green-bolts-2026-10-28.ts --apply         does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/green-bolts-2026-10-28.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh) and a backup
 *
 * Jonathan, Oct 28 2026: "Bolts: set the three Green bolts to the 06-251707
 * landed prices ($0.40, $0.33, $0.18). They're at $0.38, $0.53, $0.19 now."
 * Those were saved in Inventory on Oct 27 at 11:17 to 11:19 pm, so they count
 * as typed prices newer than the document, and the Oct 28 green prices run
 * kept them. Here each bolt line on 06-251707, waiting in Needs a match, is
 * priced on that document only (lib/vendorInvoices applyLineOnce, `overNewer`:
 * his word puts the document's price over the Oct 27 one): landed as the
 * document worked it out (freight and estimated tax spread, never fuel), dated
 * Oct 26, a price history row, the line leaves Needs a match. Not remembered
 * for later documents (a plain bolt on a galvanized order is the galvanized
 * bolt). Run again, it changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { dollars, invoiceNumberKey } from '../src/server/lib/invoiceMath.js'
import { GREEN_ASK } from '../src/server/lib/greenChainLink.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const DOC = '06-251707'
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('green-bolts-2026-10-28.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, '')
const cents = (item: any): number | null => { const n = Number(item?.unitCost); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
const money = (c: number | null | undefined) => (c == null ? 'no price' : dollars(c))

interface Row { description: string; part: string; itemId: string | null; beforeCents: number | null; beforeDate: string | null; lineId: string | null; lineState: string | null; afterCents: number | null }

async function plan(tx: any): Promise<{ accountId: string; owner: { id: string; name: string } | null; rows: Row[] }> {
  const invs = await tx.vendorInvoice.findMany({ where: { invoiceKey: invoiceNumberKey(DOC), status: { notIn: ['refused', 'failed', 'replaced'] } }, include: { lines: { orderBy: { seq: 'asc' } } } })
  if (invs.length !== 1) throw new Error(`Expected ${DOC} once in the app, found ${invs.length}.`)
  const inv = invs[0]
  const accountId = inv.accountId
  const items = arr((await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true } }))?.items)
  const owner = await tx.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin', status: 'active' }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: { createdAt: 'asc' } })
  const rows = GREEN_ASK.map(a => {
    const part = a.candidates.find(c => /^Green,/.test(c))!
    const item = items.find(i => norm(i?.name) === norm(part))
    const line = inv.lines.find((l: any) => !l.ignored && norm(l.description) === norm(a.description))
    const qty = Number(line?.qty)
    const landed = line ? line.landedCents ?? (line.totalCents ?? 0) + (line.extraCents ?? 0) : null
    return {
      description: a.description, part, itemId: item?.id ?? null, beforeCents: cents(item), beforeDate: item?.priceUpdatedAt ?? null,
      lineId: line?.id ?? null, lineState: line?.state ?? null,
      afterCents: line?.state === 'applied' ? line.unitLandedCents : landed != null && qty > 0 ? Math.round(landed / qty) : null,
    }
  })
  return { accountId, owner: owner ? { id: owner.id, name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || owner.email } : null, rows }
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const p = await prisma.$transaction(async (tx: any) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return plan(tx) })
  say(`\nBEFORE → AFTER (${DOC}, Oct 26 2026, landed each)`)
  for (const r of p.rows) say(`  ${r.part}: ${money(r.beforeCents)}${r.beforeDate ? ` (dated ${r.beforeDate})` : ''} → ${money(r.afterCents)}   line "${r.description}" ${r.lineState ?? 'NOT FOUND'}${r.itemId ? '' : '   PART NOT IN INVENTORY'}`)
  if (!APPLY) { say('\nDry run: nothing changed.'); await prisma.$disconnect(); return }

  if (!p.owner) throw new Error('No owner login for this company')
  const lib = await import('../src/server/lib/vendorInvoices.js')
  say(`\nAPPLY as ${p.owner.name}`)
  for (const r of p.rows) {
    if (!r.itemId || !r.lineId) { say(`  ${r.part}: skipped (part or line missing)`); continue }
    if (r.lineState !== 'needs_match') { say(`  ${r.part}: line is "${r.lineState}": left as it is`); continue }
    const out = await lib.applyLineOnce(p.accountId, r.lineId, { inventoryItemId: r.itemId, why: 'Jonathan, Oct 28 2026: the three plain bolts on 06-251707 are the Green bolt prices.', overNewer: true }, p.owner)
    say(`  ${r.part}: ${out.changed ? `${money(out.prevCents)} → ${money(out.cents)}` : out.note} (document now ${out.invoiceStatus})`)
  }

  say('\nRESULT (from the database)')
  const after = await prisma.$transaction(async (tx: any) => plan(tx))
  const items = arr((await prisma.inventoryState.findUnique({ where: { accountId: p.accountId }, select: { items: true } }))?.items)
  let bad = 0
  for (const r of after.rows) {
    const it = items.find(i => i.id === r.itemId)
    const ok = cents(it) === r.afterCents && it?.priceUpdatedAt === '2026-10-26' && !it?.priceImported && r.lineState === 'applied'
    if (!ok) bad++
    say(`  ${r.part}: ${money(cents(it))}, dated ${it?.priceUpdatedAt ?? 'none'}, line ${r.lineState}${ok ? '' : '   DIFFERS'}`)
  }
  await prisma.$disconnect()
  if (bad) { console.error(`\n${bad} part(s) differ from the plan.`); process.exit(1) }
  say('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
