/**
 * Customers see and sign change orders (dev database, DEV_DB=1; refuses any other).
 *
 * - The customer portal lists only this customer's change orders (their own
 *   quotes), sent / approved / void-after-sent, never a draft, a cost, who made
 *   it, the IP or the signature image.
 * - "Approve and sign" in the portal: approved, with the typed name, signature,
 *   time, IP and browser; the job's contract value goes up as when the office
 *   approves; sent again it stands; another customer's is "not found".
 * - The change order's link /p/co/<token>: the page, signing, and a draft is
 *   not shown.
 * - The portal signs in with its session cookie (lib/portalSession.ts); a
 *   login with no customer, and the old Bearer tokens, are refused.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('customers see and sign change orders (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: portal } = await import('../src/server/routes/portal.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { changeOrderPublic } = await import('../src/server/routes/changeOrderPublic.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { isCostKey } = await import('../src/server/lib/costRedact.js')
  const staffSecret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const portalSecret = resolveSecret('JWT_SECRET', 'dev-secret-change-me')
  const { hashPassword } = await import('../src/server/lib/auth.js')

  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[], portal: [] as string[] }
  let accountId = '', owner = '', base = '', mine = '', theirs = '', noCustomer = ''
  let server: ReturnType<express.Express['listen']>
  // A portal sign in is its cookie ("ezbiz_portal=…"); anything else is sent as a Bearer token.
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who.startsWith('ezbiz_portal=') ? { Cookie: who, 'X-Portal-Request': '1' } : who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json', 'User-Agent': 'E2E change order test' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, text: r.headers.get('content-type')?.includes('html') ? await r.text() : '', json: r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => null) as any : null }))
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach(x => keysOf(x, out))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) }
    return out
  }

  async function signedQuoteWithJob(contactId: string, price: number) {
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: contactId, customerName: 'E2E CO Sign Customer', fenceStyle: "WV-ND 6'x8' Privacy", runs: [80], pullSheet: [], finalPrice: price, materialCost: 300, totalCOGS: 500, status: 'SOLD', soldAt: new Date() } as any })
    made.quotes.push(q.id)
    const j = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, customerName: 'E2E CO Sign Customer', quotePrice: price, contractValue: price } as any })
    made.jobs.push(j.id)
    return q
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, staffSecret, { expiresIn: '10m' })
    for (const n of ['Mine', 'Theirs']) {
      const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E CO', lastName: n } as any })
      made.contacts.push(c.id)
    }
    const app = express()
    app.set('trust proxy', 1)
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/portal', portal)
    app.use('/api/change-orders', changeOrders)
    app.use('/p/co', changeOrderPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // Real portal logins, signed in through POST /api/portal/login (the session cookie).
    const passwordHash = await hashPassword('e2e-co-pass-1')
    const signIn = async (email: string, crmCustomerId: string) => {
      const a = await prisma.portalAccount.create({ data: { email, crmCustomerId, status: 'active', passwordHash, firstName: 'E2E CO' } })
      made.portal.push(a.id)
      const r = await fetch(`${base}/api/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'e2e-co-pass-1' }) })
      const cookie = (r.headers.get('set-cookie') || '').split(';')[0]
      expect(cookie).toMatch(/^ezbiz_portal=/)
      return cookie
    }
    const stamp = Date.now().toString(36)
    mine = await signIn(`e2e-co-mine-${stamp}@example.invalid`, made.contacts[0])
    theirs = await signIn(`e2e-co-theirs-${stamp}@example.invalid`, made.contacts[1])
    // A login whose customer is blank: its session must not read anything.
    noCustomer = await signIn(`e2e-co-none-${stamp}@example.invalid`, ' ')
  })

  afterAll(async () => {
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    await prisma.portalAccount.deleteMany({ where: { id: { in: made.portal } } }) // its sessions go with it
    server?.close()
  })

  test('the portal: only this customer\'s sent change orders, signed with name, signature, time, IP and browser; the job\'s contract value follows', async () => {
    const q = await signedQuoteWithJob(made.contacts[0], 4000)
    const other = await signedQuoteWithJob(made.contacts[1], 9000)
    const mk = async (quoteId: string, amountCents: number) => (await call(owner, 'POST', '/api/change-orders', { quoteId, reason: 'Add a walk gate', lines: [{ id: 'l1', description: 'Walk gate, 4 ft', amountCents }] })).json.data
    const draft = await mk(q.id, 10000)
    const sent = await mk(q.id, 45000)
    const theirsCo = await mk(other.id, 20000)
    for (const co of [sent, theirsCo]) expect((await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'sent' })).status).toBe(200)

    const list = await call(mine, 'GET', '/api/portal/change-orders')
    expect(list.status).toBe(200)
    expect(list.json.data.map((c: any) => c.id)).toEqual([sent.id]) // not the draft, not the other customer's
    expect(list.json.data[0]).toMatchObject({ number: 2, status: 'sent', totalCents: 45000, lines: [{ description: 'Walk gate, 4 ft', amountCents: 45000 }], quote: { priceCents: 400000 } })
    const keys = [...keysOf(list.json)]
    expect(keys.filter(isCostKey)).toEqual([])
    for (const k of ['createdBy', 'signature', 'signedIp', 'signedUserAgent', 'approvedBy', 'shareToken', 'accountId']) expect(keys).not.toContain(k)

    // Someone else's, or a draft: not found / not ready.
    expect((await call(theirs, 'POST', `/api/portal/change-orders/${sent.id}/sign`, { name: 'Intruder', signature: SIG })).status).toBe(404)
    expect((await call(mine, 'POST', `/api/portal/change-orders/${theirsCo.id}/sign`, { name: 'Intruder', signature: SIG })).status).toBe(404)
    expect((await call(mine, 'POST', `/api/portal/change-orders/${draft.id}/sign`, { name: 'E2E CO Mine', signature: SIG })).status).toBe(409)
    // Name and signature are required.
    expect((await call(mine, 'POST', `/api/portal/change-orders/${sent.id}/sign`, { name: ' ', signature: SIG })).status).toBe(400)
    expect((await call(mine, 'POST', `/api/portal/change-orders/${sent.id}/sign`, { name: 'E2E CO Mine', signature: 'nope' })).status).toBe(400)

    const s = await call(mine, 'POST', `/api/portal/change-orders/${sent.id}/sign`, { name: 'E2E CO Mine', signature: SIG })
    expect(s.status).toBe(200)
    expect(s.json.data).toMatchObject({ status: 'approved', signedBy: 'E2E CO Mine' })
    const row = (await prisma.changeOrder.findUnique({ where: { id: sent.id } }))!
    expect([row.status, row.signedBy, row.signature, row.signedVia, row.approvedBy]).toEqual(['approved', 'E2E CO Mine', SIG, 'portal', 'E2E CO Mine (customer)'])
    expect(row.signedAt).not.toBeNull()
    expect(row.signedIp).toBeTruthy()
    expect(row.signedUserAgent).toBe('E2E change order test')
    // The same as the office approving it: quote price + approved change orders.
    const job = (await prisma.savedJob.findUnique({ where: { id: made.jobs[0] } }))!
    expect([job.changeOrderTotal, job.contractValue]).toEqual([450, 4450])
    // Sent again (the answer was lost): it stands; another name is refused.
    expect((await call(mine, 'POST', `/api/portal/change-orders/${sent.id}/sign`, { name: 'E2E CO Mine', signature: SIG })).status).toBe(200)
    expect((await call(mine, 'POST', `/api/portal/change-orders/${sent.id}/sign`, { name: 'Someone Else', signature: SIG })).status).toBe(409)
    expect((await prisma.savedJob.findUnique({ where: { id: made.jobs[0] } }))!.contractValue).toBe(4450)
    // The office sees it signed.
    const office = await call(owner, 'GET', `/api/change-orders?quoteId=${q.id}`)
    expect(office.json.data.find((c: any) => c.id === sent.id)).toMatchObject({ status: 'approved', signedBy: 'E2E CO Mine', signedVia: 'portal' })
    // Void after it was sent: history for the customer. A draft voided is never shown.
    expect((await call(owner, 'PATCH', `/api/change-orders/${draft.id}`, { baseVersion: draft.version, status: 'void' })).status).toBe(200)
    expect((await call(mine, 'GET', '/api/portal/change-orders')).json.data.map((c: any) => [c.number, c.status])).toEqual([[2, 'approved']])
  })

  test('a portal login without a customer is refused (no unfiltered list), and so are the old Bearer tokens', async () => {
    expect((await call(noCustomer, 'GET', '/api/portal/change-orders')).status).toBe(401)
    expect((await call(noCustomer, 'GET', '/api/portal/media')).status).toBe(401)
    // The old portal token (a JWT naming the customer) no longer signs anyone in, even made with the real secret.
    const old = jwt.sign({ sub: made.portal[0], email: 'e2e-co-mine@example.test', role: 'portal_customer', accountId: made.contacts[0] }, portalSecret, { expiresIn: '10m' })
    expect((await call(old, 'GET', '/api/portal/change-orders')).status).toBe(401)
  })

  test('the change order\'s link: the page shows it, signing approves it, a draft is not shown', async () => {
    const q = await signedQuoteWithJob(made.contacts[0], 3000)
    const co = (await call(owner, 'POST', '/api/change-orders', { quoteId: q.id, reason: 'Credit for one section', lines: [{ id: 'l1', description: 'One section less', amountCents: -12500 }] })).json.data
    const l = await call(owner, 'POST', `/api/change-orders/${co.id}/link`)
    expect(l.status).toBe(200)
    const token = l.json.data.token as string
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect((await call(owner, 'POST', `/api/change-orders/${co.id}/link`)).json.data.token).toBe(token) // made once
    expect((await call('', 'GET', `/p/co/${token}`)).status).toBe(404) // still a draft
    const now = (await prisma.changeOrder.findUnique({ where: { id: co.id } }))!
    expect((await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: now.version, status: 'sent' })).status).toBe(200)
    const page = await call('', 'GET', `/p/co/${token}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('One section less')
    expect(page.text).toContain('Approve and sign')
    expect(page.text).toContain('−$125.00')
    expect(page.text).not.toMatch(/materialCost|totalCOGS|E2E CO Sign Customer.*cost/i)
    expect((await call('', 'GET', '/p/co/not-a-real-token-at-all-000000')).status).toBe(404)
    const s = await call('', 'POST', `/p/co/${token}/sign`, { name: 'E2E CO Link', signature: SIG })
    expect(s.status).toBe(200)
    const row = (await prisma.changeOrder.findUnique({ where: { id: co.id } }))!
    expect([row.status, row.signedBy, row.signedVia]).toEqual(['approved', 'E2E CO Link', 'link'])
    expect((await prisma.savedJob.findFirst({ where: { quoteId: q.id } }))!.contractValue).toBe(2875)
    const after = await call('', 'GET', `/p/co/${token}`)
    expect(after.text).toContain('Approved and signed by E2E CO Link')
    expect(after.text).not.toContain('id="go"')
  })
})
