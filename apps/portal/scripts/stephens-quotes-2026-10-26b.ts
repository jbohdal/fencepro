/**
 * Stephens Pipe & Steel quotations 06-251706 and 06-251707 (Oct 26 2026),
 * shown before anything changes, then done through the app's own code.
 *
 *   pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder with the PDFs>          dry run (default): reads only
 *   pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder> --compare-out <file> [--source "<where the data came from>"]
 *                                                    dry run, and section 6 (the test yards) written to <file> too
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
 *   c. Oct 27: "Green Chain Link 4 ft as its own style: a copy of Black Chain
 *      Link 4 ft, same calculation, options, labor and margins, with the green
 *      parts and prices from Stephens 06-251707. Fuel charge never goes in
 *      item prices; 7.22% estimated tax if there's no tax line. If a green part
 *      isn't on the quote, use the black price and list it for me. Show a
 *      100 ft green vs black example in the report." He OK'd switching it on
 *      for quoting in the same apply.
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
 *      The three plain BOLT/NUT lines print no color (a green order): they are
 *      NOT matched (galvanized or green is Jonathan's call) and wait in Needs a
 *      match; the tension wire prints no color either and is the Green wire
 *      because Jonathan named tension wire among the green parts;
 *   5. Green Chain Link: the fences, kits and Inventory items it makes
 *      (switched off), or, once made, how its kits follow the black kits
 *      again (lib/greenChainLink planGreenFollowsBlack); the parts with no
 *      green line (no price), and the price of each part;
 *   5a. Green next to Black 4 ft as the app reads them (labor, gate labor,
 *      margin, Target Profit, section width): every field that differs;
 *   5b. every green part the Green kits use that still has no price after
 *      ordering: the black part it was swapped from and that price, which it
 *      takes (marked "From Black until a green price is entered");
 *   5c. Green switched on for quoting, and whether each Green fence is then
 *      available;
 *   6. a 100 ft straight test yard with one 4 ft walk gate, and the same yard
 *      with one 10 ft double gate: Green against Black 4 ft (No dig, and Dig
 *      set), the full pull sheet, cost and price, from the app's own estimate
 *      (web/src/estimate.ts), with 5b's prices and Green switched on.
 *
 * --apply does what Jonathan would do in the app, through the same code:
 * uploads each document the database does not have yet (lib/vendorInvoices),
 * marks 06-251608 replaced by 06-251707 (replaceQuoteWith: Undo the order,
 * then replaced), adds Green as Settings → Fence styles → Add color does
 * (planAddColor, through lib/greenChainLink) and switches it off, matches the
 * lines (Needs a match, with the unit), and taps "We ordered this" on both, as
 * the company's owner. Once Green is made, its kits are derived again from the
 * black kits (as the server does at every start). A database where an earlier
 * run matched the plain bolts to the galvanized bolts (the dev copy, Oct 26)
 * gets that undone: the order undone, those three matches removed, the order
 * placed again (never on live). Then it prints what changed and checks it
 * against the dry run. Then (Oct 27) the green parts still with no price take
 * the black part's price (5b) and Green is switched on for quoting (5c).
 * Run again, it changes nothing (each step checks first). Never with
 * DATABASE_URL on ezbiz_livecopy (the read only copy of live).
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
import { KIT_LABEL } from '../../web/src/materialKits.js'
import { okLimitWords, quoteTitle, openRowWords, soldRowWords, yardTotalsWords, type RepriceRow } from './stephensReportWords.js'
import { GREEN_KEY, GREEN_BLACK_PRICES_KEY, GREEN_LINES, FROM_BLACK_WORDS, blackWords, greenAskFor, greenCopyDiffs, greenLineFor, greenOption, greenPartFor, greenUnpriced, planGreenBlackPrices, planGreenChainLink, planGreenFollowsBlack, planGreenSwitchOn, type GreenFollow, type GreenFromBlack, type GreenPlan, type GreenState } from '../src/server/lib/greenChainLink.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const VALUE_FLAGS = ['--account', '--compare-out', '--source']
const folder = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]))
const flagValue = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
/** --compare-out <file>: also write section 6 (Green against Black, the 100 ft test yards) to its own file; --source <words>: where the data came from, for its header. */
const COMPARE_OUT = flagValue('--compare-out')
const SOURCE = flagValue('--source')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)
/** The read only copy of live: dry runs only, never --apply. */
const LIVE_COPY_NAME = 'ezbiz_livecopy'
/** Today in Ocala (YYYY-MM-DD), for the "priced from Black" mark. */
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const PIPE_DOC = '06-251706'
const GREEN_DOC = '06-251707'
const OLD_GREEN_DOC = '06-251608'
const PIPE_LINE = `GALV 2-1/2" x 8' x .116HD`
const PIPE_ITEM = `Pipe, PT40, Galv, 2-1/2" x 8'`

