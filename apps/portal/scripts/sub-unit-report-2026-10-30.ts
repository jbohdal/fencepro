/**
 * Every unsent and sent quote whose subcontractor labor is paid per section,
 * with its labor and price as saved, as a reopen would price it before the
 * Oct 30 fix ($ rate per SECTION), and following Settings per foot today.
 * Reads only (the whole run is one read only transaction).
 *
 *   DATABASE_URL=<db> pnpm exec tsx scripts/sub-unit-report-2026-10-30.ts [--out <file.md>] [--status DRAFT,SENT]
 *
 * Jonathan, Oct 30 2026: "List every unsent and sent quote using subcontractor
 * labor paid per section, with the labor and price as is vs per foot. Don't
 * change sent ones; I'll decide."
 *
 * Columns:
 *   As saved          the quote's labor and price columns now
 *   Reopen, no fix    today's Settings rate per SECTION (what the app priced a reopen at before the fix)
 *   Per foot          labor following Settings per foot today (the real engine, the quote's own inputs);
 *                     price "labor only" = the saved materials, tear out, cost factor and commission
 *                     with only the labor changed; "full" = repriced today (materials at today's
 *                     Inventory prices too, as reopening the quote in the builder shows it)
 */

import 'dotenv/config'
import fs from 'fs'
import { databaseNameOf } from '../src/server/lib/liveGuard.js'
import { sectionQuotes, ownRate, picked, shared, footageOf, followingSettings, settingsSubUnit, priceSaved, laborOnlyPrice, id8, usd, table } from './sub-unit-common-2026-10-30.js'

const args = process.argv.slice(2)
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const OUT = arg('--out')
const STATUSES = (arg('--status') ?? 'DRAFT,SENT').split(',')

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const db = databaseNameOf(process.env.DATABASE_URL)
  const rows: Array<Array<string | number>> = []
  let n = 0
  {
    const quotes = await sectionQuotes(STATUSES)
    for (const q of quotes) {
      n++
      const own = ownRate(q)
      const asIs = { labor: Number(q.laborCost) || 0, price: Number(q.finalPrice) || 0 }
      const noFix = await priceSaved(q.accountId, q, { ...q.pricing, subUnitPicked: true })
      const foot = own ? null : await priceSaved(q.accountId, q, followingSettings(q.pricing, await settingsSubUnit(q.accountId)))
      const laborOnly = foot ? await laborOnlyPrice(q.accountId, q, foot.totals.laborCost) : null
      const diff = foot ? (laborOnly ?? foot.totals.price) - asIs.price : null
      rows.push([
        id8(q.id), q.status + (q.archivedAt ? ' (archived)' : '') + (q.status === 'DRAFT' && shared(q) ? ' (link made)' : ''), q.customerName || '—', q.fenceStyle,
        (q.work as any)?.type ?? 'new', Math.round(footageOf(q)), q.sections,
        own ? `own $${own}/section (kept)` : picked(q) ? 'picked Section' : 'Settings',
        usd(asIs.labor), usd(asIs.price),
        usd(noFix.totals.laborCost), usd(noFix.totals.price),
        foot ? usd(foot.totals.laborCost) : '—', foot ? (laborOnly == null ? 'n/a' : usd(laborOnly)) : '—', foot ? usd(foot.totals.price) : '—',
        diff == null ? '—' : `${diff >= 0 ? '+' : '−'}${usd(Math.abs(diff))}`,
      ])
    }
  }
  const md = [
    `# Sub labor paid per section: ${STATUSES.join(' and ')} quotes`,
    '',
    `Database: ${db}. ${n} quotes (subcontractor, "Paid per" saved as Section, not deleted). Settings today: per foot.`,
    '',
    'Reopen, no fix = what reopening it priced before the Oct 30 fix (today\'s per foot rate charged per section).',
    'Per foot, labor only = the saved price with only the labor changed. Per foot, full = repriced today (materials at today\'s prices too: what the quote builder shows now).',
    'Change = per foot (labor only, or full for a move or repair) minus the saved price.',
    '',
    table(['Quote', 'Status', 'Customer', 'Style', 'Job', 'Feet', 'Sections', 'Sub rate', 'Labor as saved', 'Price as saved', 'Labor, reopen no fix', 'Price, reopen no fix', 'Labor per foot', 'Price per foot (labor only)', 'Price per foot (full)', 'Change'], rows),
    '',
  ].join('\n')
  if (OUT) fs.writeFileSync(OUT, md)
  console.log(md)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
