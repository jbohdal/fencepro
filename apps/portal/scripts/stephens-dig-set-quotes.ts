/**
 * Stephens Pipe & Steel quotes 06-251126 and 06-251608 (Oct 2026): what
 * "We ordered this" does to Inventory, shown before anything changes.
 *
 *   pnpm exec tsx scripts/stephens-dig-set-quotes.ts <folder with the PDFs>             dry run (default): reads only
 *   pnpm exec tsx scripts/stephens-dig-set-quotes.ts <folder> --apply                   does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/stephens-dig-set-quotes.ts <folder> --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh), a backup from the last 30 minutes and
 *                                                    Jonathan's typed OK
 *
 * The dry run opens one READ ONLY transaction (any write would fail) and
 * reads every PDF in the folder with the app's own reader. It prints:
 *   1. each file: what was read, and whether the app takes it or refuses it as
 *      a duplicate (the same file, or the same document in another file);
 *   2. 06-251126: each line → the Inventory part by Jonathan's rule
 *      (lib/digSetPipeMatch) → its price now → the new landed price
 *      (estimated tax, fuel left out) and what happens to it;
 *   3. 06-251608: freight spread over its lines, fuel on the bill only, and
 *      every line in Needs a match (green chain link has no style);
 *   4. 06-249853: whether this database already has it;
 *   5. the dig set chain link styles: parts still without a price, before
 *      and after.
 *
 * --apply does what Jonathan would do in Inventory > Invoices, through the
 * same code the screen uses (lib/vendorInvoices): uploads a document the
 * database does not have yet, changes the matches of 06-251126's lines to the
 * dig set post parts (Change match), and taps "We ordered this" on both
 * quotes, as the company's owner. Then it prints what changed (before and
 * after, from price history) and checks it against the dry run.
 * Run again, it changes nothing (each step checks first).
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
import { checkTotals, landedParts, spreadExtras, unitLanded, changePct, needsOk, matchKey, findLink, invoiceNumberKey, dollars, pctText, isFuelFee } from '../src/server/lib/invoiceMath.js'
import { contentKey, estTaxBpOf, newerPriceKept, revisionOf, DEFAULT_JUMP_PCT, NOT_INVENTORY } from '../src/server/lib/vendorInvoices.js'
import { digSetPipeFor, digSetPipeItem } from '../src/server/lib/digSetPipeMatch.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const folder = args.find(a => !a.startsWith('--'))
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)
const ORDER = ['06-251126', '06-251608']

if (!folder || !fs.existsSync(folder)) { console.error('Usage: pnpm exec tsx scripts/stephens-dig-set-quotes.ts <folder with the Stephens PDFs> [--apply [--live]]'); process.exit(1) }
if (APPLY) {
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('stephens-dig-set-quotes.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const cents = (item: any): number | null => { const n = Number(item?.unitCost); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
const money = (c: number | null | undefined) => (c == null ? 'no price' : dollars(c))
const pct = (p: number | null) => (p == null ? 'new price' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`)
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const GREEN = /\bGRN\b|\bGREEN\b/i

interface Doc { file: string; sha: string; parsed: ParsedInvoice; revision: string; key: string; content: string }

/** Every column read here exists before and after this branch's schema change, so the dry run works on live before the deploy. */
const INV_SELECT = {
  id: true, status: true, docType: true, ordered: true, vendorId: true, vendorName: true, invoiceNumber: true, invoiceKey: true, invoiceDate: true,
  totalCents: true, taxFound: true, taxOk: true, revision: true, createdAt: true, billId: true,
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
  links: Map<string, any>
  limit: number
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
  const links = vendor ? new Map<string, any>((await tx.vendorItemLink.findMany({ where: { accountId, vendorId: vendor.id }, select: { key: true, inventoryItemId: true, vendorPer: true, invPer: true } })).map((k: any) => [k.key, k])) : new Map()
  const jump = Number((b?.config as any)?.pricing?.invoiceJumpPct)
  return {
    accountId, vendor, config: b?.config ?? null, items: arr(inv?.items), kits: arr(inv?.kits), invoices, links,
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
    if (sameFile) return { doc, takes: false, existing: sameFile, why: `refused: this exact file is already in the app (${sameFile.docType} ${sameFile.invoiceNumber}, uploaded ${sameFile.createdAt.toISOString().slice(0, 10)}, now "${sameFile.status}")` }
    if (sameDoc) return { doc, takes: false, existing: sameDoc, why: `refused as a duplicate: the same ${sameDoc.docType} ${sameDoc.invoiceNumber} (same date, lines and total) is already in the app (document ${sameDoc.revision || '?'}, "${sameDoc.status}")` }
    if (earlier) return { doc, takes: false, existing: null, why: `refused as a duplicate of ${earlier.file} (same date, lines and total), once that one is in` }
    return { doc, takes: true, existing: null, why: 'new: the app takes it in as a vendor quote' }
  })
}

