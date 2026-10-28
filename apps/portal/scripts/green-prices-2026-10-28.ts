/**
 * Real green prices for the green chain link parts priced from Black, from
 * every Stephens Pipe & Steel document Jonathan has (Oct 28 2026), shown
 * before anything changes, then done through the app's own code.
 *
 *   pnpm exec tsx scripts/green-prices-2026-10-28.ts <folder with the PDFs>            dry run (default): reads only
 *   pnpm exec tsx scripts/green-prices-2026-10-28.ts <folder> --apply                  does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/green-prices-2026-10-28.ts <folder> --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh), a backup from the last 30 minutes and
 *                                                    Jonathan's typed OK
 *
 * Jonathan, Oct 27 2026:
 *   1. "Green parts: check all 17 Stephens quotes in Downloads (including
 *      06-251608) for real green prices on every part now marked 'From Black'
 *      (gates any size, dig set posts, fittings). The 3 plain bolts on
 *      06-251707 came on my green job, so use them as the Green bolt prices.
 *      Same rules: no fuel, 7.22% tax if no tax line. Have the apply line
 *      ready for me in the morning."
 *   2. "Any part still priced from Black shows a warning on the quote so the
 *      salesman knows it's low, and follows Black's price changes until a
 *      green price is entered." (the app does this: web/src/priceAge.ts
 *      followBorrowedPrices, lib/followBorrowed.ts, FromBlackWarning.tsx.)
 *
 * The rules that say which printed line is which green part, and how a price
 * is landed, are in lib/greenRealPrices.ts. The dry run opens one READ ONLY
 * transaction and reads every PDF in the folder with the app's own reader
 * (lib/invoiceReader + invoiceParse). It prints:
 *   1. each file: document, date, lines, tax / freight / fuel; the same
 *      document in two files is read once;
 *   2. every green line printed on any document, with its date, printed and
 *      landed price each, and the green part it is (or why it is none);
 *   3. BEFORE → AFTER for each part priced from Black that a document prices:
 *      the newest document that prices it, the older prices not used, and how
 *      it is put in (the line on the app's own 06-251707, or the document's
 *      printed price);
 *   4. the parts that stay priced from Black (no green price printed anywhere);
 *   5. green parts with a price of their own already: unchanged (with the
 *      newest printed price next to it);
 *   6. a 100 ft straight yard with one 4 ft walk gate: Green No dig and Dig
 *      set against Black 4 ft, now and after, from the app's own estimate.
 *
 * --apply, as the company's owner:
 *   - a part whose newest price is a line of a document in the app (the three
 *     plain bolts on 06-251707, waiting in Needs a match): that line is priced
 *     on that document only (lib/vendorInvoices applyLineOnce): the Green bolt,
 *     not remembered for later documents (a plain bolt on a galvanized order is
 *     the galvanized bolt); the line leaves Needs a match;
 *   - a part whose newest price is on a document kept as a file only (an older
 *     quote): its landed price goes in as a vendor document puts it
 *     (applyFilePrices: dated the document's date, price history, never over a
 *     newer price), without uploading it (that would put a 2023 order on
 *     Accounts Payable);
 *   then checks the database against the dry run. Run again, it changes
 *   nothing. Never with DATABASE_URL on ezbiz_livecopy (the read only copy of live).
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { readInvoiceFile } from '../src/server/lib/invoiceReader.js'
import { parseInvoice, findVendor } from '../src/server/lib/invoiceParse.js'
import { dollars, invoiceNumberKey, pctText } from '../src/server/lib/invoiceMath.js'
import { contentKey, estTaxBpOf } from '../src/server/lib/vendorInvoices.js'
import { greenOption } from '../src/server/lib/greenChainLink.js'
import { GREEN_PRICES_KEY, planGreenRealPrices, docLanded, type Doc, type GreenPricePlan, type PrintedGreen } from '../src/server/lib/greenRealPrices.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const VALUE_FLAGS = ['--account']
const folder = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]))
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)
const LIVE_COPY_NAME = 'ezbiz_livecopy'

if (!folder || !fs.existsSync(folder)) { console.error('Usage: pnpm exec tsx scripts/green-prices-2026-10-28.ts <folder with the Stephens PDFs> [--apply [--live]]'); process.exit(1) }
if (APPLY) {
  if (dbName === LIVE_COPY_NAME) { console.error(`DATABASE_URL names "${LIVE_COPY_NAME}", the read only copy of live: dry runs only. Nothing was changed.`); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('green-prices-2026-10-28.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)
const tech: string[] = []
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, '')
const cents = (item: any): number | null => { const n = Number(item?.unitCost); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
const money = (c: number | null | undefined) => (c == null ? 'no price' : dollars(c))
const usd = (d: number) => dollars(Math.round(d * 100))
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const pct = (a: number, b: number) => (a > 0 ? `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%` : 'new')
const dayWords = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

// ── The documents ───────────────────────────────────────────────────────────

interface FileRead { file: string; doc: Doc; key: string }

async function readDocs(): Promise<{ files: FileRead[]; docs: Doc[] }> {
  const files: FileRead[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'green-prices-'))
  try {
    for (const name of fs.readdirSync(folder!).filter(f => f.toLowerCase().endsWith('.pdf')).sort()) {
      const r = await readInvoiceFile(path.join(folder!, name), path.join(tmp, String(files.length)))
      const p = parseInvoice(r.pages)
      const doc: Doc = {
        number: p.invoiceNumber, date: p.invoiceDate, files: [name], subtotalCents: p.subtotalCents, taxCents: p.taxCents, taxFound: p.taxFound,
        freightCents: p.freightCents, fees: p.fees.map(f => ({ label: f.label, cents: f.cents })), totalCents: p.totalCents,
        lines: p.lines.map(l => ({ description: l.description, qty: l.qty, unit: l.unit, unitPriceHc: l.unitPriceHc, totalCents: l.totalCents, problems: l.problems })),
      }
      files.push({ file: name, doc, key: `${invoiceNumberKey(p.invoiceNumber)}|${contentKey(p, doc.lines)}` })
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  // The same document in two files (06-251126 sent three times) is one document.
  const byKey = new Map<string, Doc>()
  for (const f of files) {
    const d = byKey.get(f.key)
    if (d) d.files.push(f.file)
    else byKey.set(f.key, { ...f.doc, files: [f.file] })
  }
  // Stephens' 2023 layout (06-120125: fuel and freight in one box) is read by the reader itself (lib/invoiceParse splitByReadingOrder).
  const docs = [...byKey.values()]
  return { files, docs: docs.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number)) }
}

// ── The database ────────────────────────────────────────────────────────────

interface State {
  accountId: string
  owner: { id: string; name: string } | null
  vendor: { id: string; name: string } | null
  config: any
  items: any[]
  kits: any[]
  /** Stephens documents in the app, with their lines. */
  invoices: any[]
}

