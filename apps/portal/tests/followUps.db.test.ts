/**
 * Follow ups against the dev database (DEV_DB=1 and ezbiz_dev only): on a
 * company made for the test, with an owner and two salesmen, all removed after.
 *   - a card moved into Pending Signature starts its steps (the pipeline save)
 *   - an answer is saved once, however often it is sent
 *   - a salesman's Follow ups list has only their cards; the owner's everyone
 *   - the 7 am push: one per person per day, however often the worker runs;
 *     on the dev copy it is logged, never delivered
 *   - the first follow up: counted first, set only on cards with none
 * Database writes happen only inside beforeAll / test / afterAll.
 */
import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('follow ups (dev database)', () => {
  let prisma: any
  let F: typeof import('../src/server/lib/followUps.js')
  const tag = `fu-${Date.now().toString(36)}`
  let accountId = ''
  const u: Record<string, { id: string; name: string }> = {}
  const card = (id: string, rep: string, stage: string) => ({ id, firstName: id, lastName: tag, stage, assignedRep: rep, lastMoved: '2026-10-01', createdAt: '2026-10-01', customerId: null, quotePrice: 1000 })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    F = await import('../src/server/lib/followUps.js')
    const a = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = a.id
    for (const [k, role, last] of [['owner', 'super_admin', 'Owner'], ['a', 'sales_rep', 'Alpha'], ['b', 'sales_rep', 'Bravo']] as const) {
      const x = await prisma.crmUser.create({ data: { email: `${tag}-${k}@example.test`, firstName: 'Test', lastName: `${last} ${tag}`, role, status: 'active', crmAccountId: accountId, mustChangePassword: false } })
      u[k] = { id: x.id, name: `Test ${last} ${tag}` }
    }
    const before = [card('c1', u.a.name, 'Estimating'), card('c2', u.b.name, 'Estimating'), card('c3', '', 'Pending Signature')]
    await prisma.pipelineState.create({ data: { accountId, leads: before, stages: [] } })
  })
  afterAll(async () => {
    if (!accountId) return
    await prisma.callLog.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.pendingTouch.deleteMany({ where: { accountId } })
    await prisma.notification.deleteMany({ where: { recipientId: { startsWith: tag } } })
    for (const x of Object.values(u)) await prisma.automationEffect.deleteMany({ where: { key: { startsWith: `followup-morning:${x.id}:` } } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('moving cards into Pending Signature starts their steps', async () => {
    const before = (await prisma.pipelineState.findUnique({ where: { accountId } })).leads
    const after = before.map((l: any) => (l.id === 'c3' ? l : { ...l, stage: 'Pending Signature' }))
    await prisma.$transaction(async (tx: any) => {
      await tx.pipelineState.update({ where: { accountId }, data: { leads: after } })
      await F.onCardMoves(tx, accountId, before, after, '2026-10-19')
    })
    const rows = await prisma.cardFollowUp.findMany({ where: { accountId }, orderBy: { cardId: 'asc' } })
    expect(rows.map((r: any) => [r.cardId, r.dueOn, r.dueKind])).toEqual([['c1', '2026-10-21', 'call'], ['c2', '2026-10-21', 'call']])
  })

  test('an answer sent twice is saved once', async () => {
    const input = { id: `${tag}-call-1`, cardId: 'c1', channel: 'call' as const, outcome: 'no_answer' as const }
    const a = await F.logCall(accountId, u.a, input)
    const b = await F.logCall(accountId, u.a, input)
    expect(a.already).toBe(false); expect(b.already).toBe(true)
    expect(await prisma.callLog.count({ where: { accountId } })).toBe(1)
    expect(a.state.lastOutcome).toBe('no_answer')
  })

  test('a salesman sees only their cards; the owner everyone and can pick a rep', async () => {
    const ids = (l: any) => [...l.overdue, ...l.dueToday, ...l.upcoming, ...l.notSet].map((r: any) => r.cardId).sort()
    expect(ids(await F.followUpList(accountId, { id: u.a.id, role: 'sales_rep' }))).toEqual(['c1'])
    expect(ids(await F.followUpList(accountId, { id: u.b.id, role: 'sales_rep' }))).toEqual(['c2'])
    // A salesman asking for another rep still gets their own.
    expect(ids(await F.followUpList(accountId, { id: u.a.id, role: 'sales_rep' }, u.b.id))).toEqual(['c1'])
    // c3 has no salesman: the owner's, with "No follow up set".
    expect(ids(await F.followUpList(accountId, { id: u.owner.id, role: 'super_admin' }))).toEqual(['c1', 'c2', 'c3'])
    expect(ids(await F.followUpList(accountId, { id: u.owner.id, role: 'super_admin' }, u.b.id))).toEqual(['c2'])
    expect(ids(await F.followUpList(accountId, { id: 'x', role: 'office_staff' }))).toEqual(['c1', 'c2', 'c3'])
  })

  test('the 7 am push: once per person per day, logged and not delivered on the dev copy', async () => {
    await F.changeNext(accountId, u.a.id, 'c1', { dueOn: '2026-10-19' })
    await F.changeNext(accountId, u.b.id, 'c2', { dueOn: '2026-10-18' })
    const at7 = new Date('2026-10-19T11:30:00Z') // 7:30 am in Florida
    const sent: string[] = []
    const send = async (_a: string, _m: any, ids: string[]) => { sent.push(...ids) }
    const one = await F.followUpMorningPush(at7, { send, allowed: false, accountIds: [accountId] })
    const two = await F.followUpMorningPush(new Date(at7.getTime() + 3600_000), { send, allowed: false, accountIds: [accountId] })
    const mine = (o: { logged: string[] }) => o.logged.filter(l => l.includes(tag)).length
    expect(mine(one)).toBe(2); expect(mine(two)).toBe(0)
    expect(sent).toEqual([])
    expect(await prisma.automationEffect.count({ where: { key: `followup-morning:${u.a.id}:2026-10-19` } })).toBe(1)
    expect(await prisma.notification.count({ where: { recipientId: `${tag}-a@example.test` } })).toBe(1)
    // Before 7 am nothing.
    const early = await F.followUpMorningPush(new Date('2026-10-20T10:00:00Z'), { send, allowed: false, accountIds: [accountId] })
    expect(early.made).toBe(0)
  })

  test('first follow up: only cards with none, due tomorrow, for the card\'s owner', async () => {
    const p = await F.firstFollowUpPreview(accountId)
    expect(p.count).toBe(1)
    expect(p.byOwner).toEqual([{ ownerId: u.owner.id, name: u.owner.name, count: 1 }])
    const r = await F.runFirstFollowUp(accountId)
    expect(r.set).toBe(1)
    const row = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: 'c3' } } })
    expect(row.dueOn).toBe(r.dueOn); expect(row.setBy).toBe('first'); expect(row.ownerUserId).toBe(u.owner.id)
    expect((await F.firstFollowUpPreview(accountId)).count).toBe(0)
  })

  test('an install text logged as sent: in the card\'s History once, no follow up changed, not counted in the report', async () => {
    const before = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: 'c2' } } })
    const reportBefore = await F.followUpReport(accountId, { id: u.owner.id, role: 'super_admin' }, '2020-01-01', '2099-12-31')
    const input = { id: `${tag}-text-1`, crmContactId: null, cardId: 'c2', stage: 'Pending Signature', note: 'Install date text to (352) 555 0142.' }
    const a = await F.logSentText(accountId, u.b, input)
    const b = await F.logSentText(accountId, u.b, input)
    expect(a.already).toBe(false); expect(b.already).toBe(true)
    expect(await prisma.callLog.count({ where: { accountId, cardId: 'c2' } })).toBe(1)
    const h = await F.customerHistory(accountId, { cardId: 'c2' })
    expect(h.filter(i => i.kind === 'text').map(i => [i.title, i.detail, i.by])).toEqual([['Text sent', 'Install date text to (352) 555 0142.', u.b.name]])
    const after = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: 'c2' } } })
    expect(after?.dueOn).toBe(before?.dueOn); expect(after?.lastOutcome ?? null).toBe(before?.lastOutcome ?? null)
    const reportAfter = await F.followUpReport(accountId, { id: u.owner.id, role: 'super_admin' }, '2020-01-01', '2099-12-31')
    expect(reportAfter.totals.calls).toBe(reportBefore.totals.calls)
  })
})
