/**
 * Requotes for the sent quotes priced with the old sub labor: each sent quote
 * stays exactly as it was sent; next to it, on the same customer, a new
 * unsent quote priced with today's sub rates (per foot), named
 * "Requote, new sub rates, Oct 30".
 *
 *   pnpm exec tsx scripts/sub-unit-requotes-2026-10-30.ts                 dry run (default): reads only
 *   pnpm exec tsx scripts/sub-unit-requotes-2026-10-30.ts --apply         does it (dev, or a throwaway copy)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/sub-unit-requotes-2026-10-30.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh) and a backup
 *   --out <file.md>   the list as markdown too
 *
 * Jonathan, Oct 30 2026: "keep each sent quote exactly as it is. For each one,
 * save a new unsent quote on that customer's profile, repriced with today's
 * sub rates (per foot), named "Requote, new sub rates, Oct 30". Don't send
 * anything to any customer: no email, no text, no portal notice. Give me the
 * list: customer, old price, new price, difference."
 *
 * Which: SENT, not deleted or archived, subcontractor, saved per section, no
 * sub rate of its own and "Paid per" not picked by hand (Luis Rivera's $26 per
 * section is his own rate: left out).
 *
 * The requote: a new DRAFT on the same customer (link, name, phone, email,
 * address), the same Salesman, owner and lead source, the same fence, runs,
 * rails, drawing, gates, tear out, corners and ends, the slider, the ± dollar
 * adjustment and "Salesman on this job?", the same move or repair. Priced as a
 * new quote saved from the quote builder today: Settings for the sub rate and
 * unit, today's Inventory, the live
 * Good/Better/Best set; the server's save pricing (lib/quotePricing.ts
 * withServerCosts) fills every cost and price, and the proposal gets the
 * stamps a new quote gets (warranties, terms, own tier). It keeps the sent
 * quote's cost factor (Target Margin), commission and Overhead %, so the price
 * moves by the sub labor (and Inventory price changes since), not by today's
 * margin; the list shows that price too ("All Settings today"). The name: the quote
 * has no title field, so it is the first line of its notes (the original's
 * notes follow). `pricing.requoteOf` holds the sent quote's id.
 *
 * Nothing is sent and nothing moves: the row is written straight to the
 * database (no app save, so no pipeline card move, no "quote sent" status, no
 * share link, no needsResend, no OutboundMessage, no push, no email). The
 * customer portal lists only Sent, Sold and Lost quotes, so a Draft is not on
 * it. Automations start from card moves, payments and dates of SENT quotes and
 * jobs, none of which this writes. The sent quote is never written: the script
 * checks it is byte for byte the same after.
 *
 * Run again: a sent quote that already has its requote (requoteOf, or the name
 * and its id in the notes, not deleted) gets none.
 */

