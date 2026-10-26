/**
 * Dry run on real invoices: reads every invoice in a folder and prints what it
 * read and whether the total check passes. NOTHING is applied and no database
 * is opened.
 *
 *   pnpm exec tsx scripts/invoice-dry-run.ts <folder> [--engine vision|tesseract|both] [--rows]
 *
 * Each PDF or picture in the folder is one invoice. A sub folder is one
 * invoice made of several pictures (pages, in name order).
 * --engine both reads every picture with the Mac's Vision and with Tesseract
 * (brew install tesseract) and shows the time each took and where they differ.
 * --rows prints every row as read, to see why something was missed.
 * --table prints only the summary table (one row per file).
 *
 * The table: vendor, document type (invoice or quote), number, revision (a
 * quote number seen twice: the newer revision is kept, the older one would be
 * marked replaced), date, lines, rows skipped (*Fab notes, separators, $0.00),
 * fuel and other fees, freight, tax (or "none: estimated", 7.22% added to landed costs), total, and whether
 * it reconciles (lines + fees + freight + tax = total, to the penny).
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { readInvoiceFile, type ReadPage } from '../src/server/lib/invoiceReader.js'
import { parseInvoice, type ParsedInvoice } from '../src/server/lib/invoiceParse.js'
import { checkTotals, dollars, isFuelFee, type CheckProblem } from '../src/server/lib/invoiceMath.js'
import { revisionOf, newerRevision } from '../src/server/lib/vendorInvoices.js'

const FILE = /\.(pdf|jpe?g|png|heic|heif|webp|tiff?)$/i

function invoicesIn(folder: string): Array<{ name: string; files: string[] }> {
  const out: Array<{ name: string; files: string[] }> = []
  for (const e of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(folder, e.name)
    if (e.isDirectory()) {
      const files = fs.readdirSync(p).filter(f => FILE.test(f)).sort().map(f => path.join(p, f))
      if (files.length) out.push({ name: `${e.name}/ (${files.length} pages)`, files })
    } else if (FILE.test(e.name)) out.push({ name: e.name, files: [p] })
  }
  return out
}

async function readAll(files: string[], engine: 'vision' | 'tesseract') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-dry-'))
  try {
    const pages: ReadPage[] = []
    let ms = 0, used = ''
    for (const [i, f] of files.entries()) {
      const r = await readInvoiceFile(f, path.join(tmp, `f${i}`), { engine, firstPage: pages.length + 1 })
      pages.push(...r.pages); ms += r.ms; used = r.engine
    }
    return { pages, ms, engine: used }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

const plain = (p: CheckProblem): string => {
  switch (p.kind) {
    case 'unclear_lines': return `line ${p.lines.map(i => i + 1).join(', ')} unclear or does not add up`
    case 'subtotal': return `lines add up to ${dollars(p.linesCents)}, subtotal says ${dollars(p.subtotalCents)}`
    case 'total': return `subtotal + tax + freight + fees = ${dollars(p.computedCents)}, total says ${dollars(p.totalCents)}`
    case 'no_total': return 'no total found'
    case 'no_lines': return 'no lines found'
  }
}

interface Summary { file: string; p: ParsedInvoice; ok: boolean; revision: string; status?: string }
const summaries: Summary[] = []

function show(p: ParsedInvoice, label: string, quiet = false) {
  const log = quiet ? () => {} : console.log
  const fees = p.fees.reduce((s, f) => s + f.cents, 0)
  const c = checkTotals(p.lines, { ...p, feesCents: fees })
  log(`  [${label}] vendor: ${p.vendorName || '?'} · invoice ${p.invoiceNumber || '?'} · date ${p.invoiceDate || '?'}`)
  for (const [i, l] of p.lines.entries()) {
    const price = l.unitPriceHc == null ? '?' : `$${(l.unitPriceHc / 10000).toFixed(4).replace(/0{1,2}$/, '')}`
    log(`    ${String(i + 1).padStart(2)}. ${(l.itemNumber || '-').padEnd(12)} ${l.description.slice(0, 40).padEnd(40)} ${String(l.qty ?? '?').padStart(6)} ${l.unit.padEnd(4)} ${price.padStart(10)} ${l.totalCents == null ? '?' : dollars(l.totalCents).padStart(11)}${l.problems.length ? `   << ${l.problems.join(', ')}` : ''}`)
  }
  log(`    subtotal ${p.subtotalCents == null ? '(none)' : dollars(p.subtotalCents)} · tax ${dollars(p.taxCents)} · freight ${dollars(p.freightCents)}${p.fees.map(f => ` · ${f.label} ${dollars(f.cents)}`).join('')} · total ${p.totalCents == null ? '?' : dollars(p.totalCents)}`)
  if (p.skipped.length) log(`    skipped: ${p.skipped.map(x => `${x.why} "${x.text.slice(0, 40)}"`).join('; ')}`)
  if (!p.taxFound) log('    no tax line on this document: estimated tax (7.22%, Settings) would be added to the landed costs')
  if (p.fees.some(f => isFuelFee(f.label))) log('    fuel charge: on the vendor bill only, never in item prices')
  if (p.problems.length) log(`    header: missing ${p.problems.join(', ')}`)
  log(`    TOTAL CHECK: ${c.ok && !p.problems.length ? 'PASSES (would go on to matching)' : `FAILS → Needs review: ${[...c.problems.map(plain), ...p.problems].join('; ')}`}`)
  return c.ok && !p.problems.length
}

async function main() {
  const args = process.argv.slice(2)
  const folder = args.find(a => !a.startsWith('--'))
  const engineArg = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : 'vision'
  if (!folder || !fs.existsSync(folder)) { console.error('Usage: pnpm exec tsx scripts/invoice-dry-run.ts <folder> [--engine vision|tesseract|both] [--rows]'); process.exit(1) }
  const engines = (engineArg === 'both' ? ['vision', 'tesseract'] : [engineArg]) as Array<'vision' | 'tesseract'>
  let pass = 0, total = 0
  const quiet = args.includes('--table')
  const say = quiet ? (..._: unknown[]) => {} : console.log
  say('Dry run: nothing is applied, no database is opened.\n')
  for (const inv of invoicesIn(folder)) {
    total++
    say(`== ${inv.name}`)
    let passedAny = false
    for (const engine of engines) {
      try {
        const r = await readAll(inv.files, engine)
        say(`  read by ${r.engine} in ${(r.ms / 1000).toFixed(2)} s, ${r.pages.length} page(s)`)
        if (args.includes('--rows') && !quiet) for (const pg of r.pages) for (const row of pg.rows) console.log(`      p${pg.page} ${row.conf.toFixed(2)} | ${row.cells.join(' | ')}`)
        const parsed = parseInvoice(r.pages)
        const ok = show(parsed, r.engine, quiet)
        if (ok) passedAny = true
        if (engine === engines[0]) summaries.push({ file: inv.name, p: parsed, ok, revision: revisionOf(path.basename(inv.files[0])) })
        if (r.engine === 'pdf-text') break // a text PDF is not OCR'd, so a second engine reads it the same
      } catch (err: any) {
        say(`  [${engine}] could not read: ${err?.message ?? err}`)
      }
    }
    if (passedAny) pass++
    say('')
  }
  // Revisions: the same vendor and number more than once; the newest is kept.
  for (const a of summaries) {
    const same = summaries.filter(b => b !== a && b.p.invoiceNumber && b.p.invoiceNumber === a.p.invoiceNumber && b.p.vendorName === a.p.vendorName)
    if (!same.length) continue
    const me = { invoiceDate: a.p.invoiceDate, revision: a.revision, createdAt: new Date(0) }
    const newer = same.find(b => newerRevision({ invoiceDate: b.p.invoiceDate, revision: b.revision, createdAt: new Date(0) }, me))
    a.status = newer ? `older: replaced by ${newer.revision || newer.file}` : 'latest revision'
  }
  const rows = summaries.map(x => [
    x.file.replace(/ Getter Done LLC/, ''), x.p.vendorName.slice(0, 26), x.p.docType === 'quote' ? 'QUOTE' : 'INVOICE', x.p.invoiceNumber || '?',
    x.revision ? `${x.revision}${x.status ? ` (${x.status})` : ''}` : (x.status ?? '-'), x.p.invoiceDate || '?', String(x.p.lines.length), String(x.p.skipped.length),
    x.p.fees.map(f => `${f.label.replace(/ Charge$/, '')} ${dollars(f.cents)}`).join(', ') || '-', x.p.freightCents ? dollars(x.p.freightCents) : '-',
    x.p.taxFound ? `${dollars(x.p.taxCents)}${x.p.taxRate ? ` (${x.p.taxRate})` : ''}` : 'none: estimated', x.p.totalCents == null ? '?' : dollars(x.p.totalCents), x.ok ? 'yes' : 'NO',
  ])
  const head = ['File', 'Vendor', 'Type', 'Number', 'Revision', 'Date', 'Lines', 'Skipped', 'Fuel/fees', 'Freight', 'Tax', 'Total', 'Reconciled']
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const line = (r: string[]) => r.map((c, i) => c.padEnd(width[i])).join(' | ')
  console.log(line(head)); console.log(width.map(w => '-'.repeat(w)).join('-+-'))
  for (const r of rows) console.log(line(r))
  console.log(`\n${pass} of ${total} document(s) reconcile (lines + fees + freight + tax = total, to the penny).`)
}

main().catch(err => { console.error(err); process.exit(1) })
