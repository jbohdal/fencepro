/**
 * Lead sources and customer tags against the dev database (DEV_DB=1; refuses
 * any other).
 *
 * A throwaway company gets Settings' old plain lists (as live has them) and
 * customers, quotes, jobs and cards holding today's words (case twins,
 * Google, Repeat Customer, an old word, the import tags). Then:
 *   - the one-time step runs once (twice side by side), writes the two lists,
 *     and changes no record;
 *   - refused: a salesman or manager saving, /api/kv, an option on records
 *     deleted instead of merged, an old version, a built-in deleted;
 *   - merge and undo through the route; words on records listed with counts;
 *   - saves: a customer, quote or job saved with an option's name in other
 *     capital letters keeps the option's id; a linked word and an unknown
 *     word are kept as typed.
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
const SOURCES = ['Google', 'Facebook', 'Instagram', 'Yard Sign', 'Referral', 'Door Hanger', 'Repeat Customer', 'Nextdoor', 'Other']
const TAGS = ['Residential', 'Commercial', 'HOA']

describe.skipIf(!process.env.DEV_DB || !onDev)('Lead sources and tags (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: listsRoute } = await import('../src/server/routes/option-lists.js')
  const { default: kvRoute } = await import('../src/server/routes/kv.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const O = await import('../src/server/lib/optionLists.js')
  const M = await import('../src/server/lib/optionListModel.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const tag = `opt-lists-${crypto.randomUUID().slice(0, 8)}`
  let accountId = ''
  const tokens: Record<string, string> = {}
  const app = express()
  app.use(express.json())
  app.use('/api/option-lists', listsRoute)
  app.use('/api/kv', kvRoute)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown, as = 'super_admin') => fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[as]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const old = new Date(Date.now() - 400 * 86_400_000)
  // [word, recent customer]
  const CUSTOMERS: Array<[string | null, string[], Date | null]> = [
    ['website/google', ['Imported', 'JobNimbus'], null], ['website/google', [], null], ['Google', [], null], ['yard sign', [], null],
    ['facebook', ['Residential'], null], ['repeat business', [], null], ['vehicle wrap', ['From schedule'], old], [null, [], null],
  ]
  const snapshot = async () => ({
    c: await prisma.crmContact.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, leadSource: true, tags: true, updatedAt: true } }),
    q: await prisma.savedQuote.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, leadSource: true, updatedAt: true } }),
    j: await prisma.savedJob.findMany({ where: { accountId }, orderBy: { id: 'asc' }, select: { id: true, leadSource: true, updatedAt: true } }),
    p: (await prisma.pipelineState.findUnique({ where: { accountId } }))!.leads,
  })

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    for (const r of ['super_admin', 'manager', 'sales_rep']) tokens[r] = jwt.sign({ sub: user.id, email: user.email, role: r, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
    await prisma.businessState.create({ data: { accountId, config: { leadSources: SOURCES, customerTags: TAGS } as any } })
    let i = 0
    for (const [w, t, at] of CUSTOMERS) {
      await prisma.crmContact.create({ data: { accountId, firstName: 'Test', lastName: `${tag} ${i++}`, leadSource: w, tags: t as any, ...(at ? { createdAt: at } : {}) } })
    }
    await prisma.savedQuote.create({ data: { accountId, customerName: `${tag} q`, leadSource: 'Repeat Customer', fenceStyle: 'WV', date: '2026-10-01', runs: [], pullSheet: [] } as any })
    await prisma.savedJob.create({ data: { accountId, customerName: `${tag} j`, leadSource: 'Google' } as any })
    await prisma.pipelineState.create({ data: { accountId, leads: [{ id: `${tag}-c1`, stage: 'First Contact', leadSource: 'Billboard maricamp', tags: ['VIP'] }] as any, stages: [] } })
  })

  afterAll(async () => {
    server.close()
    if (!accountId) return
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { startsWith: tag } } }).catch(() => {})
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the one-time step runs once, writes both lists, and changes no record', async () => {
    const before = await snapshot()
    const [a, b] = await Promise.all([O.ensureOptionLists(accountId), O.ensureOptionLists(accountId)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    const out = (a ?? b)!
    expect([...out.leadSources.caseLinks].sort((x, y) => x.word.localeCompare(y.word))).toEqual([{ word: 'facebook', into: 'Facebook' }, { word: 'yard sign', into: 'Yard Sign' }])
    expect(out.leadSources.merged).toEqual([{ from: 'Google', into: 'website/google' }, { from: 'Repeat Customer', into: 'repeat business' }])
    expect(out.leadSources.hidden).toEqual(['Billboard maricamp', 'vehicle wrap'])   // no customer in 12 months (a card only; an old customer)
    expect(await O.ensureOptionLists(accountId)).toBeNull()
    const ls = await O.loadOptionList(accountId, 'leadSources')
    const tg = await O.loadOptionList(accountId, 'customerTags')
    expect(ls.options.filter(o => o.builtIn).map(o => [o.id, o.hidden])).toEqual([['Website Quote', true], ['Phone (AI receptionist)', true], ['Website chat', true], ['Phone call', false], ['Walk-in', false]])
    expect(tg.options.filter(o => o.builtIn).map(o => [o.id, o.hidden])).toEqual([['Imported', true], ['JobNimbus', true], ['From schedule', true], ['MyBudgetQuote import', true], ['MyBudgetQuote dropoff', true], ["Didn't finish instant quote", true]])
    expect(tg.options.find(o => o.id === 'VIP')!.hidden).toBe(true)     // only on a card, no customer has it
    expect(await snapshot()).toEqual(before)
    // Every word on records belongs to an option.
    for (const kind of ['leadSources', 'customerTags'] as const) {
      const words = await O.recordWords(accountId, kind)
      expect(M.foundOnRecords((await O.loadOptionList(accountId, kind)).options, words)).toEqual([])
    }
  })

  test('refused: a salesman or manager saving, /api/kv, an option in use deleted, an old version, a built-in deleted', async () => {
    const cur = (await call('GET', '/api/option-lists/leadSources')).json.data
    for (const r of ['sales_rep', 'manager']) {
      const x = await call('PUT', '/api/option-lists/leadSources', { options: cur.options, baseVersion: cur.version }, r)
      expect(x.status).toBe(403); expect(x.json.code).toBe('NOT_ALLOWED')
    }
    expect((await call('GET', '/api/option-lists', undefined, 'sales_rep')).status).toBe(200)
    expect((await call('PUT', `/api/kv/${O.OPTION_LIST_KEY.leadSources}`, { value: [], baseVersion: cur.version })).status).toBe(403)
    expect((await call('PUT', `/api/kv/${O.OPTION_LIST_KEY.customerTags}`, { value: [], baseVersion: 0 }, 'manager')).status).toBe(403)
    const inUse = await call('PUT', '/api/option-lists/leadSources', { options: cur.options.filter((o: any) => o.id !== 'website/google'), baseVersion: cur.version })
    expect(inUse.status).toBe(409); expect(inUse.json.code).toBe('IN_USE')
    expect((await call('PUT', '/api/option-lists/leadSources', { options: cur.options, baseVersion: cur.version - 1 })).json.code).toBe('STALE')
    const noBuiltIn = await call('PUT', '/api/option-lists/leadSources', { options: cur.options.filter((o: any) => o.id !== 'Website chat'), baseVersion: cur.version })
    expect(noBuiltIn.status).toBe(400)
    // An unused option can simply go.
    const ok = await call('PUT', '/api/option-lists/leadSources', { options: cur.options.filter((o: any) => o.id !== 'Nextdoor'), baseVersion: cur.version })
    expect(ok.status).toBe(200)
  })

  test('merge and undo through the route; words listed with counts', async () => {
    const cur = (await call('GET', '/api/option-lists/leadSources')).json.data
    const m = M.mergeOption(cur.options, 'Yard Sign', 'Other', new Date().toISOString())
    if (!('list' in m)) throw new Error(m.error)
    const merged = await call('PUT', '/api/option-lists/leadSources', { options: m.list, baseVersion: cur.version })
    expect(merged.status).toBe(200)
    expect(M.groupKeyFor(merged.json.data.options, 'yard sign')).toBe('Other')
    const u = M.undoMerge(merged.json.data.options, 'Other', 'Yard Sign')
    if (!('list' in u)) throw new Error(u.error)
    const undone = await call('PUT', '/api/option-lists/leadSources', { options: u.list, baseVersion: merged.json.data.version })
    expect(undone.status).toBe(200)
    expect(M.groupKeyFor(undone.json.data.options, 'yard sign')).toBe('Yard Sign')
    const words = (await call('GET', '/api/option-lists/leadSources/words')).json.data
    expect(words.find((w: any) => w.word === 'website/google')).toMatchObject({ count: 2, tables: { customers: 2 } })
    expect(words.find((w: any) => w.word === 'Google')).toMatchObject({ count: 2, tables: { customers: 1, jobs: 1 } })
  })

  test('saves keep an id or linked word, make a name in any case the id, keep anything else as typed', async () => {
    expect(await O.canonicalWord(accountId, 'leadSources', 'INSTAGRAM')).toBe('Instagram')
    expect(await O.canonicalWord(accountId, 'leadSources', 'Google')).toBe('Google')
    expect(await O.canonicalWord(accountId, 'leadSources', 'Billbord')).toBe('Billbord')
    expect(await O.canonicalTags(accountId, ['residential', 'JobNimbus', 'Pool'])).toEqual(['Residential', 'JobNimbus', 'Pool'])
  })
})