import 'dotenv/config'
import fs from 'fs'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'
import { businessDate } from '../../web/src/businessDate'
import { LABEL, sectionQuotes, ownRate, picked, repricedSave, pricedColumns, id8, usd, cents, table } from './sub-unit-common-2026-10-30.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const outArg = args.indexOf('--out')
const OUT = outArg >= 0 ? args[outArg + 1] : undefined
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('sub-unit-requotes-2026-10-30.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)
const signed = (c: number) => `${c >= 0 ? '+' : '−'}${usd(Math.abs(c) / 100)}`

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const sent = (await sectionQuotes(['SENT'])).filter(q => !q.archivedAt && !ownRate(q) && !picked(q))
  const fingerprint = async (ids: string[]) => new Map((await prisma.$queryRawUnsafe<Array<{ id: string; h: string }>>(
    'SELECT id, md5(row_to_json(q)::text) AS h FROM "SavedQuote" q WHERE id = ANY($1)', ids)).map(r => [r.id, r.h]))
  const before = await fingerprint(sent.map(q => q.id))
  const today = businessDate(new Date())
  const allTodayPrice = new Map<string, number>()
  const rows: Array<{ q: any; out: any | null; madeId: string | null; had: string | null; contact: string | null }> = []

  for (const q of sent) {
    const had = await prisma.savedQuote.findFirst({
      where: { accountId: q.accountId, deletedAt: null, OR: [{ pricing: { path: ['requoteOf'], equals: q.id } }, { AND: [{ notes: { startsWith: LABEL } }, { notes: { contains: id8(q.id) } }] }] },
      select: { id: true },
    })
    // The customer link only when the customer is still there, in the same company (as a save does).
    const c = q.crmContactId ? await prisma.crmContact.findUnique({ where: { id: q.crmContactId }, select: { id: true, accountId: true, deletedAt: true } }) : null
    const contact = c && c.accountId === q.accountId && !c.deletedAt ? c.id : null
    if (had) { rows.push({ q, out: null, madeId: null, had: had.id, contact }); continue }
    const notes = `${LABEL}. Made from the sent quote ${id8(q.id)} (${usd(q.finalPrice)}, sent price kept as it is); priced with today's sub rates.${q.notes ? `\n\n${q.notes}` : ''}`
    // The sent quote's cost choices (cost factor, commission, Overhead %) are kept, so the price moves by the sub labor
    // (and any Inventory price change since); "all Settings today" is shown beside it.
    const costFrom = { id: q.id, status: 'DRAFT', fenceStyle: q.fenceStyle, runs: q.runs, pricing: q.pricing, work: null }
    const out = await repricedSave(q.accountId, q, null, { status: 'DRAFT', date: today, notes }, costFrom)
    const allToday = await repricedSave(q.accountId, q, null, { status: 'DRAFT', date: today, notes })
    allTodayPrice.set(q.id, Number(allToday.finalPrice))
    out.pricing = { ...(out.pricing ?? {}), requoteOf: q.id }
    rows.push({ q, out, madeId: null, had: null, contact })
  }

  if (APPLY) {
    for (const r of rows) {
      if (!r.out) continue
      const { q, out } = r
      const cols = pricedColumns(out)
      const made = await prisma.savedQuote.create({
        data: {
          accountId: q.accountId, ownerId: q.ownerId, crmContactId: r.contact,
          customerName: q.customerName, customerPhone: q.customerPhone, customerEmail: q.customerEmail, customerAddress: q.customerAddress,
          leadSource: q.leadSource, salesRep: q.salesRep, fenceStyle: out.fenceStyle,
          runs: q.runs ?? [], runRails: q.runRails ?? undefined,
          corners: q.corners, ends: q.ends, walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates,
          adjLaborHrs: q.adjLaborHrs, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust, leadTemp: q.leadTemp,
          ...cols,
          status: 'DRAFT', date: today, notes: out.notes, needsResend: false,
        },
      })
      r.madeId = made.id
      await auditSystem('create', 'SavedQuote', made.id, { newValues: { requoteOf: q.id, customerName: q.customerName, sentPrice: q.finalPrice, finalPrice: made.finalPrice, by: 'scripts/sub-unit-requotes-2026-10-30.ts', why: 'Requote, new sub rates (Jonathan, Oct 30 2026)' } })
    }
  }

  const after = await fingerprint(sent.map(q => q.id))
  const touched = sent.filter(q => before.get(q.id) !== after.get(q.id))

  const list = rows.map(r => {
    const oldC = cents(r.q.finalPrice)
    const newC = r.out ? cents(r.out.finalPrice) : null
    return [
      r.q.customerName || '—', id8(r.q.id), usd(r.q.finalPrice),
      r.out ? usd(r.out.finalPrice) : 'already made', newC == null ? '—' : signed(newC - oldC),
      r.out ? `${usd(r.q.laborCost)} → ${usd(r.out.laborCost)}` : '—',
      allTodayPrice.has(r.q.id) ? usd(allTodayPrice.get(r.q.id)) : '—',
      r.madeId ? id8(r.madeId) : r.had ? `${id8(r.had)} (earlier)` : APPLY ? '—' : '(dry run)',
      r.contact ? 'yes' : 'NO (no customer link on the sent quote)',
    ]
  })
  const made = rows.filter(r => r.out)
  const total = made.reduce((s, r) => s + cents(r.out.finalPrice) - cents(r.q.finalPrice), 0)
  const md = [
    `# ${LABEL}`,
    '',
    `Database: ${dbName}${APPLY ? '' : ' (dry run: nothing written)'}. ${sent.length} sent quotes with the old sub labor; ${made.length} requote(s) ${APPLY ? 'made' : 'to make'}, ${rows.length - made.length} already made.`,
    `Each sent quote stays exactly as sent (checked byte for byte after: ${touched.length ? `${touched.length} CHANGED: ${touched.map(q => id8(q.id)).join(', ')}` : 'none changed'}).`,
    'New price = the same measurements priced today with today\'s sub rates per foot, keeping the sent quote\'s cost factor (Target Margin), commission and Overhead %, at today\'s Inventory prices. "All Settings today" = the price if the requote also took today\'s Target Margin and Overhead % (not used).',
    '',
    table(['Customer', 'Sent quote', 'Old price (sent)', 'New price (requote)', 'Difference', 'Sub labor', 'All Settings today', 'New quote', 'On the customer'], list),
    '',
    `Total difference: ${signed(total)} over ${made.length} quote(s).`,
    '',
  ].join('\n')
  if (OUT) fs.writeFileSync(OUT, md)
  say(md)
  await prisma.$disconnect()
  if (touched.length) { console.error('A sent quote changed. Stop and look.'); process.exit(1) }
}

main().catch(err => { console.error(err); process.exit(1) })