if (!folder || !fs.existsSync(folder)) { console.error('Usage: pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts <folder with the Stephens PDFs> [--apply [--live]]'); process.exit(1) }
if (APPLY) {
  if (dbName === LIVE_COPY_NAME) { console.error(`DATABASE_URL names "${LIVE_COPY_NAME}", the read only copy of live: dry runs only. Nothing was changed.`); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('stephens-quotes-2026-10-26b.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

/** Lines for the comparison file (--compare-out), while section 6 is printed. */
let capture: string[] | null = null
const say = (...a: unknown[]) => { console.log(...a); if (capture) capture.push(a.map(String).join(' ')) }
/** Ids, database and internal states: printed at the end, under TECHNICAL, not in the main text. */
const tech: string[] = []
/** The app's states for a vendor document or line, in words. */
const STATE_WORDS: Record<string, string> = {
  needs_match: 'waiting in Needs a match', needs_review: 'in Needs review', applied: 'prices applied', history_only: 'kept in price history only',
  waiting_ok: "waiting for Jonathan's OK", undone: 'order undone', replaced: 'replaced', refused: 'refused', failed: 'could not be read', reading: 'being read', receiving: 'being uploaded',
}
const stateWords = (s: string) => STATE_WORDS[s] ?? s.replace(/_/g, ' ')
/** A kit's kind in words ("walkGate5" → "Walk gate 5 ft wide"). */
const kindWords = (k: string) => (KIT_LABEL as Record<string, string>)[k] ?? k
/** Fence names (the app's own, e.g. "chain/4/green/res/nd") in plain words, set once the styles are known. */
let labels = new Map<string, string>()
const labelOf = (name: string) => labels.get(name) ?? name
const named = (text: string) => [...labels.keys()].sort((a, b) => b.length - a.length).reduce((t, n) => t.split(n).join(labels.get(n)!), text)
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
  /** When Green was made (GREEN_KEY), or null. */
  greenMadeAt: string | null
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
  const links = vendor ? await tx.vendorItemLink.findMany({ where: { accountId, vendorId: vendor.id }, select: { id: true, key: true, inventoryItemId: true, vendorPer: true, invPer: true, createdAt: true } }) : []
  const made = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: GREEN_KEY } } })
  const jump = Number((b?.config as any)?.pricing?.invoiceJumpPct)
  // Saved quotes whose pull sheet or proposal carries the no dig pipe (Deleted Records left out).
  const ids: Array<{ id: string }> = await tx.$queryRawUnsafe(`SELECT id FROM "SavedQuote" WHERE "accountId" = $1 AND "deletedAt" IS NULL AND ("pullSheet"::text ILIKE '%PT40%' OR proposal::text ILIKE '%PT40%')`, accountId)
  const quotes = ids.length ? await tx.savedQuote.findMany({ where: { id: { in: ids.map(r => r.id) } }, orderBy: [{ status: 'asc' }, { date: 'desc' }] }) : []
  return {
    accountId, vendor, config: b?.config ?? null, items: arr(inv?.items), kits: arr(inv?.kits), invoices, links, quotes, greenMadeAt: (made?.value as any)?.at ?? null,
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
    if (sameFile) return { doc, takes: false, existing: sameFile, why: `already in the app: this exact file (${sameFile.docType} ${sameFile.invoiceNumber}, uploaded ${sameFile.createdAt.toISOString().slice(0, 10)}, now ${stateWords(sameFile.status)}); uploading it again would be refused` }
    if (sameDoc) return { doc, takes: false, existing: sameDoc, why: `already in the app: the same ${sameDoc.docType} ${sameDoc.invoiceNumber} (same date, lines and total), ${stateWords(sameDoc.status)}; uploading it again would be refused` }
    if (earlier) return { doc, takes: false, existing: null, why: `refused as a duplicate of ${earlier.file} (same date, lines and total)` }
    return { doc, takes: true, existing: null, why: 'new: the app takes it in as a vendor quote' }
  })
}

// ── Landed prices: what "We ordered this" does ──────────────────────────────

interface Target { id: string; name: string; vendorPer: number; invPer: number; unitWords: string; via: string; item: any }
interface LinePlan { seq: number; description: string; qty: number; unit: string; lineCents: number; extraCents: number; estTaxCents: number; landedCents: number; target: Target | null; why: string }
interface ItemPlan { itemId: string; name: string; prev: number | null; printed: number; next: number; pct: number | null; outcome: string; changes: boolean; waits: boolean }
interface DocPlan { lines: LinePlan[]; items: ItemPlan[]; estBp: number | null; estTaxCents: number; fuelCents: number; spreadCents: number }

function planDoc(doc: Doc, st: State, items: any[], targetFor: (desc: string) => Target | null, whyNone: (desc: string) => string = () => 'no rule for it: it waits in Needs a match'): DocPlan {
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
    return { seq: k + 1, description: l.description, qty: l.qty ?? 0, unit: l.unit, lineCents: l.totalCents ?? 0, extraCents: extra, estTaxCents: est[k], landedCents: (l.totalCents ?? 0) + extra, target, why: target ? target.via : whyNone(l.description) }
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
  else say('   STILL IN NEEDS A MATCH: none')
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
  const rows: Array<{ q: any; style: string; how: string; pipes: number; saved: number; now: number | null; after: number | null; costNow: number | null; costAfter: number | null; sold: boolean; note: string; method: string | null; wholeDollar: boolean }> = []
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
      if (n > 0 || JSON.stringify(o).includes('PT40')) targets.push({ style: o.fenceStyle, how: `option "${o.label || o.tier?.key || o.fenceStyle}"`, saved: Number(o.finalPrice) || 0, pipes: n })
    }
    for (const t of targets) {
      let now: number | null = null, aft: number | null = null, cNow: number | null = null, cAft: number | null = null, note = '', method: string | null = null, whole = false
      const work = q.work && typeof q.work === 'object' && ['move', 'repair'].includes((q.work as any).type) ? q.work as any : null
      if (work && t.how !== 'the quote') note = 'a move or repair: option not repriced here'
      else {
        try {
          const body = {
            fenceStyle: t.style, runs: arr(q.runs).map((ft: number, i: number) => ({ ft, rail: arr(q.runRails)[i] ?? 'auto' })),
            corners: q.corners, ends: q.ends, walkGates: q.walkGates, dblGates: q.dblGates, extraLinePosts: q.layout?.teeLinePosts ?? 0,
            // Gate widths: the saved drawing's, or the ones a typed run list keeps (chain link gate leaves go by width).
            ...(q.layout?.yard ? { yard: q.layout.yard } : q.layout?.gateWidths ? { gateWidths: q.layout.gateWidths } : {}),
            tearOutSections: q.tearOutSections, tearOutGates: q.tearOutGates, extraLaborHrs: q.adjLaborHrs, hasSalesman: q.hasSalesman, priceAdjust: q.priceAdjust,
            overrides: q.pricing ?? {}, jobType: work ? work.type : 'new', move: work?.move ?? null, repair: work?.repair ?? null,
          }
          const { req, overheadPct } = requestFrom(body, q, m.importedOldPrice, m.keepsCents)
          const a = m.quoteJobFor(dataNow, req, overheadPct), b = m.quoteJobFor(dataAfter, req, overheadPct)
          now = a.totals.price; aft = b.totals.price; cNow = a.totals.materialCost; cAft = b.totals.materialCost
          method = a.calc?.priced?.priceMethod ?? null
          whole = req.overrides?.wholeDollar !== false
          if (!t.pipes) t.pipes = arr(a.pullSheet).filter((l: any) => norm(String(l?.item ?? '')) === norm(PIPE_ITEM)).reduce((s: number, l: any) => s + (Number(l.qty) || 0), 0)
        } catch (err: any) { note = `not repriced: ${String(err?.message ?? err).slice(0, 120)}` }
      }
      rows.push({ q, style: t.style, how: t.how, pipes: t.pipes, saved: t.saved, now, after: aft, costNow: cNow, costAfter: cAft, sold, note, method, wholeDollar: whole })
    }
  }
  return rows
}

// ── 6. The 100 ft test yards ────────────────────────────────────────────────

