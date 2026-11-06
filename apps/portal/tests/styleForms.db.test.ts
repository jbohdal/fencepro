/**
 * /api/fence-style-forms on the dev database (DEV_DB=1 and ezbiz_dev only), in
 * a throwaway company (lib/styleForms.ts; Jonathan, Nov 5 2026): add an
 * aluminum style copying Emily (its own parts new at $0, held), price them on
 * the form (dated costs), it turns on; the Price List's prices for any style's
 * parts; the owner archives it and brings it back; the office cannot archive.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('fence styles added like vinyl colors (dev database)', () => {
  let prisma: any
  let accountId = '', base = ''
  const tok: Record<string, string> = {}
  let server: Server
  const tag = `styleform-${Date.now().toString(36)}`
  const call = (method: string, p: string, who: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${tok[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const styles = estimateConfig({}).fenceStyles.map(s => { const c: any = { ...s }; delete c.label; delete c.held; delete c.jobLot; delete c.followed; return c })
  const snapshot = async () => {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    const i = await prisma.inventoryState.findUnique({ where: { accountId } })
    return { config: b.config as any, items: i.items as any[], kits: i.kits as any[] }
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: styles, pricing: {} } } })
    await prisma.inventoryState.create({ data: { accountId, items: [{ id: 'sec', name: 'Alum, Emily 3R, Sec, 48" x 6\'', unitCost: 71.49, category: 'Aluminum' }, { id: 'hinge', name: 'Alum, Gate, Hinge, Self-Closing', unitCost: 33.36, category: 'Aluminum' }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    for (const [who, role] of [['owner', 'super_admin'], ['office', 'admin']] as const) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${who}@example.invalid`, firstName: who, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } })
      tok[who] = jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/fence-style-forms', (await import('../src/server/routes/fence-style-forms.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    for (const m of ['priceHistory', 'inventoryState', 'businessState', 'accountKeyValue', 'crmAuditLog', 'auditLog']) await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } }).catch(() => {})
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('add copying Emily, price on the form, on by itself; Price List prices; archive (owner) and bring back', async () => {
    const { proposedParts } = await import('../../web/src/styleForm')
    const { catalogOf } = await import('../../web/src/fenceCatalog')
    const s0 = await snapshot()
    const parts = proposedParts({ fenceStyles: s0.config.fenceStyles, fenceCatalog: catalogOf(s0.config), items: s0.items, kits: s0.kits }, 'alum', 'emily', 'Picket Top')
    expect(parts.filter(p => p.mode === 'own').length).toBeGreaterThan(2)
    const add = await call('POST', '/api/fence-style-forms', 'office', { input: { material: 'alum', label: 'Picket Top', copyFrom: 'emily', parts } })
    expect(add.status).toBe(201)
    const key = add.json.data.record.key
    expect(add.json.data.waiting.length).toBe(parts.filter(p => p.mode === 'own').length)
    let s = await snapshot()
    const made = s.config.fenceStyles.filter((x: any) => x.choices?.panel === key)
    expect(made.length).toBe(s.config.fenceStyles.filter((x: any) => x.choices?.panel === 'emily').length)
    expect(s.items.filter(i => /Picket Top/.test(i.name) && i.unitCost === 0).length).toBe(parts.filter(p => p.mode === 'own').length)
    // Priced on the form: dated costs, nothing waiting.
    const priced = parts.map(p => (p.mode === 'own' ? { ...p, cents: 4321 } : p))
    const save = await call('PUT', `/api/fence-style-forms/alum/${key}`, 'office', { input: { label: 'Picket Top', copyFrom: 'emily', parts: priced } })
    expect(save.status).toBe(200)
    expect(save.json.data.waiting).toEqual([])
    expect(await prisma.priceHistory.count({ where: { accountId, source: 'style_form' } })).toBe(parts.filter(p => p.mode === 'own').length)
    // The Price List: a shared part's price, as a dated cost.
    const pl = await call('PUT', '/api/fence-style-forms/prices', 'office', { prices: [{ part: 'Alum, Gate, Hinge, Self-Closing', cents: 3500 }] })
    expect(pl.status).toBe(200)
    expect(pl.json.data.priced).toEqual([{ name: 'Alum, Gate, Hinge, Self-Closing', cents: 3500, prevCents: 3336 }])
    expect(await prisma.priceHistory.count({ where: { accountId, source: 'price_list' } })).toBe(1)
    // Archive: the owner only; its fences off; Bring back on.
    expect((await call('POST', `/api/fence-style-forms/alum/${key}/remove`, 'office')).status).toBe(403)
    expect((await call('POST', `/api/fence-style-forms/alum/${key}/remove`, 'owner')).status).toBe(200)
    s = await snapshot()
    expect(s.config.fenceStyles.filter((x: any) => x.choices?.panel === key).every((x: any) => x.isActive === false)).toBe(true)
    expect((await call('POST', `/api/fence-style-forms/alum/${key}/restore`, 'owner')).status).toBe(200)
    s = await snapshot()
    expect(s.config.fenceStyles.filter((x: any) => x.choices?.panel === key).every((x: any) => x.isActive !== false)).toBe(true)
    // A second style with the same name is refused, nothing saved.
    const dup = await call('POST', '/api/fence-style-forms', 'office', { input: { material: 'alum', label: 'Picket Top', copyFrom: 'emily', parts } })
    expect(dup.status).toBe(400)
  })
})
