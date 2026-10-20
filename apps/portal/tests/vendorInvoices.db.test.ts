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
 *   landedCostOn by date; jobLotInvoiceLines
 *   Salesman: 403 and no data, everywhere
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
    expect(c.message).toMatch(/GC-10442 from Gulf Coast Fence Supply was already uploaded/)
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
      expect(lines.reduce((s, l) => s + l.landedCents, 0)).toBe(97019 - 0) // lines + tax + freight + fees
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
    // A salesman's vendor state has no bills.
    const vs = await call('sales', 'GET', '/api/vendor-state')
    expect(vs.json.data.bills).toEqual([])
  })

  // ── Jonathan's real quotations (Stephens Pipe & Steel), read from his folder; skipped when it is not here ──
  const SPS = '/Users/jonathanbohdal/Downloads/stephens pipe and steel'
  const sps = (start: string, id: string) => path.join(SPS, fs.readdirSync(SPS).find(f => f.startsWith(start) && f.includes(id))!)
  const hasSps = fs.existsSync(SPS)
  let newestId = ''

  test.skipIf(!hasSps)('a quotation is saved as a vendor quote: no bill, no price changes; a newer revision replaces the older', async () => {
    const before = await items()
    const older = await upload('office', [sps('6188237', '1158561')])
    let o = await get(older.invoiceId!)
    expect(o).toMatchObject({ docType: 'quote', status: 'needs_review', invoiceNumber: '06-188237', invoiceDate: '2026-06-18', revision: '1158561' })
    expect(o.problems).toEqual([{ kind: 'new_vendor', name: 'Stephens Pipe & Steel, LLC' }])
    await call('office', 'PATCH', `/api/vendor-invoices/${older.invoiceId}`, { newVendorName: 'Stephens Pipe & Steel' })
    o = await get(older.invoiceId!)
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

  test.skipIf(!hasSps)('no tax line: waits for an OK; matching a quote line shows the price and changes nothing', async () => {
    const before = await items()
    const up = await upload('office', [sps('6249853', '1429376')])
    newestId = up.invoiceId!
    let q = await get(newestId)
    expect(q.problems).toEqual([{ kind: 'no_tax' }])
    expect(q.status).toBe('needs_review')
    await call('office', 'PATCH', `/api/vendor-invoices/${newestId}`, { taxOk: true })
    q = await get(newestId)
    expect(q.status).toBe('quote')
    expect(q.counts.needsMatch).toBe(22)
    // Fabric: 300 ft at 50 ft a roll.
    const fab = q.lines.find((l: any) => l.unit === 'FT')
    expect((await call('office', 'POST', `/api/vendor-invoices/lines/${fab.id}/match`, { inventoryItemId: 't-fab', vendorPer: 50, invPer: 1 })).status).toBe(200)
    q = await get(newestId)
    const f2 = q.lines.find((l: any) => l.id === fab.id)
    expect(f2.state).toBe('quoted')
    expect(f2.invQty).toBe(6)
    expect((await items()).version).toBe(before.version)
    expect(await prisma.priceHistory.count({ where: { invoiceId: newestId } })).toBe(0)
  }, 120_000)

  test.skipIf(!hasSps)('"We ordered this": only the owner; then it is the invoice (bill, landed price)', async () => {
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
    // 5 lb x 220 = 1,100 rings: ($65.86 + its share of the $25 fuel charge) / 1,100.
    const h = q.lines.find((l: any) => l.unit === 'LB')
    expect(h.state).toBe('applied')
    expect(await cost(hogItem.id)).toBe(Math.floor((6586 + h.extraCents) / 1100 + 0.5))
    // Fabric already has a newer price (Oct 9): this Oct 6 order goes into price history only.
    const f = q.lines.find((l: any) => l.unit === 'FT')
    expect(f.stateNote).toMatch(/price history only/)
    expect(await cost('t-fab')).toBe(12309)
    expect(await prisma.priceHistory.count({ where: { invoiceId: newestId, inventoryItemId: 't-fab', changedInventory: false } })).toBe(1)
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    expect((vs.bills as any[]).find(b => b.billNumber === '06-249853')).toMatchObject({ totalCents: 278527, feesCents: 2500 })
  }, 120_000)
})
