/**
 * Stephens Pipe & Steel quotations 06-251706 and 06-251707 (Oct 26 2026),
 * shown before anything changes, then done through the app's own code.
 *
 *   pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder with the PDFs>          dry run (default): reads only
 *   pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder> --apply                does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder> --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh), a backup from the last 30 minutes and
 *                                                    Jonathan's typed OK
 *
 * Jonathan's words:
 *   a. 06-251706: GALV 2-1/2" x 8' x .116HD, 222 pieces in 6 bundles at $14.98,
 *      is the no dig vinyl post pipe (Inventory "Pipe, PT40, Galv, 2-1/2" x 8'").
 *      Update its price for every vinyl no dig kit; show the before/after and
 *      which saved quotes would change.
 *   b. 06-251707: green vinyl coated chain link, 4 ft. It replaces 06-251608
 *      (marked replaced). Its prices as quoted (PP20 posts) make Green Chain
 *      Link, 4 ft, Residential: the black chain link setup and kits with the
 *      green parts swapped in, switched off for quoting until he has seen the
 *      pull sheet and price of a 100 ft test yard with one walk gate next to
 *      black 4 ft.
 * His standing rules for vendor documents: a quotation marked "We ordered
 * this" updates prices; a fuel charge is never in an item's price (bill
 * only); freight is spread over the lines of a real order; no tax line → 7.22%
 * estimated tax, said so.
 *
 * The dry run opens one READ ONLY transaction (any write would fail) and reads
 * every PDF in the folder with the app's own reader. It prints:
 *   1. each file: what was read, and whether the app takes it or refuses it;
 *   2. 06-251706: the line → the Inventory item → its price now and after
 *      (landed: estimated tax, no fuel), which fences' kits use that item and
 *      how many, and every saved quote that uses it: its saved price, and its
 *      price at today's prices with the pipe now and after (a sold quote keeps
 *      its saved price either way);
 *   3. 06-251608: what "replaced by 06-251707" does (its order undone: prices
 *      back, its bill voided; its lines leave Needs a match);
 *   4. 06-251707: each line → the green part (lib/greenChainLink) and its unit
 *      → landed each (freight spread, estimated tax, fuel on the bill only);
 *   5. Green Chain Link: the fences, kits and Inventory items it makes
 *      (switched off), the parts with no green line, and the price of each part;
 *   6. a 100 ft straight test yard with one 4 ft walk gate: Green against Black
 *      4 ft (No dig, and Dig set), the full pull sheet, cost and price, from
 *      the app's own estimate (web/src/estimate.ts).
 *
 * --apply does what Jonathan would do in the app, through the same code:
 * uploads each document the database does not have yet (lib/vendorInvoices),
 * marks 06-251608 replaced by 06-251707 (replaceQuoteWith: Undo the order,
 * then replaced), adds Green as Settings → Fence styles → Add color does
 * (planAddColor, through lib/greenChainLink) and switches it off, matches the
 * lines (Needs a match, with the unit), and taps "We ordered this" on both, as
 * the company's owner. Then it prints what changed and checks it against the
 * dry run. Run again, it changes nothing (each step checks first).
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { readInvoiceFile } from '../src/server/lib/invoiceReader.js'
import { parseInvoice, findVendor, type ParsedInvoice } from '../src/server/lib/invoiceParse.js'
import { checkTotals, landedParts, spreadExtras, unitLanded, changePct, needsOk, matchKey, findLink, invoiceNumberKey, dollars, pctText, toInventoryQty } from '../src/server/lib/invoiceMath.js'
import { contentKey, estTaxBpOf, newerPriceKept, revisionOf, DEFAULT_JUMP_PCT } from '../src/server/lib/vendorInvoices.js'
import { GREEN_KEY, greenLineFor, planGreenChainLink, type GreenPlan } from '../src/server/lib/greenChainLink.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const folder = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--account')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

const PIPE_DOC = '06-251706'
const GREEN_DOC = '06-251707'
const OLD_GREEN_DOC = '06-251608'
const PIPE_LINE = `GALV 2-1/2" x 8' x .116HD`
const PIPE_ITEM = `Pipe, PT40, Galv, 2-1/2" x 8'`

if (!folder || !fs.existsSync(folder)) { console.error('Usage: pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder with the Stephens PDFs> [--apply [--live]]'); process.exit(1) }
if (APPLY) {
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('stephens-quotes-2026-10-26b.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = console.log
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const cents = (item: any): number | null => { const n = Number(item?.unitCost); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
const money = (c: number | null | undefined) => (c == null ? 'no price' : dollars(c))
const usd = (d: number) => dollars(Math.round(d * 100))
const pct = (p: number | null) => (p == null ? 'new price' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`)
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

interface Doc { file: string; sha: string; parsed: ParsedInvoice; revision: string; key: string; content: string }

const INV_SELECT = {
  id: true, status: true, docType: true, ordered: true, vendorId: true, vendorName: true, invoiceNumber: true, invoiceKey: true, invoiceDate: true,
  totalCents: true, taxFound: true, taxOk: true, revision: true, createdAt: true, billId: true, replacedById: true, message: true,
  lines: { select: { id: true, seq: true, description: true, itemNumber: true, qty: true, unit: true, unitPriceHc: true, totalCents: true, ignored: true, state: true, stateNote: true, inventoryItemId: true, inventoryName: true, matchKey: true }, orderBy: { seq: 'asc' as const } },
  files: { select: { sha256: true, fileName: true } },
}

async function readDocs(): Promise<Doc[]> {
  const out: Doc[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sps-quotes-'))
  try {
    for (const name of fs.readdirSync(folder!).filter(f => f.toLowerCase().endsWith('.pdf')).sort()) {
      const file = path.join(folder!, name)
      const r = await readInvoiceFile(file, path.join(tmp, String(out.length)))
      const parsed = parseInvoice(r.pages)
      const lines = parsed.lines.map(l => ({ description: l.description, qty: l.qty, unitPriceHc: l.unitPriceHc, totalCents: l.totalCents }))
      out.push({ file: name, sha: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), parsed, revision: revisionOf(name), key: invoiceNumberKey(parsed.invoiceNumber), content: contentKey(parsed, lines) })
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  return out
}

interface State {
  accountId: string
  owner: { id: string; name: string } | null
  vendor: { id: string; name: string } | null
  config: any
  items: any[]
  kits: any[]
  invoices: any[]
  links: any[]
  limit: number
  quotes: any[]
}

async function loadState(tx: any, accountArg?: string): Promise<State> {
  const states = await tx.vendorState.findMany({ select: { accountId: true, vendors: true } })
  const withSps = states.filter((s: any) => arr(s.vendors).some(v => /stephens pipe/i.test(String(v?.name ?? ''))))
  const pickState = accountArg ? states.find((s: any) => s.accountId === accountArg) : withSps.length === 1 ? withSps[0] : null
  if (!pickState) throw new Error(accountArg ? `No vendors for account ${accountArg}` : `Expected one company with Stephens Pipe & Steel in Vendors, found ${withSps.length}. Pass --account <id>.`)
  const accountId = pickState.accountId
  const v = arr(pickState.vendors).map((x: any) => ({ id: String(x.id), name: String(x.name), aliases: arr(x.invoiceNames).map(String) }))
  const vendor = findVendor('Stephens Pipe & Steel, LLC', v)
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
  const owner = await tx.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin', status: 'active' }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: { createdAt: 'asc' } })
  const invoices = vendor ? await tx.vendorInvoice.findMany({ where: { accountId, OR: [{ vendorId: vendor.id }, { vendorName: { contains: 'Stephens' } }] }, select: INV_SELECT, orderBy: { createdAt: 'asc' } }) : []
  const links = vendor ? await tx.vendorItemLink.findMany({ where: { accountId, vendorId: vendor.id }, select: { key: true, inventoryItemId: true, vendorPer: true, invPer: true } }) : []
  const jump = Number((b?.config as any)?.pricing?.invoiceJumpPct)
  // Saved quotes whose pull sheet or proposal carries the no dig pipe (Deleted Records left out).
  const ids: Array<{ id: string }> = await tx.$queryRawUnsafe(`SELECT id FROM "SavedQuote" WHERE "accountId" = $1 AND "deletedAt" IS NULL AND ("pullSheet"::text ILIKE '%PT40%' OR proposal::text ILIKE '%PT40%')`, accountId)
  const quotes = ids.length ? await tx.savedQuote.findMany({ where: { id: { in: ids.map(r => r.id) } }, orderBy: [{ status: 'asc' }, { date: 'desc' }] }) : []
  return {
    accountId, vendor, config: b?.config ?? null, items: arr(inv?.items), kits: arr(inv?.kits), invoices, links, quotes,
    owner: owner ? { id: owner.id, name: `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || owner.email } : null,
    limit: Number.isFinite(jump) && jump > 0 && jump <= 500 ? jump : DEFAULT_JUMP_PCT,
  }
}

// ── 1. Files and duplicates ─────────────────────────────────────────────────

interface Verdict { doc: Doc; takes: boolean; why: string; existing: any | null }

function verdicts(docs: Doc[], st: State): Verdict[] {
  const seen: Doc[] = []
  const live = st.invoices.filter(i => !['refused', 'failed', 'receiving', 'reading'].includes(i.status))
  return docs.map(doc => {
    const sameFile = live.find(i => i.files.some((f: any) => f.sha256 === doc.sha))
    const sameDoc = live.find(i => i.invoiceKey === doc.key && contentKey(i, i.lines) === doc.content)
    const earlier = seen.find(d => d.key === doc.key && d.content === doc.content)
    seen.push(doc)
    if (sameFile) return { doc, takes: false, existing: sameFile, why: `already in the app: this exact file (${sameFile.docType} ${sameFile.invoiceNumber}, uploaded ${sameFile.createdAt.toISOString().slice(0, 10)}, now "${sameFile.status}"); uploading it again would be refused` }
    if (sameDoc) return { doc, takes: false, existing: sameDoc, why: `already in the app: the same ${sameDoc.docType} ${sameDoc.invoiceNumber} (same date, lines and total), "${sameDoc.status}"; uploading it again would be refused` }
    if (earlier) return { doc, takes: false, existing: null, why: `refused as a duplicate of ${earlier.file} (same date, lines and total)` }
    return { doc, takes: true, existing: null, why: 'new: the app takes it in as a vendor quote' }
  })
}

// ── Landed prices: what "We ordered this" does ──────────────────────────────

interface Target { id: string; name: string; vendorPer: number; invPer: number; unitWords: string; via: string; item: any }
interface LinePlan { seq: number; description: string; qty: number; unit: string; lineCents: number; extraCents: number; estTaxCents: number; landedCents: number; target: Target | null; why: string }
interface ItemPlan { itemId: string; name: string; prev: number | null; printed: number; next: number; pct: number | null; outcome: string; changes: boolean; waits: boolean }
interface DocPlan { lines: LinePlan[]; items: ItemPlan[]; estBp: number | null; estTaxCents: number; fuelCents: number; spreadCents: number }

function planDoc(doc: Doc, st: State, items: any[], targetFor: (desc: string) => Target | null): DocPlan {
  const p = doc.parsed
  const fees = p.fees.map(f => ({ label: f.label, cents: f.cents }))
  const estBp = !p.taxFound ? estTaxBpOf(st.config) : null
  const check = checkTotals(p.lines, { ...p, feesCents: fees.reduce((s, f) => s + f.cents, 0) })
  if (!check.ok) throw new Error(`${doc.file} does not add up: ${JSON.stringify(check.problems)}`)
  const parts = landedParts({ linesCents: check.linesCents, taxCents: p.taxCents, freightCents: p.freightCents, fees, taxFound: p.taxFound, taxOk: false, estTaxBp: estBp ?? 0 })
  const lineCents = p.lines.map(l => l.totalCents ?? 0)
  const spread = spreadExtras(lineCents, parts.spreadCents)
  const est = spreadExtras(lineCents, parts.estTaxCents)
  const lines: LinePlan[] = p.lines.map((l, k) => {
    const target = targetFor(l.description)
    const extra = spread[k] + est[k]
    return { seq: k + 1, description: l.description, qty: l.qty ?? 0, unit: l.unit, lineCents: l.totalCents ?? 0, extraCents: extra, estTaxCents: est[k], landedCents: (l.totalCents ?? 0) + extra, target, why: target ? target.via : 'no rule for it: it waits in Needs a match' }
  })
  const byId = new Map(items.map(i => [String(i.id), i]))
  const groups = new Map<string, LinePlan[]>()
  for (const l of lines) if (l.target) groups.set(l.target.id, [...(groups.get(l.target.id) ?? []), l])
  const out: ItemPlan[] = []
  for (const [id, ls] of groups) {
    const item = byId.get(id) ?? ls[0].target!.item
    const qty = ls.reduce((s, l) => s + toInventoryQty(l.qty, l.target!), 0)
    const next = unitLanded(ls.reduce((s, l) => s + l.landedCents, 0), 0, qty).cents
    const printed = unitLanded(ls.reduce((s, l) => s + l.lineCents, 0), 0, qty).cents
    const prev = cents(item)
    const change = changePct(prev, next)
    let outcome: string, changes = false, waits = false
    if (newerPriceKept(item ?? {}, p.invoiceDate, printed)) outcome = `kept in price history only: Inventory has a newer price (${item.priceUpdatedAt})`
    else if (needsOk(prev, next, st.limit)) { outcome = `WAITS FOR JONATHAN'S OK in Inventory > Invoices (more than ${st.limit}%)`; waits = true }
    else { outcome = prev === next ? 'same price, date confirmed' : 'applied'; changes = prev !== next }
    out.push({ itemId: id, name: String(item?.name ?? ls[0].target!.name), prev, printed, next, pct: change, outcome, changes, waits })
  }
  return { lines, items: out, estBp, estTaxCents: parts.estTaxCents, fuelCents: parts.fuelCents, spreadCents: parts.spreadCents }
}

function printDocPlan(doc: Doc, pl: DocPlan) {
  const p = doc.parsed
  say(`   Items ${dollars(p.subtotalCents ?? 0)} · spread over the lines: ${dollars(pl.spreadCents)} (freight ${dollars(p.freightCents)}${p.taxFound ? `, tax ${dollars(p.taxCents)}` : ''}) · estimated tax ${pl.estBp != null ? `${pctText(pl.estBp)} = ${dollars(pl.estTaxCents)}` : 'none (tax printed)'} · fuel ${dollars(pl.fuelCents)} on the vendor bill only`)
  say('   line | vendor item | qty | amount | + freight/tax share (of it estimated tax) | landed | → Inventory item (unit)')
  for (const l of pl.lines) say(`   ${lpad(String(l.seq), 2)} | ${l.description} | ${l.qty} ${l.unit} | ${dollars(l.lineCents)} | +${dollars(l.extraCents)} (${dollars(l.estTaxCents)}) | ${dollars(l.landedCents)} | → ${l.target ? `${l.target.name} (${l.target.unitWords}; ${l.target.via})` : l.why}`)
  say('   BEFORE → AFTER (per Inventory item, landed each):')
  for (const it of pl.items) say(`     ${it.name}: ${money(it.prev)} → ${money(it.next)} (${pct(it.pct)}; printed ${dollars(it.printed)} each + estimated tax${doc.parsed.freightCents ? ' + freight' : ''}) — ${it.outcome}`)
  const waiting = pl.lines.filter(l => !l.target)
  if (waiting.length) say(`   STILL IN NEEDS A MATCH (${waiting.length}): ${waiting.map(l => l.description).join('; ')}`)
}

// ── 2. The no dig pipe: kits and saved quotes ───────────────────────────────

async function pipeUse(m: any, st: State, pipeName: string) {
  const out: Array<{ style: string; label: string; active: boolean; per: string[] }> = []
  const cfg = m.estimateConfig(st.config)
  for (const s of cfg.fenceStyles) {
    const set = m.kitSetFor(s.name, st.kits)
    if (!set || set === 'archived') continue
    const per: string[] = []
    for (const [kind, parts] of Object.entries(set.kits ?? {})) for (const p of arr(parts)) if (norm(p.part) === norm(pipeName) && p.qty > 0) per.push(`${p.qty} per ${kind === 'corner' ? 'corner post' : kind === 'end' ? 'end post' : kind === 'line' ? 'line post' : kind === 'blank' ? 'blank post (double gate)' : kind}`)
    if (per.length) out.push({ style: s.name, label: s.label || s.name, active: s.isActive !== false, per })
  }
  return out
}

async function repriceQuotes(m: any, st: State, pipeItemId: string, before: number | null, after: number) {
  const { requestFrom } = await import('../src/server/lib/quotePricing.js')
  const withPipe = (c: number | null) => ({ config: st.config, inventory: st.items.map(i => (String(i.id) === pipeItemId ? { ...i, unitCost: (c ?? 0) / 100 } : i)), kits: st.kits })
  const dataNow = withPipe(before), dataAfter = withPipe(after)
  const rows: Array<{ q: any; style: string; how: string; pipes: number; saved: number; now: number | null; after: number | null; costNow: number | null; costAfter: number | null; sold: boolean; note: string }> = []
  for (const q of st.quotes) {
    const sold = q.status === 'SOLD' || !!q.soldAt || !!q.acceptedAt
    const sheet = arr(q.pullSheet)
    const own = sheet.filter((l: any) => norm(String(l?.item ?? '')) === norm(PIPE_ITEM)).reduce((s: number, l: any) => s + (Number(l.qty) || 0), 0)
    const targets: Array<{ style: string; how: string; saved: number; pipes: number }> = []
    if (own > 0) targets.push({ style: q.fenceStyle, how: 'the quote', saved: Number(q.finalPrice) || 0, pipes: own })
    for (const o of arr(q.proposal?.options)) {
      if (!o?.fenceStyle || o.fenceStyle === q.fenceStyle) continue
      const snapSheet = arr(o?.snapshot?.pullSheet)
      const n = snapSheet.filter((l: any) => norm(String(l?.item ?? '')) === norm(PIPE_ITEM)).reduce((s: number, l: any) => s + (Number(l.qty) || 0), 0)
      if (n > 0 || JSON.stringify(o).includes('PT40')) targets.push({ style: o.fenceStyle, how: `proposal option "${o.label || o.tier?.key || o.fenceStyle}"`, saved: Number(o.finalPrice) || 0, pipes: n })
    }
    for (const t of targets) {
      let now: number | null = null, aft: number | null = null, cNow: number | null = null, cAft: number | null = null, note = ''
      const work = q.work && typeof q.work === 'object' && ['move', 'repair'].includes((q.work as any).type) ? q.work as any : null
      if (work && t.how !== 'the quote') note = 'a move or repair: option not repriced here'
      else {
        try {
          const body = {
            fenceStyle: t.style, runs: arr(q.runs).map((ft: number, i: number) => ({ ft, rail: arr(q.runRails)[i] ?? 'auto' })),
            corners: q.corners, ends: q.ends, walkGates: q.walkGates, dblGates: q.dblGates, extraLinePosts: q.layout?.teeLinePosts ?? 0,
            tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates, extraLaborHrs: q.adjLaborHrs, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust,
            overrides: q.pricing ?? {}, jobType: work ? work.type : 'new', move: work?.move ?? null, repair: work?.repair ?? null,
          }
          const { req, overheadPct } = requestFrom(body, q, m.importedOldPrice, m.keepsCents)
          const a = m.quoteJobFor(dataNow, req, overheadPct), b = m.quoteJobFor(dataAfter, req, overheadPct)
          now = a.totals.price; aft = b.totals.price; cNow = a.totals.materialCost; cAft = b.totals.materialCost
          if (!t.pipes) t.pipes = arr(a.pullSheet).filter((l: any) => norm(String(l?.item ?? '')) === norm(PIPE_ITEM)).reduce((s: number, l: any) => s + (Number(l.qty) || 0), 0)
        } catch (err: any) { note = `not repriced: ${String(err?.message ?? err).slice(0, 120)}` }
      }
      rows.push({ q, style: t.style, how: t.how, pipes: t.pipes, saved: t.saved, now, after: aft, costNow: cNow, costAfter: cAft, sold, note })
    }
  }
  return rows
}

// ── 6. The 100 ft test yard ─────────────────────────────────────────────────

const TEST_YARD = {
  shape: 'straight', closed: false,
  sides: [{ id: 'test-1', name: 'Test side', on: true, lengthIn: 100 * 12, startFinish: 'free', endFinish: 'free', gate: { type: 'walk', widthIn: 48, position: 'middle' } }],
}

function testYard(m: any, data: any, styleName: string) {
  const y = m.deriveYardRuns(data.config, TEST_YARD, styleName)
  if (!y) throw new Error(`No yard for ${styleName}`)
  const est = m.estimate(data, { fenceStyle: styleName, runs: y.runs, corners: y.corners, ends: y.ends, walkGates: y.walkGates, dblGates: y.dblGates }, { preview: true })
  return { y, est }
}

function printCompare(m: any, dataBlack: any, dataGreen: any, pairs: Array<[string, string]>, unpriced: Set<string>) {
  for (const [black, green] of pairs) {
    const b = testYard(m, dataBlack, black), g = testYard(m, dataGreen, green)
    say(`\n   ${b.est.style.label || black}  vs  ${g.est.style.label || green}`)
    say(`   yard: runs ${b.y.runs.join(' + ')} ft, ${b.y.corners} corner, ${b.y.ends} end posts, ${b.y.walkGates} walk gate; ${b.est.sections} sections`)
    say(`   ${pad('BLACK part', 62)} ${lpad('qty', 7)} ${lpad('each', 9)} ${lpad('total', 10)} | ${pad('GREEN part', 62)} ${lpad('qty', 7)} ${lpad('each', 9)} ${lpad('total', 10)}`)
    const bl = b.est.pullSheet, gl = g.est.pullSheet
    for (let i = 0; i < Math.max(bl.length, gl.length); i++) {
      const x = bl[i], z = gl[i]
      const cell = (l: any, mark = '') => (l ? `${pad(String(l.item) + mark, 62)} ${lpad(String(Math.round(l.qty * 1000) / 1000), 7)} ${lpad(usd(l.unitCost), 9)} ${lpad(usd(l.total), 10)}` : pad('', 62 + 29))
      say(`   ${cell(x)} | ${cell(z, z && unpriced.has(norm(z.item)) ? ' [NO PRICE]' : '')}`)
    }
    const row = (k: string, f: (e: any) => string) => say(`   ${pad(k, 22)} black ${lpad(f(b.est), 12)}   green ${lpad(f(g.est), 12)}`)
    row('Material', e => usd(e.materialCost))
    row('Labor', e => usd(e.laborCost))
    row('Cost (COGS)', e => usd(e.totalCOGS))
    row('Price', e => usd(e.price))
    row('Price per foot', e => usd(e.pricePerFoot))
    row('Gross margin', e => `${(e.gmPct * 100).toFixed(1)}%`)
    for (const n of g.est.notes) say(`   green note: ${n}`)
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

interface Plans { pipe: DocPlan | null; green: DocPlan | null; greenPlan: GreenPlan; vs: Verdict[] }

async function report(docs: Doc[], st: State, m: any): Promise<Plans> {
  say(`Database "${dbName}", company ${st.accountId}, vendor ${st.vendor ? `"${st.vendor.name}"` : 'NOT IN VENDORS'}, estimated tax ${pctText(estTaxBpOf(st.config))}, OK limit ${st.limit}%\n`)
  say('1. FILES AND DUPLICATES')
  const vs = verdicts(docs, st)
  for (const v of vs) {
    const p = v.doc.parsed
    say(`  ${v.doc.file}`)
    say(`     ${p.docType} ${p.invoiceNumber} of ${p.invoiceDate}, document ${v.doc.revision}: ${p.lines.length} line${p.lines.length === 1 ? '' : 's'}, items ${dollars(p.subtotalCents ?? 0)}, freight ${dollars(p.freightCents)}, ${p.fees.map(f => `${f.label} ${dollars(f.cents)}`).join(', ') || 'no fees'}, tax ${p.taxFound ? dollars(p.taxCents) : 'none printed'}, total ${dollars(p.totalCents ?? 0)}`)
    say(`     → ${v.why}`)
  }
  const docOf = (n: string) => docs.find(d => d.parsed.invoiceNumber === n) ?? null
  const inApp = (n: string) => st.invoices.find(i => i.invoiceKey === invoiceNumberKey(n) && !['refused', 'failed', 'replaced'].includes(i.status)) ?? null

  // 2. 06-251706
  const pipeItem = st.items.find(i => norm(String(i?.name ?? '')) === norm(PIPE_ITEM)) ?? null
  const pdoc = docOf(PIPE_DOC)
  let pipe: DocPlan | null = null
  say(`\n2. ${PIPE_DOC}: THE NO DIG VINYL POST PIPE`)
  if (!pdoc) say(`   no PDF of ${PIPE_DOC} in ${folder}`)
  else if (!pipeItem) say(`   Inventory has no "${PIPE_ITEM}": nothing to price. Stopped here for this quote.`)
  else {
    const l = pdoc.parsed.lines[0]
    const ex = inApp(PIPE_DOC)
    say(`   ${ex ? `in the app as ${ex.id} ("${ex.status}"${ex.ordered ? ', ordered' : ''})` : 'not in the app yet: uploaded first'}; marked "We ordered this"`)
    say(`   Printed: ${l.qty} ${l.unit} "${l.description}"${(l as any).packing ? `, packed ${(l as any).packing}` : ''}, $${(l.unitPriceHc! / 10000).toFixed(4)} each, ${dollars(l.totalCents ?? 0)}: ${l.qty} pieces = ${l.qty} each in Inventory (the bundles are how they ship, not the unit).`)
    pipe = planDoc(pdoc, st, st.items, desc => (norm(desc) === norm(PIPE_LINE) ? { id: String(pipeItem.id), name: String(pipeItem.name), vendorPer: 1, invPer: 1, unitWords: '1 piece = 1 each', via: 'Jonathan: the no dig vinyl post pipe', item: pipeItem } : null))
    printDocPlan(pdoc, pipe)
    const after = pipe.items.find(i => i.itemId === String(pipeItem.id))
    const use = await pipeUse(m, st, PIPE_ITEM)
    say(`\n   FENCES WHOSE KITS USE "${PIPE_ITEM}" (${use.length}; the kit takes the price from Inventory, so every one of them follows):`)
    for (const u of use) say(`     ${u.label} (${u.style})${u.active ? '' : ' [switched off]'}: ${u.per.join(', ')}`)
    if (after) {
      const rows = await repriceQuotes(m, st, String(pipeItem.id), after.prev, after.next)
      const open = rows.filter(r => !r.sold), sold = rows.filter(r => r.sold)
      say(`\n   SAVED QUOTES THAT USE IT (${new Set(rows.map(r => r.q.id)).size} quotes; Deleted Records left out). A saved quote keeps its saved price until it is saved again; "today" is the app's price for it at today's prices:`)
      const line = (r: typeof rows[number]) => {
        const name = `${r.q.customerName || '(no name)'}${r.q.date ? ` ${r.q.date}` : ''}`
        const d = r.now != null && r.after != null ? r.after - r.now : null
        return `     ${pad(r.q.status + (r.q.archivedAt ? ' (archived)' : '') + ((r.q.work as any)?.type ? ` ${(r.q.work as any).type}` : ''), 17)} ${pad(name, 34)} ${pad(r.how + ': ' + r.style, 52)} pipes ${lpad(String(r.pipes), 3)} | saved ${lpad(usd(r.saved), 11)} | today ${r.now == null ? lpad('-', 11) : lpad(usd(r.now), 11)} → ${r.after == null ? '-' : usd(r.after)}${d != null ? ` (${d >= 0 ? '+' : ''}${usd(d)}; material ${usd(r.costNow!)} → ${usd(r.costAfter!)})` : ''}${r.note ? ` ${r.note}` : ''}`
      }
      const count = (rs: typeof rows) => `${new Set(rs.map(r => r.q.id)).size} quote${new Set(rs.map(r => r.q.id)).size === 1 ? '' : 's'}`
      say(`   OPEN (Draft, Sent; ${count(open)}): would change only when saved again or re-sent`)
      for (const r of open) say(line(r))
      say(`   SOLD (${count(sold)}): keep their saved price; nothing changes`)
      for (const r of sold) say(line(r))
    }
  }

  // 3. 06-251608
  say(`\n3. ${OLD_GREEN_DOC} → REPLACED BY ${GREEN_DOC}`)
  const old = st.invoices.filter(i => i.invoiceKey === invoiceNumberKey(OLD_GREEN_DOC))
  if (!old.length) say(`   ${OLD_GREEN_DOC} is not in the app on this database: nothing to replace.`)
  for (const o of old) {
    if (o.status === 'replaced') { say(`   ${o.id}: already replaced (${o.message})`); continue }
    const waiting = o.lines.filter((l: any) => ['needs_match', 'waiting_ok'].includes(l.state)).length
    const applied = o.lines.filter((l: any) => l.state === 'applied')
    say(`   ${o.id}: "${o.status}"${o.ordered ? ', ordered' : ''}, bill ${o.billId ?? 'none'}; ${waiting} line${waiting === 1 ? '' : 's'} in Needs a match${applied.length ? `; ${applied.length} priced from it: ${applied.map((l: any) => `${l.description} → ${l.inventoryName}`).join('; ')}` : ''}`)
    say(`   → ${o.ordered && ['applied', 'needs_match'].includes(o.status) ? `Undo the order first (${applied.length ? 'its prices put back unless changed since' : 'no price to put back'}; its bill voided: off Accounts Payable, kept in Vendors), then` : ''} marked "Replaced" by ${GREEN_DOC}: its lines leave Needs a match; it cannot be ordered again.`)
  }

  // 4 and 5. 06-251707 and Green
  const greenPlan = planGreenChainLink(m, { fenceStyles: arr(st.config?.fenceStyles), fenceCatalog: m.fenceCatalogOf(st.config), items: st.items, kits: st.kits })
  const gdoc = docOf(GREEN_DOC)
  let green: DocPlan | null = null
  say(`\n4. ${GREEN_DOC} (green vinyl coated chain link) MARKED "WE ORDERED THIS"`)
  if (!gdoc) say(`   no PDF of ${GREEN_DOC} in ${folder}`)
  else {
    const ex = inApp(GREEN_DOC)
    say(`   ${ex ? `in the app as ${ex.id} ("${ex.status}"${ex.ordered ? ', ordered' : ''})` : 'not in the app yet: uploaded first'}`)
    const items = greenPlan.state.items
    green = planDoc(gdoc, st, items, desc => {
      const g = greenLineFor(desc)
      if (!g) return null
      const item = items.find(i => norm(String(i?.name ?? '')) === norm(g.part))
      if (!item) return null
      return { id: String(item.id), name: String(item.name), vendorPer: g.vendorPer, invPer: g.invPer, unitWords: g.unitWords, via: g.existing ? (g.note ?? 'existing item') : `${greenPlan.made ? 'new' : 'the'} Green part${g.note ? `; ${g.note}` : ''}`, item }
    })
    printDocPlan(gdoc, green)
  }

  say('\n5. GREEN CHAIN LINK, 4 FT, RESIDENTIAL (Settings → Fence styles → Chain link → Finish → Add color "Green", copying Black, 4 ft)')
  say(`   ${greenPlan.message}`)
  if (greenPlan.made) {
    for (const s of greenPlan.styles) say(`   fence ${s.name}: ${s.install === 'nd' ? 'No dig' : 'Dig set'}, copies "${s.madeFrom}" (its labor, profit and kit), SWITCHED OFF for quoting`)
    const price = new Map<string, number | null>()
    for (const it of green?.items ?? []) price.set(norm(it.name), it.next)
    for (const k of greenPlan.state.kits.filter((x: any) => greenPlan.kits.includes(x.name))) {
      say(`   kit ${k.name}:`)
      for (const [kind, parts] of Object.entries(k.kits ?? {})) {
        say(`     ${kind}: ${arr(parts).map((p: any) => { const pr = price.get(norm(p.part)); const inv = st.items.find(i => norm(String(i.name)) === norm(p.part)); const c = pr ?? cents(inv); return `${p.qty} × ${p.part} (${c == null ? 'NO PRICE' : dollars(c)})` }).join('; ')}`)
      }
    }
    say(`   parts renamed from the black swap to what ${GREEN_DOC} sells:`)
    for (const r of greenPlan.renamed) say(`     ${r.from} → ${r.to}`)
    say(`   NO GREEN EQUIVALENT on ${GREEN_DOC} (kept in the kits with no price, so Green stays "not fully priced" as well as switched off):`)
    for (const n of greenPlan.noGreen) say(`     - ${n.part} (${n.kits.join(', ')})`)
    const older = st.items.filter(i => i?.category === 'Chainlink Green')
    if (older.length) say(`   Older green items already in Inventory (Chainlink Green, from the price workbook, used by no fence or kit; left as they are): ${older.length}, e.g. ${older.slice(0, 4).map(i => `${i.name} ${money(cents(i))}`).join('; ')}`)
  }

  // 6. The test yard
  say('\n6. 100 FT STRAIGHT TEST YARD, ONE 4 FT WALK GATE: GREEN AGAINST BLACK 4 FT (the app\'s own estimate; Green priced as if switched on, preview only)')
  const after = (items: any[]) => {
    const next = new Map<string, number>()
    for (const pl of [pipe, green]) for (const it of pl?.items ?? []) if (it.changes) next.set(norm(it.name), it.next)
    return items.map(i => (next.has(norm(String(i.name))) ? { ...i, unitCost: next.get(norm(String(i.name)))! / 100 } : i))
  }
  const greenCfg = { ...(st.config ?? {}), fenceStyles: greenPlan.state.fenceStyles, fenceCatalog: greenPlan.state.fenceCatalog }
  const dataBlack = { config: greenCfg, inventory: after(greenPlan.state.items), kits: greenPlan.state.kits }
  const unpriced = new Set(greenPlan.noGreen.map(n => norm(n.part)))
  const nd = greenPlan.styles.find(s => s.install === 'nd'), ds = greenPlan.styles.find(s => s.install === 'ds')
  const pairs: Array<[string, string]> = []
  if (nd) pairs.push(["CL - 4' Black", nd.name])
  if (ds) pairs.push(['chain/4/black/res/ds', ds.name])
  if (!greenPlan.made) {
    const names = arr(st.config?.fenceStyles).filter((s: any) => s?.material === 'chain' && s?.choices?.finish === 'green' && s?.choices?.height === '4')
    for (const s of names) pairs.push([s.choices.install === 'ds' ? 'chain/4/black/res/ds' : "CL - 4' Black", s.name])
  }
  printCompare(m, dataBlack, dataBlack, pairs, unpriced)
  return { pipe, green, greenPlan, vs }
}

// ── Apply (what Jonathan would tap) ─────────────────────────────────────────

async function apply(docs: Doc[], st: State, plans: Plans, m: any) {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const lib = await import('../src/server/lib/vendorInvoices.js')
  const { lockAccountState } = await import('../src/server/lib/lockState.js')
  if (!st.owner) throw new Error('No owner login for this company')
  if (!st.vendor) throw new Error('Stephens Pipe & Steel is not in Vendors')
  const actor = st.owner
  const accountId = st.accountId
  say(`\nAPPLY as ${actor.name}`)
  const find = (n: string) => prisma.vendorInvoice.findFirst({ where: { accountId, vendorId: st.vendor!.id, invoiceKey: invoiceNumberKey(n), status: { notIn: ['refused', 'failed', 'replaced'] } }, include: { lines: { orderBy: { seq: 'asc' } } }, orderBy: { createdAt: 'asc' } })

  // Uploads.
  for (const n of [PIPE_DOC, GREEN_DOC]) {
    if (await find(n)) { say(`  ${n}: already in the app`); continue }
    const v = plans.vs.find(x => x.takes && x.doc.parsed.invoiceNumber === n)
    if (!v) throw new Error(`${n}: no file to upload`)
    const tmp = path.join(os.tmpdir(), `sps-${crypto.randomUUID()}.pdf`)
    fs.copyFileSync(path.join(folder!, v.doc.file), tmp)
    const r = await lib.receiveInvoiceFile({ accountId, actor, clientId: crypto.randomUUID(), batchId: crypto.randomUUID(), seq: 0, pageCount: 1, fileName: v.doc.file, mime: 'application/pdf', path: tmp, bytes: fs.statSync(tmp).size })
    await lib.readsSettled()
    if (!(await find(n))) throw new Error(`${n}: the upload was refused: ${(await prisma.vendorInvoice.findUnique({ where: { id: r.invoiceId } }))?.message}`)
    say(`  ${n}: uploaded ${v.doc.file} → ${r.invoiceId}`)
  }
  for (const n of [PIPE_DOC, GREEN_DOC]) { const i = await find(n); if (i?.status === 'needs_review') throw new Error(`${n} is in Needs review: fix it in the app first. Stopped.`) }

  // 06-251608 replaced by 06-251707.
  const neu = await find(GREEN_DOC)
  const olds = await prisma.vendorInvoice.findMany({ where: { accountId, vendorId: st.vendor.id, invoiceKey: invoiceNumberKey(OLD_GREEN_DOC), status: { notIn: ['refused', 'failed'] } } })
  for (const o of olds) {
    const r = await lib.replaceQuoteWith(accountId, o.id, neu!.id, actor)
    say(`  ${OLD_GREEN_DOC} (${o.id}): ${r.already ? 'already replaced' : r.message}`)
  }

  // Green chain link, as Add color makes it, switched off.
  const made = await prisma.$transaction(async (tx: any) => {
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    const cfg = (b?.config ?? {}) as Record<string, any>
    const plan = planGreenChainLink(m, { fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items: arr(inv?.items), kits: arr(inv?.kits) })
    if (!plan.made) return plan
    await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog } as any, version: { increment: 1 } } })
    await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    const value = { at: new Date().toISOString(), by: actor.name, styles: plan.styles, kits: plan.kits, items: plan.items, noGreen: plan.noGreen, renamed: plan.renamed, from: GREEN_DOC }
    await tx.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: GREEN_KEY } }, create: { accountId, key: GREEN_KEY, value: value as any }, update: { value: value as any } })
    return plan
  }, { timeout: 30_000 })
  say(`  ${made.message}`)

  // Matches (Needs a match, with the unit), then "We ordered this".
  const items = arr((await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true } }))?.items)
  const itemNamed = (name: string) => items.find(i => norm(String(i?.name ?? '')) === norm(name))
  const want = (desc: string, doc: string): { id: string; name: string; vendorPer: number; invPer: number } | null => {
    if (doc === PIPE_DOC) { const it = norm(desc) === norm(PIPE_LINE) ? itemNamed(PIPE_ITEM) : null; return it ? { id: it.id, name: it.name, vendorPer: 1, invPer: 1 } : null }
    const g = greenLineFor(desc); const it = g ? itemNamed(g.part) : null
    return g && it ? { id: it.id, name: it.name, vendorPer: g.vendorPer, invPer: g.invPer } : null
  }
  for (const n of [PIPE_DOC, GREEN_DOC]) {
    let inv = await find(n)
    if (!inv) throw new Error(`${n} is not in the app`)
    if (!inv.ordered) {
      const links = await prisma.vendorItemLink.findMany({ where: { accountId, vendorId: st.vendor.id } })
      for (const l of inv.lines) {
        const w = want(l.description, n)
        if (!w) { say(`  ${n}: "${l.description}" has no rule: left in Needs a match`); continue }
        const link = findLink(links, l.matchKey || matchKey(l.itemNumber, l.description))
        if (link && link.inventoryItemId === w.id && link.vendorPer === w.vendorPer && link.invPer === w.invPer && l.inventoryItemId === w.id) continue
        await lib.matchLine(accountId, l.id, { inventoryItemId: w.id, vendorPer: w.vendorPer, invPer: w.invPer }, actor, { mayCreateItem: false })
        say(`  ${n}: "${l.description}" matched to ${w.name} (${w.vendorPer} ${l.unit} = ${w.invPer})`)
      }
    }
    inv = await find(n)
    if (!inv!.ordered) { await lib.markOrdered(accountId, inv!.id, actor); say(`  ${n}: We ordered this`) }
    else say(`  ${n}: already ordered, nothing to do`)
  }

  // What changed, from the database, against the dry run.
  say('\nRESULT (from the database)')
  let mismatch = 0
  for (const [n, want] of [[PIPE_DOC, plans.pipe], [GREEN_DOC, plans.green]] as const) {
    const inv = await prisma.vendorInvoice.findFirst({ where: { accountId, vendorId: st.vendor.id, invoiceKey: invoiceNumberKey(n), ordered: true, status: { notIn: ['refused', 'failed', 'replaced'] } }, include: { lines: { orderBy: { seq: 'asc' } } } })
    if (!inv) { say(`  ${n}: not ordered?`); mismatch++; continue }
    say(`  ${n} (${inv.id}): ${inv.status}; estimated tax ${inv.estTaxBp != null ? `${pctText(inv.estTaxBp)} ${dollars(inv.estTaxCents)}` : 'none'}; bill ${inv.billId}`)
    for (const l of inv.lines) say(`     ${lpad(String(l.seq + 1), 2)} ${l.description}: ${l.state}${l.inventoryName ? ` → ${l.inventoryName}` : ''}${l.unitLandedCents != null ? ` ${money(l.prevUnitCents)} → ${money(l.unitLandedCents)}` : ''}`)
    for (const it of want?.items ?? []) {
      const got = inv.lines.find(l => norm(String(l.inventoryName ?? '')) === norm(it.name))
      if (!got || got.unitLandedCents !== it.next) { mismatch++; say(`     DIFFERS from the dry run: ${it.name} expected ${money(it.next)}, got ${money(got?.unitLandedCents)}`) }
      else if (it.waits && got.state !== 'waiting_ok') { mismatch++; say(`     DIFFERS from the dry run: ${it.name} was to wait for an OK, it is "${got.state}"`) }
    }
  }
  const o = await prisma.vendorInvoice.findFirst({ where: { accountId, invoiceKey: invoiceNumberKey(OLD_GREEN_DOC) }, include: { lines: true } })
  if (o) {
    const waiting = o.lines.filter(l => ['needs_match', 'waiting_ok'].includes(l.state)).length
    say(`  ${OLD_GREEN_DOC}: ${o.status}${o.replacedById ? ` (by ${o.replacedById})` : ''}; ${waiting} lines waiting; ${o.message}`)
    if (o.status !== 'replaced' || waiting) mismatch++
  }
  const vstate = await prisma.vendorState.findUnique({ where: { accountId }, select: { bills: true } })
  for (const b of arr(vstate?.bills).filter((x: any) => [PIPE_DOC, GREEN_DOC, OLD_GREEN_DOC].includes(x?.billNumber))) say(`  bill ${b.billNumber}: ${b.status}, total ${dollars(b.totalCents)}, freight ${dollars(b.freightCents ?? 0)}, fees ${dollars(b.feesCents ?? 0)} — ${b.notes}`)
  const after = await prisma.$transaction(async (tx: any) => loadState(tx, accountId))
  m.styleLabels(after.config, { inventory: after.items, kits: after.kits })
  const resolved = m.estimateConfig(after.config).fenceStyles.filter((s: any) => s?.choices?.finish === 'green')
  for (const s of resolved) {
    say(`  fence ${s.name} (${s.label}): ${s.held ? `not available for quoting: ${s.held}` : 'AVAILABLE FOR QUOTING'}`)
    if (!s.held) mismatch++
  }
  say('\n  The test yard again, from the database:')
  const data = { config: after.config, inventory: after.items, kits: after.kits }
  const unpriced = new Set(arr(after.items).filter((i: any) => String(i?.madeFor ?? '').startsWith('chain:finish:') && !(cents(i) ?? 0)).map((i: any) => norm(String(i.name))))
  printCompare(m, data, data, resolved.map((s: any) => [s.choices.install === 'ds' ? 'chain/4/black/res/ds' : "CL - 4' Black", s.name] as [string, string]), unpriced)
  say(mismatch ? `\n${mismatch} difference(s) from the dry run: check above.` : '\nEverything matches the dry run.')
  if (mismatch) process.exitCode = 1
}

async function main() {
  const docs = await readDocs()
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const m: any = await pricingModule()
  // Dry run (and the "before" of an apply): one read only transaction; a write would fail.
  const { st, out } = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only') as Array<{ transaction_read_only: string }>
    if (ro[0]?.transaction_read_only !== 'on') throw new Error('Could not make the transaction read only: stopped.')
    console.log(`(database "${dbName}": this transaction is read only)`)
    const st = await loadState(tx, args.includes('--account') ? args[args.indexOf('--account') + 1] : undefined)
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read only, nothing is changed)'}: Stephens quotes ${PIPE_DOC} and ${GREEN_DOC} (${OLD_GREEN_DOC} replaced)\n`)
    const out = await report(docs, st, m)
    return { st, out }
  }, { timeout: 120_000 })
  if (APPLY) await apply(docs, st, out, m)
  else console.log('\nNothing was changed. To apply: --apply (dev); live only after a backup and Jonathan\'s typed OK (see the top of this file).')
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.stack ?? err?.message ?? err); process.exit(1) })