// ── 2 and 3. What "We ordered this" does ────────────────────────────────────

interface LinePlan {
  seq: number; description: string; qty: number; unit: string; lineCents: number; extraCents: number; estTaxCents: number; landedCents: number
  target: { id: string; name: string } | null; via: string; currentLink: string
}
interface ItemPlan { itemId: string; name: string; prev: number | null; printed: number; next: number; pct: number | null; outcome: string; changes: boolean }

function plan(doc: Doc, st: State, existing: any | null, useRule: boolean): { lines: LinePlan[]; items: ItemPlan[]; estBp: number | null; estTaxCents: number; fuelCents: number; spreadCents: number } {
  const p = doc.parsed
  const fees = p.fees.map(f => ({ label: f.label, cents: f.cents }))
  // Jonathan's rule: no tax line → estimated tax. A "No tax is right" tapped before estimated tax
  // existed (it was the only way past review) is taken back by --apply before ordering.
  const taxOk = false
  void existing
  const estBp = !p.taxFound && !taxOk ? estTaxBpOf(st.config) : null
  const check = checkTotals(p.lines, { ...p, feesCents: fees.reduce((s, f) => s + f.cents, 0) })
  if (!check.ok) throw new Error(`${doc.file} does not add up: ${JSON.stringify(check.problems)}`)
  const parts = landedParts({ linesCents: check.linesCents, taxCents: p.taxCents, freightCents: p.freightCents, fees, taxFound: p.taxFound, taxOk, estTaxBp: estBp ?? 0 })
  const lineCents = p.lines.map(l => l.totalCents ?? 0)
  const spread = spreadExtras(lineCents, parts.spreadCents)
  const est = spreadExtras(lineCents, parts.estTaxCents)
  const byId = new Map(st.items.map(i => [String(i.id), i]))
  const lines: LinePlan[] = p.lines.map((l, k) => {
    const key = matchKey(l.itemNumber, l.description)
    const link = findLink([...st.links.values()], key)
    const linked = link ? (link.inventoryItemId === NOT_INVENTORY ? 'Not an Inventory item' : String(byId.get(link.inventoryItemId)?.name ?? `${link.inventoryItemId} (gone)`)) : 'none'
    const rule = useRule ? digSetPipeItem(l.description, st.items) : null
    let target: LinePlan['target'] = null, via = ''
    if (rule) { target = { id: String(rule.item.id), name: String(rule.item.name) }; via = rule.rule.why }
    else if (useRule && digSetPipeFor(l.description)) via = `rule says "${digSetPipeFor(l.description)!.part}", which is not in Inventory`
    else if (link && link.inventoryItemId !== NOT_INVENTORY && byId.has(link.inventoryItemId)) { target = { id: link.inventoryItemId, name: String(byId.get(link.inventoryItemId).name) }; via = 'matched before' }
    else via = GREEN.test(l.description) ? 'Needs a match (green: no green chain link style)' : 'Needs a match (no rule for it; a tap decides)'
    const extra = spread[k] + est[k]
    return { seq: k + 1, description: l.description, qty: l.qty ?? 0, unit: l.unit, lineCents: l.totalCents ?? 0, extraCents: extra, estTaxCents: est[k], landedCents: (l.totalCents ?? 0) + extra, target, via, currentLink: linked }
  })
  const groups = new Map<string, LinePlan[]>()
  for (const l of lines) if (l.target) groups.set(l.target.id, [...(groups.get(l.target.id) ?? []), l])
  const items: ItemPlan[] = []
  for (const [id, ls] of groups) {
    const item = byId.get(id)
    const qty = ls.reduce((s, l) => s + l.qty, 0)
    const next = unitLanded(ls.reduce((s, l) => s + l.landedCents, 0), 0, qty).cents
    const printed = unitLanded(ls.reduce((s, l) => s + l.lineCents, 0), 0, qty).cents
    const prev = cents(item)
    const change = changePct(prev, next)
    let outcome: string, changes = false
    if (newerPriceKept(item, p.invoiceDate, printed)) outcome = `kept in price history only: Inventory has a newer price (${item.priceUpdatedAt})`
    else if (needsOk(prev, next, st.limit)) outcome = `waits for an OK (more than ${st.limit}%)`
    else { outcome = prev === next ? 'same price, date confirmed' : 'applied'; changes = prev !== next }
    if (changes && typeof item?.priceUpdatedAt === 'string' && item.priceUpdatedAt > p.invoiceDate) outcome += ` (the price now, from ${item.priceUpdatedAt}, is this quote's own price typed in by hand)`
    items.push({ itemId: id, name: String(item?.name ?? id), prev, printed, next, pct: change, outcome, changes })
  }
  return { lines, items, estBp, estTaxCents: parts.estTaxCents, fuelCents: parts.fuelCents, spreadCents: parts.spreadCents }
}

