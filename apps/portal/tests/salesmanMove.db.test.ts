/**
 * The owner changes the Salesman on one quote or job (lib/salesmanMove.ts;
 * Jonathan, Oct 29 2026): "lets me (owner only) change the salesman from the
 * customer page AND from a single quote, including a signed one, to fix a
 * wrong pick. Changing a signed job's salesman asks first and moves its
 * commission too, with a History note. Christa can't change it."
 *
 * Against the dev database (DEV_DB=1; refuses any other), on a throwaway
 * company, through the same middleware order as index.ts: who may change it
 * on every path, an unsold quote, a signed one (asked first; price, status,
 * payment schedule and signed papers untouched), the History, the audit
 * log, the Salesman scope, and an older copy saved afterwards.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the owner changes one quote\'s Salesman (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped } = await import('../src/server/lib/salesScope.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: leadAssign } = await import('../src/server/routes/lead-assign.js')
  const { default: followUps } = await import('../src/server/routes/follow-ups.js')
  const { quoteCommissionCents } = await import('../src/server/lib/quotesFollowCustomer.js')
  const { isOwnerLogin } = await import('../src/server/lib/salesmanChoice.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `smv-${crypto.randomUUID().slice(0, 8)}`
  let accountId = '', base = ''
  const tok: Record<string, string> = {}
  const id: Record<string, string> = {}
  let server: ReturnType<express.Express['listen']>
  const SALLY = () => `Sally ${tag}`, SAM = () => `Sam ${tag}`, OLIVE = () => `Olive ${tag}`
  const num = (qid: string) => qid.slice(-6).toUpperCase()

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = async (key: string, firstName: string, role: string) => {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
      id[key] = u.id
      tok[key] = jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    await user('owner', 'Olive', 'super_admin')
    await user('admin', 'Adam', 'admin')
    await user('office', 'Opal', 'office_staff')
    await user('manager', 'Mona', 'manager')
    await user('sally', 'Sally', 'sales_rep')
    await user('sam', 'Sam', 'sales_rep')
    await user('installer', 'Ivan', 'field_crew')

    // Cara is the owner's customer; two of her quotes were wrongly given to Sally.
    id.cara = (await prisma.crmContact.create({ data: { accountId, firstName: 'Cara', lastName: tag, ownerId: id.owner, salesRep: OLIVE() } })).id
    const quote = (data: any) => prisma.savedQuote.create({ data: { accountId, runs: [150], pullSheet: [], fenceStyle: 'WV ND 6x8', crmContactId: id.cara, customerName: `Cara ${tag}`, salesRep: SALLY(), ownerId: id.owner, ...data } }).then(q => q.id)
    id.qOpen = await quote({ status: 'SENT', finalPrice: 10000, totalCOGS: 6000, gmPct: 0.3, hasSalesman: true })
    id.qSigned = await quote({ status: 'SOLD', soldAt: new Date(), finalPrice: 9000, totalCOGS: 5000, gmPct: 0.35, hasSalesman: true })
    id.qSallyOwn = await quote({ status: 'DRAFT', ownerId: id.sally, finalPrice: 4000, totalCOGS: 2500, gmPct: 0.3 })
    id.job = (await prisma.savedJob.create({ data: { accountId, quoteId: id.qSigned, crmContactId: id.cara, customerName: `Cara ${tag}`, salesRep: SALLY(), quotePrice: 9000, contractValue: 9000, gmPct: 0.35 } })).id
    await prisma.jobQuotedCost.create({ data: { accountId, quoteId: id.qSigned, salesRep: SALLY(), priceCents: 900000, materialCents: 300000, laborCents: 200000, totalCents: 500000 } })
    id.schedule = (await prisma.paymentSchedule.create({ data: { accountId, jobId: id.job, quoteId: id.qSigned, crmContactId: id.cara, signedCents: 900000, depositPct: 50 } })).id
    id.doc = (await prisma.signedDocument.create({ data: { accountId, sourceKey: `${tag}-contract`, kind: 'contract', quoteId: id.qSigned, jobId: id.job, fileKey: `${tag}.pdf`, fileSizeBytes: 1234, sha256: 'a'.repeat(64), signedAt: new Date(), signedBy: `Cara ${tag}` } })).id
    // Dora is Sally's customer, with an open quote and a sold one (the customer page's Change, D3).
    id.dora = (await prisma.crmContact.create({ data: { accountId, firstName: 'Dora', lastName: tag, ownerId: id.owner, salesRep: SALLY() } })).id
    id.qDoraOpen = await quote({ crmContactId: id.dora, customerName: `Dora ${tag}`, status: 'DRAFT', finalPrice: 5000, totalCOGS: 3000, gmPct: 0.3, hasSalesman: true })
    id.qDoraSold = await quote({ crmContactId: id.dora, customerName: `Dora ${tag}`, status: 'SOLD', soldAt: new Date(), finalPrice: 6000, totalCOGS: 3500, gmPct: 0.3, hasSalesman: true })
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [] } as any })

    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/crm-contacts', salesScoped('contacts')); app.use('/api/saved-jobs', salesScoped('jobs')); app.use('/api/saved-quotes', salesScoped('quotes'))
    app.use('/api/crm-contacts', contacts); app.use('/api/saved-jobs', jobs); app.use('/api/saved-quotes', quotes)
    app.use('/api/lead-assign', leadAssign); app.use('/api/follow-ups', followUps)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.cardFollowUp.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.signedDocument.deleteMany({ where: { accountId } })
    await prisma.paymentSchedule.deleteMany({ where: { accountId } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const quoteOf = (qid: string) => prisma.savedQuote.findUnique({ where: { id: qid } })
  const sees = async (token: string, kind: 'saved-quotes' | 'saved-jobs', rid: string) => {
    const list = await call('GET', `/api/${kind}`, token)
    const inList = (list.json.data as any[]).some(x => x.id === rid)
    expect((await call('GET', `/api/${kind}/${rid}`, token)).status === 200).toBe(inList)
    return inList
  }
  const history = async (token: string, customerId: string) => ((await call('GET', `/api/follow-ups/history?customerId=${customerId}`, token)).json.data as any[]).filter(x => x.title === 'Salesman changed')

  test('the owner is found by role (D4): the super_admin; an admin only when there is no super_admin', async () => {
    expect(await isOwnerLogin(accountId, id.owner, 'super_admin')).toBe(true)
    expect(await isOwnerLogin(accountId, id.admin, 'admin')).toBe(false)
    for (const k of ['office', 'manager', 'sally', 'installer']) expect(await isOwnerLogin(accountId, id[k], k === 'office' ? 'office_staff' : k === 'manager' ? 'manager' : k === 'sally' ? 'sales_rep' : 'field_crew')).toBe(false)
    expect((await call('GET', '/api/crm-contacts/salesmen', tok.owner)).json.data.canChange).toBe(true)
    for (const k of ['admin', 'office', 'manager', 'sally']) expect([k, (await call('GET', '/api/crm-contacts/salesmen', tok[k])).json.data.canChange]).toEqual([k, false])
  })

  let sallyStaleOwn: any
  test('everyone but the owner gets a 403 on the quote\'s and the job\'s Salesman, and nothing changes', async () => {
    sallyStaleOwn = (await call('GET', `/api/saved-quotes/${id.qSallyOwn}`, tok.sally)).json.data
    for (const k of ['admin', 'office', 'manager', 'sally', 'installer']) {
      for (const [p, confirm] of [[`/api/saved-quotes/${id.qOpen}/salesman`, false], [`/api/saved-quotes/${id.qSigned}/salesman`, true], [`/api/saved-jobs/${id.job}/salesman`, true]] as const) {
        const r = await call('POST', p, tok[k], { to: id.sam, confirm })
        expect([k, p, r.status, r.json.code]).toEqual([k, p, 403, 'NOT_ALLOWED'])
        // The Salesman's job writes are refused before this (her jobs are read only: lib/salesScope.ts), in its own words.
        expect(r.json.error).toBe(k === 'sally' && p.includes('saved-jobs') ? 'The Salesman\'s login shows jobs read only. Ask the office to change this job.' : 'Only the owner can change the Salesman once it is entered. Nothing was changed.')
      }
    }
    for (const qid of [id.qOpen, id.qSigned]) expect((await quoteOf(qid))!.salesRep).toBe(SALLY())
    expect((await prisma.savedJob.findUnique({ where: { id: id.job } }))!.salesRep).toBe(SALLY())
    expect(await prisma.crmContactNote.count({ where: { accountId } })).toBe(0)
  })

  test('no everyday save changes a Salesman on file: the quote and job saves keep it (the rest is saved); the customer save refuses the Salesman, keeps it for the office', async () => {
    // The quote builder sends its customer's Salesman (Olive): the quote's stays Sally, the notes are saved. The owner's own save too:
    // a quote's Salesman moves only with the Salesman control or the customer's Change.
    for (const k of ['office', 'manager', 'owner']) {
      const r = await call('PATCH', `/api/saved-quotes/${id.qOpen}`, tok[k], { salesRep: OLIVE(), notes: `by ${k}` })
      expect(r.status).toBe(200)
      expect([r.json.data.salesRep, r.json.data.notes]).toEqual([SALLY(), `by ${k}`])
    }
    // A signed quote: the same (the lock allows the rep, but the rep is kept).
    expect((await call('PATCH', `/api/saved-quotes/${id.qSigned}`, tok.office, { salesRep: SAM() })).json.data.salesRep).toBe(SALLY())
    // The job.
    const j = await call('PATCH', `/api/saved-jobs/${id.job}`, tok.office, { salesRep: SAM(), notes: 'gate code 4411' })
    expect(j.status).toBe(200)
    expect([j.json.data.salesRep, j.json.data.notes]).toEqual([SALLY(), 'gate code 4411'])
    // The bulk syncs (old browser copies).
    await call('POST', '/api/saved-quotes/sync', tok.owner, { quotes: [{ ...(await quoteOf(id.qOpen)), runs: [150], pullSheet: [], salesRep: SAM(), id: id.qOpen }] })
    expect((await quoteOf(id.qOpen))!.salesRep).toBe(SALLY())
    // The customer: Sally is refused outright; the office's and the manager's saves keep the owner's Salesman and save the rest.
    expect((await call('PATCH', `/api/crm-contacts/${id.dora}`, tok.sally, { salesRep: SAM(), notes: 'x' })).status).toBe(403)
    for (const k of ['office', 'manager', 'admin']) {
      const r = await call('PATCH', `/api/crm-contacts/${id.cara}`, tok[k], { salesRep: SAM(), notes: `cara by ${k}` })
      expect([k, r.status, r.json.salesRepKept, r.json.data.salesRep, r.json.data.notes]).toEqual([k, 200, true, OLIVE(), `cara by ${k}`])
    }
    // The customer page's Change: the office and manager are refused (403), with or without "replace"; the Salesman and the Installer too.
    for (const k of ['office', 'manager', 'admin', 'sally', 'installer']) {
      const r = await call('POST', `/api/lead-assign/${id.cara}`, tok[k], { to: id.sam, replace: true })
      expect([k, r.status]).toEqual([k, 403])
    }
    expect((await prisma.crmContact.findUnique({ where: { id: id.cara } }))!.salesRep).toBe(OLIVE())
    for (const qid of [id.qOpen, id.qSigned]) expect((await quoteOf(qid))!.salesRep).toBe(SALLY())
  })

  test('the owner moves an unsold quote at once: only its Salesman changes; the customer\'s own Salesman stays', async () => {
    const before = (await quoteOf(id.qOpen))!
    expect(await sees(tok.sally, 'saved-quotes', id.qOpen)).toBe(true)
    expect(await sees(tok.sam, 'saved-quotes', id.qOpen)).toBe(false)
    const r = await call('POST', `/api/saved-quotes/${id.qOpen}/salesman`, tok.owner, { to: id.sam })
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ already: false, from: SALLY(), to: SAM(), signed: false, commissionCents: 100000 })
    const after = (await quoteOf(id.qOpen))!
    expect(after.salesRep).toBe(SAM())
    expect([after.finalPrice, after.totalCOGS, after.gmPct, after.hasSalesman, after.status, after.notes]).toEqual([before.finalPrice, before.totalCOGS, before.gmPct, before.hasSalesman, before.status, before.notes])
    expect(quoteCommissionCents(after)).toBe(100000)
    expect((await prisma.crmContact.findUnique({ where: { id: id.cara } }))!.salesRep).toBe(OLIVE())
    const note = await prisma.crmContactNote.findFirst({ where: { crmContactId: id.cara }, orderBy: { createdAt: 'desc' } })
    expect(note!.body).toBe(`Salesman on quote #${num(id.qOpen)} changed from ${SALLY()} to ${SAM()} by ${OLIVE()} (not sold yet; its commission goes with it). The customer's own Salesman is unchanged.`)
    const log = await prisma.crmAuditLog.findFirst({ where: { userId: id.owner, entityId: id.qOpen }, orderBy: { createdAt: 'desc' } }) as any
    expect(log.newValues.salesmanMoved).toMatchObject({ from: SALLY(), to: SAM(), signed: false, priceCents: 1000000, commissionCents: 100000 })
    // The same person again: nothing more.
    const again = await call('POST', `/api/saved-quotes/${id.qOpen}/salesman`, tok.owner, { to: id.sam })
    expect(again.json.data.already).toBe(true)
    expect(await prisma.crmContactNote.count({ where: { crmContactId: id.cara } })).toBe(1)
  })

  test('the owner moves a signed quote: asked first with its commission; on yes the quote, its job and its quoted cost move; price, status, schedule and signed papers are untouched', async () => {
    const q0 = (await quoteOf(id.qSigned))!
    const job0 = (await prisma.savedJob.findUnique({ where: { id: id.job } }))!
    const sched0 = await prisma.paymentSchedule.findUnique({ where: { id: id.schedule } })
    const doc0 = await prisma.signedDocument.findUnique({ where: { id: id.doc } })
    const cost0 = await prisma.jobQuotedCost.findFirst({ where: { accountId, quoteId: id.qSigned } })
    // Asked first: nothing changes until Yes.
    const ask = await call('POST', `/api/saved-quotes/${id.qSigned}/salesman`, tok.owner, { to: id.sam })
    expect(ask.status).toBe(409)
    expect(ask.json.code).toBe('CONFIRM_SIGNED')
    expect(ask.json.confirm).toMatchObject({ from: SALLY(), to: SAM(), signed: true, commissionCents: 85000 })
    expect(ask.json.confirm.question).toBe(`This job is signed. Move it and its $850.00 commission from ${SALLY()} to ${SAM()}?`)
    expect((await quoteOf(id.qSigned))!.salesRep).toBe(SALLY())
    // The job page asks the same; Yes there moves the quote and the job together.
    expect((await call('POST', `/api/saved-jobs/${id.job}/salesman`, tok.owner, { to: id.sam })).json.code).toBe('CONFIRM_SIGNED')
    const yes = await call('POST', `/api/saved-jobs/${id.job}/salesman`, tok.owner, { to: id.sam, confirm: true })
    expect(yes.status).toBe(200)
    expect(yes.json.data).toMatchObject({ from: SALLY(), to: SAM(), signed: true, quoteId: id.qSigned, jobIds: [id.job], commissionCents: 85000 })

    const q1 = (await quoteOf(id.qSigned))!
    const job1 = (await prisma.savedJob.findUnique({ where: { id: id.job } }))!
    expect([q1.salesRep, job1.salesRep, (await prisma.jobQuotedCost.findFirst({ where: { accountId, quoteId: id.qSigned } }))!.salesRep]).toEqual([SAM(), SAM(), SAM()])
    // Only the Salesman changed: the quote, the job, the quoted cost, the payment schedule and the signed contract are otherwise as they were.
    const drop = (o: any, ...keys: string[]) => { const c = { ...o }; for (const k of ['salesRep', 'updatedAt', ...keys]) delete c[k]; return JSON.parse(JSON.stringify(c)) }
    expect(drop(q1)).toEqual(drop(q0))
    expect(drop(job1)).toEqual(drop(job0))
    expect(drop(await prisma.jobQuotedCost.findFirst({ where: { accountId, quoteId: id.qSigned } }))).toEqual(drop(cost0))
    expect(await prisma.paymentSchedule.findUnique({ where: { id: id.schedule } })).toEqual(sched0)
    expect(await prisma.signedDocument.findUnique({ where: { id: id.doc } })).toEqual(doc0)
    // The commission is the same amount, credited now to Sam (what Sales by rep, the board and the quote list group by).
    expect(quoteCommissionCents(q1)).toBe(85000)
    // The History says so, with no money; the audit log has the amounts in cents.
    const lines = await history(tok.owner, id.cara)
    expect(lines.map(l => l.detail)).toContain(`Salesman on quote #${num(id.qSigned)} changed from ${SALLY()} to ${SAM()} by ${OLIVE()} (signed job; its commission went with it). The customer's own Salesman is unchanged.`)
    for (const l of lines) expect(l.detail).not.toMatch(/\$|\d+\.\d\d/)
    const log = await prisma.crmAuditLog.findFirst({ where: { userId: id.owner, entityId: id.qSigned }, orderBy: { createdAt: 'desc' } }) as any
    expect(log.newValues.salesmanMoved).toMatchObject({ from: SALLY(), to: SAM(), signed: true, priceCents: 900000, commissionCents: 85000, jobIds: [id.job] })
    const jobLog = await prisma.crmAuditLog.findFirst({ where: { userId: id.owner, entityId: id.job }, orderBy: { createdAt: 'desc' } }) as any
    expect(jobLog.newValues.salesmanMoved.commissionCents).toBe(85000)
    // The customer's own Salesman stays the owner.
    expect((await prisma.crmContact.findUnique({ where: { id: id.cara } }))!.salesRep).toBe(OLIVE())
  })

  test('scope follows: Sam has the moved quotes and the job; Sally no longer has them, not even the quote she wrote; her older copy neither saves nor takes it back', async () => {
    expect(await sees(tok.sam, 'saved-quotes', id.qOpen)).toBe(true)
    expect(await sees(tok.sam, 'saved-quotes', id.qSigned)).toBe(true)
    expect(await sees(tok.sam, 'saved-jobs', id.job)).toBe(true)
    expect(await sees(tok.sally, 'saved-quotes', id.qOpen)).toBe(false)
    expect(await sees(tok.sally, 'saved-quotes', id.qSigned)).toBe(false)
    expect(await sees(tok.sally, 'saved-jobs', id.job)).toBe(false)
    // The quote Sally wrote, moved to Sam: Sam has it; Sally no longer does (Jonathan, Oct 29 2026: "unsold ones
    // leave her list"; the rep decides, not who wrote it).
    const before = (await quoteOf(id.qSallyOwn))!
    expect((await call('POST', `/api/saved-quotes/${id.qSallyOwn}/salesman`, tok.owner, { to: id.sam })).status).toBe(200)
    expect(await sees(tok.sam, 'saved-quotes', id.qSallyOwn)).toBe(true)
    expect(await sees(tok.sally, 'saved-quotes', id.qSallyOwn)).toBe(false)
    const list = await call('GET', '/api/saved-quotes', tok.sally)
    expect(list.json.data.map((q: any) => q.id)).not.toContain(id.qSallyOwn)
    // Her phone's older copy (read before the move) is a 404 (the app reloads its list); nothing changes, the Salesman stays Sam.
    const s = await call('PATCH', `/api/saved-quotes/${id.qSallyOwn}`, tok.sally, { ...sallyStaleOwn, notes: 'called her back' })
    expect(s.status).toBe(404)
    // A create naming it (a retried create) is a 404 too: it is not brought back.
    expect((await call('POST', '/api/saved-quotes', tok.sally, { ...sallyStaleOwn, id: id.qSallyOwn, notes: 'again' })).status).toBe(404)
    const q = (await quoteOf(id.qSallyOwn))!
    expect([q.salesRep, q.notes, q.finalPrice]).toEqual([SAM(), before.notes, 4000])
    // Sally has no control: the server refuses her, on a quote that is no longer hers (404) and on one that is (403).
    expect((await call('POST', `/api/saved-quotes/${id.qSallyOwn}/salesman`, tok.sally, { to: id.sally })).status).toBe(404)
    expect((await call('POST', `/api/saved-quotes/${id.qDoraSold}/salesman`, tok.sally, { to: id.sally })).status).toBe(403)
    expect((await quoteOf(id.qSallyOwn))!.salesRep).toBe(SAM())
  })

  test('the customer page\'s Change still works for the owner (D3): Dora\'s open quote and its commission go to Sam; the sold one stays Sally\'s', async () => {
    const r = await call('POST', `/api/lead-assign/${id.dora}`, tok.owner, { to: id.sam, replace: true })
    expect(r.status).toBe(200)
    expect(r.json.data.quotesMoved).toBe(1)
    expect((await quoteOf(id.qDoraOpen))!.salesRep).toBe(SAM())
    expect((await quoteOf(id.qDoraSold))!.salesRep).toBe(SALLY())
    expect(quoteCommissionCents((await quoteOf(id.qDoraOpen))!)).toBe(50000)
    expect((await prisma.crmContact.findUnique({ where: { id: id.dora } }))!.salesRep).toBe(SAM())
    // And the owner fixes the sold one too, from the quote, after the question.
    expect((await call('POST', `/api/saved-quotes/${id.qDoraSold}/salesman`, tok.owner, { to: id.sam })).status).toBe(409)
    expect((await call('POST', `/api/saved-quotes/${id.qDoraSold}/salesman`, tok.owner, { to: id.sam, confirm: true })).status).toBe(200)
    expect((await quoteOf(id.qDoraSold))!.salesRep).toBe(SAM())
  })
})