const yardWith = (gate: { type: 'walk' | 'double'; widthIn: number }) => ({
  shape: 'straight', closed: false,
  sides: [{ id: 'test-1', name: 'Test side', on: true, lengthIn: 100 * 12, startFinish: 'free', endFinish: 'free', gate: { ...gate, position: 'middle' } }],
})
const TEST_YARDS = [
  { title: '100 FT STRAIGHT, ONE 4 FT WALK GATE', yard: yardWith({ type: 'walk', widthIn: 48 }) },
  { title: '100 FT STRAIGHT, ONE 10 FT DOUBLE GATE', yard: yardWith({ type: 'double', widthIn: 120 }) },
]

function testYard(m: any, data: any, styleName: string, yard: unknown, hasSalesman = false) {
  const y = m.deriveYardRuns(data.config, yard, styleName)
  if (!y) throw new Error(`No yard for ${styleName}`)
  const est = m.estimate(data, { fenceStyle: styleName, runs: y.runs, corners: y.corners, ends: y.ends, walkGates: y.walkGates, dblGates: y.dblGates, gateWidths: y.gateWidths, hasSalesman }, { preview: true })
  return { y, est }
}

/** Green against Black on each test yard: the pull sheets side by side (each black part next to its green part), then the totals. */
function printCompare(m: any, data: any, pairs: Array<[string, string]>, unpriced: Set<string>, words: string[], fromBlack: Set<string> = new Set()) {
  for (const t of TEST_YARDS) {
    for (const [black, green] of pairs) {
      const b = testYard(m, data, black, t.yard), g = testYard(m, data, green, t.yard)
      const ys = b.y
      say(`\n   ${t.title}: ${b.est.style.label || black}  vs  ${g.est.style.label || green}`)
      say(`   yard: ${ys.runs.reduce((a: number, r: number) => a + r, 0) + (ys.gateWidths?.walk ?? []).reduce((a: number, w: number) => a + w, 0) + (ys.gateWidths?.dbl ?? []).reduce((a: number, w: number) => a + w, 0)} ft in all; fence runs ${ys.runs.join(' + ')} ft (sections counted run by run: ${ys.runs.map((r: number) => `${r} ft = ${Math.ceil(r / (b.est.style.panelWidth || 10))}`).join(', ')}), ${ys.corners} corner, ${ys.ends} end posts, ${ys.walkGates} walk gate${ys.walkGates === 1 ? '' : 's'}${ys.gateWidths?.walk?.length ? ` (${ys.gateWidths.walk.join(', ')} ft)` : ''}, ${ys.dblGates} double gate${ys.dblGates === 1 ? '' : 's'}${ys.gateWidths?.dbl?.length ? ` (${ys.gateWidths.dbl.join(', ')} ft)` : ''}; ${b.est.sections} sections`)
      say(`   ${pad('BLACK part', 58)} ${lpad('qty', 7)} ${lpad('each', 9)} ${lpad('total', 10)} | ${pad('GREEN part', 70)} ${lpad('qty', 7)} ${lpad('each', 9)} ${lpad('total', 10)}`)
      const gl = [...g.est.pullSheet]
      const rows: Array<[any, any]> = []
      for (const x of b.est.pullSheet) {
        const want = norm(greenPartFor(m, String(x.item), words))
        const k = gl.findIndex((z: any) => norm(String(z.item)) === want)
        rows.push([x, k >= 0 ? gl.splice(k, 1)[0] : null])
      }
      for (const z of gl) rows.push([null, z])
      const cell = (l: any, w: number, mark = '') => (l ? `${pad(String(l.item).trim() + mark, w)} ${lpad(String(Math.round(l.qty * 1000) / 1000), 7)} ${lpad(usd(l.unitCost), 9)} ${lpad(usd(l.total), 10)}` : pad('', w + 29))
      // A part with no price counts $0.00: a part in the green kits with no price, or any line priced at $0 that is a real part to buy.
      const noPrice = (l: any) => !!l && Number(l.qty) > 0 && (unpriced.has(norm(String(l.item))) || (!(Number(l.unitCost) > 0) && !l.moneyOnly && !l.jobLotPiece && l.costSource !== 'jobLot' && l.costSource !== 'wood'))
      const mark = (l: any) => (noPrice(l) ? ' [NO PRICE]' : l && fromBlack.has(norm(String(l.item))) ? ' [black price]' : '')
      for (const [x, z] of rows) say(`   ${cell(x, 58, mark(x))} | ${cell(z, 70, mark(z))}`)
      const side = (e: any) => ({ materialCents: Math.round(e.materialCost * 100), laborCents: Math.round(e.laborCost * 100), cogsCents: Math.round(e.totalCOGS * 100), priceCents: Math.round(e.price * 100), perFootCents: Math.round(e.pricePerFoot * 100), gmPct: e.gmPct, unpriced: new Set(e.pullSheet.filter(noPrice).map((l: any) => norm(String(l.item)))).size })
      for (const l of yardTotalsWords(side(b.est), side(g.est))) say(`   ${l}`)
      // The same yard quoted by a Salesman (his commission, Settings › Pricing): what his phone shows.
      const bs = testYard(m, data, black, t.yard, true).est, gs = testYard(m, data, green, t.yard, true).est
      const pc = Number(data.config?.pricing?.commissionSalesman)
      say(`   Quoted by a Salesman (commission ${Number.isFinite(pc) ? `${Math.round(pc * 1000) / 10}%` : 'as in Settings'}): black ${usd(bs.price)} (${usd(bs.pricePerFoot)}/ft) · green ${usd(gs.price)} (${usd(gs.pricePerFoot)}/ft)`)
      for (const [who, e] of [['black', b.est], ['green', g.est]] as const) {
        const missing = e.pullSheet.filter(noPrice)
        if (missing.length) say(`   ${who} parts with NO PRICE yet (counted $0.00 above): ${missing.map((z: any) => `${Math.round(z.qty * 1000) / 1000} × ${String(z.item).trim()}`).join('; ')}`)
      }
      for (const n of g.est.notes) say(`   green note: ${named(n)}`)
    }
  }
}

/** Section 6 on its own (--compare-out): where the numbers come from, then the yards. */
function writeCompare(file: string, lines: string[], made: boolean, fromBlack: GreenFromBlack[] = []) {
  const head = [
    `GREEN CHAIN LINK 4 FT AGAINST BLACK 4 FT: 100 FT STRAIGHT TEST YARDS (${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`,
    '',
    `Where these numbers come from: ${SOURCE ?? `the database the dry run read (${dbName})`}. A dry run: nothing was changed.`,
    'Prices are as they will be once 06-251706 (no dig pipe) and 06-251707 (green chain link) are marked "We ordered this".',
    "Priced by the app's own estimate code (web/src/estimate.ts), with Green switched on for quoting as the apply leaves it.",
    ...(fromBlack.length ? [
      `Green parts 06-251707 does not price take the Black part's price (Jonathan, Oct 27), marked [black price] below:`,
      ...fromBlack.map(r => `   ${r.part}  ←  ${r.black}  ${money(r.cents)}`),
    ] : []),
    "Same install method side by side (No dig against No dig, Dig set against Dig set), same labor and profit (Green copies Black's).",
    '',
    'A total is only a price when every part in it has one. Parts marked [NO PRICE] count $0.00, so a side with any of them',
    'says INCOMPLETE instead of a total, and no green − black difference is given until they are priced.',
    ...(made ? [] : ['', 'No Green chain link fences on this database: nothing to compare.']),
    '',
  ]
  fs.writeFileSync(file, [...head, ...lines].join('\n') + '\n')
  console.error(`(written: ${file})`)
}

