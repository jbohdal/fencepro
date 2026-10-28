/**
 * A job waiting on its 811 locate or permit moves on by itself (Jonathan, Oct
 * 27 2026; review Oct 27: a signed job stayed in Awaiting Locates after the
 * office entered its 811 ticket, Clear to dig, and an Approved permit).
 * Against the dev database (DEV_DB=1; refuses any other), through the same
 * saves the job page makes (PUT /api/saved-jobs/:id/locate, PUT
 * /api/automations/permits/:jobId), and the daily sweep on a company made for
 * the test:
 *
 *   - locate Clear to dig, permit not set: → Permit Pending, with "Moved to
 *     Permit Pending by itself: 811 locate is clear to dig." in the job
 *     history; permit Approved: → Need Drawing; another browser reads it;
 *   - a good to dig day still ahead ("Called") does not move it; the sweep
 *     moves it on that day, once;
 *   - the quote has a drawing but nothing is ordered: → Need Drawing, never
 *     Materials Ordered (round 2, Oct 28 2026), its history line saying it is
 *     drawn and moves on when the Sales Order is marked Ordered; with its
 *     materials already ordered: → Materials Ordered;
 *   - a repair: → Ready to Pull (the stage that stands for ready to schedule);
 *     on a company made for the test with a stage "  ready   TO schedule "
 *     added after Ready to Pull: → that stage, and Advance from Ready to Pull
 *     reaches it; one placed after Scheduled is not used (it stands for
 *     scheduled): → Ready to Pull;
 *   - dragged back: saving the locate or permit again (already clear / issued)
 *     and the next sweep leave it where the office put it;
 *   - a job the office put further along stays (never backward);
 *   - a move and a materials change by hand say who in the Job history; an
 *     Installer cannot read it (audit #47).
 *
 * Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a job moves on by itself once its 811 locate is clear and its permit is in (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { locatesClearSweep, stageFollowsLocateAndPermit, readyStageOf, LOCATE_SWEEP_KEY, LOCATE_REASON, AUTO_MOVE_KIND, DRAWN_WAITS_WORDS } = await import('../src/server/lib/waitingStageMove.js')
  const { OPS_STAGES_KEY, loadOpsStages } = await import('../src/server/lib/opsStages.js')
  const { START_OPS_STAGES, advanceStageOf, phaseOf, HELD_FOR_DRAWING_WORDS } = await import('../src/server/lib/opsStageModel.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use('/api/saved-jobs', jobs)
  app.use('/api/automations', automations)
  app.use('/api/change-orders', changeOrders)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const tag = `lsm-${crypto.randomUUID().slice(0, 8)}`
  const made = { jobs: [] as string[], quotes: [] as string[], account: '', accounts: [] as string[] }
  const fl = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const today = fl(new Date())
  const tomorrow = fl(new Date(Date.now() + 86_400_000))
  const clear = { ticket: '302610270001', calledDate: today, goodDate: today, expDate: '2099-12-31' }

  async function mk(name: string, extra: Record<string, unknown>, quote?: Record<string, unknown>, acct = accountId) {
    let quoteId: string | undefined
    if (quote) {
      const q = await prisma.savedQuote.create({ data: { accountId: acct, customerName: `Testy ${tag} ${name}`, customerAddress: '1 Test Ln, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", runs: [40], pullSheet: [], finalPrice: 900, status: 'SOLD', soldAt: new Date(), ...quote } as any })
      made.quotes.push(q.id)
      quoteId = q.id
    }
    const j = await prisma.savedJob.create({ data: { accountId: acct, customerName: `Testy ${tag} ${name}`, status: 'staging', opsStage: 'awaiting_locates', ...(quoteId ? { quoteId } : {}), ...extra } as any })
    made.jobs.push(j.id)
    return j.id
  }
  const job = (id: string) => prisma.savedJob.findUniqueOrThrow({ where: { id } })
  const notes = async (id: string) => (await prisma.activityLog.findMany({ where: { entityType: 'job', entityId: id }, orderBy: { createdAt: 'asc' } })).filter(l => (l.metadata as any)?.kind === AUTO_MOVE_KIND).map(l => l.body)
  /** The office drags the card back on the board. */
  const dragBack = (id: string, stage: string) => prisma.savedJob.update({ where: { id }, data: { opsStage: stage } })

  afterAll(async () => {
    await prisma.permit.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: made.jobs } } })
    await prisma.automationRun.deleteMany({ where: { entityId: { in: made.jobs } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.task.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: made.jobs } } })
    await prisma.activityLog.deleteMany({ where: { entityType: 'job', entityId: { in: made.jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    for (const a of [made.account, ...made.accounts].filter(Boolean)) {
      await prisma.accountKeyValue.deleteMany({ where: { accountId: a } })
      await prisma.crmAccount.delete({ where: { id: a } }).catch(() => {})
    }
    server.close()
  })

  test('locate clear: → Permit Pending, with a history line; permit Approved: → Need Drawing; another browser sees it', async () => {
    const id = await mk('A', {})
    const since = (await call('GET', '/api/saved-jobs')).json.serverTime as string

    const r = await call('PUT', `/api/saved-jobs/${id}/locate`, clear)
    expect(r.status).toBe(200)
    expect(r.json.data.opsStage).toBe('permit_pending')

    expect((await call('PUT', `/api/automations/permits/${id}`, { status: 'approved' })).status).toBe(200)
    const after = await job(id)
    expect([after.opsStage, after.status, after.materialsStatus, after.drawingComplete]).toEqual(['need_drawing', 'staging', 'not_ordered', false])
    expect(await notes(id)).toEqual([
      'Moved to Permit Pending by itself: 811 locate is clear to dig.',
      'Moved to Need Drawing by itself: permit is Approved.',
    ])
    // The job window's Job history shows it: from → to, by itself, the reason, one line each (lib/jobMoveHistory.ts, audit #47).
    const tl = await call('GET', `/api/change-orders/timeline?jobId=${id}`)
    const moves = (tl.json.data.items as any[]).filter(i => i.kind === 'stage')
    expect(moves.map(i => i.title)).toEqual(['Moved from Permit Pending to Need Drawing automatically:', 'Moved from Awaiting Locates to Permit Pending automatically:'])
    expect(moves[0].detail).toMatch(/^permit is Approved\. \(Permit saved, /)
    expect(moves[1].detail).toMatch(/^811 locate is clear to dig\. \(811 locate saved, /)
    // A second browser, on its next read.
    const next = await call('GET', `/api/saved-jobs?since=${encodeURIComponent(since)}`)
    expect((next.json.data as any[]).find(j => j.id === id)?.opsStage).toBe('need_drawing')

    // Dragged back: saving the locate again (still clear) or the permit again (still issued) leaves it there.
    await dragBack(id, 'awaiting_locates')
    await call('PUT', `/api/saved-jobs/${id}/locate`, { ...clear, expDate: '2099-11-30' })
    await call('PUT', `/api/automations/permits/${id}`, { status: 'passed' })
    expect((await job(id)).opsStage).toBe('awaiting_locates')
    expect((await notes(id)).length).toBe(2)
  })

  test('a good to dig day still ahead ("Called") does not count; permit first waits for the locate', async () => {
    const id = await mk('B', {})
    expect((await call('PUT', `/api/automations/permits/${id}`, { status: 'approved' })).status).toBe(200)
    expect((await job(id)).opsStage).toBe('awaiting_locates')
    await call('PUT', `/api/saved-jobs/${id}/locate`, { ...clear, goodDate: tomorrow })
    expect((await job(id)).opsStage).toBe('awaiting_locates')
    // The office corrects the good to dig day to today: now it is clear.
    await call('PUT', `/api/saved-jobs/${id}/locate`, clear)
    expect((await job(id)).opsStage).toBe('need_drawing')
  })

  test('the quote has a drawing but nothing is ordered: Need Drawing, never Materials Ordered; ordered already: Materials Ordered', async () => {
    const id = await mk('C', {}, { layout: { yard: { sides: [] } } })
    await prisma.permit.create({ data: { accountId, jobId: id, status: 'approved' } })
    await call('PUT', `/api/saved-jobs/${id}/locate`, clear)
    const c = await job(id)
    expect([c.opsStage, c.materialsStatus]).toEqual(['need_drawing', 'not_ordered'])
    // The stage rule's "drawing not done" is not written by a move by itself: the job keeps what it had.
    expect(c.drawingComplete).toBe(false)
    expect(await notes(id)).toEqual([`Moved to Need Drawing by itself: 811 locate is clear to dig. ${DRAWN_WAITS_WORDS}`])

    // Its materials were ordered before the locate cleared: it belongs in Materials Ordered.
    const o = await mk('C2', { materialsStatus: 'ordered' }, { layout: { widgetDrawing: { lines: [] } } })
    await prisma.permit.create({ data: { accountId, jobId: o, status: 'not_needed' } })
    await call('PUT', `/api/saved-jobs/${o}/locate`, clear)
    expect((await job(o)).opsStage).toBe('materials_ordered')
    expect(await notes(o)).toEqual(['Moved to Materials Ordered by itself: 811 locate is clear to dig.'])
  })

  test('still to be drawn with its materials in: held in Need Drawing, and its history says it waits for its drawing (audit #55)', async () => {
    const id = await mk('H', { materialsStatus: 'received' })
    await prisma.permit.create({ data: { accountId, jobId: id, status: 'not_needed' } })
    await call('PUT', `/api/saved-jobs/${id}/locate`, clear)
    expect((await job(id)).opsStage).toBe('need_drawing')
    expect(await notes(id)).toEqual([`Moved to Need Drawing by itself: 811 locate is clear to dig. ${HELD_FOR_DRAWING_WORDS}.`])
    const tl = await call('GET', `/api/change-orders/timeline?jobId=${id}`)
    const line = (tl.json.data.items as any[]).find(i => i.title === 'Moved from Awaiting Locates to Need Drawing automatically:')
    expect(line?.detail).toMatch(/^811 locate is clear to dig\. Materials in; waits for its drawing\. \(811 locate saved, /)
  })

  test('a repair (permit Not needed): → Ready to Pull, the stage for ready to schedule', async () => {
    const id = await mk('D', {}, { work: { type: 'repair' } })
    await call('PUT', `/api/saved-jobs/${id}/locate`, clear)
    expect((await job(id)).opsStage).toBe('ready_to_pull')
  })

  test('Ready to Schedule: a stage of that name added in Settings (any case, extra spaces) takes repairs; placed after Scheduled it is not used', async () => {
    const S = (id: string, name: string, at: number) => ({ id, name, color: '#0ea5e9', order: 0, hidden: false, isFirst: false, isComplete: false, lane: 'main' as const, at })
    /** A company made for the test with the start list plus one stage put after the stage `after`. */
    async function company(name: string, after: string) {
      const acct = (await prisma.crmAccount.create({ data: { name: `Test ${tag} ${name}` } })).id
      made.accounts.push(acct)
      const list: any[] = START_OPS_STAGES.map(s => ({ ...s }))
      list.splice(list.findIndex(s => s.id === after) + 1, 0, S('stage_rts_' + name.toLowerCase(), '  ready   TO schedule ', 0))
      await prisma.accountKeyValue.create({ data: { accountId: acct, key: OPS_STAGES_KEY, value: list.map(({ at: _a, ...s }, i) => ({ ...s, order: i })) } })
      return acct
    }
    const repairOn = async (acct: string, n: string) => {
      const id = await mk(n, { locateTicket: clear.ticket, locateCalledDate: today, locatesDate: today, locatesExpDate: clear.expDate }, { work: { type: 'repair' } }, acct)
      await stageFollowsLocateAndPermit(acct, id, LOCATE_REASON, 'test')
      return job(id)
    }

    // After Ready to Pull, where it belongs: a waiting stage, the last one before Scheduled.
    const good = await company('Good', 'ready_to_pull')
    const { stages } = await loadOpsStages(good)
    expect(readyStageOf(stages)).toBe('stage_rts_good')
    expect(phaseOf(stages, 'stage_rts_good')).toBe('staging')
    const r1 = await repairOn(good, 'R1')
    expect([r1.opsStage, r1.status]).toEqual(['stage_rts_good', 'staging'])
    expect(await notes(r1.id)).toEqual(['Moved to ready   TO schedule by itself: 811 locate is clear to dig.'])
    // On the board it sits between Ready to Pull and Scheduled: Advance from Ready to Pull reaches it, and from it Scheduled.
    expect(advanceStageOf(stages, 'ready_to_pull')?.id).toBe('stage_rts_good')
    expect(advanceStageOf(stages, 'stage_rts_good')?.id).toBe('scheduled')
    // A new fence still goes to Need Drawing (only repairs go to Ready to Schedule).
    const nf = await mk('N1', { locateTicket: clear.ticket, locateCalledDate: today, locatesDate: today, locatesExpDate: clear.expDate }, undefined, good)
    await prisma.permit.create({ data: { accountId: good, jobId: nf, status: 'approved' } })
    await stageFollowsLocateAndPermit(good, nf, LOCATE_REASON, 'test')
    expect((await job(nf)).opsStage).toBe('need_drawing')

    // Placed after Scheduled it stands for scheduled; a move by itself does not schedule a job: Ready to Pull, as before.
    const late = await company('Late', 'scheduled')
    const ls = (await loadOpsStages(late)).stages
    expect(phaseOf(ls, 'stage_rts_late')).toBe('scheduled')
    expect(readyStageOf(ls)).toBe('ready_to_pull')
    expect((await repairOn(late, 'R2')).opsStage).toBe('ready_to_pull')

    // No such stage (the start list): Ready to Pull.
    expect(readyStageOf(START_OPS_STAGES)).toBe('ready_to_pull')
  })

  test('never backward: a job the office put in Materials Ordered stays there', async () => {
    const id = await mk('E', { opsStage: 'materials_ordered' })
    await call('PUT', `/api/saved-jobs/${id}/locate`, clear)
    expect((await job(id)).opsStage).toBe('materials_ordered')
  })

  test('the daily sweep: moves a job the day its locate becomes clear, once; not one saved already clear; not one dragged back', async () => {
    made.account = (await prisma.crmAccount.create({ data: { name: `Test ${tag}` } })).id
    const acct = made.account
    const D = '2099-01-12', D1 = '2099-01-13'
    const at = (d: string) => new Date(`${d}T17:00:00Z`)
    const savedBefore = new Date('2099-01-05T15:00:00Z')
    const nf = { opsStage: 'awaiting_locates', locateTicket: '1', locateCalledDate: '2099-01-05', locateUpdatedAt: savedBefore }
    const x = await mk('S1', { ...nf, locatesDate: D }, undefined, acct)
    const y = await mk('S2', { ...nf, locatesDate: D1 }, undefined, acct)
    const z = await mk('S3', { ...nf, locatesDate: D, locateUpdatedAt: at(D) }, undefined, acct)

    // Day D: x is clear (permit not set → Permit Pending); y is still "Called"; z was saved already clear (its save was the change).
    expect((await locatesClearSweep(at(D), acct)).map(m => m.jobId)).toEqual([x])
    expect([(await job(x)).opsStage, (await job(y)).opsStage, (await job(z)).opsStage]).toEqual(['permit_pending', 'awaiting_locates', 'awaiting_locates'])
    expect(await notes(x)).toEqual(['Moved to Permit Pending by itself: 811 locate is clear to dig.'])
    // Another pass the same day does nothing.
    expect(await locatesClearSweep(at(D), acct)).toEqual([])

    // The office drags x back. Day D+1: y becomes clear and moves; x stays where the office put it.
    await dragBack(x, 'awaiting_locates')
    expect((await locatesClearSweep(at(D1), acct)).map(m => m.jobId)).toEqual([y])
    expect([(await job(x)).opsStage, (await job(y)).opsStage]).toEqual(['awaiting_locates', 'permit_pending'])
    expect((await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId: acct, key: LOCATE_SWEEP_KEY } } }))?.value).toEqual({ day: D1 })
  })
  test('a move and a materials change by hand show who made them in the Job history; an Installer cannot read it (audit #47)', async () => {
    const id = await mk('H', {})
    const r = await call('PATCH', `/api/saved-jobs/${id}`, { opsStage: 'materials_ordered', materialsStatus: 'ordered' })
    expect(r.status).toBe(200)
    const items = (await call('GET', `/api/change-orders/timeline?jobId=${id}`)).json.data.items as any[]
    const who = `${user.firstName} ${user.lastName}`.trim()
    expect(items.filter(i => i.kind === 'stage' || i.kind === 'materials').map(i => [i.title, i.by])).toEqual([
      ['Moved from Awaiting Locates to Materials Ordered', who],
      ['Materials: Not ordered yet → Ordered', who],
    ])
    const installer = jwt.sign({ sub: user.id, email: user.email, role: 'installer', firstName: 'I', lastName: 'C', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '5m' })
    const crew = await fetch(`${base}/api/change-orders/timeline?jobId=${id}`, { headers: { Authorization: `Bearer ${installer}` } })
    expect(crew.status).toBe(403)
  })
})