async function loadState(tx: any, accountArg?: string): Promise<State> {
  const states = await tx.vendorState.findMany({ select: { accountId: true, vendors: true } })
  const withSps = states.filter((s: any) => arr(s.vendors).some(v => /stephens pipe/i.test(String(v?.name ?? ''))))
  const pick = accountArg ? states.find((s: any) => s.accountId === accountArg) : withSps.length === 1 ? withSps[0] : null
  if (!pick) throw new Error(accountArg ? `No vendors for account ${accountArg}` : `Expected one company with Stephens Pipe & Steel in Vendors, found ${withSps.length}. Pass --account <id>.`)
  const accountId = pick.accountId
  const v = arr(pick.vendors).map((x: any) => ({ id: String(x.id), name: String(x.name), aliases: arr(x.invoiceNames).map(String) }))
  const vendor = findVendor('Stephens Pipe & Steel, LLC', v)
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
  const owner = await tx.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin', status: 'active' }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: { createdAt: 'asc' } })
  const invoices = vendor ? await tx.vendorInvoice.findMany({
    where: { accountId, vendorId: vendor.id, status: { notIn: ['refused', 'failed', 'replaced'] } },
    select: { id: true, invoiceNumber: true, invoiceKey: true, status: true, ordered: true, docType: true, invoiceDate: true, lines: { select: { id: true, seq: true, description: true, state: true, ignored: true, landedCents: true, inventoryItemId: true, inventoryName: true, unitLandedCents: true }, orderBy: { seq: 'asc' as const } } },
    orderBy: { createdAt: 'asc' },
  }) : []
  return {
    accountId, vendor, config: b?.config ?? null, items: arr(inv?.items), kits: arr(inv?.kits), invoices,
    owner: owner ? { id: owner.id, name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || owner.email } : null,
  }
}

