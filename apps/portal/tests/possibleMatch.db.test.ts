/**
 * Website and phone leads never attach to a customer on file; possible
 * matches, merge and Undo merge (lib/intake.ts, lib/customerMerge.ts), on the
 * dev database:
 *   - a lead with an existing customer's email (other capitals) makes a NEW
 *     customer with a possible match on it; the one on file is not touched;
 *   - the same delivery twice (at once, and again later) makes one customer;
 *   - merge moves every record listed (quotes, jobs, appointments, notes,
 *     website leads, photos, logged calls, cards, invoices, activity lines)
 *     and leaves the kept customer's row byte for byte unchanged; the merged
 *     one is kept, archived, pointing at the kept one; audit row written;
 *   - undo puts exactly those back and brings the merged customer back;
 *   - undo is refused, changing nothing, after a moved record was put with
 *     another customer;
 *   - Not the same person is kept; a role without records.archive is refused.
 *
 * A company made for the test and removed after.
 */

import 'dotenv/config'
import express from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('possible matches, merge and undo (dev database)', () => {
  let prisma: any
  let recordIntake: any
  let server: Server
  let base = ''
  const tag = `pm-${Date.now().toString(36)}`
  const password = `pw-${tag}`
  let accountId = ''
  const users: Record<string, string> = {}
  const tokens: Record<string, string> = {}

  const call = async (who: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  /** The customer's row exactly as stored, every column. */
  const rawRow = async (id: string) => JSON.stringify((await prisma.$queryRaw`SELECT row_to_json(c)::text AS j FROM "CrmContact" c WHERE id = ${id}`)[0]?.j)
  const lead = (ref: string, extra: Record<string, unknown>) => ({ source: 'retell', sourceRef: `${tag}-${ref}`, name: 'Nina Newlead', summary: 'Wants a fence quote.', leadSource: 'Phone (AI receptionist)', payload: {}, ...extra })

  let kept: any
  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    recordIntake = (await import('../src/server/lib/intake.js')).recordIntake
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    for (const [key, role] of [['owner', 'super_admin'], ['sales', 'sales_rep'], ['crew', 'field_crew']] as const) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${key}@example.test`, firstName: 'Test', lastName: key, role, status: 'active', mustChangePassword: false, passwordHash: await bcrypt.hash(password, 4), crmAccountId: accountId } })
      users[key] = u.id
    }
    await prisma.pipelineState.create({ data: { accountId, leads: [], archivedLeads: [], stages: [] } })
    await prisma.businessState.create({ data: { accountId } })
    kept = await prisma.crmContact.create({ data: { accountId, firstName: 'Kate', lastName: `Kept ${tag}`, email: `kate.${tag}@example.test`, phone: '(352) 555-0123', serviceAddress: '1 Kept Ln, Ocala, FL', leadSource: 'Referral' } })
    await prisma.crmContactNote.create({ data: { accountId, crmContactId: kept.id, body: 'Kate own note', createdBy: 'Test' } })
    const { requireLiveSession } = await import('../src/server/lib/sessionGuard.js')
    const app = express()
    app.use(express.json())
    app.use('/api', requireLiveSession)
    app.use('/api/crm-auth', (await import('../src/server/routes/crm-auth.js')).default)
    app.use('/api/customer-matches', (await import('../src/server/routes/customer-matches.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const key of Object.keys(users)) {
      const r = await fetch(`${base}/api/crm-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${tag}-${key}@example.test`, password }) })
      tokens[key] = ((await r.json()) as any).data.accessToken
    }
  })

  afterAll(async () => {
    server?.close()
    if (!prisma || !accountId) return
    const ids = Object.values(users)
    const contacts = (await prisma.crmContact.findMany({ where: { accountId }, select: { id: true } })).map((c: any) => c.id)
    await prisma.customerMerge.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.callLog.deleteMany({ where: { accountId } })
    await prisma.crmTextConsent.deleteMany({ where: { accountId } })
    await prisma.mediaItem.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.intakeLead.deleteMany({ where: { accountId } })
    await prisma.crmContactNote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    for (const m of ['pipelineState', 'businessState']) await prisma[m].deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { title: { in: ['Phone call: Nina Newlead', 'Phone call: Pat Phone'] } } })
    await prisma.crmAuditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: contacts } }] } })
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  let newId = ''
  let matchRow: any
  test('a lead with an existing customer\'s email makes a new customer, with a possible match; the one on file is untouched', async () => {
    const before = await rawRow(kept.id)
    const r = await recordIntake(accountId, lead('1', { email: kept.email.toUpperCase(), phone: '+1 352 555 0999' }))
    expect(r.duplicate).toBe(false)
    expect(r.contactId).not.toBe(kept.id)
    newId = r.contactId
    const n = await prisma.crmContact.findUnique({ where: { id: newId } })
    expect([n.firstName, n.lastName, n.email]).toEqual(['Nina', 'Newlead', kept.email])
    matchRow = await prisma.customerPossibleMatch.findFirst({ where: { contactId: newId } })
    expect(matchRow).toMatchObject({ matchId: kept.id, reason: 'email', status: 'open' })
    expect(await prisma.intakeLead.count({ where: { sourceRef: `${tag}-1`, crmContactId: newId } })).toBe(1)
    expect(await rawRow(kept.id)).toBe(before)
    const view = await call('sales', 'GET', `/api/customer-matches/customer/${newId}`)
    expect(view.json.data.matches).toEqual([{ id: matchRow.id, reason: 'email', customer: { id: kept.id, name: `Kate Kept ${tag}`, phone: '(352) 555-0123', email: kept.email, address: '1 Kept Ln, Ocala, FL', textConsent: 'unknown' } }])
  })

  test('the same delivery twice (at once, then again later) makes one customer', async () => {
    const twin = lead('2', { phone: '352.555.0123', name: 'Pat Phone' })
    const [a, b] = await Promise.all([recordIntake(accountId, twin), recordIntake(accountId, twin)])
    const c = await recordIntake(accountId, twin)
    expect(new Set([a.contactId, b.contactId, c.contactId]).size).toBe(1)
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
    expect(c.duplicate).toBe(true)
    expect(await prisma.crmContact.count({ where: { accountId, firstName: 'Pat' } })).toBe(1)
    expect(await prisma.customerPossibleMatch.findMany({ where: { contactId: a.contactId }, select: { matchId: true, reason: true } })).toEqual([{ matchId: kept.id, reason: 'phone' }])
  })

  test('Not the same person is kept and the notice does not come back; a role without records.archive is refused', async () => {
    const pat = await prisma.crmContact.findFirst({ where: { accountId, firstName: 'Pat' } })
    const m = await prisma.customerPossibleMatch.findFirst({ where: { contactId: pat.id } })
    expect((await call('crew', 'POST', `/api/customer-matches/${m.id}/dismiss`)).status).toBe(403)
    expect((await call('crew', 'POST', `/api/customer-matches/${m.id}/merge`)).status).toBe(403)
    expect((await call('sales', 'POST', `/api/customer-matches/${m.id}/dismiss`)).status).toBe(200)
    expect((await prisma.customerPossibleMatch.findUnique({ where: { id: m.id } })).status).toBe('dismissed')
    expect((await call('sales', 'GET', `/api/customer-matches/customer/${pat.id}`)).json.data.matches).toEqual([])
    expect((await call('sales', 'POST', `/api/customer-matches/${m.id}/merge`)).status).toBe(409)
  })

  // Everything of the new customer's, in each kind of place a customer id is kept.
  const made: Record<string, string> = {}
  async function giveRecords() {
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: newId, customerName: 'Nina Newlead', fenceStyle: 'WV 6ft Privacy', runs: [100], pullSheet: [], finalPrice: 5000, status: 'DRAFT' } })
    const q2 = await prisma.savedQuote.create({ data: { accountId, crmContactId: newId, customerName: 'Nina Newlead', fenceStyle: 'WV 4ft Picket', runs: [50], pullSheet: [], finalPrice: 2000, status: 'DRAFT' } })
    const j = await prisma.savedJob.create({ data: { accountId, crmContactId: newId, quoteId: q.id, customerName: 'Nina Newlead', contractValue: 5000 } })
    const a = await prisma.appointment.create({ data: { accountId, crmContactId: newId, type: 'estimate' } })
    const md = await prisma.mediaItem.create({ data: { accountId, clientId: `${tag}-${crypto.randomUUID()}`, customerId: newId, kind: 'photo', mime: 'image/jpeg', path: 'x.jpg', takenAt: new Date() } })
    // The new customer said no to texts (its answer and its history row).
    const tc = await prisma.crmTextConsent.create({ data: { accountId, crmContactId: newId, consent: 'no', source: 'website_checkbox', byName: 'website' } })
    await prisma.crmContact.update({ where: { id: newId }, data: { textConsent: 'no', textConsentAt: new Date(), textConsentBy: 'website', textConsentSource: 'website_checkbox' } })
    made.tc = tc.id
    const cl = await prisma.callLog.create({ data: { id: crypto.randomUUID(), accountId, crmContactId: newId, userId: users.sales, outcome: 'no_answer' } })
    Object.assign(made, { q: q.id, q2: q2.id, j: j.id, a: a.id, md: md.id, cl: cl.id, card: `card-${tag}-${crypto.randomUUID().slice(0, 6)}`, old: `old-${tag}`, inv: `inv-${tag}`, act: `act-${tag}` })
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    await prisma.pipelineState.update({ where: { accountId }, data: {
      leads: [...p.leads, { id: made.card, customerId: newId, firstName: 'Nina', lastName: 'Newlead', stage: 'new' }, { id: `kate-card-${tag}`, customerId: kept.id, firstName: 'Kate', lastName: 'Kept', stage: 'new' }],
      archivedLeads: [{ id: made.old, customerId: newId, firstName: 'Nina', lastName: 'Old' }], version: { increment: 1 },
    } })
    await prisma.businessState.update({ where: { accountId }, data: { invoices: [{ id: made.inv, customerId: newId, invoiceNumber: 'INV-1', totalCents: 10000 }], version: { increment: 1 } } })
    await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: 'fencepro_customer_activity' } }, create: { accountId, key: 'fencepro_customer_activity', value: [{ id: made.act, customerId: newId, body: 'Called' }, { id: `kact-${tag}`, customerId: kept.id, body: 'Kate' }] }, update: {} })
  }
  /** Who each of those records points at now. */
  async function owners() {
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    const kv = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: 'fencepro_customer_activity' } } })
    return {
      quotes: (await prisma.savedQuote.findMany({ where: { id: { in: [made.q, made.q2] } }, orderBy: { finalPrice: 'desc' } })).map((x: any) => x.crmContactId),
      job: (await prisma.savedJob.findUnique({ where: { id: made.j } })).crmContactId,
      appt: (await prisma.appointment.findUnique({ where: { id: made.a } })).crmContactId,
      media: (await prisma.mediaItem.findUnique({ where: { id: made.md } })).customerId,
      call: (await prisma.callLog.findUnique({ where: { id: made.cl } })).crmContactId,
      consent: (await prisma.crmTextConsent.findUnique({ where: { id: made.tc } })).crmContactId,
      notes: (await prisma.crmContactNote.findMany({ where: { accountId, body: { contains: 'Wants a fence quote' } } })).filter((n: any) => n.crmContactId === newId || n.crmContactId === kept.id).map((n: any) => n.crmContactId),
      intake: (await prisma.intakeLead.findFirst({ where: { sourceRef: `${tag}-1` } })).crmContactId,
      card: (p.leads as any[]).find(l => l.id === made.card).customerId,
      oldCard: (p.archivedLeads as any[]).find(l => l.id === made.old).customerId,
      invoice: (b.invoices as any[]).find(i => i.id === made.inv).customerId,
      activity: (kv.value as any[]).find(i => i.id === made.act).customerId,
    }
  }
  const all = (id: string) => ({ quotes: [id, id], job: id, appt: id, media: id, call: id, consent: id, notes: [id], intake: id, card: id, oldCard: id, invoice: id, activity: id })

  test('merge moves every record listed; the kept customer\'s row is byte for byte unchanged; logged', async () => {
    await giveRecords()
    expect(await owners()).toEqual(all(newId))
    const before = await rawRow(kept.id)
    const r = await call('sales', 'POST', `/api/customer-matches/${matchRow.id}/merge`)
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ keptId: kept.id, mergedId: newId })
    expect(await owners()).toEqual(all(kept.id))
    expect(await rawRow(kept.id)).toBe(before)
    const n = await prisma.crmContact.findUnique({ where: { id: newId } })
    expect(n.mergedIntoId).toBe(kept.id)
    expect(n.archivedAt).not.toBeNull()
    expect(n.deletedAt).toBeNull()
    expect((await prisma.customerPossibleMatch.findUnique({ where: { id: matchRow.id } })).status).toBe('merged')
    // The merge record lists exactly what moved, by id.
    const mg = await prisma.customerMerge.findUnique({ where: { id: r.json.data.mergeId } })
    const moved = mg.moved as any
    const rowIds = (model: string) => moved.rows.find((x: any) => x.model === model)?.ids.slice().sort()
    expect(rowIds('savedQuote')).toEqual([made.q, made.q2].sort())
    expect(rowIds('savedJob')).toEqual([made.j])
    expect(rowIds('appointment')).toEqual([made.a])
    expect(rowIds('mediaItem')).toEqual([made.md])
    expect(rowIds('callLog')).toEqual([made.cl])
    expect(rowIds('crmTextConsent')).toEqual([made.tc])
    // Both texting answers at the merge are on the record; the kept one's own answer is not changed.
    expect(moved.textConsent).toEqual({ kept: 'unknown', merged: 'no' })
    expect((await prisma.crmContact.findUnique({ where: { id: kept.id } })).textConsent).toBe('unknown')
    expect(rowIds('intakeLead')).toHaveLength(1)
    expect(rowIds('crmContactNote')).toHaveLength(1)
    expect(moved.items).toEqual(expect.arrayContaining([{ doc: 'pipeline.leads', ids: [made.card] }, { doc: 'pipeline.archivedLeads', ids: [made.old] }, { doc: 'business.invoices', ids: [made.inv] }]))
    expect(moved.kv).toEqual([{ key: 'fencepro_customer_activity', ids: [made.act] }])
    expect((mg.mergedDetails as any)).toMatchObject({ id: newId, firstName: 'Nina', lastName: 'Newlead', email: kept.email })
    const audit = await prisma.crmAuditLog.findFirst({ where: { action: 'merged', entityId: kept.id } })
    expect(audit?.newValues).toMatchObject({ mergeId: mg.id, merged: newId })
    // Both pages: the kept one has the history, the merged one says where it went.
    const keptView = (await call('sales', 'GET', `/api/customer-matches/customer/${kept.id}`)).json.data
    expect(keptView.merges[0]).toMatchObject({ id: mg.id, mergedId: newId, undoneAt: null, details: { name: 'Nina Newlead', email: kept.email } })
    expect(keptView.merges[0].moved).toEqual(expect.arrayContaining(['2 quotes', '1 job', '1 card', '1 invoice', '1 activity line']))
    expect((await call('sales', 'GET', `/api/customer-matches/customer/${newId}`)).json.data).toMatchObject({ matches: [], mergedInto: { id: kept.id, mergeId: mg.id } })
    expect(keptView.merges[0].textConsent).toEqual({ kept: 'unknown', merged: 'no' })
    // The merged one's "no" is never lost: texts to Kate stay blocked until a yes is recorded on Kate.
    const { mergedTextNo } = await import('../src/server/lib/textConsent.js')
    expect(await mergedTextNo(kept.id)).toMatch(/Nina Newlead \(merged into this customer\) said no/)
    const { recordTextConsent } = await import('../src/server/lib/textConsent.js')
    await recordTextConsent(kept.id, { consent: 'yes', source: 'verbal', byName: 'Test' } as any)
    expect(await mergedTextNo(kept.id)).toBeNull()
    // A second tap does nothing more.
    expect((await call('sales', 'POST', `/api/customer-matches/${matchRow.id}/merge`)).status).toBe(409)
    made.mergeId = mg.id
  })

  test('undo puts exactly those back and brings the merged customer back', async () => {
    const before = await rawRow(kept.id)
    const r = await call('sales', 'POST', `/api/customer-matches/merges/${made.mergeId}/undo`)
    expect(r.status).toBe(200)
    expect(await owners()).toEqual(all(newId))
    // Kate's own things stayed hers.
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    expect((p.leads as any[]).find(l => l.id === `kate-card-${tag}`).customerId).toBe(kept.id)
    expect(await prisma.crmContactNote.count({ where: { crmContactId: kept.id, body: 'Kate own note' } })).toBe(1)
    expect(await rawRow(kept.id)).toBe(before)
    const n = await prisma.crmContact.findUnique({ where: { id: newId } })
    expect([n.mergedIntoId, n.archivedAt]).toEqual([null, null])
    expect((await prisma.customerPossibleMatch.findUnique({ where: { id: matchRow.id } })).status).toBe('open')
    expect((await prisma.customerMerge.findUnique({ where: { id: made.mergeId } })).undoneAt).not.toBeNull()
    expect(await prisma.crmAuditLog.count({ where: { action: 'merge_undone', entityId: kept.id } })).toBe(1)
    expect((await call('sales', 'POST', `/api/customer-matches/merges/${made.mergeId}/undo`)).status).toBe(409)
  })

  test('undo is refused, changing nothing, after a moved record was put with another customer', async () => {
    const r = await call('owner', 'POST', `/api/customer-matches/${matchRow.id}/merge`)
    expect(r.status).toBe(200)
    const other = await prisma.crmContact.create({ data: { accountId, firstName: 'Otto', lastName: `Other ${tag}` } })
    await prisma.savedQuote.update({ where: { id: made.q2 }, data: { crmContactId: other.id } })
    const u = await call('owner', 'POST', `/api/customer-matches/merges/${r.json.data.mergeId}/undo`)
    expect(u.status).toBe(409)
    expect(u.json.error).toMatch(/^Not undone: this record has been put with another customer since the merge: Quote for Nina Newlead, WV 4ft Picket/)
    expect(u.json.error).toMatch(/Nothing was changed\.$/)
    const now = await owners()
    expect(now).toEqual({ ...all(kept.id), quotes: [kept.id, other.id] })
    expect((await prisma.crmContact.findUnique({ where: { id: newId } })).mergedIntoId).toBe(kept.id)
    expect((await prisma.customerMerge.findUnique({ where: { id: r.json.data.mergeId } })).undoneAt).toBeNull()
  })
})
