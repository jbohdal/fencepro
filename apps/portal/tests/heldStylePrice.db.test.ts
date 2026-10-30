/**
 * Review Oct 29 2026 (money): a saved 8 ft tall quote reopened after its piece
 * costs were cleared in Settings repriced at $0 a piece ($5,050 → $698) and
 * "Update quote" saved $698. The quote builder keeps the saved price
 * (web/src/heldQuote.ts) and the server refuses any save that changes the
 * price of a quote on a style held now (lib/heldStylePrice.ts, 409
 * STYLE_NOT_QUOTABLE), drafts too; words still save.
 *
 * On the dev database (DEV_DB=1; refuses any other), in a throwaway company
 * with live's White 8 ft styles (no piece costs) and a switched off style,
 * through the real route. Writes only inside beforeAll, test and afterAll.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_CATALOG } from '../../web/src/fenceCatalog'
import { calculateQuote } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { isHeldSavedQuote, heldQuoteSave } from '../../web/src/heldQuote'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const W88 = "WV-ND 8'x8' Privacy"
const STYLES = [
  { id: '4', name: W88, margin: 0.56, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
  { id: '20', name: "CL - Com 6'", margin: 0.56, category: 'Commercial', isActive: true, quotable: false, panelWidth: 10, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 1 },
]
const INV: Record<string, number> = { "V , W, Post, 8' Privacy, EP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, LP, 5\" x 5\"": 26.7, '*Vinyl, White, Cap, 5"x5"': 1.5, 'ND, Donut': 4.12, "Pipe, PT40, Galv, 2-1/2\" x 8'": 16.06, "*Vinyl, White, Rail, 8'": 9.85, "Vinyl, Rail Insert, 8'": 8.15 }

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('the quote builder: a held style\'s saved quote keeps its price', () => {
  test('it would reprice far below the saved price at $0 a piece; the save keeps $5,050 and the words', () => {
    setMaterialPriceSource(priceSourceFromMap(INV))
    setSavedKitSets(() => [])
    const cfg = estimateConfig({ fenceStyles: STYLES, fenceCatalog: DEFAULT_CATALOG } as any)
    const style = cfg.fenceStyles.find(s => s.name === W88)!
    expect(style.held).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
    const saved = { id: 'q1', fenceStyle: W88, finalPrice: 5050, materialCost: 3000, notes: 'old', customerName: 'Pat', date: '2026-10-20', status: 'DRAFT', runs: [100] }
    expect(isHeldSavedQuote(saved, style)).toBe(true)
    expect(isHeldSavedQuote({ ...saved, id: '' }, style)).toBe(false)
    expect(isHeldSavedQuote(saved, { name: W88 })).toBe(false)
    // What the builder works out today: the pieces at $0.
    const today = calculateQuote({ style, runs: [{ ft: 100, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer! })
    expect(today.priced.price).toBeLessThan(5050 / 2)
    // The save: the saved quote, its price, with the new notes.
    const edited = { ...saved, finalPrice: today.priced.price, materialCost: 0, notes: 'call Tuesday', customerName: 'Pat Smith' }
    expect(heldQuoteSave(saved, edited, false)).toMatchObject({ finalPrice: 5050, materialCost: 3000, notes: 'call Tuesday', customerName: 'Pat Smith', date: '2026-10-20' })
    // The fence or its price inputs changed: not saved.
    expect(heldQuoteSave(saved, edited, true)).toBeNull()
  })
})

describe.skipIf(!process.env.DEV_DB || !onDev)('the server refuses a held style\'s price change (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedQuotes } = await import('../src/server/routes/saved-quotes.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const stamp = crypto.randomUUID().slice(0, 8)
  let accountId = '', base = '', owner = ''
  let server: ReturnType<express.Express['listen']>
  const ids: Record<string, string> = {}
  const call = (method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const row = (id: string) => prisma.savedQuote.findUnique({ where: { id } })

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test held price-${stamp}`, status: 'active' } })).id
    owner = jwt.sign({ sub: `held-test-${stamp}`, email: 'held@example.invalid', role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: STYLES, fenceCatalog: DEFAULT_CATALOG } as any } })
    await prisma.inventoryState.create({ data: { accountId, items: Object.entries(INV).map(([name, unitCost], i) => ({ id: `i${i}`, name, unitCost, status: 'active' })) as any, bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    for (const [key, status, style] of [['draft', 'DRAFT', W88], ['sent', 'SENT', W88], ['com', 'DRAFT', "CL - Com 6'"]] as const) {
      ids[key] = (await prisma.savedQuote.create({ data: {
        accountId, customerName: `E2E Held ${key}`, customerPhone: '', customerEmail: '', customerAddress: '1 Held Way, Ocala, FL',
        fenceStyle: style, runs: [100], sections: 13, corners: 0, ends: 2, materialCost: 3000, laborCost: 1000, tearOutCost: 0, totalCOGS: 4000,
        finalPrice: 5050, gmPct: 0.2, pullSheet: [], status, notes: 'old',
      } as any })).id
    }
    const app = express()
    app.use(express.json({ limit: '5mb' }))
    app.use('/api/saved-quotes', savedQuotes)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: Object.values(ids) } } }).catch(() => {})
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the $698 save is refused (draft and sent); the saved price stays', async () => {
    for (const key of ['draft', 'sent']) {
      const r = await call('PATCH', `/api/saved-quotes/${ids[key]}`, { finalPrice: 698, materialCost: 0, notes: 'repriced' })
      expect([key, r.status, r.json?.code]).toEqual([key, 409, 'STYLE_NOT_QUOTABLE'])
      expect(r.json.error).toContain('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
      expect((await row(ids[key]))!.finalPrice).toBe(5050)
      expect((await row(ids[key]))!.notes).toBe('old')
    }
  })

  test('words at the saved price save', async () => {
    const r = await call('PATCH', `/api/saved-quotes/${ids.draft}`, { finalPrice: 5050, notes: 'call Tuesday', customerName: 'E2E Held Pat' })
    expect(r.status).toBe(200)
    expect(await row(ids.draft)).toMatchObject({ finalPrice: 5050, notes: 'call Tuesday', customerName: 'E2E Held Pat', materialCost: 3000 })
    // No price sent at all: the same.
    expect((await call('PATCH', `/api/saved-quotes/${ids.draft}`, { notes: 'again' })).status).toBe(200)
  })

  test('a new quote priced on a held style is refused; moving a quote onto it with a price too', async () => {
    const r = await call('POST', '/api/saved-quotes', { customerName: 'E2E Held New', fenceStyle: W88, runs: [100], finalPrice: 698, status: 'DRAFT' })
    expect([r.status, r.json?.code]).toEqual([409, 'STYLE_NOT_QUOTABLE'])
    const move = await call('PATCH', `/api/saved-quotes/${ids.com}`, { fenceStyle: W88, finalPrice: 5050 })
    expect([move.status, move.json?.code]).toEqual([409, 'STYLE_NOT_QUOTABLE'])
  })

  test('a switched off style (not held) still prices: its price change saves', async () => {
    const r = await call('PATCH', `/api/saved-quotes/${ids.com}`, { finalPrice: 5100 })
    expect(r.status).toBe(200)
    expect((await row(ids.com))!.finalPrice).toBe(5100)
  })

  test('with its costs typed in Settings, the price changes save again', async () => {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    const styles = ((b!.config as any).fenceStyles as any[]).map(s => (s.name === W88 ? { ...s, pieceCents: { section: 30000, post: 6500, pricedOn: '2026-10-30' } } : s))
    await prisma.businessState.update({ where: { accountId }, data: { config: { ...(b!.config as any), fenceStyles: styles } } })
    const r = await call('PATCH', `/api/saved-quotes/${ids.draft}`, { finalPrice: 5200 })
    expect(r.status).toBe(200)
    expect((await row(ids.draft))!.finalPrice).toBe(5200)
  })
})