/** The app's own document and line for a printed green line, when that document is in the app as an order. */
function appLineFor(st: State, p: PrintedGreen) {
  const inv = st.invoices.find(i => i.invoiceKey === invoiceNumberKey(p.doc) && (i.docType !== 'quote' || i.ordered) && ['needs_match', 'applied'].includes(i.status))
  if (!inv) return null
  const line = inv.lines.find((l: any) => !l.ignored && norm(l.description) === norm(p.description) && l.seq === p.seq - 1) ?? inv.lines.find((l: any) => !l.ignored && norm(l.description) === norm(p.description))
  return line ? { inv, line } : null
}

// ── The test yard ───────────────────────────────────────────────────────────

const YARD = {
  shape: 'straight', closed: false,
  sides: [{ id: 'test-1', name: 'Test side', on: true, lengthIn: 100 * 12, startFinish: 'free', endFinish: 'free', gate: { type: 'walk', widthIn: 48, position: 'middle' } }],
}

function yardPrice(m: any, data: any, styleName: string, hasSalesman: boolean) {
  const y = m.deriveYardRuns(data.config, YARD, styleName)
  if (!y) throw new Error(`No yard for ${styleName}`)
  return m.estimate(data, { fenceStyle: styleName, runs: y.runs, corners: y.corners, ends: y.ends, walkGates: y.walkGates, dblGates: y.dblGates, gateWidths: y.gateWidths, hasSalesman }, { preview: true })
}

