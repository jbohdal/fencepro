/**
 * "Needs cost review" on WV-ND Bell 4'x6' (Jonathan, Oct 21, 2026: "Flag WV-ND
 * Bell 4'x6' needsCostReview so I'm reminded to enter the real supplier
 * cost"), on the dev database (DEV_DB=1 and ezbiz_dev only):
 *
 * - the one-time step flags the Bell once, never again, and leaves other styles alone;
 * - the Finish setup list shows "Enter the real supplier cost for the Bell 4'x6' section";
 * - an Inventory save that does not touch the Bell's kits leaves the flag;
 * - saving the Bell's kit set (Inventory > Material Kits) clears it and ticks the item off;
 * - the step run again does not flag it back.
 *
 * Everything happens in a throwaway company, removed afterwards. Writes only
 * inside beforeAll, test and afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { flagStyles, kitsEditedFor } from '../src/server/lib/costReview'

const BELL = "WV-ND Bell 4'x6'"

describe('cost review helpers', () => {
  test('flagStyles flags only the Bell, once', () => {
    const styles = [{ name: "WV-ND 6'x6' Privacy" }, { name: BELL }]
    const a = flagStyles(styles)
    expect(a.changed).toEqual([BELL])
    expect(a.styles).toEqual([{ name: "WV-ND 6'x6' Privacy" }, { name: BELL, needsCostReview: true }])
    const b = flagStyles(a.styles)
    expect(b.changed).toEqual([])
    expect(b.styles).toBe(a.styles)
    expect(flagStyles([{ name: "WV-ND 6'x6' Privacy" }]).changed).toEqual([])
  })
  test('kitsEditedFor: a new or changed saved set in use for the style counts; other styles and archived sets do not', () => {
    const bell = { id: 'kit-own:' + BELL, styleName: BELL, kits: { section: [{ part: "Misc, 6' Section", qty: 1 }] } }
    const other = { id: 'k2', styleName: "WV-ND 6'x6' Privacy", kits: {} }
    expect(kitsEditedFor([BELL], [], [bell])).toEqual([BELL])
    expect(kitsEditedFor([BELL], [bell], [bell])).toEqual([])
    expect(kitsEditedFor([BELL], [bell], [{ ...bell, kits: { section: [{ part: "Misc, 6' Section", qty: 2 }] } }])).toEqual([BELL])
    expect(kitsEditedFor([BELL], [], [other])).toEqual([])
    expect(kitsEditedFor([BELL], [], [{ ...bell, archived: true }])).toEqual([])
    expect(kitsEditedFor([], [], [bell])).toEqual([])
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('Bell needs cost review (dev database)', () => {
  let prisma: any
  let accountId = ''
  let token = ''
  let base = ''
  let server: Server
  const tag = `costreview-${Date.now().toString(36)}`
  const styles = [{ id: '1', name: "WV-ND 6'x6' Privacy", category: 'Vinyl' }, { id: '5', name: BELL, category: 'Vinyl' }]

  const call = (method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const bellStyle = async () => ((await prisma.businessState.findUnique({ where: { accountId } })).config.fenceStyles as any[]).find(s => s.name === BELL)
  const setupItem = async () => ((await call('GET', '/api/system/setup')).json.data as any[]).find(i => i.key === 'bell-cost')
  const saveInventory = async (kits: unknown[], items: unknown[] = []) => {
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    return call('PUT', '/api/inventory', { items, bundles: [], locations: [], stockLevels: [], transactions: [], kits, baseVersion: inv.version })
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: styles, pricing: {} } } })
    await prisma.inventoryState.create({ data: { accountId, items: [], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    token = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: 'Test', lastName: 'Cost review', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/system', (await import('../src/server/routes/system.js')).default)
    app.use('/api/inventory', (await import('../src/server/routes/inventory.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    for (const m of ['auditLog', 'inventoryState', 'businessState', 'accountKeyValue']) {
      await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    }
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[cost review test] account cleanup:', e))
  })

  test('flagged once; the reminder shows; a kit save for the Bell clears it; never flagged again', async () => {
    const { ensureCostReview } = await import('../src/server/lib/costReview.js')
    expect(await setupItem()).toBeUndefined()
    const v0 = (await prisma.businessState.findUnique({ where: { accountId } })).version
    expect(await ensureCostReview(accountId)).toEqual([BELL])
    expect((await bellStyle()).needsCostReview).toBe(true)
    expect((await prisma.businessState.findUnique({ where: { accountId } })).version).toBe(v0 + 1)
    const other = ((await prisma.businessState.findUnique({ where: { accountId } })).config.fenceStyles as any[]).find(s => s.name !== BELL)
    expect(other.needsCostReview).toBeUndefined()
    expect(await ensureCostReview(accountId)).toEqual([])

    const item = await setupItem()
    expect(item).toMatchObject({ label: "Enter the real supplier cost for the Bell 4'x6' section", done: false, link: `/inventory?tab=kits&style=${encodeURIComponent(BELL)}` })

    // A price edit, kits as they were: still flagged.
    expect((await saveInventory([], [{ id: 'i1', name: "Misc, 6' Section", unitCost: 154.34 }])).status).toBe(200)
    expect((await bellStyle()).needsCostReview).toBe(true)
    // Another style's kits saved: still flagged.
    expect((await saveInventory([{ id: 'k-priv', name: 'Privacy', styleName: "WV-ND 6'x6' Privacy", kits: {}, roundUp: [] }])).status).toBe(200)
    expect((await bellStyle()).needsCostReview).toBe(true)

    // The Bell's kits saved with its real section part: cleared, the item ticks off.
    const bellKit = { id: `kit-own:${BELL}`, name: BELL, styleName: BELL, kits: { section: [{ part: "Misc, 6' Section", qty: 1, fallbackCost: 0 }] }, roundUp: [] }
    const before = (await prisma.businessState.findUnique({ where: { accountId } })).version
    expect((await saveInventory([{ id: 'k-priv', name: 'Privacy', styleName: "WV-ND 6'x6' Privacy", kits: {}, roundUp: [] }, bellKit])).status).toBe(200)
    expect((await bellStyle()).needsCostReview).toBeUndefined()
    expect((await prisma.businessState.findUnique({ where: { accountId } })).version).toBe(before + 1)
    expect(await setupItem()).toMatchObject({ done: true, detail: 'Entered.' })

    // The one-time step again: not flagged back.
    expect(await ensureCostReview(accountId)).toEqual([])
    expect((await bellStyle()).needsCostReview).toBeUndefined()
  })
})
