/**
 * The pipeline a page at a time (routes/pipeline.ts GET /board, /column/:stage,
 * /search, /cards/:id; lib/pipelinePages.ts), against the dev database
 * (DEV_DB=1; refuses any other).
 *
 * A throwaway company gets a board of 130 No Answer cards (three placed by
 * hand), two Pending Signature cards (one with a sent quote, one with only its
 * own figure) and an archived card. Then:
 *   - /board: every column's count and total, the first 50 cards in board
 *     order (unplaced newest first, then the placed ones), and where the next
 *     page starts; the version of the board record;
 *   - /column: the next pages, to the end; a stage with "&" in its name;
 *   - ?q= searches across all cards; the count and total stay the column's;
 *   - /cards/:id finds a card past the first page and an archived one; 404 otherwise;
 *   - a card moved by the usual PATCH (delta, version) shows in its new column
 *     on the next /board, with the new version: saving is unchanged.
 * Database writes happen only inside beforeAll / test / afterAll; the company
 * and everything in it are removed at the end.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('Pipeline pages (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: pipelineRoute } = await import('../src/server/routes/pipeline.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const tag = `pipe-pages-${crypto.randomUUID().slice(0, 8)}`
  let accountId = ''
  let token = ''
  const app = express()
  app.use(express.json())
  app.use('/api/pipeline', pipelineRoute)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
  // na-000 is the oldest, na-129 the newest; na-005, na-006, na-007 placed by hand (ranks 2, 0, 1).
  const NA = Array.from({ length: 130 }, (_, i) => ({
    id: `${tag}-na-${String(i).padStart(3, '0')}`, firstName: 'Test', lastName: `${tag} ${i}`, phone: `35255500${String(i).padStart(2, '0')}`, address: `${i} Oak St`,
    stage: 'No Answer', createdAt: day(i), lastMoved: day(i), quotePrice: 100,
    ...(i === 5 ? { boardOrder: { stage: 'No Answer', rank: 2 } } : i === 6 ? { boardOrder: { stage: 'No Answer', rank: 0 } } : i === 7 ? { boardOrder: { stage: 'No Answer', rank: 1 } } : {}),
  }))
  const PS = [
    { id: `${tag}-ps-quoted`, customerId: `${tag}-cust-q`, firstName: 'Quoted', lastName: tag, stage: 'Pending Signature', createdAt: day(1), quotePrice: 999 },
    { id: `${tag}-ps-own`, firstName: 'Own', lastName: tag, stage: 'Pending Signature', createdAt: day(2), quotePrice: 2500 },
    { id: `${tag}-paid`, firstName: 'Paid', lastName: tag, stage: 'Paid & Closed', createdAt: day(3), jobValue: 4000 },
  ]
  const ARCHIVED = [{ id: `${tag}-arch`, firstName: 'Archived', lastName: tag, stage: 'Lost Sale', createdAt: day(4) }]

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    token = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
    await prisma.pipelineState.create({ data: { accountId, leads: [...PS, ...NA] as any, archivedLeads: ARCHIVED as any, stages: [] as any } })
    // The quoted card's value is its customer's sent quote (6000), not its own 999.
    await prisma.crmContact.create({ data: { id: `${tag}-cust-q`, accountId, firstName: 'Quoted', lastName: tag } as any })
    await prisma.savedQuote.create({ data: { accountId, crmContactId: `${tag}-cust-q`, status: 'SENT' as any, date: '2026-10-01', finalPrice: 6000, customerName: `Quoted ${tag}`, fenceStyle: "WV 6ft Privacy", runs: [], pullSheet: [] } as any })
  })

  afterAll(async () => {
    server.close()
    if (!accountId) return
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.automationEvent.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.cardFollowUp.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmAuditLog.deleteMany({ where: { OR: [{ entityId: accountId }, { entityId: { startsWith: tag } }] } }).catch(() => {})
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const ids = (cards: any[]) => cards.map(c => c.id.replace(`${tag}-`, ''))

  test('/board: counts, totals, the first 50 in board order, the next page, the version', async () => {
    const r = await call('GET', '/api/pipeline/board')
    expect(r.status).toBe(200)
    const v0 = (await prisma.pipelineState.findUnique({ where: { accountId } }))!.version
    expect(r.json.version).toBe(v0)
    expect(r.json.data.cards).toBe(133)
    const col = (s: string) => r.json.data.columns.find((c: any) => c.stage === s)
    const na = col('No Answer')
    expect(na).toMatchObject({ count: 130, matching: 130, total: 13000, next: 50 })
    expect(na.cards).toHaveLength(50)
    // Unplaced newest first (129, 128, ...), the hand placed ones after them.
    expect(ids(na.cards).slice(0, 3)).toEqual(['na-129', 'na-128', 'na-127'])
    const ps = col('Pending Signature')
    expect(ps).toMatchObject({ count: 2, total: 8500, next: null })
    expect(col('Paid & Closed')).toMatchObject({ count: 1, total: 4000 })
    // Columns in board order, empty ones included (13 start stages).
    expect(r.json.data.columns.map((c: any) => c.stage).slice(0, 4)).toEqual(['First Contact', 'Appointment', 'Estimating', 'Pending Signature'])
    expect(col('First Contact')).toMatchObject({ count: 0, total: 0, cards: [], next: null })
    // ?per=
    const small = await call('GET', '/api/pipeline/board?per=5')
    expect(small.json.data.columns.find((c: any) => c.stage === 'No Answer').cards).toHaveLength(5)
  })

  test('/column: the next pages to the end, placed cards last in their order; "&" in a stage name', async () => {
    const seen: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const r = await call('GET', `/api/pipeline/column/${encodeURIComponent('No Answer')}?offset=${offset}&limit=50`)
      expect(r.status).toBe(200)
      seen.push(...ids(r.json.data.cards))
      offset = r.json.data.next
    }
    expect(seen).toHaveLength(130)
    expect(new Set(seen).size).toBe(130)
    expect(seen.slice(-3)).toEqual(['na-006', 'na-007', 'na-005'])
    const paid = await call('GET', `/api/pipeline/column/${encodeURIComponent('Paid & Closed')}`)
    expect(ids(paid.json.data.cards)).toEqual(['paid'])
  })

  test('?q= searches every card; the column count and total stay the whole column', async () => {
    const r = await call('GET', `/api/pipeline/board?q=${encodeURIComponent('12 Oak')}`)
    const na = r.json.data.columns.find((c: any) => c.stage === 'No Answer')
    // "12 Oak" is in 12 and 112 Oak St; whatever the count, it is the matching cards, not the column's.
    const expected = NA.filter(c => c.address.includes('12 Oak')).length
    expect(na).toMatchObject({ count: 130, total: 13000, matching: expected })
    const s = await call('GET', `/api/pipeline/search?q=${encodeURIComponent('quoted')}`)
    expect(s.json.data.matching).toBe(1)
    expect(ids(s.json.data.cards)).toEqual(['ps-quoted'])
    const none = await call('GET', '/api/pipeline/search?q=')
    expect(none.json.data).toEqual({ matching: 0, cards: [] })
  })

  test('/cards/:id: a card past the first page, an archived one, and 404', async () => {
    const deep = await call('GET', `/api/pipeline/cards/${tag}-na-000`)
    expect(deep.status).toBe(200)
    expect(deep.json.data).toMatchObject({ archived: false, card: { id: `${tag}-na-000`, stage: 'No Answer' } })
    const arch = await call('GET', `/api/pipeline/cards/${tag}-arch`)
    expect(arch.json.data.archived).toBe(true)
    expect((await call('GET', `/api/pipeline/cards/${tag}-nope`)).status).toBe(404)
  })

  test('a card moved by the usual PATCH shows in its new column, with the new version', async () => {
    const moved = { ...NA[0], stage: 'Pending Signature', lastMoved: '2026-10-23' }
    const v = (await call('GET', '/api/pipeline/board')).json.version
    const p = await call('PATCH', '/api/pipeline', { upsert: [{ lead: moved }], remove: [], baseVersion: v })
    expect(p.status).toBe(200)
    expect(p.json.version).toBe(v + 1)
    const r = await call('GET', '/api/pipeline/board')
    expect(r.json.version).toBe(v + 1)
    const col = (s: string) => r.json.data.columns.find((c: any) => c.stage === s)
    expect(col('No Answer').count).toBe(129)
    expect(col('Pending Signature').count).toBe(3)
    expect(ids(col('Pending Signature').cards)).toContain('na-000')
    // A stale version is still refused, as before.
    expect((await call('PATCH', '/api/pipeline', { upsert: [{ lead: { ...moved, stage: 'No Answer' } }], remove: [], baseVersion: v })).status).toBe(409)
  })
})