function printYards(m: any, title: string, config: any, items: any[], kits: any[]) {
  const data = { config, inventory: items, kits }
  const opt = greenOption(m.fenceCatalogOf(config))
  if (!opt) { say('   no Green chain link on this database'); return }
  const styles = arr(config?.fenceStyles).filter((s: any) => s?.material === 'chain' && s?.choices?.finish === opt.key && s?.madeFrom)
  const labels = m.styleLabels(config, { inventory: items, kits })
  say(`\n   ${title}`)
  for (const g of styles) {
    const b = g.madeFrom
    const eb = yardPrice(m, data, b, false), eg = yardPrice(m, data, g.name, false)
    const sb = yardPrice(m, data, b, true), sg = yardPrice(m, data, g.name, true)
    const borrowedOn = (e: any) => arr(e.pullSheet).filter((l: any) => Number(l.qty) > 0).map((l: any) => ({ l, it: items.find(i => norm(i?.name) === norm(l.item)) })).filter(x => x.it && m.borrowedPrice(x.it))
    const fb = borrowedOn(eg)
    say(`   ${labels[g.name] ?? g.name}  vs  ${labels[b] ?? b}`)
    say(`     green: materials ${usd(eg.materialCost)}, price ${usd(eg.price)} (${usd(eg.pricePerFoot)}/ft); quoted by a Salesman ${usd(sg.price)} (${usd(sg.pricePerFoot)}/ft)`)
    say(`     black: materials ${usd(eb.materialCost)}, price ${usd(eb.price)} (${usd(eb.pricePerFoot)}/ft); quoted by a Salesman ${usd(sb.price)} (${usd(sb.pricePerFoot)}/ft)`)
    say(`     green − black: ${usd(eg.price - eb.price)} (${pct(eb.price, eg.price)})`)
    say(`     green parts still priced from Black on this yard: ${fb.length ? fb.map(x => `${Math.round(x.l.qty * 1000) / 1000} × ${String(x.l.item).trim()} at ${usd(x.l.unitCost)}`).join('; ') + ' (the quote shows "Price may be low")' : 'none (no warning on the quote)'}`)
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

function report(files: Array<{ file: string; doc: Doc }>, docs: Doc[], st: State, m: any): GreenPricePlan {
  const estBp = estTaxBpOf(st.config)
  tech.push(`database "${dbName}", company ${st.accountId}, vendor ${st.vendor ? `"${st.vendor.name}" (${st.vendor.id})` : 'NOT IN VENDORS'}`)
  say(`Estimated tax ${pctText(estBp)} (added when a document prints no tax). Fuel is never in an item price. Freight is spread over the lines of its order.\n`)

  say(`1. FILES (${files.length} files, ${docs.length} different documents, ${new Set(docs.map(d => d.number)).size} quote numbers)`)
  for (const d of docs) {
    const L = docLanded(d, estBp)
    say(`   ${d.number} of ${d.date}: ${d.lines.length} lines, items ${money(d.subtotalCents)}, freight ${money(d.freightCents || null)}, tax ${d.taxFound ? dollars(d.taxCents) : 'none printed'}, fuel ${L.fuelCents ? dollars(L.fuelCents) : 'none'}, total ${money(d.totalCents)}${L.ok ? '' : `  DOES NOT ADD UP: ${L.problems.join('; ')}`}`)
    say(`      ${d.files.length > 1 ? `the same document in ${d.files.length} files: ` : 'file: '}${d.files.join(' | ')}`)
  }

  const plan = planGreenRealPrices(docs, st.items, estBp, (i: any) => m.borrowedPrice(i))
  say(`\n2. EVERY GREEN LINE PRINTED (${plan.printed.length}), newest document first`)
  const order = [...plan.printed].sort((a, b) => b.date.localeCompare(a.date) || b.doc.localeCompare(a.doc) || a.seq - b.seq)
  for (const p of order) {
    say(`   ${p.doc} ${p.date} | ${p.description} | ${p.qty} ${p.unit} | ${dollars(p.lineCents)} → landed ${dollars(p.landedCents)}`)
    if (p.part && p.landedEachCents == null) say(`      → ${p.part}: NOT USED: ${p.none}`)
    else if (p.part) say(`      → ${p.part}: printed ${money(p.printedEachCents)} each, landed ${money(p.landedEachCents)} each (${p.rule!.unitWords}; ${p.how}; ${p.rule!.rule}${p.rule!.note ? `; NOTE ${p.rule!.note}` : ''})`)
    else say(`      → no part: ${p.none}`)
  }

  say(`\n3. PARTS PRICED FROM BLACK THAT A DOCUMENT PRICES: BEFORE → AFTER (the newest document that prices the part)`)
  if (!plan.set.length) say('   none')
  for (const s of plan.set) {
    const app = appLineFor(st, s.source)
    say(`   ${s.part}`)
    say(`      ${money(s.beforeCents)} (from ${s.black}) → ${money(s.afterCents)} (${pct(s.beforeCents, s.afterCents)})`)
    say(`      from ${s.source.doc} of ${dayWords(s.source.date)}: "${s.source.description}", printed ${money(s.printedCents)} each, landed ${money(s.afterCents)} (${s.source.how})${s.source.rule?.note ? `; NOTE ${s.source.rule.note}` : ''}`)
    if (s.older.length) say(`      older prices not used: ${s.older.map(o => `${o.doc} ${o.date} ${money(o.landedEachCents)}`).join('; ')}`)
    say(`      put in: ${app ? `${s.source.doc} is in the app (ordered); its line "${s.source.description}" is now ${app.line.state === 'needs_match' ? 'waiting in Needs a match' : `"${app.line.state}"`}: priced on that document only, as the green part (not remembered for later documents)` : `${s.source.doc} is not in the app: its landed price goes into Inventory as a vendor document puts it, dated ${s.source.date}, with price history (the document is not uploaded)`}`)
    if (app && app.line.landedCents != null) {
      const q = s.source.qty
      const appEach = q > 0 ? Math.floor(app.line.landedCents / q + 0.5 + 1e-9) : null
      if (appEach !== s.afterCents) say(`      DIFFERS: the app's own line works out ${money(appEach)} each`)
    }
    tech.push(`${s.part} = item ${s.itemId}${app ? `; ${s.source.doc} line ${app.line.id}` : ''}`)
  }

  say(`\n4. STILL PRICED FROM BLACK (no green price printed on any document; they keep following the black part and the quote keeps warning)`)
  if (!plan.stillFromBlack.length) say('   none')
  for (const s of plan.stillFromBlack) {
    say(`   ${s.part}: ${money(s.cents)}, follows ${s.black}`)
    for (const p of s.seen) say(`      not this part: ${p.doc} ${p.date} "${p.description}" ${money(p.lineCents)} — ${p.none}`)
  }

  say(`\n5. GREEN PARTS WITH A PRICE OF THEIR OWN (never changed by this; the newest printed price next to it)`)
  for (const k of plan.kept) say(`   ${pad(k.part, 66)} ${lpad(money(k.cents), 9)} ${k.date ? `(${k.date})` : '(no date)'} · newest printed: ${k.newest ? `${k.newest.doc} ${k.newest.date} ${money(k.newest.landedEachCents)}` : 'none'}`)

  // 6. The yard, now and after.
  const after = st.items.map(i => {
    const s = plan.set.find(x => x.itemId === String(i.id))
    return s ? { ...i, unitCost: s.afterCents / 100, priceUpdatedAt: s.source.date, priceImported: false } : i
  })
  say(`\n6. 100 FT STRAIGHT YARD, ONE 4 FT WALK GATE (the app's own estimate; same labor and profit as Black)`)
  printYards(m, 'NOW', st.config, st.items, st.kits)
  printYards(m, 'AFTER THE APPLY', st.config, after, st.kits)
  return plan
}

// ── Apply ───────────────────────────────────────────────────────────────────

async function apply(st: State, plan: GreenPricePlan, m: any) {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const lib = await import('../src/server/lib/vendorInvoices.js')
  if (!st.owner) throw new Error('No owner login for this company')
  if (!st.vendor) throw new Error('Stephens Pipe & Steel is not in Vendors')
  const actor = st.owner
  const accountId = st.accountId
  say(`\nAPPLY as ${actor.name}`)
  const files: any[] = []
  const done: Array<{ part: string; how: string }> = []
  for (const s of plan.set) {
    const app = appLineFor(st, s.source)
    if (app) {
      if (app.line.state !== 'needs_match') { say(`  ${s.part}: ${s.source.doc} "${s.source.description}" is "${app.line.state}"${app.line.inventoryName ? ` (${app.line.inventoryName})` : ''}: left as it is`); continue }
      const r = await lib.applyLineOnce(accountId, app.line.id, { inventoryItemId: s.itemId, why: s.source.rule!.rule }, actor)
      say(`  ${s.part}: ${s.source.doc} "${s.source.description}" → ${r.changed ? `${money(r.prevCents)} → ${money(r.cents)}` : r.note} (document now ${r.invoiceStatus})`)
      done.push({ part: s.part, how: `${s.source.doc} line` })
    } else {
      files.push({ inventoryItemId: s.itemId, vendorId: st.vendor.id, vendorName: st.vendor.name, docNumber: s.source.doc, day: s.source.date, unitCents: s.afterCents, unitExact: s.afterExact, printedCents: s.printedCents, part: s.part })
    }
  }
  if (files.length) {
    const r = await lib.applyFilePrices(accountId, files.map(({ part: _p, ...f }) => f), actor)
    r.forEach((x, k) => { say(`  ${x.item}: ${files[k].docNumber} (file) → ${x.changed ? `${money(x.prevCents)} → ${money(x.cents)}` : x.note}`); done.push({ part: x.item, how: `${files[k].docNumber} file` }) })
  }
  if (!plan.set.length) say('  nothing to price')
  if (done.length) {
    const kv = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: GREEN_PRICES_KEY } } })
    const runs = arr((kv?.value as any)?.runs)
    const value = { runs: [...runs, { at: new Date().toISOString(), by: actor.name, set: plan.set.map(s => ({ part: s.part, from: s.beforeCents, to: s.afterCents, doc: s.source.doc, date: s.source.date })), stillFromBlack: plan.stillFromBlack.map(s => s.part) }] }
    await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: GREEN_PRICES_KEY } }, create: { accountId, key: GREEN_PRICES_KEY, value: value as any }, update: { value: value as any } })
  }

  // What changed, from the database, against the dry run.
  say('\nRESULT (from the database)')
  const after = await prisma.$transaction(async (tx: any) => loadState(tx, accountId))
  let mismatch = 0
  const byId = (items: any[], id: string) => items.find(i => String(i.id) === id)
  for (const s of plan.set) {
    const it = byId(after.items, s.itemId)
    const ok = cents(it) === s.afterCents && it?.priceUpdatedAt === s.source.date && !it?.priceImported && !m.borrowedPrice(it)
    say(`  ${s.part}: ${money(cents(it))}, dated ${it?.priceUpdatedAt ?? 'none'}${m.borrowedPrice(it) ? ', STILL FROM BLACK' : ', its own price (no longer follows Black)'}${ok ? '' : `  DIFFERS from the dry run (expected ${money(s.afterCents)} dated ${s.source.date})`}`)
    if (!ok) mismatch++
  }
  for (const s of plan.stillFromBlack) {
    const it = byId(after.items, s.itemId)
    const b = m.borrowedPrice(it)
    say(`  ${s.part}: ${money(cents(it))}, ${b ? `still from Black (follows ${b.part})` : 'NO LONGER FROM BLACK?'}`)
    if (!b) mismatch++
  }
  const allowed = new Set(plan.set.map(s => s.itemId))
  const changed = st.items.filter(i => !allowed.has(String(i.id)) && cents(byId(after.items, String(i.id))) !== cents(i))
  if (changed.length) { mismatch += changed.length; for (const i of changed) say(`  PRICE CHANGED THAT SHOULD NOT: ${i.name} ${money(cents(i))} → ${money(cents(byId(after.items, String(i.id))))}`) }
  else say('  no other Inventory price changed')
  for (const inv of after.invoices.filter((i: any) => plan.set.some(s => invoiceNumberKey(s.source.doc) === i.invoiceKey))) {
    const waiting = inv.lines.filter((l: any) => l.state === 'needs_match' && !l.ignored)
    say(`  ${inv.invoiceNumber}: ${inv.status}; ${waiting.length ? `still in Needs a match: ${waiting.map((l: any) => l.description).join('; ')}` : 'nothing left in Needs a match'}`)
  }
  printYards(m, 'THE YARD AGAIN, FROM THE DATABASE', after.config, after.items, after.kits)
  say(mismatch ? `\n${mismatch} difference(s) from the dry run: check above.` : '\nEverything matches the dry run.')
  if (mismatch) process.exitCode = 1
}