// ── 5. Dig set styles: parts with no price ──────────────────────────────────

function unpricedDigSet(st: State, prices: Map<string, number>): Array<{ style: string; parts: string[] }> {
  const price = new Map<string, number>()
  for (const i of st.items) if (i?.status !== 'inactive' && i?.status !== 'discontinued') price.set(norm(String(i.name ?? '')), prices.get(String(i.id)) ?? (Number(i.unitCost) || 0))
  const styles = arr(st.config?.fenceStyles).filter((s: any) => s?.material === 'chain' && s?.choices?.install === 'ds' && s.isActive !== false)
  return styles.map((s: any) => {
    const set = st.kits.find(k => k?.styleName === s.name && !k.archived)
    if (!set) return { style: s.name, parts: ['(no material kit)'] }
    const left = new Set<string>()
    for (const parts of Object.values(set.kits ?? {}) as any[]) for (const p of arr(parts)) if (p.qty > 0 && !((price.get(norm(String(p.part))) ?? 0) > 0)) left.add(String(p.part))
    return { style: s.name, parts: [...left].sort() }
  })
}

const styleWords = (name: string) => {
  const m = /^chain\/(\d)\/(galv|black)\/res\/ds$/.exec(name)
  return m ? `${m[1]} ft tall ${m[2] === 'galv' ? 'Galvanized' : 'Black'} dig set chain link` : name
}

// ── Report ──────────────────────────────────────────────────────────────────

