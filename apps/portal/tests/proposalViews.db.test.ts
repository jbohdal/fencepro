/**
 * Proposal opens against the dev database (DEV_DB=1 and ezbiz_dev only), on a
 * company made for the test and removed after:
 *   - a customer's open is recorded and counted once (a reload is the same open)
 *   - staff opens (the app's preview link, a device staff used) are recorded,
 *     marked, never counted and never pushed
 *   - heartbeats: time per option, the signature reached
 *   - the push: first open and a reopen after 2+ days, each once; none within
 *     2 days; none when turned off in Settings; on the dev copy logged only
 *   - Follow ups: "Opened in the last 24h", scoped like the rest of the list
 *   - the customer's history, with Staff view
 * Database writes happen only inside beforeAll / test / afterAll.
 */
import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('proposal opens (dev database)', () => {
  let prisma: any
  let V: typeof import('../src/server/lib/proposalViews.js')
  let F: typeof import('../src/server/lib/followUps.js')
  let D: typeof import('../src/server/lib/staffDevices.js')
  const tag = `pv-${Date.now().toString(36)}`
  let accountId = '', contactId = '', quoteId = ''
  const u: Record<string, { id: string; name: string; email: string }> = {}
  const cardId = `${tag}-card`
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 test'
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15 test'
  const req = (ua: string, ip: string) => ({ headers: { 'user-agent': ua }, ip, socket: {} }) as any
  const quote = async () => prisma.savedQuote.findUnique({ where: { id: quoteId } })
  const views: string[] = []
  const back = async (days: number) => {
    const ms = days * 86_400_000
    for (const v of await prisma.proposalView.findMany({ where: { quoteId } })) {
      await prisma.proposalView.update({ where: { id: v.id }, data: { startedAt: new Date(v.startedAt.getTime() - ms), lastSeenAt: new Date(v.lastSeenAt.getTime() - ms) } })
    }
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    V = await import('../src/server/lib/proposalViews.js')
    F = await import('../src/server/lib/followUps.js')
    D = await import('../src/server/lib/staffDevices.js')
    const a = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = a.id
    for (const [k, role, last] of [['owner', 'super_admin', 'Owner'], ['a', 'sales_rep', 'Alpha'], ['b', 'sales_rep', 'Bravo']] as const) {
      const email = `${tag}-${k}@example.test`
      const x = await prisma.crmUser.create({ data: { email, firstName: 'Test', lastName: `${last} ${tag}`, role, status: 'active', crmAccountId: accountId, mustChangePassword: false } })
      u[k] = { id: x.id, name: `Test ${last} ${tag}`, email }
    }
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Pat', lastName: tag, phone: '', email: null } })
    contactId = c.id
    await prisma.pipelineState.create({ data: { accountId, leads: [{ id: cardId, customerId: contactId, firstName: 'Pat', lastName: tag, stage: 'Pending Signature', assignedRep: u.a.name, lastMoved: '2026-10-19', createdAt: '2026-10-19' }], stages: [] } })
    const options = [
      { label: 'White 6 ft', tier: { label: 'Good' }, fenceStyle: 'A', finalPrice: 7400, perFoot: 0, sections: 10 },
      { label: 'White 6 ft no dig', tier: { label: 'Better' }, fenceStyle: 'B', finalPrice: 8200, perFoot: 0, sections: 10 },
      { label: 'Tan 6 ft', tier: { label: 'Best' }, fenceStyle: 'C', finalPrice: 9100, perFoot: 0, sections: 12 },
    ]
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: contactId, customerName: `Pat ${tag}`, runs: [100], pullSheet: [], status: 'SENT', shareToken: `${tag}-link`, finalPrice: 8200, proposal: { version: 1, options, recommended: 1 } } })
    quoteId = q.id
  })
  afterAll(async () => {
    D?.forgetStaffDevices()
    if (!accountId) return
    await prisma.proposalView.deleteMany({ where: { accountId } })
    if (quoteId) await prisma.automationEffect.deleteMany({ where: { key: { startsWith: `proposal-opened:${quoteId}:` } } })
    await prisma.notification.deleteMany({ where: { recipientId: { startsWith: tag } } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('a customer open is recorded and counted once; a reload on the same phone is the same open', async () => {
    const first = await V.startView(req(IPHONE, '198.51.100.7'), await quote(), undefined)
    expect(first.staff).toBe(false)
    expect(first.push).toBe(true)
    views.push(first.id)
    const again = await V.startView(req(IPHONE, '198.51.100.7'), await quote(), undefined)
    expect(again.id).toBe(first.id)
    expect(again.push).toBe(false)
    const q = await quote()
    expect(q.viewCount).toBe(1)
    expect(q.lastViewedAt).not.toBeNull()
    const row = await prisma.proposalView.findUnique({ where: { id: first.id } })
    expect(row).toMatchObject({ cardId, crmContactId: contactId, device: 'iPhone', staff: false, pushTrigger: 'first', pushKey: `proposal-opened:${quoteId}:first` })
    expect(row.ipHash).toBeTruthy()
    expect(row.ipHash).not.toContain('198.51')
  })

  test('heartbeats: time per option, capped, and the signature reached', async () => {
    const q = await quote()
    const id = views[0]
    const startedAt = (await prisma.proposalView.findUnique({ where: { id } })).startedAt
    expect(await V.beatView(q, id, { o: { 0: 2000, 1: 9000 }, a: 11_000 }, new Date(startedAt.getTime() + 15_000))).toBe(true)
    expect(await V.beatView(q, id, { o: { 0: 2000, 1: 20_000, 2: 4000 }, a: 26_000, sig: true }, new Date(startedAt.getTime() + 30_000))).toBe(true)
    // Not this quote's open: refused.
    expect(await V.beatView({ id: 'other', proposal: q.proposal }, id, { a: 1 })).toBe(false)
    const row = await prisma.proposalView.findUnique({ where: { id } })
    expect(row.optionMs).toEqual({ 0: 2000, 1: 20_000, 2: 4000 })
    expect(row.activeMs).toBe(26_000)
    expect(row.reachedSignature).toBe(true)
  })

  test('staff opens: the app\'s preview link and a device staff used; marked, not counted, never pushed', async () => {
    const preview = V.makePreviewToken(u.owner.id, quoteId)
    const s1 = await V.startView(req(MAC, '203.0.113.9'), await quote(), preview)
    expect(s1.staff).toBe(true)
    expect(s1.push).toBe(false)
    D.noteStaffDevice(req(MAC + ' office', '203.0.113.10'), u.a.id, accountId)
    const s2 = await V.startView(req(MAC + ' office', '203.0.113.10'), await quote(), undefined)
    expect(s2.staff).toBe(true)
    const rows = await prisma.proposalView.findMany({ where: { id: { in: [s1.id, s2.id] } }, orderBy: { startedAt: 'asc' } })
    expect(rows.map((r: any) => [r.staffHow, r.staffUserId, r.pushTrigger])).toEqual([['preview', u.owner.id, null], ['device', u.a.id, null]])
    expect((await quote()).viewCount).toBe(1)
    // A preview mark made for another quote is not staff here.
    const other = await V.startView(req(MAC, '203.0.113.11'), await quote(), V.makePreviewToken(u.owner.id, 'another-quote'))
    expect(other.staff).toBe(false)
    // ...and that second customer open, minutes after the first, earns no push.
    expect(other.push).toBe(false)
    expect((await quote()).viewCount).toBe(2)
  })

  test('the first open pushes the card owner once; on the dev copy it is logged, never delivered', async () => {
    let sent = 0
    const r1 = await V.proposalOpenedPush(views[0], { allowed: false, send: async () => { sent++ } })
    expect(r1.made).toBe(true)
    expect(r1.delivered).toBe(false)
    expect(r1.logged).toContain(`dev copy: push not delivered to ${u.a.name}: Proposal opened: Pat ${tag}`)
    const r2 = await V.proposalOpenedPush(views[0], { allowed: false })
    expect(r2.made).toBe(false)
    expect(await V.proposalOpenedSweep(new Date(), { allowed: false })).toBe(0)
    expect(sent).toBe(0)
    const notes = await prisma.notification.findMany({ where: { recipientId: u.a.email } })
    expect(notes.map((n: any) => n.title)).toEqual([`Proposal opened: Pat ${tag}`])
    expect(notes[0].link).toBe(`/pipeline?card=${cardId}`)
    // Where it is allowed (live), it is sent to the owner's phones only.
    const effect = await prisma.automationEffect.findUnique({ where: { key: `proposal-opened:${quoteId}:first` } })
    expect(effect.result.to).toBe(u.a.id)
  })

  test('a reopen after 2+ days pushes once; within 2 days nothing; turned off in Settings nothing', async () => {
    await back(3)
    const r = await V.startView(req(IPHONE, '198.51.100.7'), await quote(), undefined)
    expect(r.push).toBe(true)
    const row = await prisma.proposalView.findUnique({ where: { id: r.id } })
    expect(row.pushTrigger).toBe('reopen')
    let delivered = 0
    const p = await V.proposalOpenedPush(r.id, { allowed: true, send: async (_a, msg, to) => { delivered++; expect(to).toEqual([u.a.id]); expect(msg.title).toBe(`Pat ${tag} opened the proposal again`); expect(msg.body).toContain('Back after 3 days') } })
    expect(p).toMatchObject({ made: true, delivered: true })
    expect((await V.proposalOpenedPush(r.id, { allowed: true, send: async () => { delivered++ } })).made).toBe(false)
    expect(delivered).toBe(1)

    await back(1)
    const soon = await V.startView(req(IPHONE, '198.51.100.7'), await quote(), undefined)
    expect(soon.push).toBe(false)

    await prisma.businessState.create({ data: { accountId, config: { proposal: { notifyOpened: false } } } })
    await back(5)
    const off = await V.startView(req(IPHONE, '198.51.100.7'), await quote(), undefined)
    expect(off.push).toBe(true)
    expect((await V.proposalOpenedPush(off.id, { allowed: false })).why).toBe('turned off')
    expect(await prisma.notification.count({ where: { recipientId: u.a.email } })).toBe(2)
    await prisma.businessState.deleteMany({ where: { accountId } })
  })

  test('Follow ups: "Opened in the last 24h" for the card owner and the office, not another salesman', async () => {
    const a = await F.followUpList(accountId, { id: u.a.id, role: 'sales_rep' })
    expect(a.opened24h.map((r: any) => r.cardId)).toEqual([cardId])
    expect(a.opened24h[0].openedDevice).toBe('iPhone')
    const b = await F.followUpList(accountId, { id: u.b.id, role: 'sales_rep' })
    expect(b.opened24h).toEqual([])
    const o = await F.followUpList(accountId, { id: u.owner.id, role: 'super_admin' })
    expect(o.opened24h.map((r: any) => r.cardId)).toEqual([cardId])
    // Staff views alone never put a card here.
    await prisma.proposalView.updateMany({ where: { quoteId, staff: false, startedAt: { gt: new Date(Date.now() - 86_400_000) } }, data: { startedAt: new Date(Date.now() - 2 * 86_400_000) } })
    expect((await F.followUpList(accountId, { id: u.owner.id, role: 'super_admin' })).opened24h).toEqual([])
  })

  test('the customer\'s history: each open with its longest option and the signature; staff as Staff view; the badge count', async () => {
    await V.markSigned(quoteId, views[0])
    const h = await F.customerHistory(accountId, { customerId: contactId, cardId })
    const opens = h.filter(i => i.kind === 'proposal_opened').map(i => i.title)
    expect(opens).toContain('Proposal opened on iPhone, 26 sec, looked longest at Better ($8,200), signed')
    const staff = h.filter(i => i.kind === 'proposal_staff')
    expect(staff.length).toBe(2)
    expect(staff.every(i => i.title === 'Staff view')).toBe(true)
    expect(staff.map(i => i.by).sort()).toEqual([u.a.name, `Test Owner ${tag}`].sort())
    const { rows } = await F.cardRows(accountId)
    const q = await quote()
    expect(rows.find(r => r.cardId === cardId)?.opened).toEqual({ count: q.viewCount, lastAt: q.lastViewedAt.toISOString() })
    expect(q.viewCount).toBe(5)
  })
})