async function main() {
  const { files, docs } = await readDocs()
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const m: any = await pricingModule()
  const { st, plan } = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only') as Array<{ transaction_read_only: string }>
    if (ro[0]?.transaction_read_only !== 'on') throw new Error('Could not make the transaction read only: stopped.')
    tech.push(`database "${dbName}": this run's read was one read only transaction (SHOW transaction_read_only = on)`)
    const st = await loadState(tx, args.includes('--account') ? args[args.indexOf('--account') + 1] : undefined)
    say(`${APPLY ? 'APPLY' : 'DRY RUN (read only, nothing is changed)'}: real green chain link prices from ${docs.length} Stephens documents (${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}, database ${dbName})\n`)
    const plan = report(files, docs, st, m)
    return { st, plan }
  }, { timeout: 120_000 })
  if (APPLY) await apply(st, plan, m)
  else {
    say('\nNothing was changed.')
    say('To do it on the dev copy: pnpm exec tsx scripts/green-prices-2026-10-28.ts "<folder with the PDFs>" --apply')
    say("On live, only after the deploy (update.sh), a backup from the last 30 minutes and Jonathan's typed OK, from ~/ezbiz/apps/portal:")
    say('   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/green-prices-2026-10-28.ts "<folder with the PDFs>" --apply --live')
  }
  if (tech.length) {
    say('\nTECHNICAL (for whoever runs this; not needed to read the rest):')
    for (const t of [...new Set(tech)]) say(`   ${t}`)
  }
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.stack ?? err?.message ?? err); process.exit(1) })