// ── Report ──────────────────────────────────────────────────────────────────

interface Plans { pipe: DocPlan | null; green: DocPlan | null; greenPlan: GreenPlan; follow: GreenFollow | null; vs: Verdict[]; fromBlack: GreenFromBlack[] }

async function report(docs: Doc[], st: State, m: any): Promise<Plans> {
  labels = new Map(m.estimateConfig(st.config).fenceStyles.map((s: any) => [String(s.name), String(s.label || s.name)]))
  tech.push(`database "${dbName}", company ${st.accountId}, vendor ${st.vendor ? `"${st.vendor.name}" (${st.vendor.id})` : 'NOT IN VENDORS'}`)
  say(`Vendor ${st.vendor ? st.vendor.name : 'Stephens Pipe & Steel: NOT IN VENDORS'}. Estimated tax ${pctText(estTaxBpOf(st.config))} (added when a document prints no tax). OK limit ${st.limit}%: ${okLimitWords(st.limit)}.\n`)
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
    if (ex) tech.push(`${PIPE_DOC}: vendor document ${ex.id}, state ${ex.status}${ex.ordered ? ', ordered' : ''}`)
    say(`   ${ex ? `already in the app (${stateWords(ex.status)}${ex.ordered ? ', ordered' : ''})` : 'not in the app yet: uploaded first'}; marked "We ordered this"`)
    say(`   Printed: ${l.qty} ${l.unit} "${l.description}"${(l as any).packing ? `, packed ${(l as any).packing}` : ''}, $${(l.unitPriceHc! / 10000).toFixed(4)} each, ${dollars(l.totalCents ?? 0)}: ${l.qty} pieces = ${l.qty} each in Inventory (the bundles are how they ship, not the unit).`)
    pipe = planDoc(pdoc, st, st.items, desc => (norm(desc) === norm(PIPE_LINE) ? { id: String(pipeItem.id), name: String(pipeItem.name), vendorPer: 1, invPer: 1, unitWords: '1 piece = 1 each', via: 'Jonathan: the no dig vinyl post pipe', item: pipeItem } : null))
    printDocPlan(pdoc, pipe)
    const after = pipe.items.find(i => i.itemId === String(pipeItem.id))
    const use = await pipeUse(m, st, PIPE_ITEM)
    say(`\n   FENCES WHOSE KITS USE "${PIPE_ITEM}" (${use.length}; the kit takes the price from Inventory, so every one of them follows):`)
    for (const u of use) say(`     ${u.label}${u.active ? '' : ' [switched off]'}: ${u.per.join(', ')}`)
    if (after) {
      const rows = await repriceQuotes(m, st, String(pipeItem.id), after.prev, after.next)
      const open = rows.filter(r => !r.sold), sold = rows.filter(r => r.sold)
      const nQuotes = (rs: typeof rows) => { const n = new Set(rs.map(r => r.q.id)).size; return `${n} quote${n === 1 ? '' : 's'}` }
      const asRow = (r: typeof rows[number]): RepriceRow => ({
        what: r.how, fence: labelOf(r.style), pipes: r.pipes, savedCents: Math.round(r.saved * 100),
        nowCents: r.now == null ? null : Math.round(r.now * 100), afterCents: r.after == null ? null : Math.round(r.after * 100),
        materialNowCents: r.costNow == null ? null : Math.round(r.costNow * 100), materialAfterCents: r.costAfter == null ? null : Math.round(r.costAfter * 100),
        method: r.method, wholeDollar: r.wholeDollar, note: r.note,
      })
      // One heading per quote (name, date, status, its short id), its own line and its proposal options under it.
      const byQuote = (rs: typeof rows, print: (r: typeof rows[number]) => void) => {
        const seen = new Set<string>()
        for (const r of rs) {
          if (!seen.has(r.q.id)) { seen.add(r.q.id); say(`     ${quoteTitle(r.q)}`); tech.push(`quote ${String(r.q.id).replace(/-/g, '').slice(0, 7)} = ${r.q.id}`) }
          print(r)
        }
      }
      say(`\n   SAVED QUOTES THAT USE IT (${nQuotes(rows)}; Deleted Records left out). Each quote is named by customer, date, status and the first letters of its id, so two quotes for the same customer can be told apart.`)
      say(`   OPEN (Draft, Sent; ${nQuotes(open)}): a saved quote keeps its saved price until it is saved again or re-sent. Three prices: saved; today with the pipe at ${money(after.prev)} (every other price as it is today); today with the pipe at ${money(after.next)}. The pipe's own effect is the last two apart; anything between saved and the first "today" is other price changes since the quote was saved.`)
      byQuote(open, r => { for (const l of openRowWords(asRow(r), money(after.prev), money(after.next))) say(`       ${l}`) })
      say(`\n   SOLD (${nQuotes(sold)}): a sold quote keeps the price the customer signed; the pipe does not change it. Only what the job's materials cost us changes (pipe at ${money(after.prev)} → ${money(after.next)}):`)
      byQuote(sold, r => say(`       ${soldRowWords(asRow(r))}`))
    }
  }

  // 3. 06-251608
  say(`\n3. ${OLD_GREEN_DOC} → REPLACED BY ${GREEN_DOC}`)
  const old = st.invoices.filter(i => i.invoiceKey === invoiceNumberKey(OLD_GREEN_DOC))
  if (!old.length) say(`   ${OLD_GREEN_DOC} is not in the app on this database: nothing to replace.`)
  for (const o of old) {
    tech.push(`${OLD_GREEN_DOC}: vendor document ${o.id}, state ${o.status}${o.ordered ? ', ordered' : ''}, bill ${o.billId ?? 'none'}`)
    if (o.status === 'replaced') { say(`   ${OLD_GREEN_DOC}: already replaced (${o.message})`); continue }
    const waiting = o.lines.filter((l: any) => ['needs_match', 'waiting_ok'].includes(l.state)).length
    const applied = o.lines.filter((l: any) => l.state === 'applied')
    say(`   ${OLD_GREEN_DOC} is in the app${o.status === 'needs_match' ? '' : ` (${stateWords(o.status)})`}${o.ordered ? ', marked "We ordered this"' : ''}${o.billId ? ', its bill on Accounts Payable' : ''}; ${waiting} line${waiting === 1 ? '' : 's'} waiting in Needs a match${applied.length ? `; ${applied.length} priced from it: ${applied.map((l: any) => `${l.description} → ${l.inventoryName}`).join('; ')}` : ''}`)
    say(`   → ${o.ordered && ['applied', 'needs_match'].includes(o.status) ? `Undo the order first (${applied.length ? 'its prices put back unless changed since' : 'no price to put back'}; its bill voided: off Accounts Payable, kept in Vendors), then` : ''} marked "Replaced" by ${GREEN_DOC}: its lines leave Needs a match; it cannot be ordered again.`)
  }

  // 4 and 5. 06-251707 and Green
  const st0: GreenState = { fenceStyles: arr(st.config?.fenceStyles), fenceCatalog: m.fenceCatalogOf(st.config), items: st.items, kits: st.kits }
  const greenPlan = planGreenChainLink(m, st0)
  const follow = greenPlan.made ? null : planGreenFollowsBlack(m, st0, { madeAt: st.greenMadeAt })
  const gstate: GreenState = follow ? follow.state : greenPlan.state
  const gdoc = docOf(GREEN_DOC)
  let green: DocPlan | null = null
  const itemNamed = (items: any[], name: string) => items.find(i => norm(String(i?.name ?? '')) === norm(name)) ?? null
  say(`\n4. ${GREEN_DOC} (green vinyl coated chain link) MARKED "WE ORDERED THIS"`)
  if (!gdoc) say(`   no PDF of ${GREEN_DOC} in ${folder}`)
  else {
    const ex = inApp(GREEN_DOC)
    if (ex) tech.push(`${GREEN_DOC}: vendor document ${ex.id}, state ${ex.status}${ex.ordered ? ', ordered' : ''}`)
    say(`   ${ex ? `already in the app (${stateWords(ex.status)}${ex.ordered ? ', ordered' : ''})` : 'not in the app yet: uploaded first'}`)
    const items = gstate.items
    green = planDoc(gdoc, st, items, desc => {
      const g = greenLineFor(desc)
      if (!g) return null
      const item = itemNamed(items, g.part)
      if (!item) return null
      return { id: String(item.id), name: String(item.name), vendorPer: g.vendorPer, invPer: g.invPer, unitWords: g.unitWords, via: `${greenPlan.made ? 'new' : 'the'} Green part${g.note ? `; ${g.note}` : ''}`, item }
    }, desc => (greenAskFor(desc) ? 'NOT MATCHED: left in Needs a match for Jonathan (no color printed)' : 'no rule for it: it waits in Needs a match'))
    printDocPlan(gdoc, green)
    say('   LINES WITH NO COLOR PRINTED (a green order):')
    for (const l of gdoc.parsed.lines) {
      const a = greenAskFor(l.description), g = greenLineFor(l.description)
      if (a) {
        const link = findLink(st.links, matchKey(l.itemNumber ?? '', l.description))
        const linked = link ? st.items.find(i => String(i.id) === link.inventoryItemId) : null
        say(`     "${l.description}": NOT applied. ${a.why} It is either ${a.candidates.map(c => `"${c}" (${money(cents(itemNamed(gstate.items, c)))} now)`).join(' or ')}. It waits in Needs a match for Jonathan; the Green kits use the green bolt, at the black bolt's price (5b), until he says.`)
        if (link) say(`        the app already has a match for it → "${linked?.name ?? link.inventoryItemId}" (made ${link.createdAt.toISOString().slice(0, 16).replace('T', ' ')}): ${dbName === LIVE_DATABASE_NAME ? 'kept (on live a match is Jonathan\'s); ordering prices the line from it' : 'an earlier run\'s guess; --apply removes it (and puts back what it priced)'}`)
      } else if (g?.note && /no color/.test(g.note)) say(`     "${l.description}": matched to "${g.part}": ${g.note}.`)
    }
  }

  say('\n5. GREEN CHAIN LINK, 4 FT, RESIDENTIAL (Settings → Fence styles → Chain link → Finish → Add color "Green", copying Black, 4 ft)')
  labels = new Map([...labels, ...m.estimateConfig({ ...(st.config ?? {}), fenceStyles: gstate.fenceStyles, fenceCatalog: gstate.fenceCatalog }).fenceStyles.map((s: any) => [String(s.name), String(s.label || s.name)] as [string, string])])
  say(`   ${named(greenPlan.message)}`)
  if (follow) {
    say('   KEPT IN STEP WITH BLACK 4 FT (each Green kit derived again from the black kit as it is now; the server does the same at every start):')
    for (const u of follow.updated) { say(`     ${labelOf(u.kit)} follows ${labelOf(u.from)}; what changes:`); for (const c of u.changes) say(`        ${c.replace(/^(\w+):/, (_w, k: string) => `${kindWords(k)}:`)}`) }
    if (follow.marked.length) say(`     already the same, marked as following: ${follow.marked.map(labelOf).join(', ')}`)
    if (follow.items.length) say(`     green parts added to Inventory with no price: ${follow.items.join('; ')}`)
    for (const x of follow.skipped) say(`     left as it is: ${named(x)}`)
    if (follow.tidied.length) say(`     green part names with a stray space, trimmed (kits still find them): ${follow.tidied.join('; ')}`)
    if (follow.removed.length) say(`     green parts with no price that no kit uses, taken out of Inventory: ${follow.removed.join('; ')}`)
    if (!follow.updated.length && !follow.marked.length && !follow.items.length && !follow.skipped.length && !follow.tidied.length && !follow.removed.length) say('     already in step: nothing changes')
  }
  const opt = greenOption(gstate.fenceCatalog)
  const words = blackWords(gstate.fenceCatalog, opt)
  const gStyles = opt ? gstate.fenceStyles.filter((s: any) => s?.material === 'chain' && s?.choices?.finish === opt.key && s?.madeFrom) : []
  for (const s of gStyles) say(`   fence ${labelOf(s.name)}: made from ${labelOf(s.madeFrom)} (its labor, profit and kit), SWITCHED OFF for quoting`)
  const price = new Map<string, number | null>()
  for (const it of green?.items ?? []) price.set(norm(it.name), it.next)
  const priceOf = (part: string) => price.get(norm(part)) ?? cents(itemNamed(gstate.items, part))
  for (const k of gstate.kits.filter((x: any) => !x.archived && gStyles.some((s: any) => s.name === x.styleName))) {
    say(`   kit ${labelOf(k.styleName ?? k.name)} (follows ${k.followsKit?.from ? labelOf(k.followsKit.from) : 'nothing'}):`)
    for (const [kind, parts] of Object.entries(k.kits ?? {})) {
      say(`     ${kindWords(kind)}: ${arr(parts).map((p: any) => { const c = priceOf(p.part); return `${p.qty} × ${String(p.part).trim()} (${c == null ? 'NO PRICE' : dollars(c)})` }).join('; ')}`)
    }
  }
  say(`   parts named for what ${GREEN_DOC} sells instead of the plain Black → Green swap:`)
  for (const g of GREEN_LINES.filter(x => x.swappedFrom)) say(`     ${g.swappedFrom} → ${g.part}`)
  const used = new Set<string>()
  for (const k of gstate.kits.filter((x: any) => !x.archived && gStyles.some((s: any) => s.name === x.styleName))) for (const ps of Object.values(k.kits ?? {})) for (const p of arr(ps)) used.add(norm(p.part))
  say(`   GREEN PARTS PRICED BY ${GREEN_DOC} (landed each after "We ordered this"):`)
  for (const g of GREEN_LINES) say(`     ${pad(g.part, 66)} ${lpad(money(priceOf(g.part)), 10)}${used.has(norm(g.part)) ? '' : '  (no Green kit uses it)'}`)
  const noGreen = greenUnpriced(gstate)
  say(`   NO GREEN PRICE on ${GREEN_DOC} (in the Green kits with no price yet; each takes the black part's price, see 5b):`)
  // "chain/4/green/res/nd walkGate5" → "Green Chain Link, 4 ft, Residential, No dig: Walk gate 5 ft wide"
  const kitWhere = (w: string) => { const i = w.lastIndexOf(' '); return i > 0 ? `${labelOf(w.slice(0, i))}: ${kindWords(w.slice(i + 1))}` : named(w) }
  for (const n of noGreen) say(`     - ${n.part}${n.ask ? ` (06-251707 "${n.ask.description}" may be it: ${n.ask.why})` : ''} — used in ${n.kits.map(kitWhere).join('; ')}`)
  const older = st.items.filter(i => i?.category === 'Chainlink Green' && !i?.madeFor && !used.has(norm(String(i.name))))
  if (older.length) {
    say(`   Older green items already in Inventory (Chainlink Green, from the price workbook; used by no Green kit, left as they are). Some may be the parts above with no price (for example "Gate, Grn, 4 x 5", "Gr, Fork, PS, 2-1/2"", "Gr, Bolt, ..."): whether to use their workbook prices is Jonathan's call, nothing is matched to them (${older.length}):`)
    for (const i of [...older].sort((a, b) => String(a.name).localeCompare(String(b.name)))) say(`     ${pad(String(i.name), 58)} ${lpad(money(cents(i)), 10)}`)
  }

  // Oct 27: the prices after both quotes are ordered, then Black's price for every green part still without one, then Green switched on.
  const after = (items: any[]) => {
    const next = new Map<string, number>()
    for (const pl of [pipe, green]) for (const it of pl?.items ?? []) if (it.changes) next.set(norm(it.name), it.next)
    return items.map(i => (next.has(norm(String(i.name))) ? { ...i, unitCost: next.get(norm(String(i.name)))! / 100 } : i))
  }
  const fb = planGreenBlackPrices(m, { ...gstate, items: after(gstate.items) }, TODAY)
  const on = planGreenSwitchOn(m, fb.state)
  const fin = on.state
  const pairs = gStyles.map((s: any) => [s.madeFrom, s.name] as [string, string])
  const finConfig = { ...(st.config ?? {}), fenceStyles: fin.fenceStyles, fenceCatalog: fin.fenceCatalog }

  say('\n5a. IS GREEN A FAITHFUL COPY OF BLACK 4 FT? (as the app reads both: calculation, options, labor, margins, profit)')
  m.styleLabels(finConfig, { inventory: fin.items, kits: fin.kits })
  const resolved = m.estimateConfig(finConfig).fenceStyles
  for (const [b, g] of pairs) {
    const bs = resolved.find((s: any) => s.name === b), gs = resolved.find((s: any) => s.name === g)
    if (!bs || !gs) continue
    say(`   ${labelOf(g)} next to ${labelOf(b)}:`)
    say(`     section width ${gs.panelWidth} ft (black ${bs.panelWidth}); sections one person installs an hour ${gs.sectionsPerMH} (black ${bs.sectionsPerMH}); walk gate ${gs.mhPerWalkGate} man hours (black ${bs.mhPerWalkGate}); double gate ${gs.mhPerDblGate} (black ${bs.mhPerDblGate})`)
    say(`     margin ${gs.margin} (black ${bs.margin}); Target Profit ${gs.colorTargetProfitPct ?? gs.targetProfitPct}% (black ${bs.colorTargetProfitPct ?? bs.targetProfitPct}%); category ${gs.category} (black ${bs.category}); sub rate ${gs.subRate ?? 'the Chainlink rate in Settings'} (black ${bs.subRate ?? 'the Chainlink rate in Settings'})`)
  }
  const diffs = greenCopyDiffs(resolved, pairs)
  if (diffs.length) for (const d of diffs) say(`   DIFFERS: ${labelOf(d.green)} ${d.field} = ${JSON.stringify(d.greenValue)}, black ${JSON.stringify(d.blackValue)}`)
  else say(`   Same in every field the price uses${pairs.length ? '' : ' (no Green fences yet)'}. Its kits are the black kits part for part (section 5); Green is offered at 4 ft only, No dig and Dig set, residential, walk and double gates of every width black 4 ft has.`)

  say(`\n5b. GREEN PARTS NOT PRICED BY ${GREEN_DOC}: BLACK'S PRICE (Jonathan, Oct 27: "If a green part isn't on the quote, use the black price and list it for me")`)
  say(`   Each takes the black part's price in Inventory now and is marked "${FROM_BLACK_WORDS}" (Inventory, and the quote's price warning). A vendor document or a typed price replaces it. No black price is changed.`)
  say(`   ${pad('GREEN part', 66)} ${pad('BLACK part used', 62)} ${lpad('price', 9)}`)
  for (const r of fb.priced) say(`   ${pad(r.part, 66)} ${pad(r.black, 62)} ${lpad(money(r.cents), 9)}`)
  if (!fb.priced.length) say('   none: every green part already has a price')
  for (const r of fb.missing) say(`   STILL NO PRICE: ${r.part}: its black part "${r.black}" has no price in Inventory either`)

  say('\n5c. SWITCH ON (Jonathan OK\'d it Oct 27): Settings → Fence styles → Chain link → Finish → Green, on for quoting')
  if (!greenOption(fin.fenceCatalog)) say('   no Green on this database: nothing to switch on')
  else say(`   ${on.switched ? 'Green: off → ON for quoting' : 'Green is already on for quoting'}`)
  for (const s of resolved.filter((x: any) => pairs.some(([, g]) => g === x.name))) say(`   ${s.label}: ${s.held ? `STILL NOT AVAILABLE: ${s.held}` : 'available for quoting (the quote builder offers it to the Salesman and the office; the customer reads this name)'}`)

  // 6. The test yards
  say('\n6. TEST YARDS: GREEN AGAINST BLACK 4 FT (the app\'s own estimate, at the prices after both quotes are ordered, Black\'s price for the green parts in 5b, Green switched on)')
  if (COMPARE_OUT) capture = []
  const data = { config: finConfig, inventory: fin.items, kits: fin.kits }
  const unpriced = new Set(greenUnpriced(fin).map(n => norm(n.part)))
  printCompare(m, data, pairs, unpriced, words, new Set(fb.priced.map(r => norm(r.part))))
  if (COMPARE_OUT && capture) { writeCompare(COMPARE_OUT, capture, gStyles.length > 0, fb.priced); capture = null }
  return { pipe, green, greenPlan, follow, vs, fromBlack: fb.priced }
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

  // Green chain link, as Add color makes it, switched off; once made, its kits follow the black kits.
  const made = await prisma.$transaction(async (tx: any) => {
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    const kv = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: GREEN_KEY } } })
    const cfg = (b?.config ?? {}) as Record<string, any>
    const st1: GreenState = { fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items: arr(inv?.items), kits: arr(inv?.kits) }
    const plan = planGreenChainLink(m, st1)
    if (!plan.made) {
      const f = planGreenFollowsBlack(m, st1, { madeAt: (kv?.value as any)?.at ?? null })
      if (f.updated.length || f.items.length || f.marked.length || f.tidied.length || f.removed.length) await tx.inventoryState.update({ where: { accountId }, data: { items: f.state.items as any, kits: f.state.kits as any, version: { increment: 1 } } })
      return { message: `${plan.message} Kept in step with black: ${f.updated.length ? f.updated.map(u => `${u.kit} (${u.changes.length} kit${u.changes.length === 1 ? '' : 's'} changed)`).join(', ') : 'no kit changed'}${f.items.length ? `; added with no price: ${f.items.join('; ')}` : ''}${f.skipped.length ? `; left as they are: ${f.skipped.join('; ')}` : ''}.` }
    }
    await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog } as any, version: { increment: 1 } } })
    await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    const value = { at: new Date().toISOString(), by: actor.name, styles: plan.styles, kits: plan.kits, items: plan.items, noGreen: plan.noGreen.map(n => n.part), renamed: plan.renamed, from: GREEN_DOC }
    await tx.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: GREEN_KEY } }, create: { accountId, key: GREEN_KEY, value: value as any }, update: { value: value as any } })
    return { message: plan.message }
  }, { timeout: 30_000 })
  say(`  ${made.message}`)

  // The plain bolts are Jonathan's call: an earlier run (the dev copy, Oct 26) matched them to the galvanized bolts.
  // Undo that order, remove those matches, order again: the bolts wait in Needs a match. Never on live.
  {
    const gi = await find(GREEN_DOC)
    const links = await prisma.vendorItemLink.findMany({ where: { accountId, vendorId: st.vendor.id } })
    const asked = (gi?.lines ?? []).filter(l => greenAskFor(l.description))
    const guessed = asked.filter(l => ['applied', 'history_only', 'waiting_ok'].includes(l.state))
    const askLinks = [...new Map(asked.map(l => findLink(links, l.matchKey || matchKey(l.itemNumber, l.description))).filter(Boolean).map(k => [k!.id, k!])).values()]
    // What the guessed match left on the line (its item, unit and price), shown in Needs a match as if matched.
    const stale = asked.filter(l => !['applied', 'history_only', 'waiting_ok'].includes(l.state) && (l.inventoryItemId || l.unitLandedCents != null || l.vendorPer != null))
    // A run stopped between the undo and ordering again leaves the order undone: it is placed again.
    const reorder = !!gi && gi.ordered && gi.status === 'undone' && asked.length > 0 && dbName !== LIVE_DATABASE_NAME
    if (gi && (guessed.length || askLinks.length || stale.length || reorder)) {
      if (dbName === LIVE_DATABASE_NAME) say(`  ${GREEN_DOC}: the plain bolts already have a match on live (${askLinks.map(k => k.key).join(', ')}): left as they are (Jonathan's).`)
      else {
        let undone = reorder
        if (gi.ordered && ['applied', 'needs_match'].includes(gi.status) && guessed.length) {
          const r = await lib.undoInvoice(accountId, gi.id, actor)
          undone = true
          say(`  ${GREEN_DOC}: order undone (an earlier run priced the plain bolts as galvanized): ${r.restored.map(x => `${x.name} back to ${x.back}`).join('; ') || 'nothing to put back'}${r.skipped.length ? `; not put back: ${r.skipped.map(x => `${x.name} (${x.reason})`).join('; ')}` : ''}`)
        }
        if (askLinks.length || stale.length || guessed.length) {
          await prisma.vendorItemLink.deleteMany({ where: { id: { in: askLinks.map(k => k.id) } } })
          await prisma.vendorInvoiceLine.updateMany({ where: { id: { in: [...new Set([...stale, ...guessed].map(l => l.id))] } }, data: { inventoryItemId: null, inventoryName: '', vendorPer: null, invPer: null, invQty: null, unitLandedCents: null, unitLandedExact: null, prevUnitCents: null, changePct: null } })
          say(`  ${GREEN_DOC}: removed the galvanized matches for ${asked.map(l => `"${l.description}"`).join(', ')} (${askLinks.length} remembered match${askLinks.length === 1 ? "" : "es"}, ${new Set([...stale, ...guessed].map(l => l.id)).size} line(s) cleared)`)
        }
        if (undone) { await lib.markOrdered(accountId, gi.id, actor); say(`  ${GREEN_DOC}: We ordered this again (its own bill back; the bolts wait in Needs a match)`) }
      }
    }
  }

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
        if (!w) { say(`  ${n}: "${l.description}" ${greenAskFor(l.description) ? "left in Needs a match for Jonathan (no color printed: galvanized or green is his call)" : "has no rule: left in Needs a match"}`); continue }
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

  // Oct 27: the green parts still with no price take the black part's price; Green switched on for quoting.
  const on = await prisma.$transaction(async (tx: any) => {
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    const cfg = (b?.config ?? {}) as Record<string, any>
    const st1: GreenState = { fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items: arr(inv?.items), kits: arr(inv?.kits) }
    if (!greenOption(st1.fenceCatalog)) throw new Error('Green chain link is not in Settings: stopped before pricing it from black.')
    const fb = planGreenBlackPrices(m, st1, TODAY)
    const sw = planGreenSwitchOn(m, fb.state)
    if (fb.priced.length) await tx.inventoryState.update({ where: { accountId }, data: { items: sw.state.items as any, version: { increment: 1 } } })
    if (sw.switched) await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceCatalog: sw.state.fenceCatalog } as any, version: { increment: 1 } } })
    if (fb.priced.length || sw.switched) {
      const kv = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: GREEN_BLACK_PRICES_KEY } } })
      const runs = arr((kv?.value as any)?.runs)
      const value = { runs: [...runs, { at: new Date().toISOString(), by: actor.name, fromBlack: fb.priced, stillNoPrice: fb.missing, switchedOn: sw.switched }] }
      await tx.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: GREEN_BLACK_PRICES_KEY } }, create: { accountId, key: GREEN_BLACK_PRICES_KEY, value: value as any }, update: { value: value as any } })
    }
    return { fb, switched: sw.switched }
  }, { timeout: 30_000 })
  for (const r of on.fb.priced) say(`  ${r.part}: no price → ${money(r.cents)} (from ${r.black}; "${FROM_BLACK_WORDS}")`)
  if (!on.fb.priced.length) say('  green parts priced from black: none needed (each already has a price)')
  for (const r of on.fb.missing) say(`  STILL NO PRICE: ${r.part} (its black part "${r.black}" has no price either)`)
  say(`  Green chain link: ${on.switched ? 'switched ON for quoting' : 'already on for quoting'}`)

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
  const resolved = m.estimateConfig(after.config).fenceStyles.filter((s: any) => s?.material === 'chain' && s?.choices?.finish === 'green')
  for (const s of resolved) {
    say(`  fence ${s.name} (${s.label}): ${s.held ? `NOT AVAILABLE FOR QUOTING: ${s.held}` : 'available for quoting'}`)
    if (s.held) mismatch++
  }
  // Black's price for each green part, as the dry run said; and no other price changed (never a black one).
  const itemBy = (items: any[], name: string) => items.find(i => norm(String(i?.name ?? '')) === norm(name))
  for (const r of plans.fromBlack) {
    const it = itemBy(after.items, r.part)
    const got = cents(it)
    say(`  ${r.part}: ${money(got)}${it?.priceFrom ? ` (${it.priceFrom.words}: ${it.priceFrom.part})` : ''}`)
    if (got !== r.cents) { mismatch++; say(`     DIFFERS from the dry run: expected ${money(r.cents)} from ${r.black}`) }
  }
  const allowed = new Set([norm(PIPE_ITEM), ...[plans.pipe, plans.green].flatMap(p => (p?.items ?? []).map(i => norm(i.name))), ...plans.fromBlack.map(r => norm(r.part))])
  const changed = st.items.filter(i => !allowed.has(norm(String(i?.name ?? ''))) && cents(itemBy(after.items, String(i?.name ?? ''))) !== cents(i))
  if (changed.length) { mismatch += changed.length; for (const i of changed) say(`  PRICE CHANGED THAT SHOULD NOT: ${i.name} ${money(cents(i))} → ${money(cents(itemBy(after.items, i.name)))}`) }
  else say(`  no other Inventory price changed (every Black price as it was)`)
  for (const k of after.kits.filter((x: any) => !x.archived && resolved.some((s: any) => s.name === x.styleName))) {
    const black = m.kitSetFor(k.followsKit?.from ?? '', after.kits)
    say(`  kit ${k.name}: ${k.followsKit ? `follows ${k.followsKit.from}` : 'FOLLOWS NOTHING'}`)
    if (!k.followsKit || !black) mismatch++
  }
  const asked = await prisma.vendorInvoiceLine.findMany({ where: { invoice: { accountId, invoiceKey: invoiceNumberKey(GREEN_DOC), ordered: true, status: { notIn: ['refused', 'failed', 'replaced'] } } }, select: { description: true, state: true } })
  for (const l of asked.filter(x => greenAskFor(x.description))) {
    say(`  ${GREEN_DOC} "${l.description}": ${l.state}${l.state === 'needs_match' ? ' (waits for Jonathan)' : ''}`)
    if (l.state !== 'needs_match' && dbName !== LIVE_DATABASE_NAME) mismatch++
  }
  say('\n  The test yards again, from the database:')
  const data = { config: after.config, inventory: after.items, kits: after.kits }
  const gs: GreenState = { fenceStyles: arr(after.config?.fenceStyles), fenceCatalog: m.fenceCatalogOf(after.config), items: after.items, kits: after.kits }
  const unpriced = new Set(greenUnpriced(gs).map(n => norm(n.part)))
  printCompare(m, data, resolved.map((s: any) => [s.madeFrom, s.name] as [string, string]), unpriced, blackWords(gs.fenceCatalog, greenOption(gs.fenceCatalog)), new Set(after.items.filter((i: any) => i?.priceFrom && cents(i) === i.priceFrom.cents).map((i: any) => norm(String(i.name)))))
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
    tech.push(`database "${dbName}": this run's transaction was read only (SHOW transaction_read_only = on)`)
    const st = await loadState(tx, args.includes('--account') ? args[args.indexOf('--account') + 1] : undefined)
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read only, nothing is changed)'}: Stephens quotes ${PIPE_DOC} and ${GREEN_DOC} (${OLD_GREEN_DOC} replaced)\n`)
    const out = await report(docs, st, m)
    return { st, out }
  }, { timeout: 120_000 })
  if (APPLY) await apply(docs, st, out, m)
  else {
    say('\nNothing was changed.')
    say('To do it on the dev copy: pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts "<folder with the PDFs>" --apply')
    say("To do it on live, only after the deploy (update.sh), a backup from the last 30 minutes and Jonathan's typed OK, from ~/ezbiz/apps/portal:")
    say('   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/stephens-quotes-2026-10-26b.ts "<folder with the PDFs>" --apply --live')
  }
  if (tech.length) {
    say('\nTECHNICAL (for whoever runs this; not needed to read the rest):')
    for (const t of [...new Set(tech)]) say(`   ${t}`)
  }
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.stack ?? err?.message ?? err); process.exit(1) })
