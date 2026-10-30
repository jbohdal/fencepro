/**
 * Settings → Price List → 8 ft tall vinyl saves for real (Oct 29, 2026).
 *
 * Jonathan: "8 ft tall vinyl is still off for quoting even though I entered
 * prices" ... "I'll enter prices in Settings". Live has never stored an 8 ft
 * tall price (FenceStyle.pieceCents): his prices went into Inventory. This
 * proves the Settings save end to end, against the dev database (DEV_DB=1;
 * refuses any other) on a throwaway company with live's four White 8 ft tall
 * fences and live's Inventory prices (no customer data), through the real
 * route, as the web does it:
 *   - the owner's browser reads Settings, the screen's save
 *     (web tallVinylPriceSave.applyTallPrices) puts the typed dollars on the
 *     fences, saveConfig's stripDerived, PATCH /api/business-state with the
 *     version it read;
 *   - read again (a reload, another device): the prices are there in integer
 *     cents; the style is available for quoting at once, the other fences say
 *     which price is missing;
 *   - the Salesman's phone reads the same prices (not hidden as a cost) and
 *     can quote it; the server's estimate prices the section and post as typed;
 *   - a second browser holding the older copy is refused (409) and its merge
 *     keeps both changes.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig, estimate } from '../../web/src/estimate'
import { DEFAULT_CATALOG, stripDerived, isTallVinyl, styleChoicesOf } from '../../web/src/fenceCatalog'
import { applyTallPrices, tallKey } from '../../web/src/tallVinylPriceSave'
import { isQuotable } from '../../web/src/styleAvailability'
import type { FenceStyle } from '../../web/src/configStore'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

// Live's four 8 ft tall fences and one 6 ft fence, as saved in Settings (config.fenceStyles, Oct 29, 2026).
const LIVE_STYLES = [
  { id: '2', name: "WV-ND 6'x8' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '8', height: '6', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 1.2, targetProfitPct: 14 },
  { id: '3', name: "WV-ND 8'x6' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '6', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
  { id: '4', name: "WV-ND 8'x8' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
  { id: '8', name: "WV-DS 8'x6' Privacy", margin: 0.6, choices: { color: 'white', style: 'privacy', width: '6', height: '8', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.7, targetProfitPct: 10 },
  { id: '9', name: "WV-DS 8'x8' Privacy", margin: 0.6, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.7, targetProfitPct: 10 },
]
// Live's Inventory prices (dollars) for the parts these fences use.
const LIVE_INV: Record<string, number> = {
  "V , W, Picket Section 8' x 6' Privacy": 92.5, "V , W, Picket Section 8' x 8' Privacy": 147.8,
  "V , W, Post, 8' Privacy, CP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, EP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, LP, 5\" x 5\"": 26.7,
  '*Vinyl, White, Cap, 5"x5"': 1.5, 'ND, Donut': 4.12, "Pipe, PT40, Galv, 2-1/2\" x 8'": 16.06, 'Misc, Concrete': 7.06,
  "*Vinyl, White, Rail, 6'": 6.65, "*Vinyl, White, Rail, 8'": 9.85, "Vinyl, Rail Insert, 8'": 8.15,
  "*Vinyl, White, Mid Rail, 6'": 0, "*Vinyl, White, Mid Rail, 8'": 0, "*Vinyl, White, Picket, 4'": 0, "*Vinyl, White, U Channel, 4'": 0,
}

describe.skipIf(!process.env.DEV_DB || !onDev)('8 ft tall prices typed in Settings save for real (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { tagDocVersions } = await import('../src/server/lib/docVersions.js')
  const { hideCostsFromLimitedLogins } = await import('../src/server/lib/costRedact.js')
  const { default: businessStateRoutes } = await import('../src/server/routes/business-state.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `t8-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', baseUrl = '', owner = '', sales = ''
  let server: ReturnType<express.Express['listen']>
  const items = Object.entries(LIVE_INV).map(([name, unitCost], i) => ({ id: `i${i}`, name, unitCost, status: 'active' }))

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const o = await prisma.crmUser.create({ data: { email: `${tag}-owner@example.invalid`, firstName: 'Jon', lastName: tag, role: 'super_admin', crmAccountId: accountId, passwordHash: 'x' } as any })
    const s = await prisma.crmUser.create({ data: { email: `${tag}-sales@example.invalid`, firstName: 'Sam', lastName: tag, role: 'sales_rep', crmAccountId: accountId, passwordHash: 'x' } as any })
    owner = jwt.sign({ sub: o.id, email: o.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    sales = jwt.sign({ sub: s.id, email: s.email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Getter Done Fence', phone: '3528442677' }, fenceStyles: LIVE_STYLES, fenceCatalog: DEFAULT_CATALOG } as any } })
    await prisma.inventoryState.create({ data: { accountId, items: items as any, bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api', tagDocVersions)
    app.use('/api', hideCostsFromLimitedLogins)
    app.use('/api/business-state', businessStateRoutes)
    server = app.listen(0); baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.crmAuditLog.deleteMany({ where: { userEmail: { in: [`${tag}-owner@example.invalid`, `${tag}-sales@example.invalid`] } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const call = async (token: string, method: string, body?: unknown) => {
    const r = await fetch(`${baseUrl}/api/business-state?omit=jobChecklists,pendingOrders`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json() as any }
  }
  /** The owner's browser: what Settings shows (resolved, as getConfig does), and the version it read. */
  const read = async (token = owner) => {
    const r = await call(token, 'GET')
    expect(r.status).toBe(200)
    return { saved: r.json.data.config, version: r.json.data.version as number, cfg: estimateConfig(r.json.data.config) }
  }
  /** The 8 ft tall screen: type, Save (applyTallPrices, then saveConfig's stripDerived), PATCH on the version read. */
  const typeAndSave = async (b: Awaited<ReturnType<typeof read>>, typed: Record<string, string>) => {
    const tall = b.cfg.fenceStyles.filter(s => s.isActive !== false && isTallVinyl(styleChoicesOf(s)))
    const r = applyTallPrices(b.cfg.fenceStyles, tall, typed, '2026-10-29')
    expect(r.bad).toEqual([])
    return call(owner, 'PATCH', { config: { ...b.saved, fenceStyles: stripDerived(r.fenceStyles) }, baseVersion: b.version })
  }
  const byName = (styles: FenceStyle[], n: string) => styles.find(s => s.name === n)!

  test('nothing typed yet: every 8 ft tall fence is held and says which prices are missing, and where', async () => {
    const b = await read()
    for (const s of b.cfg.fenceStyles.filter(s => isTallVinyl(styleChoicesOf(s)))) {
      expect(isQuotable(s), s.name).toBe(false)
      expect(s.held).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
    }
    expect(isQuotable(byName(b.cfg.fenceStyles, "WV-ND 6'x8' Privacy"))).toBe(true)
  })

  test('the owner types prices and saves: stored in integer cents, on at once, survives a reload and reaches the Salesman\'s phone', async () => {
    const b = await read()
    const r = await typeAndSave(b, {
      [tallKey("WV-ND 8'x6' Privacy", 'section')]: '412.50', [tallKey("WV-ND 8'x6' Privacy", 'post')]: '65',
      [tallKey("WV-DS 8'x8' Privacy", 'section')]: '$450',
    })
    expect(r.status).toBe(200)
    expect(r.json.data.version).toBe(b.version + 1)

    // In the database, exactly as typed, in cents.
    const row = await prisma.businessState.findUnique({ where: { accountId } })
    const stored = (row!.config as any).fenceStyles as FenceStyle[]
    expect(byName(stored, "WV-ND 8'x6' Privacy").pieceCents).toEqual({ section: 41250, post: 6500, pricedOn: '2026-10-29' })
    expect(byName(stored, "WV-DS 8'x8' Privacy").pieceCents).toEqual({ section: 45000, post: null, pricedOn: '2026-10-29' })
    expect(byName(stored, "WV-ND 8'x8' Privacy").pieceCents).toBeUndefined()
    // Nothing worked out on read was saved.
    expect(stored.some(s => 'held' in s || 'jobLot' in s || 'label' in s)).toBe(false)

    // A reload (or another device): on for quoting with both prices; the others say what is missing.
    const again = await read()
    expect(isQuotable(byName(again.cfg.fenceStyles, "WV-ND 8'x6' Privacy"))).toBe(true)
    expect(byName(again.cfg.fenceStyles, "WV-DS 8'x8' Privacy").held).toBe('8 ft tall needs our post cost in Settings → Price List → 8 ft tall vinyl')
    expect(byName(again.cfg.fenceStyles, "WV-ND 8'x8' Privacy").held).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')

    // The Salesman's phone: the prices are not hidden from him, so the fence is on there too.
    const phone = await read(sales)
    expect(byName(phone.saved.fenceStyles, "WV-ND 8'x6' Privacy").pieceCents).toEqual({ section: 41250, post: 6500, pricedOn: '2026-10-29' })
    expect(isQuotable(byName(phone.cfg.fenceStyles, "WV-ND 8'x6' Privacy"))).toBe(true)

    // The server's estimate (website, the Salesman's server priced quote): the section and posts as typed.
    const e = estimate({ config: row!.config as any, inventory: items as any, kits: [] }, { fenceStyle: "WV-ND 8'x6' Privacy", runs: [30, 40, 30], corners: 2, ends: 2, walkGates: 0, dblGates: 0 })
    expect(e.sections).toBe(17)
    expect(e.pullSheet.find(l => l.item === '8 ft tall White: section, 6 ft wide')).toMatchObject({ qty: 17, unitCost: 412.5 })
    expect(e.pullSheet.find(l => l.item === '8 ft tall White: corner post')).toMatchObject({ qty: 2, unitCost: 65 })
    expect(e.pullSheet.find(l => l.item === '8 ft tall White: line post')).toMatchObject({ qty: 14, unitCost: 65 })
    // Plus the post cap, donuts and pipe from Inventory (Oct 29, 2026: the post price is the vinyl post only); the vinyl posts at $0.
    const fromInv = e.pullSheet.filter(l => !l.jobLotPiece && l.total > 0)
    expect(fromInv.some(l => /Post, 8' Privacy/.test(l.item))).toBe(false)
    expect(e.pullSheet.filter(l => /Post, 8' Privacy/.test(l.item)).every(l => l.total === 0)).toBe(true)
    expect(Math.round(e.materialCost * 100)).toBe(17 * 41250 + 18 * 6500 + Math.round(fromInv.reduce((t, l) => t + l.total, 0) * 100))
    expect(() => estimate({ config: row!.config as any, inventory: items as any, kits: [] }, { fenceStyle: "WV-DS 8'x8' Privacy", runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })).toThrow()
  })

  test('two browsers: the one holding the older copy is refused, and its merge keeps both prices', async () => {
    const a = await read(), stale = await read()
    expect((await typeAndSave(a, { [tallKey("WV-ND 8'x8' Privacy", 'section')]: '500', [tallKey("WV-ND 8'x8' Privacy", 'post')]: '70',
      [tallKey("WV-ND 8'x6' Privacy", 'section')]: '412.50', [tallKey("WV-ND 8'x6' Privacy", 'post')]: '65', [tallKey("WV-DS 8'x8' Privacy", 'section')]: '450' })).status).toBe(200)
    // B still holds the copy from before A's save.
    const refused = await typeAndSave(stale, { [tallKey("WV-DS 8'x8' Privacy", 'section')]: '450', [tallKey("WV-DS 8'x8' Privacy", 'post')]: '72',
      [tallKey("WV-ND 8'x6' Privacy", 'section')]: '412.50', [tallKey("WV-ND 8'x6' Privacy", 'post')]: '65' })
    expect(refused.status).toBe(409)
    expect(refused.json.code).toBe('STALE_VERSION')
    // As the app does after a 409 (syncGuard): its change on top of the newest copy, saved again.
    const fresh = { saved: refused.json.data.config, version: refused.json.version as number, cfg: estimateConfig(refused.json.data.config) }
    expect((await typeAndSave(fresh, {
      [tallKey("WV-DS 8'x8' Privacy", 'section')]: '450', [tallKey("WV-DS 8'x8' Privacy", 'post')]: '72',
      [tallKey("WV-ND 8'x8' Privacy", 'section')]: '500', [tallKey("WV-ND 8'x8' Privacy", 'post')]: '70',
      [tallKey("WV-ND 8'x6' Privacy", 'section')]: '412.50', [tallKey("WV-ND 8'x6' Privacy", 'post')]: '65',
    })).status).toBe(200)
    const end = await read()
    expect(byName(end.saved.fenceStyles, "WV-ND 8'x8' Privacy").pieceCents).toMatchObject({ section: 50000, post: 7000 })
    expect(byName(end.saved.fenceStyles, "WV-DS 8'x8' Privacy").pieceCents).toMatchObject({ section: 45000, post: 7200 })
    for (const n of ["WV-ND 8'x6' Privacy", "WV-ND 8'x8' Privacy", "WV-DS 8'x8' Privacy"]) expect(isQuotable(byName(end.cfg.fenceStyles, n)), n).toBe(true)
    expect(byName(end.cfg.fenceStyles, "WV-DS 8'x6' Privacy").held).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
    // The Settings change log has the save.
    const log = await prisma.crmAuditLog.findMany({ where: { userEmail: `${tag}-owner@example.invalid`, entityId: 'business-state/config' } })
    expect(log.length).toBeGreaterThanOrEqual(2)
  })
})
