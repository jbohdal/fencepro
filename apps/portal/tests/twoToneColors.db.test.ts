/**
 * Two tone vinyl kept in step with Vinyl Colors at once (Jonathan, Nov 5 2026),
 * on the dev database (DEV_DB=1 and ezbiz_dev only), in a throwaway company:
 *   - Chai Gray added per section: no two tone with it; switched to per piece
 *     in its form: its two tone fences are there in the same save;
 *   - Undo takes away the color and what its saves made in two tone: Settings,
 *     Inventory and kits exactly as before;
 *   - Remove (archive) takes its choice off two tone; Bring back puts it back.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { CHAI_GRAY } from './fixtures/chaiGray'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('two tone in step with vinyl colors (dev database)', () => {
  let prisma: any
  let accountId = '', owner = '', base = ''
  let server: Server
  const tag = `twotone-${Date.now().toString(36)}`
  const call = (method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const snapshot = async () => {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    const i = await prisma.inventoryState.findUnique({ where: { accountId } })
    return { config: b.config, items: i.items, kits: i.kits }
  }
  const twoTone = (cfg: any) => cfg.fenceStyles.filter((s: any) => s.material === 'twotone').map((s: any) => s.name).sort()
  const ttOptions = (cfg: any, dim: string) => (cfg.fenceCatalog?.materials ?? []).find((m: any) => m.key === 'twotone')?.dims.find((d: any) => d.key === dim)?.options.filter((o: any) => !o.archived).map((o: any) => o.key) ?? []
  const styles = estimateConfig({}).fenceStyles.map(s => { const c: any = { ...s }; delete c.label; delete c.held; delete c.jobLot; delete c.followed; return c })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: styles, pricing: {} } } })
    await prisma.inventoryState.create({ data: { accountId, items: [{ id: 'other', name: 'Misc, Concrete', unitCost: 6.25, category: 'Misc' }], bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/vinyl-colors', (await import('../src/server/routes/vinyl-colors.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    for (const m of ['priceHistory', 'inventoryState', 'businessState', 'accountKeyValue']) await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('per section: not in two tone; switched to per piece: in two tone at once; Undo: everything as before', async () => {
    const before = await snapshot()
    expect((await call('POST', '/api/vinyl-colors', { input: CHAI_GRAY })).status).toBe(201)
    let s = await snapshot()
    // White and Tan pairs (per piece); Chai Gray, sold by the section, is not a frame or infill choice.
    expect(ttOptions(s.config, 'frame')).toEqual(['white', 'tan'])
    expect(twoTone(s.config).some((n: string) => n.includes('chai-gray'))).toBe(false)
    // Switched to per piece in its form: Chai Gray's two tone fences (its 6x8 size, No dig and Dig set, with White and with Tan, both ways) in the same save.
    const piece = { ...CHAI_GRAY, mode: 'piece', pieces: { picketCents: 599, rail6Cents: 1480, rail8Cents: 1480, uTrimCents: 390 } }
    const edit = await call('PUT', '/api/vinyl-colors/chai-gray', { input: piece })
    expect(edit.status).toBe(200)
    s = await snapshot()
    expect(ttOptions(s.config, 'frame')).toEqual(['white', 'tan', 'chai-gray'])
    expect(twoTone(s.config).filter((n: string) => n.includes('chai-gray'))).toEqual([
      'twotone/6/chai-gray/tan/ds/8', 'twotone/6/chai-gray/tan/nd/8', 'twotone/6/chai-gray/white/ds/8', 'twotone/6/chai-gray/white/nd/8',
      'twotone/6/tan/chai-gray/ds/8', 'twotone/6/tan/chai-gray/nd/8', 'twotone/6/white/chai-gray/ds/8', 'twotone/6/white/chai-gray/nd/8',
    ])
    // Remove takes its choice off two tone (its fences kept, held); Bring back puts it back.
    expect((await call('POST', '/api/vinyl-colors/chai-gray/remove')).status).toBe(200)
    expect(ttOptions((await snapshot()).config, 'frame')).toEqual(['white', 'tan'])
    expect((await call('POST', '/api/vinyl-colors/chai-gray/restore')).status).toBe(200)
    expect(ttOptions((await snapshot()).config, 'frame')).toEqual(['white', 'tan', 'chai-gray'])
    // Undo: the color, its two tone fences, and the two tone its adding brought: Settings, Inventory and kits as before.
    const undo = await call('POST', '/api/vinyl-colors/chai-gray/undo')
    expect(undo.status).toBe(200)
    expect(await snapshot()).toEqual(before)
  })
})
