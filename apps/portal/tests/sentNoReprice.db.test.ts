/**
 * A sent or shared proposal never reprices unless the office chooses it (Jonathan's rule; review Oct 27 2026:
 * any save of Carlton Williams' sent quote from the builder would have put Good at today's $8,780 on the link
 * he has, where it says $9,407, without asking and without "send it again").
 *
 * - The builder asks when a save would change any card the customer reads (web/src/sentReprice.ts proposalPriceChanges).
 * - The server: a save that did not choose new prices (no needsResend: an old browser, a queued save) keeps the
 *   sent proposal and prices, and saves the note; "Save new version (send it again)" saves the new prices and
 *   flags it to be sent again; a save that changes nothing the customer reads saves as before.
 *
 * Dev database only (DEV_DB=1). Writes only its own test quote, removed after.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { proposalPriceChanges } from '../../web/src/sentReprice'

const STYLE = 'WV-Auto ND Privacy'
const opt = (key: string | null, label: string, fenceStyle: string, finalPrice: number) => ({
  ...(key ? { tier: { key, label: key[0].toUpperCase() + key.slice(1), blurb: '' } } : {}),
  label, fenceStyle, finalPrice, perFoot: Math.round((finalPrice / 260) * 100) / 100, sections: 35, photoId: null,
  snapshot: { materialCost: 1, laborCost: 1, tearOutCost: 0, totalCOGS: 2, gmPct: 0.4, pullSheet: [], runSections: [35] },
})
/** Carlton's proposal as sent (Good priced when dig set cost more), and as a save today would build it. */
const sentProposal = (good: number) => ({
  version: 1, recommended: 1, footageFt: 260, depositPct: 50,
  tierSet: { category: 'Vinyl', popular: 'better', tiers: [{ key: 'good', name: 'Good', width: 'cheapest' }, { key: 'better', name: 'Better', width: 'cheapest' }, { key: 'best', name: 'Best', width: '6' }] },
  tierPrefs: { off: [], swap: {} },
  options: [
    opt('good', 'White Vinyl Privacy, 6 ft tall, 8 ft panels, Dig set', "WV-DS 6'x8' Privacy", good),
    opt('better', 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig', "WV-ND 6'x8' Privacy", 10549),
    opt('best', 'White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig', "WV-ND 6'x6' Privacy", 11343),
    opt(null, 'White Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), No dig', STYLE, 10457),
  ],
})

describe('what a save would change on the customer\'s cards', () => {
  const q = { fenceStyle: STYLE, status: 'SENT', runRails: ['auto'] }
  test('Good repriced at today\'s costs: one change, Good $9,407 then, $8,780 now', () => {
    expect(proposalPriceChanges(sentProposal(9407), q, sentProposal(8780), q)).toEqual([{ name: 'Good', wasCents: 940700, nowCents: 878000 }])
  })
  test('the same cards: nothing', () => {
    expect(proposalPriceChanges(sentProposal(9407), q, sentProposal(9407), q)).toEqual([])
  })
  test('a card gone or added counts', () => {
    const fewer = { ...sentProposal(9407), options: sentProposal(9407).options.filter(o => o.tier?.key !== 'best') }
    expect(proposalPriceChanges(sentProposal(9407), q, fewer, q)).toEqual([{ name: 'Best', wasCents: 1134300, nowCents: null }])
    expect(proposalPriceChanges(fewer, q, sentProposal(9407), q)).toEqual([{ name: 'Best', wasCents: null, nowCents: 1134300 }])
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the server never reprices a sent proposal unless chosen (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedQuotes } = await import('../src/server/routes/saved-quotes.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const ids: string[] = []
  let owner = '', accountId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const call = (method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const goodOf = (p: any) => p.options.find((o: any) => o.tier?.key === 'good').finalPrice

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-quotes', savedQuotes)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: ids } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: ids } } })
    server?.close()
  })

  async function sentQuote(status = 'SENT', extra: Record<string, unknown> = {}) {
    const q = await prisma.savedQuote.create({ data: {
      accountId, customerName: 'E2E Sent No Reprice', customerPhone: '3525550199', fenceStyle: STYLE, runs: [87, 90, 64], runRails: ['auto', 'auto', 'auto'],
      corners: 2, ends: 2, walkGates: 1, sections: 35, materialCost: 4000, laborCost: 835, tearOutCost: 0, totalCOGS: 4835, finalPrice: 10457, gmPct: 0.44,
      pullSheet: [], status, proposal: sentProposal(9407), ...extra,
    } as any })
    ids.push(q.id)
    return q
  }

  test('Carlton: a note only save from a browser that rebuilt the tiers keeps Good $9,407; the note saves', async () => {
    const q = await sentQuote()
    const r = await call('PATCH', `/api/saved-quotes/${q.id}`, { notes: 'gate code 4411', finalPrice: 10457, proposal: sentProposal(8780) })
    expect(r.status).toBe(200)
    expect(r.json.keptSentPrices).toEqual([{ name: 'Good', wasCents: 940700, nowCents: 878000 }])
    const after = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect(goodOf(after.proposal)).toBe(9407)
    expect((after.proposal as any).options.map((o: any) => o.finalPrice)).toEqual([9407, 10549, 11343, 10457])
    expect(after.notes).toBe('gate code 4411')
    expect(after.needsResend).toBe(false)
  })

  test('a yard change from an old browser (no choice made): the sent fence and prices stay', async () => {
    const q = await sentQuote()
    const bigger = { ...sentProposal(9407), options: sentProposal(9407).options.map(o => ({ ...o, finalPrice: o.finalPrice + 400 })) }
    const r = await call('PATCH', `/api/saved-quotes/${q.id}`, { runs: [97, 90, 64], finalPrice: 10857, notes: 'longer back', proposal: bigger })
    expect(r.status).toBe(200)
    const after = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect([after.finalPrice, after.runs, goodOf(after.proposal), after.notes]).toEqual([10457, [87, 90, 64], 9407, 'longer back'])
  })

  test('"Save new version (send it again)": the new prices go on and it is flagged to be sent again', async () => {
    const q = await sentQuote()
    const r = await call('PATCH', `/api/saved-quotes/${q.id}`, { notes: 'new prices', proposal: sentProposal(8780), needsResend: true })
    expect(r.status).toBe(200)
    expect(r.json.keptSentPrices).toBeUndefined()
    const after = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect(goodOf(after.proposal)).toBe(8780)
    expect(after.needsResend).toBe(true)
  })

  test('nothing the customer reads changes: saved as before, no question', async () => {
    const q = await sentQuote()
    const r = await call('PATCH', `/api/saved-quotes/${q.id}`, { notes: 'same prices', proposal: { ...sentProposal(9407), includedNote: 'Gate faces the street' } })
    expect(r.status).toBe(200)
    expect(r.json.keptSentPrices).toBeUndefined()
    const after = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect([(after.proposal as any).includedNote, after.notes, goodOf(after.proposal)]).toEqual(['Gate faces the street', 'same prices', 9407])
  })

  test('a draft shared by link is protected too; a draft never shared is not', async () => {
    const shared = await sentQuote('DRAFT', { shareToken: `e2e-no-reprice-${Date.now()}` })
    await call('PATCH', `/api/saved-quotes/${shared.id}`, { proposal: sentProposal(8780) })
    expect(goodOf((await prisma.savedQuote.findUnique({ where: { id: shared.id } }))!.proposal)).toBe(9407)
    const draft = await sentQuote('DRAFT')
    await call('PATCH', `/api/saved-quotes/${draft.id}`, { proposal: sentProposal(8780) })
    expect(goodOf((await prisma.savedQuote.findUnique({ where: { id: draft.id } }))!.proposal)).toBe(8780)
  })
})