async function report(docs: Doc[], st: State) {
  const say = console.log
  say(`Database "${dbName}", company ${st.accountId}, vendor ${st.vendor ? `"${st.vendor.name}"` : 'NOT IN VENDORS'}, estimated tax ${pctText(estTaxBpOf(st.config))}, OK limit ${st.limit}%\n`)

  say('1. FILES AND DUPLICATES')
  const vs = verdicts(docs, st)
  for (const v of vs) {
    const p = v.doc.parsed
    say(`  ${v.doc.file}`)
    say(`     ${p.docType} ${p.invoiceNumber} of ${p.invoiceDate}, document ${v.doc.revision}: ${p.lines.length} lines, items ${dollars(p.subtotalCents ?? 0)}, freight ${dollars(p.freightCents)}, ${p.fees.map(f => `${f.label} ${dollars(f.cents)}`).join(', ') || 'no fees'}, tax ${p.taxFound ? dollars(p.taxCents) : 'none printed'}, total ${dollars(p.totalCents ?? 0)}`)
    say(`     → ${v.why}`)
  }

  const plans = new Map<string, ReturnType<typeof plan>>()
  for (const number of ORDER) {
    const key = invoiceNumberKey(number)
    const doc = docs.find(d => d.parsed.invoiceNumber === number)
    if (!doc) { say(`\n${number}: no PDF of it in ${folder}`); continue }
    const existing = st.invoices.find(i => i.invoiceKey === key && !['refused', 'failed', 'replaced'].includes(i.status)) ?? null
    const pl = plan(doc, st, existing, number === '06-251126')
    plans.set(number, pl)
    const p = doc.parsed
    say(`\n${number === '06-251126' ? '2' : '3'}. ${number} (${p.invoiceDate}) MARKED "WE ORDERED THIS"${existing ? ` — in the app as ${existing.id} ("${existing.status}"${existing.ordered ? ', already ordered' : ''})` : ' — not in the app yet: uploaded first'}`)
    if (existing?.taxOk && !p.taxFound) say('   "No tax is right" was tapped on it before estimated tax existed (it was the only way past review then): --apply takes that back first, so estimated tax applies (rule 4).')
    say(`   Items ${dollars(p.subtotalCents ?? 0)} · spread over the lines: ${dollars(pl.spreadCents)} (freight ${dollars(p.freightCents)}${p.taxFound ? `, tax ${dollars(p.taxCents)}` : ''}) · estimated tax ${pl.estBp != null ? `${pctText(pl.estBp)} = ${dollars(pl.estTaxCents)}` : 'none'} · fuel ${dollars(pl.fuelCents)} on the vendor bill only`)
    say('   line | vendor item | qty | amount | + freight/tax share (of it estimated tax) | landed | → Inventory part (why) | matched now to')
    for (const l of pl.lines) {
      say(`   ${String(l.seq).padStart(2)} | ${l.description} | ${l.qty} ${l.unit} | ${dollars(l.lineCents)} | +${dollars(l.extraCents)} (${dollars(l.estTaxCents)}) | ${dollars(l.landedCents)} | → ${l.target ? `${l.target.name} (${l.via})` : l.via} | ${l.currentLink}`)
    }
    if (pl.items.length) {
      say('   BEFORE → AFTER (per Inventory part, landed each):')
      for (const it of pl.items) say(`     ${it.name}: ${money(it.prev)} → ${money(it.next)} (${pct(it.pct)}; printed ${dollars(it.printed)} + estimated tax${p.freightCents ? ' + freight' : ''}) — ${it.outcome}`)
    }
    const waiting = pl.lines.filter(l => !l.target)
    if (waiting.length) {
      say(`   NEEDS A MATCH (${waiting.length}): nothing priced from these until each is matched once`)
      for (const l of waiting) say(`     - ${l.description} (${l.qty} ${l.unit}, landed ${dollars(l.landedCents)})${GREEN.test(l.description) ? ' [green]' : ''}`)
    }
  }

  say('\n4. 06-249853 (Oct 6)')
  const k853 = st.invoices.filter(i => i.invoiceKey === invoiceNumberKey('06-249853'))
  if (!k853.length) say('   NOT in the app on this database: no document 06-249853 from Stephens. Uploaded now it would be taken in as a new vendor quote (not a duplicate); a second copy after that is refused.')
  for (const i of k853) say(`   in the app: ${i.id} "${i.status}" uploaded ${i.createdAt.toISOString().slice(0, 10)} → uploading it again is refused as a duplicate`)

  say('\n5. DIG SET CHAIN LINK: PARTS WITH NO PRICE IN INVENTORY')
  const after = new Map<string, number>()
  for (const pl of plans.values()) for (const it of pl.items) if (it.changes) after.set(it.itemId, it.next / 100)
  const before = unpricedDigSet(st, new Map())
  const now = unpricedDigSet(st, after)
  // Available for quoting, by the app's own rules (web/src/fenceCatalog resolveFenceStyles, through the estimate bundle).
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const m = await pricingModule()
  const quotable = (items: any[]) => new Set(m.estimateStyles(st.config, { inventory: items, kits: st.kits } as any).map((s: any) => s.name))
  const qNow = quotable(st.items)
  const qAfter = quotable(st.items.map(i => (after.has(String(i.id)) ? { ...i, unitCost: after.get(String(i.id)) } : i)))
  const words = (q: Set<string>, style: string, parts: string[]) => `${q.has(style) ? 'AVAILABLE for quoting' : 'not available for quoting'}${parts.length ? `, ${parts.length} part${parts.length === 1 ? '' : 's'} with no price: ${parts.join('; ')}` : ', every part priced'}`
  for (const [i, b] of before.entries()) {
    say(`   ${styleWords(b.style)} (${b.style})`)
    say(`      now:   ${words(qNow, b.style, b.parts)}`)
    say(`      after: ${words(qAfter, b.style, now[i].parts)}`)
  }
  const strays = st.items.filter(i => i?.category === 'Misc' && /stephens/i.test(String(i?.supplier ?? '')) && /(PLY BLK|GALV) .* (PP055|18ga-SPS)/i.test(String(i?.name ?? '')))
  if (strays.length) {
    say(`\n   Inventory items added from 06-251126's lines on an earlier match (Misc, no price; nothing will point at them after the change; left as they are, to remove by hand if Jonathan wants):`)
    for (const s of strays) say(`     - ${s.name} (${s.id}, ${money(cents(s))})`)
  }
  return { vs, plans }
}

