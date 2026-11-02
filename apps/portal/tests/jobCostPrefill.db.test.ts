/**
 * Job costing prefill and the Nov 2 2026 labor fix, on the dev database
 * (DEV_DB=1; refuses any other), in a throwaway account: real bills, a Sales
 * Order, a job lot invoice, and scripts/job-cost-labor-fix-2026-11-02.ts run for
 * real (dry run, apply, apply again). Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import path from 'path'
import { spawnSync } from 'child_process'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('job cost prefill (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { prefillFor } = await import('../src/server/lib/jobCostPrefill.js')
  const { default: jobCosting } = await import('../src/server/routes/job-costing.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const accountId = crypto.randomUUID()
  const quoteId = crypto.randomUUID(), jobId = crypto.randomUUID()
  const bare = crypto.randomUUID()
  const fixed = crypto.randomUUID(), crewed = crypto.randomUUID()
  const KV = 'fencepro_jobcosting'
  let userId = '', email = ''
  let base = ''
  let server: ReturnType<express.Express['listen']>
  const token = (role: string) => jwt.sign({ sub: userId, email, role, firstName: 'No', lastName: 'One', crmAccountId: accountId }, secret, { expiresIn: '10m' })
  const get = (role: string, p: string) => fetch(`${base}/api/job-costing${p}`, { headers: { Authorization: `Bearer ${token(role)}` } }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))

  const sold = (id: string, extra: Record<string, unknown> = {}) => prisma.savedQuote.create({ data: {
    id, accountId, customerName: 'E2E Job Cost Prefill', fenceStyle: "WV-ND 6'x8' Privacy", runs: [], sections: 10, materialCost: 4222.99, laborCost: 769, tearOutCost: 0,
    totalCOGS: 4991.99, finalPrice: 8914.27, gmPct: 0.35, pricing: { laborMode: 'subcontractor' }, status: 'SOLD', ...extra,
  } as any })
  const putBills = (bills: unknown[]) => prisma.vendorState.upsert({ where: { accountId }, create: { accountId, vendors: [], bills: bills as any, payments: [] }, update: { bills: bills as any } })
  const script = (...args: string[]) => spawnSync('pnpm', ['exec', 'tsx', 'scripts/job-cost-labor-fix-2026-11-02.ts', ...args], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' })
  const entries = async () => ((await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KV } } }))!.value as any[])

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    userId = user.id; email = user.email
    await prisma.crmAccount.create({ data: { id: accountId, name: 'E2E Job Cost Prefill' } })
    await sold(quoteId)
    await sold(bare, { laborCost: 500, materialCost: 1000, tearOutCost: 200 })
    await sold(fixed, { laborCost: 600, adjLaborHrs: 20 })
    await sold(crewed)
    await prisma.savedJob.create({ data: { id: jobId, accountId, quoteId, customerName: 'E2E Job Cost Prefill', status: 'completed' } as any })
    const app = express()
    app.use(express.json())
    app.use('/api/job-costing', jobCosting)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    await prisma.crmAuditLog.deleteMany({ where: { entityType: 'JobCosting', entityId: { in: ['old1', 'old2', 'old3', 'crew1'] } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.jobTakeoff.deleteMany({ where: { accountId } })
    await prisma.vendorInvoice.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.vendorState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.deleteMany({ where: { id: accountId } })
  })

  test('nothing on the job: the quote, in cents, and tear out and change orders beside it', async () => {
    const p = (await prefillFor(accountId, bare))!
    expect([p.jobId, p.sub, p.labor.cents, p.labor.source, p.material.cents, p.material.source, p.tearOutCents]).toEqual([null, true, 50000, 'quote', 100000, 'quote', 20000])
    expect(p.changeOrders).toEqual({ count: 0, priceCents: 0 })
  })

  test('a Sales Order on the job; a cancelled one does not count', async () => {
    await prisma.businessState.create({ data: { accountId, pendingOrders: [
      { id: 'o1', quoteId, jobId, status: 'pending', totalCostCents: 410000 },
      { id: 'o2', quoteId, jobId, status: 'cancelled', totalCostCents: 999999 },
      { id: 'o3', quoteId: 'another', jobId: 'another', status: 'ordered', totalCostCents: 777 },
    ] } as any })
    const p = (await prefillFor(accountId, quoteId))!
    expect([p.material.cents, p.material.source]).toEqual([410000, 'sales_order'])
  })

  test('bills on the job win over the Sales Order, not added; void, draft and other jobs do not count', async () => {
    await putBills([
      { id: 'b1', billNumber: 'M-1', jobId, category: 'materials', status: 'received', totalCents: 430000 },
      { id: 'b2', billNumber: 'M-2', jobId, category: 'materials', status: 'void', totalCents: 5 },
      { id: 'b3', billNumber: 'M-3', jobId: 'another', category: 'materials', status: 'paid', totalCents: 7 },
      { id: 'b4', billNumber: 'M-4', jobId, category: 'materials', status: 'draft', totalCents: 9 },
      { id: 'b5', billNumber: 'S-1', jobId, category: 'subcontractor', status: 'paid', totalCents: 80000 },
    ])
    const p = (await prefillFor(accountId, quoteId))!
    expect([p.material.cents, p.material.source, p.labor.cents, p.labor.source]).toEqual([430000, 'bills', 80000, 'bills'])
    expect(p.material.note).toMatch(/cannot tell/)
  })

  test('a job lot invoice and its own bill are one order, counted once', async () => {
    const billed = await prisma.vendorInvoice.create({ data: { id: crypto.randomUUID(), accountId, batchId: crypto.randomUUID(), status: 'applied', jobId, billId: 'b1', invoiceNumber: 'M-1', totalCents: 430000 } as any })
    expect((await prefillFor(accountId, quoteId))!.material.cents).toBe(430000)
    await prisma.vendorInvoice.create({ data: { id: crypto.randomUUID(), accountId, batchId: crypto.randomUUID(), status: 'applied', jobId, invoiceNumber: 'J-7', totalCents: 12500 } as any })
    expect((await prefillFor(accountId, quoteId))!.material.cents).toBe(442500)
    await prisma.vendorInvoice.deleteMany({ where: { accountId, id: { not: billed.id } } })
  })

  test('"Sub paid $" on the takeoff comes first; the bill is not added', async () => {
    await prisma.jobTakeoff.create({ data: { id: crypto.randomUUID(), accountId, jobId, quoteId, labor: { mode: 'sub', subUnit: 'section', subUnits: 10, subPaidCents: 77000, crew: [] } } })
    const p = (await prefillFor(accountId, quoteId))!
    expect([p.labor.cents, p.labor.source]).toEqual([77000, 'takeoff'])
    expect(p.labor.note).toMatch(/\$800\.00/)
  })

  test('the route: owner, office and Salesman see it; an installer is refused and gets no number', async () => {
    expect((await get('super_admin', `/prefill/${quoteId}`)).json.data.labor.cents).toBe(77000)
    expect((await get('office_staff', `/prefill/${quoteId}`)).status).toBe(200)
    const crew = await get('field_crew', `/prefill/${quoteId}`)
    expect(crew.status).toBe(403)
    expect(JSON.stringify(crew.json)).not.toMatch(/77000|cents/i)
    expect((await get('super_admin', `/prefill/${crypto.randomUUID()}`)).status).toBe(404)
    // Not the Salesman's quote: a 404, as every record out of scope.
    expect((await get('sales_rep', `/prefill/${quoteId}`)).status).toBe(404)
  })

  test('the fix: dry run changes nothing; apply writes only hours entries, with an audit entry each; run again changes nothing', async () => {
    const list = [
      { id: 'old1', quoteId: fixed, completionDate: '2026-10-01', actualLaborHrs: 30, crew: [], actualMaterialCost: 4000, actualOtherCosts: 10, notes: 'keep' }, // 30 x ($600 / 20) = $900 → $600
      { id: 'crew1', quoteId: crewed, completionDate: '2026-10-02', actualLaborHrs: 0, crew: [{ name: 'D', hours: 1, rate: 770 }], actualMaterialCost: 4000, actualOtherCosts: 0, notes: '' },
      { id: 'old2', quoteId, completionDate: '2026-10-03', actualLaborHrs: 2, crew: [], actualMaterialCost: 4000, actualOtherCosts: 0, notes: '', actualLaborCostCents: 12345, laborCostTyped: true },
      { id: 'old3', quoteId: crypto.randomUUID(), completionDate: '2026-10-04', actualLaborHrs: 2, crew: [], actualMaterialCost: 1, actualOtherCosts: 0, notes: '' }, // quote gone
    ]
    await prisma.accountKeyValue.create({ data: { accountId, key: KV, value: list } })
    const dry = script()
    expect(dry.status).toBe(0)
    expect(dry.stdout).toContain('labor $900.00 → $600.00')
    expect(dry.stdout).toMatch(/profit \$4,004\.27 \(44\.9%\) → \$4,304\.27 \(48\.3%\)/)
    expect(dry.stdout).toContain('Dry run: nothing changed.')
    expect(await entries()).toEqual(list)

    const applied = script('--apply')
    expect(applied.status).toBe(0)
    const after = await entries()
    expect(after[0]).toMatchObject({ actualLaborCostCents: 60000, laborCostTyped: false, laborKind: 'sub', actualMaterialCost: 4000, actualOtherCosts: 10, notes: 'keep', actualLaborHrs: 30 })
    expect(after[0].laborSource).toMatch(/Nov 2 2026 fix/)
    expect(after.slice(1)).toEqual(list.slice(1))
    expect(await prisma.crmAuditLog.count({ where: { entityType: 'JobCosting', entityId: 'old1' } })).toBe(1)
    expect(await prisma.crmAuditLog.count({ where: { entityType: 'JobCosting', entityId: 'crew1' } })).toBe(0)
    const version = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KV } } }))!.version

    expect(script('--apply').status).toBe(0)
    expect((await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: KV } } }))!.version).toBe(version)
    expect(await prisma.crmAuditLog.count({ where: { entityType: 'JobCosting', entityId: 'old1' } })).toBe(1)
  }, 120_000)
})
