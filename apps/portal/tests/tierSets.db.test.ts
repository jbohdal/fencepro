/**
 * Good, Better, Best tier sets, against the dev database (DEV_DB=1 and
 * ezbiz_dev only; vitest does not even load this file anywhere else).
 * Everything runs on a company made for the test and removed after it.
 *
 *   - The starting sets: made twice, then three times at once, one set per
 *     category; the database refuses a second set for a category; a set
 *     deleted stays deleted.
 *   - Old Settings → Proposals tiers are carried over (his edits kept).
 *   - A new set with the screen's own id: sent three times, then three times
 *     at once, one set. A save built on an old version is refused.
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('tier sets (dev database)', () => {
  let prisma: any
  let accountId = ''
  let token = ''
  let base = ''
  let server: Server
  const tag = `tiers-${Date.now().toString(36)}`
  const deletedIds: string[] = []
  const styles = [
    { name: "WV-ND 6'x6' Privacy", category: 'Vinyl' }, { name: "WV-DS 6'x8' Privacy", category: 'Vinyl' },
    { name: "CL - 4' Galv", category: 'Chainlink' }, { name: "CL - 4' Black", category: 'Chainlink' },
    { name: 'Alum - ND - Emily - 48', category: 'Aluminum' }, { name: 'Alum - DS - Emily - 48', category: 'Aluminum' },
  ]

  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    // His settings, with the old lineup edited: Good renamed, Best still the old tan default.
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: styles, proposal: { popular: 'better', tiers: [
      { key: 'good', label: 'Basic', color: 'white', install: 'dig-set', heightFt: 6, blurb: 'Dig set: posts set in concrete.' },
      { key: 'better', label: 'Better', color: 'white', install: 'no-dig', heightFt: 6, blurb: 'No dig: steel pipe driven deep, no concrete, faster install.' },
      { key: 'best', label: 'Best', color: 'tan', install: 'no-dig', heightFt: 6, blurb: 'Tan: premium color, on steel pipe driven deep with no concrete.' },
    ] } } } })
    token = jwt.sign({ sub: user.id, email: user.email, role: 'admin', firstName: 'Test', lastName: 'Tiers', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
    const app = express()
    app.use(express.json())
    app.use('/api/tier-sets', (await import('../src/server/routes/tier-sets.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const ids = (await prisma.proposalTierSet.findMany({ where: { accountId }, select: { id: true } })).map((r: any) => r.id)
    await prisma.crmAuditLog.deleteMany({ where: { entityType: 'ProposalTierSet', entityId: { in: [...ids, ...deletedIds] } } }).catch(() => {})
    for (const m of ['proposalTierSet', 'businessState', 'accountKeyValue']) {
      await prisma[m].deleteMany({ where: { accountId } }).catch(() => {})
    }
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[tierSets test] account cleanup:', e))
  })

  test('starting sets: made twice, then three times at once, one set per category', async () => {
    const { ensureTierSets } = await import('../src/server/lib/tierSets.js')
    await ensureTierSets(accountId)
    await ensureTierSets(accountId)
    await Promise.all([ensureTierSets(accountId), ensureTierSets(accountId), ensureTierSets(accountId)])
    const answers = await Promise.all([call('GET', '/api/tier-sets'), call('GET', '/api/tier-sets'), call('GET', '/api/tier-sets')])
    expect(answers.map(a => a.status)).toEqual([200, 200, 200])
    const rows = await prisma.proposalTierSet.findMany({ where: { accountId }, orderBy: { sortOrder: 'asc' } })
    expect(rows.map((r: any) => [r.category, r.starter, (r.tiers as any[]).length])).toEqual([['Vinyl', 'vinyl', 3], ['Chainlink', 'chainlink', 2], ['Aluminum', 'aluminum', 2]])
    expect(answers[2].json.data.map((r: any) => r.category)).toEqual(['Vinyl', 'Chainlink', 'Aluminum'])
    // The database refuses a second set for a category.
    await expect(prisma.proposalTierSet.create({ data: { accountId, category: 'Vinyl', tiers: [] } })).rejects.toMatchObject({ code: 'P2002' })
  })

  test('old tiers carried over: his rename kept, the tan Best replaced by the new lineup', async () => {
    const v = await prisma.proposalTierSet.findFirst({ where: { accountId, category: 'Vinyl' } })
    const tiers = v.tiers as any[]
    expect(tiers.map(t => [t.key, t.name, t.install, t.width, t.color])).toEqual([
      ['good', 'Basic', 'dig-set', 'cheapest', 'same'], ['better', 'Better', 'no-dig', 'cheapest', 'same'], ['best', 'Best', 'no-dig', '6', 'same'],
    ])
    expect(tiers[2].text).toBe('More posts per foot for the strongest fence we build.')
    expect(v.popular).toBe('better')
  })

  test('a set deleted stays deleted', async () => {
    const { ensureTierSets } = await import('../src/server/lib/tierSets.js')
    const al = await prisma.proposalTierSet.findFirst({ where: { accountId, category: 'Aluminum' } })
    deletedIds.push(al.id)
    expect((await call('DELETE', `/api/tier-sets/${al.id}`)).status).toBe(200)
    await call('GET', '/api/tier-sets')
    await ensureTierSets(accountId)
    expect(await prisma.proposalTierSet.count({ where: { accountId, category: 'Aluminum' } })).toBe(0)
  })

  test("a new set with the screen's id: three times, then three times at once, one set", async () => {
    const id = `${tag}-set`
    const body = { id, category: 'Commercial', tiers: [{ key: 'good', name: 'Good', install: 'same', width: 'same', color: 'same', text: '' }], popular: null }
    const seq = [await call('POST', '/api/tier-sets', body), await call('POST', '/api/tier-sets', body), await call('POST', '/api/tier-sets', body)]
    const par = await Promise.all([call('POST', '/api/tier-sets', body), call('POST', '/api/tier-sets', body), call('POST', '/api/tier-sets', body)])
    expect([...seq, ...par].every(a => a.status === 200 || a.status === 201)).toBe(true)
    expect(await prisma.proposalTierSet.count({ where: { accountId, category: 'Commercial' } })).toBe(1)
    // Another id for a category that has a set: refused, plainly.
    const other = await call('POST', '/api/tier-sets', { ...body, id: `${tag}-other` })
    expect(other.status).toBe(409)
    expect(other.json.error).toBe('There is already a set for Commercial.')
  })

  test('saving: tiers and Most popular saved; a save built on an old version is refused', async () => {
    const v = await prisma.proposalTierSet.findFirst({ where: { accountId, category: 'Vinyl' } })
    const tiers = (v.tiers as any[]).map(t => (t.key === 'best' ? { ...t, name: 'Premium', text: 'Our top fence.' } : t))
    const ok = await call('PUT', `/api/tier-sets/${v.id}`, { tiers, popular: 'best', version: v.version })
    expect(ok.status).toBe(200)
    expect(ok.json.data.tiers[2].name).toBe('Premium')
    expect(ok.json.data.popular).toBe('best')
    const stale = await call('PUT', `/api/tier-sets/${v.id}`, { tiers, popular: 'good', version: v.version })
    expect(stale.status).toBe(409)
    expect((await prisma.proposalTierSet.findUnique({ where: { id: v.id } })).popular).toBe('best')
    const four = await call('PUT', `/api/tier-sets/${v.id}`, { tiers: [...tiers, { ...tiers[0], key: 'x' }], popular: null, version: ok.json.data.version })
    expect(four.status).toBe(400)
  })
})
