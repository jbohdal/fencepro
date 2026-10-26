/**
 * Vendor invoices through the real routes, against the dev database (DEV_DB=1
 * and ezbiz_dev only; vitest does not load this file anywhere else). Files go
 * up the way the phone sends them (the photo upload: start, chunks, finish).
 *
 *   text PDF: new vendor → Needs a match → matched once (box of 100 → each)
 *     → applied at landed cost (tax and freight spread), bill in Vendors
 *   same file again → refused; same vendor and number, other file → refused
 *   price well over 20% → waits; the rest applies; office cannot OK; owner OKs
 *   a line that does not add up → nothing applied; fixed by tap → applied
 *   two photos of a two page invoice → one invoice, read and checked
 *   Undo → skips an item changed since; the later invoice's Undo puts it back
 *   landedCostOn by date; jobLotInvoiceLines (a fuel surcharge is on the bill only)
 *   Salesman: 403 and no data, everywhere
 *   Stephens quotes (Jonathan's PDFs, STEPHENS_DIR): no tax → estimated tax
 *   7.22%; fuel on the bill only; 06-251126 sent twice is one quote, its pipes
 *   match the dig set posts by his rule (Change match on a quote), "We
 *   ordered this" prices them; 06-251608: freight spread, Needs a match
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const canRead = process.platform === 'darwin' && (() => { try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }); return true } catch { return false } })()
const FIX = path.resolve(__dirname, 'fixtures/invoices')

describe.skipIf(!process.env.DEV_DB || !onDev || !canRead)('vendor invoices update Inventory prices (dev database)', () => {
  let prisma: any
  let lib: typeof import('../src/server/lib/vendorInvoices.js')
  let server: Server
  let base = ''
  let accountId = ''
  const tag = `inv-${Date.now().toString(36)}`
  type Who = 'owner' | 'office' | 'sales' | 'crew'
  const users: Record<string, { id: string; token: string }> = {}

  const call = (who: Who, method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  /** Send files as one invoice, the way the phone does (lib/mediaStore.ts). */
  async function upload(who: Who, files: string[], extra: Record<string, unknown> = {}): Promise<{ status: number; invoiceId?: string }> {
    const batch = crypto.randomUUID()
    let invoiceId: string | undefined
    for (const [seq, file] of files.entries()) {
      const bytes = fs.readFileSync(file)
      const clientId = crypto.randomUUID()
      const mime = file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
      const start = await call(who, 'POST', '/api/media/uploads', { clientId, size: bytes.length, meta: { kind: 'invoice', mime, invoiceBatch: batch, invoiceSeq: seq, invoicePages: files.length, fileName: path.basename(file), ...extra } })
      if (start.status !== 200) return { status: start.status }
      const put = await fetch(`${base}/api/media/uploads/${clientId}?offset=0`, { method: 'PUT', headers: { Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/octet-stream' }, body: bytes })
      expect(put.status).toBe(200)
      const fin = await call(who, 'POST', `/api/media/uploads/${clientId}/finish`)
      expect(fin.status).toBe(200)
      invoiceId = fin.json.data.id
    }
    await lib.readsSettled()
    return { status: 200, invoiceId }
  }
  const get = async (id: string) => (await call('owner', 'GET', `/api/vendor-invoices/${id}`)).json.data
  const items = async () => {
    const s = await prisma.inventoryState.findUnique({ where: { accountId } })
    return { version: s.version, byId: new Map((s.items as any[]).map(i => [i.id, i])) }
  }
  const cost = async (id: string) => Math.round(Number((await items()).byId.get(id).unitCost) * 100)
  const lineBy = (inv: any, code: string) => inv.lines.find((l: any) => l.itemNumber === code)

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    lib = await import('../src/server/lib/vendorInvoices.js')
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    const roles: Record<Who, string> = { owner: 'super_admin', office: 'office_staff', sales: 'sales_rep', crew: 'field_crew' }
    for (const [who, role] of Object.entries(roles) as [Who, string][]) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${who}@example.test`, firstName: 'Test', lastName: who, role, status: 'active', crmAccountId: accountId, mustChangePassword: false } })
      users[who] = { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role, firstName: 'Test', lastName: who, crmAccountId: accountId }, secret, { expiresIn: '30m' }) }
    }
    // Made up test prices (this test's own company), close to the invoice so most changes are under 20%.
    await prisma.inventoryState.create({ data: { accountId, bundles: [], locations: [], stockLevels: [], transactions: [], items: [
      { id: 't-hog', name: 'Hog Ring, Alum', unitCost: 0.27, category: 'Chainlink Galv', unitOfMeasure: 'each', priceUpdatedAt: '2026-03-01' },
      { id: 't-tb48', name: 'G, Tension Bar, 48"', unitCost: 3.00, category: 'Chainlink Galv', unitOfMeasure: 'each', priceImported: true },
      { id: 't-pipe', name: 'Pipe, Galv, 2-1/2" X 8\' (SS40)', unitCost: 28.13, category: 'Chainlink Galv', unitOfMeasure: 'each' },
      { id: 't-fab', name: 'Fabric, Galv, 48" KK (11.5)', unitCost: 113.43, category: 'Chainlink Galv', unitOfMeasure: 'roll' },
    ] } })
    await prisma.businessState.create({ data: { accountId, config: { pricing: {} } } })
    await prisma.savedJob.create({ data: { id: `${tag}-job`, accountId, customerName: 'Test Customer', fenceStyle: 'Chain link' } })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/media', (await import('../src/server/routes/media.js')).default)
    app.use('/api/vendor-invoices', (await import('../src/server/routes/vendor-invoices.js')).default)
    app.use('/api/vendor-state', (await import('../src/server/routes/vendors-state.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }, 60_000)

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const ids = (await prisma.vendorInvoice.findMany({ where: { accountId }, select: { id: true } })).map((i: any) => i.id)
    await prisma.vendorInvoice.deleteMany({ where: { id: { in: ids } } })
    for (const m of ['priceHistory', 'vendorItemLink', 'vendorInvoiceFile', 'mediaUpload', 'mediaItem', 'savedJob', 'businessState', 'inventoryState', 'vendorState']) {
      await prisma[m].deleteMany({ where: { accountId } }).catch((e: unknown) => console.error(`[invoices test] ${m} cleanup:`, e))
    }
    fs.rmSync(path.resolve(process.env.UPLOAD_DIR || './uploads', 'invoices', accountId), { recursive: true, force: true })
    const userIds = Object.values(users).map(u => u.id)
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { id: { in: userIds } } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  }, 60_000)

  let textId = ''
  let vendorId = ''

  test('salesman and installer: 403 and nothing, on every invoice route and on upload', async () => {
    for (const who of ['sales', 'crew'] as Who[]) {
      for (const p of ['/api/vendor-invoices', '/api/vendor-invoices/waiting', '/api/vendor-invoices/needs-match', '/api/vendor-invoices/history', '/api/vendor-invoices/vendors-by-month', '/api/vendor-invoices/x']) {
        const r = await call(who, 'GET', p)
        expect(r.status).toBe(403)
        expect(r.json.code).toBe('NOT_ALLOWED')
        expect(r.json.data).toBeUndefined()
      }
      const up = await upload(who, [path.join(FIX, 'text.pdf')])
      expect(up.status).toBe(403)
    }
    expect(await prisma.vendorInvoice.count({ where: { accountId } })).toBe(0)
  })

  test('text PDF: a new vendor is asked once, then each new item waits for a match; nothing applied yet', async () => {
    const before = await items()
    const up = await upload('office', [path.join(FIX, 'text.pdf')])
    textId = up.invoiceId!
    let inv = await get(textId)
    expect(inv.status).toBe('needs_review')
    expect(inv.problems).toEqual([{ kind: 'new_vendor', name: 'GULF COAST FENCE SUPPLY' }])
    expect(inv).toMatchObject({ invoiceNumber: 'GC-10442', invoiceDate: '2026-10-02', subtotalCents: 100000, taxCents: 7000, freightCents: 5000, totalCents: 112000, engine: 'pdf-text' })
    const ok = await call('office', 'PATCH', `/api/vendor-invoices/${textId}`, { newVendorName: 'Gulf Coast Fence Supply' })
    expect(ok.status).toBe(200)
    inv = await get(textId)
    expect(inv.status).toBe('needs_match')
    expect(inv.lines.map((l: any) => l.state)).toEqual(['needs_match', 'needs_match', 'needs_match', 'needs_match'])
    // Landed cost is worked out for every line: $1,000 subtotal, $120 tax and freight.
    expect(inv.lines.map((l: any) => l.extraCents)).toEqual([1200, 2160, 3360, 5280])
    expect((await items()).version).toBe(before.version)
    // The bill is in Vendors.
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    vendorId = (vs.vendors as any[])[0].id
    expect((vs.bills as any[])[0]).toMatchObject({ vendorName: 'Gulf Coast Fence Supply', billNumber: 'GC-10442', billDate: '2026-10-02', totalCents: 112000, taxCents: 7000, freightCents: 5000, invoiceId: textId })
    const nm = await call('office', 'GET', '/api/vendor-invoices/needs-match')
    expect(nm.json.data).toHaveLength(4)
    expect(nm.json.data.find((l: any) => l.itemNumber === 'TB-48G').suggestions[0].id).toBe('t-tb48')
  }, 120_000)

  test('matched once (box of 100 → each): applied at landed cost, price confirmed on the invoice date', async () => {
    let inv = await get(textId)
    const m = (code: string, body: any) => call('office', 'POST', `/api/vendor-invoices/lines/${lineBy(inv, code).id}/match`, body)
    expect((await m('HR-100', { inventoryItemId: 't-hog', vendorPer: 1, invPer: 100 })).status).toBe(200)
    // $100 + $12 = $112 for 400 rings: $0.28 each (was $0.27).
    expect(await cost('t-hog')).toBe(28)
    inv = await get(textId)
    expect(inv.status).toBe('needs_match')
    expect((await m('TB-48G', { inventoryItemId: 't-tb48' })).status).toBe(200)
    expect((await m('PP-258', { inventoryItemId: 't-pipe' })).status).toBe(200)
    // The office may not add an Inventory item.
    const made = await m('FAB-48K', { newItem: { name: 'Fabric roll test' } })
    expect(made.status).toBe(403)
    expect((await m('FAB-48K', { inventoryItemId: 't-fab' })).status).toBe(200)
    inv = await get(textId)
    expect(inv.status).toBe('applied')
    const { byId } = await items()
    expect(byId.get('t-tb48')).toMatchObject({ unitCost: 3.36, priceUpdatedAt: '2026-10-02', priceImported: false }) // (180 + 21.60) / 60
    expect(byId.get('t-pipe').unitCost).toBe(31.36) // (280 + 33.60) / 10
    expect(byId.get('t-fab').unitCost).toBe(123.2) // (440 + 52.80) / 4
    const hist = await prisma.priceHistory.findMany({ where: { invoiceId: textId } })
    expect(hist).toHaveLength(4)
    expect(hist.find((h: any) => h.inventoryItemId === 't-tb48')).toMatchObject({ vendorId, day: '2026-10-02', unitLandedCents: 336, prevUnitCents: 300, prevPriceImported: true })
  }, 120_000)

  test('the same file again is refused; the same vendor and number in another file is refused', async () => {
    const before = await items()
    const again = await upload('office', [path.join(FIX, 'text.pdf')])
    const a = await get(again.invoiceId!)
    expect(a.status).toBe('refused')
    expect(a.message).toMatch(/already uploaded/)
    const copy = await upload('office', [path.join(FIX, 'text-again.pdf')])
    const c = await get(copy.invoiceId!)
    expect(c.status).toBe('refused')
    expect(c.message).toMatch(/GC-10442 from Gulf Coast Fence Supply .*was already uploaded/)
    expect((await items()).version).toBe(before.version)
  }, 120_000)

  let jumpId = ''
  test('a price well over 20% waits for an OK; the rest of the invoice applies; only the owner may OK', async () => {
    const up = await upload('office', [path.join(FIX, 'jump.pdf')])
    jumpId = up.invoiceId!
    const inv = await get(jumpId)
    expect(inv.status).toBe('applied')
    const tb = lineBy(inv, 'TB-48G')
    expect(tb.state).toBe('waiting_ok')
    expect(tb.changePct).toBeCloseTo(30.95, 1)
    expect(lineBy(inv, 'HR-100').state).toBe('applied')
    expect(await cost('t-tb48')).toBe(336)
    expect(await cost('t-hog')).toBe(25)
    const waiting = await call('office', 'GET', '/api/vendor-invoices/waiting')
    expect(waiting.json.data.map((l: any) => l.id)).toEqual([tb.id])
    const office = await call('office', 'POST', `/api/vendor-invoices/lines/${tb.id}/ok`)
    expect(office.status).toBe(403)
    expect(await cost('t-tb48')).toBe(336)
    const owner = await call('owner', 'POST', `/api/vendor-invoices/lines/${tb.id}/ok`)
    expect(owner.status).toBe(200)
    expect(await cost('t-tb48')).toBe(440)
    expect((await get(jumpId)).lines.every((l: any) => l.state === 'applied')).toBe(true)
  }, 120_000)

  let badId = ''
  test('a line that does not add up: nothing is applied; fixed by tap, it applies', async () => {
    const before = await items()
    const up = await upload('office', [path.join(FIX, 'bad-line.pdf')])
    badId = up.invoiceId!
    let inv = await get(badId)
    expect(inv.status).toBe('needs_review')
    expect(inv.problems).toEqual([{ kind: 'unclear_lines', lines: [1] }])
    expect(lineBy(inv, 'TB-48G').problems).toEqual(['math'])
    expect((await items()).version).toBe(before.version)
    expect(await prisma.priceHistory.count({ where: { invoiceId: badId } })).toBe(0)
    // Changing the amount to 60 x $3.00 makes the line right but the lines miss the subtotal: still nothing.
    await call('office', 'PATCH', `/api/vendor-invoices/${badId}/lines/${lineBy(inv, 'TB-48G').id}`, { totalCents: 18000 })
    inv = await get(badId)
    expect(inv.status).toBe('needs_review')
    expect(inv.problems.map((p: any) => p.kind)).toEqual(['subtotal'])
    // Checked against the paper: the amount $210.00 is right (the price was $3.50).
    await call('office', 'PATCH', `/api/vendor-invoices/${badId}/lines/${lineBy(inv, 'TB-48G').id}`, { totalCents: 21000, unitPriceHc: 35000 })
    inv = await get(badId)
    expect(inv.status).toBe('applied')
    // $210 + $14.70 tax share = $224.70 / 60 = $3.745 → $3.75 (down from $4.40: 14.8%, under 20%).
    expect(await cost('t-tb48')).toBe(375)
    expect(await cost('t-hog')).toBe(27) // ($100 + $7.00) / 400 = $0.2675
  }, 120_000)

  test('Undo: an item changed since is skipped and said so; the later invoice\'s Undo puts the price back', async () => {
    const r1 = await call('owner', 'POST', `/api/vendor-invoices/${jumpId}/undo`)
    expect(r1.status).toBe(200)
    expect(r1.json.data.restored).toEqual([])
    expect(r1.json.data.skipped.map((s: any) => s.name).sort()).toEqual(['G, Tension Bar, 48"', 'Hog Ring, Alum'])
    expect(await cost('t-tb48')).toBe(375)
    const office = await call('office', 'POST', `/api/vendor-invoices/${badId}/undo`)
    expect(office.status).toBe(403)
    const r2 = await call('owner', 'POST', `/api/vendor-invoices/${badId}/undo`)
    expect(r2.status).toBe(200)
    expect(r2.json.data.skipped).toEqual([])
    // Back to what the jump invoice set: $4.40 and $0.25, with that invoice's date.
    const { byId } = await items()
    expect(byId.get('t-tb48')).toMatchObject({ unitCost: 4.4, priceUpdatedAt: '2026-10-15' })
    expect(byId.get('t-hog')).toMatchObject({ unitCost: 0.25, priceUpdatedAt: '2026-10-15' })
    expect((await get(badId)).status).toBe('undone')
    // A price changed by hand since is never overwritten by Undo.
    const s = await prisma.inventoryState.findUnique({ where: { accountId } })
    await prisma.inventoryState.update({ where: { accountId }, data: { items: (s.items as any[]).map(i => (i.id === 't-pipe' ? { ...i, unitCost: 30 } : i)), version: { increment: 1 } } })
    const r3 = await call('owner', 'POST', `/api/vendor-invoices/${textId}/undo`)
    expect(r3.json.data.skipped.map((x: any) => x.name)).toContain('Pipe, Galv, 2-1/2" X 8\' (SS40)')
    expect(await cost('t-pipe')).toBe(3000)
    expect(await cost('t-fab')).toBe(11343)
  }, 120_000)

  test('two photos of a two page invoice are one invoice, linked to a job', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inv2-'))
    try {
      const { readerBinary } = await import('../src/server/lib/invoiceReader.js')
      execFileSync(await readerBinary(), [path.join(FIX, 'two-page.pdf'), out])
      const up = await upload('office', [path.join(out, 'page-1.jpg'), path.join(out, 'page-2.jpg')], { invoiceJobId: `${tag}-job` })
      const inv = await get(up.invoiceId!)
      expect(inv.pageCount).toBe(2)
      expect(inv.engine).toBe('vision')
      expect(inv.lines).toHaveLength(9)
      expect(inv).toMatchObject({ invoiceNumber: 'GC-10518', vendorName: 'Gulf Coast Fence Supply', totalCents: 97019, feesCents: 750, jobId: `${tag}-job` })
      expect(inv.status).toBe('applied')
      // A job lot order: items not seen before are not asked about; matched ones still update.
      expect(lineBy(inv, 'TP-158').state).toBe('skipped')
      expect(lineBy(inv, 'TB-48G').state).toBe('applied')
      const { jobLotInvoiceLines } = await import('../src/server/lib/priceHistory.js')
      const lines = await jobLotInvoiceLines(accountId, `${tag}-job`)
      expect(lines).toHaveLength(9)
      // Lines + tax + freight; the $7.50 fuel surcharge is on the bill only, never in a price (Jonathan, Oct 2026).
      expect(lines.reduce((s, l) => s + l.landedCents, 0)).toBe(97019 - 750)
      expect((await prisma.vendorState.findUnique({ where: { accountId } })).bills.find((b: any) => b.billNumber === 'GC-10518')).toMatchObject({ totalCents: 97019, feesCents: 750 })
    } finally { fs.rmSync(out, { recursive: true, force: true }) }
  }, 180_000)

  test('landedCostOn: the price paid on or before a day, else Inventory', async () => {
    const { landedCostOn } = await import('../src/server/lib/priceHistory.js')
    // Undone invoices are left out; the two page photos (Oct 9) set tension bars.
    const oct9 = await landedCostOn(accountId, 't-tb48', '2026-10-09')
    expect(oct9?.source).toBe('invoice')
    const early = await landedCostOn(accountId, 't-tb48', '2026-01-01')
    expect(early).toEqual({ cents: await cost('t-tb48'), source: 'inventory' })
    expect(await landedCostOn(accountId, 'nope', '2026-10-09')).toBeNull()
  })

  test('vendors with totals by month, and the price history list', async () => {
    const r = await call('office', 'GET', '/api/vendor-invoices/vendors-by-month?months=3')
    const row = r.json.data.rows.find((x: any) => x.name === 'Gulf Coast Fence Supply')
    // GC-10442, GC-10701, GC-10600 and GC-10518 are all October bills.
    expect(row.byMonth['2026-10']).toBe(112000 + 54000 + 33170 + 97019)
    const h = await call('office', 'GET', '/api/vendor-invoices/history?itemId=t-tb48')
    expect(h.json.data.length).toBeGreaterThanOrEqual(4)
    // An installer's vendor state has no bills.
    const vs = await call('crew', 'GET', '/api/vendor-state')
    expect(vs.json.data.bills).toEqual([])
  })


  // ── Jonathan's real quotations (Stephens Pipe & Steel), read from his folder (STEPHENS_DIR to use
  //    another one); each test is skipped when its PDF is not there ──
  const SPS = process.env.STEPHENS_DIR || '/Users/jonathanbohdal/Downloads/stephens pipe and steel'
  const spsName = (start: string, id: string) => (fs.existsSync(SPS) ? fs.readdirSync(SPS).find(f => f.startsWith(start) && f.includes(id)) : undefined)
  const sps = (start: string, id: string) => path.join(SPS, spsName(start, id)!)
  const has = (...files: Array<[string, string]>) => files.every(([s, i]) => !!spsName(s, i))
  let newestId = ''
  /** The first Stephens document makes the vendor (once), the way the office does. */
  async function stephensVendor(id: string) {
    const q = await get(id)
    if (q.problems.some((p: any) => p.kind === 'new_vendor')) {
      const vs = await prisma.vendorState.findUnique({ where: { accountId } })
      const have = (vs?.vendors as any[] | undefined)?.find(v => /stephens/i.test(v.name))
      await call('office', 'PATCH', `/api/vendor-invoices/${id}`, have ? { vendorId: have.id } : { newVendorName: 'Stephens Pipe & Steel' })
    }
    return get(id)
  }

  test.skipIf(!has(['6188237', '1158561'], ['6188237', '1158567']))('a quotation is saved as a vendor quote: no bill, no price changes; a newer revision replaces the older', async () => {
    const before = await items()
    const older = await upload('office', [sps('6188237', '1158561')])
    let o = await get(older.invoiceId!)
    expect(o).toMatchObject({ docType: 'quote', status: 'needs_review', invoiceNumber: '06-188237', invoiceDate: '2026-06-18', revision: '1158561' })
    expect(o.problems).toEqual([{ kind: 'new_vendor', name: 'Stephens Pipe & Steel, LLC' }])
    o = await stephensVendor(older.invoiceId!)
    expect(o.status).toBe('quote')
    expect(o.billId).toBeNull()
    const newer = await upload('office', [sps('6188237', '1158567')])
    const n = await get(newer.invoiceId!)
    expect(n.status).toBe('quote')
    o = await get(older.invoiceId!)
    expect(o).toMatchObject({ status: 'replaced', replacedById: newer.invoiceId })
    expect((await items()).version).toBe(before.version)
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    expect((vs.bills as any[]).some(b => b.billNumber === '06-188237')).toBe(false)
  }, 120_000)

  test.skipIf(!has(['6249853', '1429376']))('no tax line: estimated tax 7.22%, flagged, no waiting; matching a quote line shows the price and changes nothing; the same file again is refused', async () => {
    const before = await items()
    const up = await upload('office', [sps('6249853', '1429376')])
    newestId = up.invoiceId!
    const q0 = await stephensVendor(newestId)
    expect(q0.problems).toEqual([])
    expect(q0).toMatchObject({ status: 'quote', taxFound: false, taxOk: false, estTaxBp: 722, estTaxCents: 19929 }) // $2,760.27 x 7.22% = $199.2915
    expect(q0.counts.needsMatch).toBe(22)
    // Fuel ($25) is not spread: the extras are exactly the estimated tax.
    expect(q0.lines.reduce((s: number, l: any) => s + l.extraCents, 0)).toBe(19929)
    expect(q0.lines.every((l: any) => l.extraCents === l.estTaxCents)).toBe(true)
    // Fabric: 300 ft at 50 ft a roll.
    const fab = q0.lines.find((l: any) => l.unit === 'FT')
    expect((await call('office', 'POST', `/api/vendor-invoices/lines/${fab.id}/match`, { inventoryItemId: 't-fab', vendorPer: 50, invPer: 1 })).status).toBe(200)
    const q = await get(newestId)
    const f2 = q.lines.find((l: any) => l.id === fab.id)
    expect(f2.state).toBe('quoted')
    expect(f2.invQty).toBe(6)
    expect(f2.stateNote).toMatch(/estimated tax \(7\.22%\)/)
    expect((await items()).version).toBe(before.version)
    expect(await prisma.priceHistory.count({ where: { invoiceId: newestId } })).toBe(0)
    // 06-249853 again: refused, nothing changed.
    const again = await upload('office', [sps('6249853', '1429376')])
    expect(await get(again.invoiceId!)).toMatchObject({ status: 'refused', duplicateOfId: newestId })
    expect((await get(again.invoiceId!)).message).toMatch(/already uploaded/)
  }, 120_000)

  test.skipIf(!has(['6249853', '1429376']))('"We ordered this": only the owner; then it is the invoice (bill with the fuel, landed price with estimated tax and no fuel)', async () => {
    // The owner adds hog rings as a new Inventory item: sold by the lb, 220 rings a lb.
    const hog = (await get(newestId)).lines.find((l: any) => l.unit === 'LB')
    expect((await call('owner', 'POST', `/api/vendor-invoices/lines/${hog.id}/match`, { newItem: { name: `${tag} hog ring` }, vendorPer: 1, invPer: 220 })).status).toBe(200)
    const hogItem = [...(await items()).byId.values()].find((i: any) => i.name === `${tag} hog ring`)
    expect(hogItem.unitCost).toBe(0)
    expect((await call('office', 'POST', `/api/vendor-invoices/${newestId}/ordered`)).status).toBe(403)
    expect((await call('owner', 'POST', `/api/vendor-invoices/${newestId}/ordered`)).status).toBe(200)
    const q = await get(newestId)
    expect(q.ordered).toBe(true)
    expect(q.status).toBe('needs_match')
    // 5 lb x 220 = 1,100 rings: ($65.86 + its share of the estimated tax, no fuel) / 1,100.
    const h = q.lines.find((l: any) => l.unit === 'LB')
    expect(h.state).toBe('applied')
    expect(h.extraCents).toBe(h.estTaxCents)
    expect(h.estTaxCents).toBe(476) // its share of $199.29 by amount: 6586 / 276027
    expect(await cost(hogItem.id)).toBe(Math.floor((6586 + 476) / 1100 + 0.5))
    // Fabric already has a newer price (Oct 9): this Oct 6 order goes into price history only.
    const f = q.lines.find((l: any) => l.unit === 'FT')
    expect(f.stateNote).toMatch(/price history only/)
    expect(await cost('t-fab')).toBe(12214) // the Oct 9 price, without that invoice's fuel surcharge
    expect(await prisma.priceHistory.count({ where: { invoiceId: newestId, inventoryItemId: 't-fab', changedInventory: false } })).toBe(1)
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    const bill = (vs.bills as any[]).find(b => b.billNumber === '06-249853')
    expect(bill).toMatchObject({ totalCents: 278527, feesCents: 2500, estTaxCents: 19929 })
    expect(bill.notes).toMatch(/Fuel Charge \$25\.00 \(on this bill only, not in item prices\)/)
    expect(bill.notes).toMatch(/estimated tax 7\.22% \(\$199\.29\)/)
  }, 120_000)

  // 06-251126 (Oct 19), sent twice; the dig set post pipes by Jonathan's rule.
  const DS = [
    { desc: 'PLY BLK 1-5/8" x 6\' x PP055', id: 't-ds-b4l', landed: 1174 },
    { desc: 'PLY BLK 1-5/8" x 7\' x PP055', id: 't-ds-b5l', landed: 1370 },
    { desc: 'PLY BLK 2-1/2" x 6\' x PP055', id: 't-ds-b4t', landed: 1694 },
    { desc: 'PLY BLK 2-1/2" x 7\' x PP055', id: 't-ds-b5t', landed: 1977 },
    { desc: '1-5/8" GALV x 6\' x 18ga-SPS', id: 't-ds-g4l', landed: 703 },
    { desc: '1-5/8" GALV x 7\' x 18ga-SPS', id: 't-ds-g5l', landed: 819 },
    { desc: '2-1/2" GALV x 6\' x 18ga-SPS', id: 't-ds-g4t', landed: 1013 },
    { desc: '2-1/2" GALV x 7\' x 18ga-SPS', id: 't-ds-g5t', landed: 1182 },
  ]
  test.skipIf(!has(['6251126', '1464095'], ['6251126', '1466412']))('06-251126 sent twice is one quote; its pipes match the dig set posts by the rule; "We ordered this" prices them with estimated tax, fuel on the bill only', async () => {
    // The dig set post parts, as on live: black typed by hand from this quote on Oct 20, galvanized not priced.
    const s = await prisma.inventoryState.findUnique({ where: { accountId } })
    const { digSetPipeFor } = await import('../src/server/lib/digSetPipeMatch.js')
    const typed: Record<string, number> = { 't-ds-b4l': 10.96, 't-ds-b5l': 12.78, 't-ds-b4t': 15.8, 't-ds-b5t': 18.43 }
    await prisma.inventoryState.update({ where: { accountId }, data: { version: { increment: 1 }, items: [...(s.items as any[]), ...DS.map(d => ({
      id: d.id, name: digSetPipeFor(d.desc)!.part, category: 'Chainlink', status: 'active', unitCost: typed[d.id] ?? 0, ...(typed[d.id] ? { priceUpdatedAt: '2026-10-20', priceImported: false } : {}),
    }))] } })
    const first = await upload('office', [sps('6251126', '1464095')])
    let q = await stephensVendor(first.invoiceId!)
    expect(q).toMatchObject({ status: 'quote', invoiceNumber: '06-251126', revision: '1464095', estTaxBp: 722, estTaxCents: 669, freightCents: 0 })
    expect(q.fees).toEqual([expect.objectContaining({ label: 'Fuel Charge', cents: 2500 })])
    // The other file of the same quote: refused as the same document (not a newer revision).
    const second = await upload('office', [sps('6251126', '1466412')])
    expect(await get(second.invoiceId!)).toMatchObject({ status: 'refused', duplicateOfId: first.invoiceId })
    expect((await get(second.invoiceId!)).message).toMatch(/same quote 06-251126 .*same date, lines and total/)
    expect((await get(first.invoiceId!)).status).toBe('quote')
    // As happened on live: the first pipe was marked "Not an Inventory item"; Change match puts it right.
    const lineOf = (d: string) => q.lines.find((l: any) => l.description === d)
    expect((await call('office', 'POST', `/api/vendor-invoices/lines/${lineOf(DS[0].desc).id}/match`, { notInventory: true })).status).toBe(200)
    q = await get(first.invoiceId!)
    expect(lineOf(DS[0].desc).state).toBe('skipped')
    // Needs a match suggests the rule's part first, and says why; each tap uses it.
    const nm = (await call('office', 'GET', '/api/vendor-invoices/needs-match')).json.data.filter((l: any) => l.invoice.id === first.invoiceId)
    expect(nm).toHaveLength(7)
    for (const l of nm) {
      const d = DS.find(x => x.desc === l.description)!
      expect(l.suggestions[0]).toMatchObject({ id: d.id, why: expect.stringMatching(/^Jonathan's rule: [67] ft long = [45] ft tall dig set/) })
      expect((await call('office', 'POST', `/api/vendor-invoices/lines/${l.id}/match`, { inventoryItemId: l.suggestions[0].id, vendorPer: 1, invPer: 1 })).status).toBe(200)
    }
    const sug = (await call('office', 'GET', `/api/vendor-invoices/lines/${lineOf(DS[0].desc).id}/suggestions`)).json.data
    expect(sug[0].id).toBe('t-ds-b4l')
    expect((await call('office', 'POST', `/api/vendor-invoices/lines/${lineOf(DS[0].desc).id}/match`, { inventoryItemId: 't-ds-b4l', vendorPer: 1, invPer: 1 })).status).toBe(200)
    q = await get(first.invoiceId!)
    expect(q.lines.map((l: any) => [l.state, l.inventoryItemId, l.unitLandedCents])).toEqual(DS.map(d => ['quoted', d.id, d.landed]))
    expect(await cost('t-ds-g4l')).toBe(0)
    // We ordered this: every price applied, black too (its Oct 20 price was this quote's own, typed by hand).
    expect((await call('owner', 'POST', `/api/vendor-invoices/${first.invoiceId}/ordered`)).status).toBe(200)
    q = await get(first.invoiceId!)
    expect(q.status).toBe('applied')
    for (const d of DS) expect(await cost(d.id)).toBe(d.landed)
    expect(q.lines.map((l: any) => l.prevUnitCents)).toEqual([1096, 1278, 1580, 1843, null, null, null, null])
    expect(q.lines.every((l: any) => l.extraCents === l.estTaxCents && l.estTaxCents > 0)).toBe(true)
    expect(q.lines[0].stateNote).toMatch(/\$10\.96 → \$11\.74\. Includes estimated tax \(7\.22%\)/)
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    expect((vs.bills as any[]).find(b => b.billNumber === '06-251126')).toMatchObject({ totalCents: 11763, feesCents: 2500, estTaxCents: 669 })
    // Once priced, a match can no longer be changed.
    expect((await call('office', 'POST', `/api/vendor-invoices/lines/${q.lines[0].id}/match`, { inventoryItemId: 't-ds-b5l' })).status).toBe(409)
    // The same file a third time: refused.
    const third = await upload('office', [sps('6251126', '1464095')])
    expect((await get(third.invoiceId!)).message).toMatch(/already uploaded/)
  }, 180_000)

  test.skipIf(!has(['6251608', '1473958']))('06-251608 (green chain link): freight $125 spread over its lines, fuel on the bill only, estimated tax; every line waits in Needs a match; no price changes', async () => {
    const before = await items()
    const up = await upload('office', [sps('6251608', '1473958')])
    let q = await stephensVendor(up.invoiceId!)
    expect(q).toMatchObject({ status: 'quote', subtotalCents: 187160, freightCents: 12500, feesCents: 2500, totalCents: 202160, estTaxBp: 722, estTaxCents: 13513 })
    expect(q.lines).toHaveLength(22)
    expect((await call('owner', 'POST', `/api/vendor-invoices/${up.invoiceId}/ordered`)).status).toBe(200)
    q = await get(up.invoiceId!)
    expect(q.status).toBe('needs_match')
    expect(q.lines.every((l: any) => l.state === 'needs_match')).toBe(true)
    // Freight + estimated tax on the lines, to the cent; the $25 fuel is not.
    expect(q.lines.reduce((s: number, l: any) => s + l.extraCents, 0)).toBe(12500 + 13513)
    expect(q.lines.reduce((s: number, l: any) => s + l.estTaxCents, 0)).toBe(13513)
    expect(q.lines[0]).toMatchObject({ description: 'VNL Ext GRN 2x9(13core)x48in KK 50ft/rll', extraCents: 2321 + 2509 })
    expect((await items()).version).toBe(before.version)
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    expect((vs.bills as any[]).find(b => b.billNumber === '06-251608')).toMatchObject({ totalCents: 202160, freightCents: 12500, feesCents: 2500 })
    const nm = (await call('office', 'GET', '/api/vendor-invoices/needs-match')).json.data.filter((l: any) => l.invoice.id === up.invoiceId)
    expect(nm).toHaveLength(22)
  }, 120_000)
})