// ── Apply (what Jonathan would tap) ─────────────────────────────────────────

async function apply(docs: Doc[], st: State, vs: Verdict[], plans: Map<string, ReturnType<typeof plan>>) {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const lib = await import('../src/server/lib/vendorInvoices.js')
  if (!st.owner) throw new Error('No owner login for this company')
  if (!st.vendor) throw new Error('Stephens Pipe & Steel is not in Vendors')
  const actor = st.owner
  const say = console.log
  say(`\nAPPLY as ${actor.name}`)
  for (const number of ORDER) {
    const key = invoiceNumberKey(number)
    const find = () => prisma.vendorInvoice.findFirst({ where: { accountId: st.accountId, vendorId: st.vendor!.id, invoiceKey: key, status: { notIn: ['refused', 'failed', 'replaced'] } }, include: { lines: { orderBy: { seq: 'asc' } } }, orderBy: { createdAt: 'asc' } })
    let inv = await find()
    if (!inv) {
      const v = vs.find(x => x.takes && x.doc.parsed.invoiceNumber === number)
      if (!v) throw new Error(`${number}: no file to upload`)
      const tmp = path.join(os.tmpdir(), `sps-${crypto.randomUUID()}.pdf`)
      fs.copyFileSync(path.join(folder!, v.doc.file), tmp)
      const r = await lib.receiveInvoiceFile({ accountId: st.accountId, actor, clientId: crypto.randomUUID(), batchId: crypto.randomUUID(), seq: 0, pageCount: 1, fileName: v.doc.file, mime: 'application/pdf', path: tmp, bytes: fs.statSync(tmp).size })
      await lib.readsSettled()
      say(`  ${number}: uploaded ${v.doc.file} → ${r.invoiceId}`)
      inv = await find()
      if (!inv) throw new Error(`${number}: the upload was refused: ${(await prisma.vendorInvoice.findUnique({ where: { id: r.invoiceId } }))?.message}`)
    }
    if (inv.status === 'needs_review') throw new Error(`${number} is in Needs review (${JSON.stringify(inv.problems)}): fix it in the app first. Nothing more was done.`)
    if (!inv.ordered && !inv.taxFound && inv.taxOk) {
      await lib.editHeader(st.accountId, inv.id, { taxOk: false }, actor)
      say(`  ${number}: "No tax is right" taken back: estimated tax applies`)
    }
    if (number === '06-251126' && !inv.ordered) {
      for (const l of inv.lines) {
        const rule = digSetPipeItem(l.description, st.items)
        if (!rule) continue
        if (l.inventoryItemId === rule.item.id && l.state === 'quoted') continue
        await lib.matchLine(st.accountId, l.id, { inventoryItemId: String(rule.item.id), vendorPer: 1, invPer: 1 }, actor, { mayCreateItem: false })
        say(`  ${number}: "${l.description}" matched to ${rule.item.name}`)
      }
    }
    inv = await find()
    if (!inv!.ordered) { await lib.markOrdered(st.accountId, inv!.id, actor); say(`  ${number}: We ordered this`) }
    else say(`  ${number}: already ordered, nothing to do`)
  }

  // What changed, from the database, against the dry run.
  say('\nRESULT (from the database)')
  let mismatch = 0
  for (const number of ORDER) {
    const inv = await prisma.vendorInvoice.findFirst({ where: { accountId: st.accountId, vendorId: st.vendor.id, invoiceKey: invoiceNumberKey(number), ordered: true }, include: { lines: { orderBy: { seq: 'asc' } } } })
    if (!inv) { say(`  ${number}: not ordered?`); mismatch++; continue }
    const hist = await prisma.priceHistory.findMany({ where: { invoiceId: inv.id, undoneAt: null }, orderBy: { createdAt: 'asc' } })
    say(`  ${number} (${inv.id}): ${inv.status}; estimated tax ${inv.estTaxBp != null ? `${pctText(inv.estTaxBp)} ${dollars(inv.estTaxCents)}` : 'none'}; bill ${inv.billId}`)
    for (const l of inv.lines) say(`     ${String(l.seq + 1).padStart(2)} ${l.description}: ${l.state}${l.inventoryName ? ` → ${l.inventoryName}` : ''}${l.unitLandedCents != null ? ` ${money(l.prevUnitCents)} → ${money(l.unitLandedCents)}` : ''} (extra ${dollars(l.extraCents ?? 0)}, estimated tax ${dollars(l.estTaxCents)})`)
    for (const h of hist) say(`     price history: ${h.inventoryItemId} ${money(h.prevUnitCents)} → ${money(h.unitLandedCents)}${h.changedInventory ? '' : ' (history only)'}`)
    const want = plans.get(number)
    for (const it of want?.items ?? []) {
      const got = inv.lines.find(l => l.inventoryItemId === it.itemId)
      if (!got || got.unitLandedCents !== it.next) { mismatch++; say(`     DIFFERS from the dry run: ${it.name} expected ${money(it.next)}, got ${money(got?.unitLandedCents)}`) }
    }
  }
  const vstate = await prisma.vendorState.findUnique({ where: { accountId: st.accountId }, select: { bills: true } })
  for (const b of arr(vstate?.bills).filter((x: any) => ORDER.includes(x?.billNumber))) say(`  bill ${b.billNumber}: total ${dollars(b.totalCents)}, freight ${dollars(b.freightCents ?? 0)}, fees ${dollars(b.feesCents ?? 0)} — ${b.notes}`)
  say(mismatch ? `\n${mismatch} difference(s) from the dry run: check above.` : '\nEverything matches the dry run.')
  if (mismatch) process.exitCode = 1
}

async function main() {
  const docs = await readDocs()
  const prisma = (await import('../src/server/lib/prisma.js')).default
  // Dry run (and the "before" of an apply): one read only transaction; a write would fail.
  const { st, out } = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only') as Array<{ transaction_read_only: string }>
    if (ro[0]?.transaction_read_only !== 'on') throw new Error('Could not make the transaction read only: stopped.')
    console.log(`(database "${dbName}": this transaction is read only)`)
    const st = await loadState(tx, args.includes('--account') ? args[args.indexOf('--account') + 1] : undefined)
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read only, nothing is changed)'}: Stephens quotes 06-251126 and 06-251608\n`)
    const out = await report(docs, st)
    return { st, out }
  }, { timeout: 60_000 })
  if (APPLY) await apply(docs, st, out.vs, out.plans)
  else console.log('\nNothing was changed. To apply: --apply (dev); live only after a backup and Jonathan\'s typed OK (see the top of this file).')
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.message ?? err); process.exit(1) })
