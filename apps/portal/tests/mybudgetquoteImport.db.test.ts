/**
 * The MyBudgetQuote import (lib/mybudgetquoteImport.ts, lib/customerImport.ts)
 * on the dev database, with tests/fixtures/mybudgetquote-small.csv and a
 * company made for the test (removed after). Every rule:
 *   - the plan writes nothing;
 *   - a match only on the same phone (10 digits) or email (any capitals),
 *     never on a name; same name -> attached; a different name -> a NEW
 *     customer with a Possible match on the one on file; several matches ->
 *     the single one with the same name, else skipped and listed;
 *   - a customer on file with an open card or a paid job gets no new card;
 *     one with only a finished (Lost Sale) card gets one;
 *   - make_card: First Contact always, No Answer unless a Dropoff;
 *     dropoffs are customers only, tagged; Sold and unmatched: no card, listed;
 *   - cards in the file's order inside each column, dated latest_date;
 *   - the pinned history note, the tags, the flags, the structured row;
 *   - customers on file: only the tag added, nothing else changed;
 *   - nothing starts: no follow ups, automation events or runs, notifications,
 *     texting consent, portal accounts, appointments, calls; a time
 *     automation and the "first follow up" button pass the imported cards by
 *     (while a normal card in the same column is picked up);
 *   - Anthony Gonzalez / Ant G: a possible match on the customer page;
 *   - the name rule itself (sameName, decideMatch);
 *   - a second --apply makes nothing new;
 *   - Undo import puts everything back exactly (customers on file byte for
 *     byte, the board as it was, live counts as before); Restore from
 *     Deleted Records brings the import back; undo again is exact again.
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('MyBudgetQuote import (dev database)', () => {
  let prisma: any
  let m: any
  let ci: any
  const tag = `mbq-${Date.now().toString(36)}`
  let accountId = ''
  let ownerId = ''
  const startedAt = new Date()
  const on: Record<string, any> = {}
  let rows: any[] = []
  let batchId = ''
  const FILE = path.join(__dirname, 'fixtures', 'mybudgetquote-small.csv')

  /** A customer's row exactly as stored, every column. */
  const raw = async (id: string): Promise<string> => (await prisma.$queryRaw`SELECT row_to_json(c)::text AS j FROM "CrmContact" c WHERE id = ${id}`)[0]?.j
  const rawAll = async () => Object.fromEntries(await Promise.all(Object.entries(on).map(async ([k, c]) => [k, await raw(c.id)])))
  const board = async () => JSON.stringify((await prisma.pipelineState.findUnique({ where: { accountId } })).leads)
  /** What a person sees: live rows per table for the test company. */
  const liveCounts = async () => ({
    customers: await prisma.crmContact.count({ where: { accountId, deletedAt: null } }),
    notes: await prisma.crmContactNote.count({ where: { accountId, deletedAt: null } }),
    possibleMatches: await prisma.customerPossibleMatch.count({ where: { accountId } }),
    importRows: await prisma.customerImportRow.count({ where: { accountId, undoneAt: null } }),
    cards: ((await prisma.pipelineState.findUnique({ where: { accountId } })).leads as any[]).length,
  })
  /** Everything that would mean something was sent or started. */
  const sideEffects = async () => ({
    cardFollowUps: await prisma.cardFollowUp.count({ where: { accountId } }),
    events: await prisma.automationEvent.count({ where: { accountId } }),
    runs: await prisma.automationRun.count({ where: { accountId } }),
    textConsents: await prisma.crmTextConsent.count({ where: { accountId } }),
    consentYes: await prisma.crmContact.count({ where: { accountId, textConsent: { not: 'unknown' } } }),
    appointments: await prisma.appointment.count({ where: { accountId } }),
    calls: await prisma.callLog.count({ where: { accountId } }),
    pendingTouches: await prisma.pendingTouch.count({ where: { accountId } }),
    intake: await prisma.intakeLead.count({ where: { accountId } }),
    portalAccounts: await prisma.portalAccount.count({ where: { crmCustomerId: { in: (await prisma.crmContact.findMany({ where: { accountId }, select: { id: true } })).map((c: any) => c.id) } } }),
    notifications: await prisma.notification.count({ where: { createdAt: { gte: startedAt }, OR: [{ title: { contains: tag } }, { body: { contains: 'Dropper' } }, { body: { contains: 'Gonzalez' } }, { title: { contains: 'Gonzalez' } }] } }),
  })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    m = await import('../src/server/lib/mybudgetquoteImport.js')
    ci = await import('../src/server/lib/customerImport.js')
    const { START_PIPELINE_STAGES } = await import('../src/server/lib/pipelineStageModel.js')
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    ownerId = (await prisma.crmUser.create({ data: { email: `${tag}-owner@example.test`, firstName: 'Test', lastName: 'Owner', role: 'super_admin', status: 'active', mustChangePassword: false, crmAccountId: accountId } })).id
    // No Answer needs a follow up here, so the "first follow up" button would take its cards (it must skip the imported ones).
    await prisma.accountKeyValue.create({ data: { accountId, key: 'fencepro_pipeline_stages', value: START_PIPELINE_STAGES.map((s: any) => (s.id === 'No Answer' ? { ...s, needsFollowUp: true } : s)) } })
    await prisma.accountKeyValue.create({ data: { accountId, key: 'fencepro_lead_sources', value: ['Facebook', 'Referral', 'Other', 'website/google', 'Instagram'].map((id, i) => ({ id, name: id, order: i, hidden: false, builtIn: false, alsoMatches: [] })) } })
    await prisma.businessState.create({ data: { accountId } })
    const mk = (k: string, data: any) => prisma.crmContact.create({ data: { accountId, lastName: tag, ...data } }).then((c: any) => { on[k] = c; return c })
    await mk('pat', { firstName: 'Pat', phone: '3525550101', email: `pat.${tag}@example.test`, tags: ['Residential'] })
    await mk('eve', { firstName: 'EVE', lastName: 'e-mail', email: 'Eve@example.test', serviceAddress: '1 Eve Rd' })
    await mk('sam', { firstName: 'Sam', lastName: 'Sold', phone: '(352) 555-0103' })
    await mk('nora', { firstName: 'Nora', lastName: 'Namesake' })
    await mk('twoA', { firstName: 'Two', lastName: 'Matches', phone: '352.555.0105' })
    await mk('twoB', { firstName: 'Twob', email: 'two.b@example.test' })
    await mk('larry', { firstName: 'Larry', lastName: 'Lost', phone: '+1 352 555 0106' })
    await prisma.savedJob.create({ data: { accountId, crmContactId: on.sam.id, customerName: 'Sam', status: 'paid', paymentStatus: 'paid', quotePrice: 1000, contractValue: 1000 } as any })
    const card = (id: string, c: any, stage: string, day: string, extra: any = {}) => ({ id, customerId: c.id, firstName: c.firstName, lastName: c.lastName, phone: '', email: '', address: '', leadSource: '', leadTemp: 0, fenceType: '', sections: 0, quotePrice: 0, crew: '', scheduledDate: '', jobValue: 0, paymentStatus: '', balanceDue: 0, notes: '', stage, createdAt: day, lastMoved: day, ...extra })
    await prisma.pipelineState.create({ data: { accountId, stages: [], archivedLeads: [], leads: [
      card(`${tag}-eve`, on.eve, 'Estimating', '2026-09-01'),
      card(`${tag}-larry`, on.larry, 'Lost Sale', '2024-01-01'),
      // A normal card in No Answer: the time automation and the first follow up must still see it.
      card(`${tag}-control`, on.nora, 'No Answer', '2026-01-01'),
    ] } })
    // A time automation on No Answer, switched on long ago: it would fire for any card there.
    await prisma.automationRule.create({ data: { accountId, name: `${tag} 1 day in No Answer`, board: 'sales', enabled: true, enabledAt: new Date('2020-01-01'), trigger: { type: 'in_stage_days', stage: 'No Answer', days: 1 }, steps: [{ type: 'notify', title: 'x', body: 'y' }] } })
    rows = m.readRows(fs.readFileSync(FILE, 'utf8'))
  })

  afterAll(async () => {
    if (!prisma || !accountId) return
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.automationRun.deleteMany({ where: { accountId } })
    await prisma.automationRule.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.deletionLog.deleteMany({ where: { accountId } })
    await prisma.importBatch.deleteMany({ where: { accountId } })
    await prisma.customerImportRow.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmContactNote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.auditLog?.deleteMany?.({ where: { userId: ownerId } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  let before: any, beforeRaw: any, beforeBoard = '', beforeSide: any
  test('the plan writes nothing and decides every rule', async () => {
    before = await liveCounts(); beforeRaw = await rawAll(); beforeBoard = await board(); beforeSide = await sideEffects()
    const plan = await m.planMbq(prisma, accountId, rows, 'small.csv')
    expect(await liveCounts()).toEqual(before)
    expect(await rawAll()).toEqual(beforeRaw)
    const by = (k: string) => plan.decisions.find((d: any) => d.row.key === k)
    // Same name: attached, by email (other capitals) or phone; never by name alone.
    expect(by('T9102')).toMatchObject({ kind: 'matched', contactId: on.eve.id, matchedBy: 'email' })
    // Same phone, different name (Patricia Other vs Pat): a NEW customer with a Possible match on Pat.
    expect(by('T9101')).toMatchObject({ kind: 'new', possibleOf: { c: { id: on.pat.id }, by: 'phone' } })
    expect(by('T9101').contactId).not.toBe(on.pat.id)
    expect(by('T9103')).toMatchObject({ kind: 'matched', contactId: on.sam.id, matchedBy: 'phone' })
    expect(by('T9104').kind).toBe('new')
    expect(by('T9104').contactId).not.toBe(on.nora.id)
    // Two customers on file: the single one with the same name (Two Matches), else not guessed (Zed Nobody).
    expect(by('T9105')).toMatchObject({ kind: 'matched', contactId: on.twoA.id, matchedBy: 'phone', byNameAmong: 2 })
    expect(by('T9111')).toMatchObject({ kind: 'skip', skipWhy: expect.stringContaining('none by name') })
    expect(by('T9111').candidates.map((x: any) => x.c.id).sort()).toEqual([on.twoA.id, on.twoB.id].sort())
    // Cards for customers on file: open card -> none; paid job -> none; only a finished card -> made.
    expect(by('T9101').card).toMatchObject({ make: true, stage: 'No Answer' })
    expect(by('T9105').card).toMatchObject({ make: true, stage: 'No Answer' })
    expect(by('T9102').card).toMatchObject({ make: false, why: expect.stringContaining('open card (Estimating)') })
    expect(by('T9103').card).toMatchObject({ make: false, why: 'they have a paid job' })
    expect(by('T9106').card).toMatchObject({ make: true, stage: 'No Answer' })
    // make_card: First Contact always (a Dropoff too); No Answer + Dropoff never.
    expect(by('T9001').card).toMatchObject({ make: true, stage: 'First Contact' })
    expect(by('T9109').card.make).toBe(false)
    expect(by('T9109').tags).toEqual(['MyBudgetQuote import', 'MyBudgetQuote dropoff'])
    // Sold and unmatched: customer, no card, listed.
    expect(by('T9108')).toMatchObject({ kind: 'new', card: { make: false, why: expect.stringContaining('Sold in the old tool') } })
    // Lead sources: mapped where the company has it, otherwise its own.
    expect(by('T9002;T9003').leadSource).toBe('website/google')
    expect(by('T9101').leadSource).toBe('Referral')
    expect(by('T9104').leadSource).toBe('Home Show')
    expect(plan.counts).toMatchObject({ rows: 15, newCustomers: 10, matchedRows: 4, matchedCustomers: 4, cardsByStage: { 'First Contact': 4, 'No Answer': 6 }, newWithoutCard: 2, possibleMatches: 2, possibleMatchesByKind: { sameEmailAndStreet: 1, nameDiffers: 1 } })
    expect(plan.counts.skipped).toEqual({ 'matches two or more customers on file, none by name (not guessed)': 1 })
    expect(plan.counts.flags).toMatchObject({ 'old tool status Sold': 2, 'contact cleared': 1, 'N different addresses on this phone/email': 1 })
  })

  test('apply: customers, cards in order, notes, tags, flags, possible match; customers on file only tagged', async () => {
    const r = await m.applyMbq(prisma, accountId, rows, 'small.csv', 'test')
    batchId = r.batchId
    expect(batchId).toBeTruthy()
    expect(r.wrote).toMatchObject({ contacts: 10, notes: 14, cards: 10, tagged: 4, possibleMatches: 2, rows: 14 })
    const made = await prisma.crmContact.findMany({ where: { accountId, id: { notIn: Object.values(on).map((c: any) => c.id) } } })
    const named = (f: string, l: string) => made.find((c: any) => c.firstName === f && c.lastName === l)
    const rita = named('Rita', 'Received')
    expect(rita).toMatchObject({ phone: '(352) 555 0171', email: 'rita.received@example.test', serviceAddress: '11 Oak Lane, Ocala, FL 34470', city: 'Ocala', state: 'FL', zip: '34470', leadSource: 'website/google', jobStatus: 'First Contact', textConsent: 'unknown', tags: ['MyBudgetQuote import'] })
    expect(named('Olive', 'Dropoff').tags).toEqual(['MyBudgetQuote import', 'MyBudgetQuote dropoff'])
    // The pinned history note: estimate as a note, never a quote; every field.
    const note = await prisma.crmContactNote.findFirst({ where: { crmContactId: rita.id } })
    expect(note.isPinned).toBe(true)
    expect(note.createdBy).toBe('MyBudgetQuote import')
    for (const s of ['MyBudgetQuote history', 'Old online estimate $9,493 to $10,383 (2026-10-19)', 'Status in the old tool: Received', 'Furthest step: Design', 'Finished the quote: yes', 'Best time to contact: Contact via Email', 'Their notes: Wants the gates moved up front, "asap".', 'Attachments in the old tool: yes', 'Old tool ids: T9002, T9003', 'Pipeline card: First Contact'])
      expect(note.body).toContain(s)
    expect(await prisma.savedQuote.count({ where: { accountId } })).toBe(0)
    const cleared = named('Cleared', 'Contact')
    expect((await prisma.crmContactNote.findFirst({ where: { crmContactId: cleared.id } })).body).toContain('Flags: staff phone/email was entered; contact cleared.')
    // Structured: the same fields, estimates in cents.
    const ir = await prisma.customerImportRow.findFirst({ where: { accountId, sourceKey: 'T9002;T9003' } })
    expect(ir.data).toMatchObject({ lowEstimateCents: 949300, highEstimateCents: 1038300, old_tool_status: 'Received', best_time_to_contact: 'Contact via Email', has_attachments: 'yes', card: 'First Contact' })
    expect((await ci.importHistory(accountId, cleared.id))[0].data.flagList).toEqual(['staff phone/email was entered', 'contact cleared'])

    // Customers on file it attached to: the tag, and nothing else, changed. They get the note.
    const larry = JSON.parse(await raw(on.larry.id)), larryBefore = JSON.parse(beforeRaw.larry)
    expect(larry.tags).toEqual(['MyBudgetQuote import'])
    const { tags: _a, updatedAt: _b, ...larryRest } = larry, { tags: _c, updatedAt: _d, ...larryRestBefore } = larryBefore
    expect(larryRest).toEqual(larryRestBefore)
    const larryNote = await prisma.crmContactNote.findFirst({ where: { crmContactId: on.larry.id } })
    expect(larryNote.body).toContain('Matched to this customer by phone. Nothing on the customer was changed.')
    expect(larryNote.body).toContain('As the old tool had them: Larry Lost')
    // Not attached at all: Pat (different name), Nora (name only), Twob (Zed was skipped).
    for (const k of ['pat', 'nora', 'twoB']) expect(await raw(on[k].id)).toEqual(beforeRaw[k])
    expect(await prisma.crmContactNote.count({ where: { crmContactId: on.pat.id } })).toBe(0)
    // Patricia Other: a new customer of her own, her card, her note, and the Possible match on Pat.
    const patricia = named('Patricia', 'Other')
    expect(patricia).toMatchObject({ phone: '(352) 555-0101', leadSource: 'Referral', tags: ['MyBudgetQuote import'] })
    expect((await prisma.crmContactNote.findFirst({ where: { crmContactId: patricia.id } })).body).toContain(`Same phone as Pat ${tag} on file, but a different name`)
    expect((await ci.importHistory(accountId, patricia.id))[0].data.possibleMatchOf).toMatchObject({ id: on.pat.id, by: 'phone' })

    // Cards: after the board's own, in the file's order per column, dated latest_date, marked quiet.
    const leads = (await prisma.pipelineState.findUnique({ where: { accountId } })).leads as any[]
    const imp = leads.filter(l => l.importBatchId === batchId)
    expect(leads.slice(0, 3).map(l => l.id)).toEqual([`${tag}-eve`, `${tag}-larry`, `${tag}-control`])
    expect(imp.map(l => `${l.stage}:${l.firstName}`)).toEqual([
      'First Contact:Dana', 'First Contact:Rita', 'First Contact:Anthony', 'First Contact:Ant',
      'No Answer:Patricia', 'No Answer:Nora', 'No Answer:Two', 'No Answer:Larry', 'No Answer:Cleared', 'No Answer:Rob',
    ])
    expect(imp.find(l => l.firstName === 'Rita')).toMatchObject({ createdAt: '2026-10-17', lastMoved: '2026-10-17', importStage: 'First Contact', quotePrice: 0, customerId: rita.id })
    expect(imp.find(l => l.firstName === 'Two').customerId).toBe(on.twoA.id)
    expect(imp.find(l => l.firstName === 'Patricia').customerId).toBe(patricia.id)
    expect(imp.some(l => [on.eve.id, on.sam.id, on.pat.id].includes(l.customerId))).toBe(false)
    expect(imp.some(l => ['Olive', 'Sally'].includes(l.firstName))).toBe(false)

    // Anthony Gonzalez and Ant G: both made, the possible match on Anthony's page.
    const { matchView } = await import('../src/server/lib/customerMerge.js')
    const anthony = named('Anthony', 'Gonzalez'), antG = named('Ant', 'G')
    const view = await matchView(accountId, anthony.id)
    expect(view.matches.map((x: any) => [x.customer.id, x.reason])).toEqual([[antG.id, 'email']])
    expect((await matchView(accountId, patricia.id)).matches.map((x: any) => [x.customer.id, x.reason])).toEqual([[on.pat.id, 'phone']])

    // Search by tag finds the dropoffs (the customer list searches tags).
    expect(made.filter((c: any) => (c.tags as string[]).includes('MyBudgetQuote dropoff')).map((c: any) => c.firstName)).toEqual(['Olive'])
  })

  test('the name rule (every import)', async () => {
    const same = (a: string, b: string) => { const [f1, ...l1] = a.split(' '), [f2, ...l2] = b.split(' '); return ci.sameName({ first: f1, last: l1.join(' ') }, { first: f2, last: l2.join(' ') }) }
    for (const [a, b] of [['John StClair', 'John St. Clair'], ['Elsa Ipus', 'Roger & Elsa Ipus'], ['Nonito Palencia Jr.', 'Nonito Palencia'], ['Eric Velázquez', 'ERIC velazquez'], ['Brianna Grant', 'Brianna Grant']]) expect(same(a, b), `${a} = ${b}`).toBe(true)
    for (const [a, b] of [['Ant G', 'Anthony Gonzalez'], ['Jennifer D', 'Jennifer'], ['Ted miiler', 'Ted Miller'], ['Hector Pritoni', 'Hector Valle'], ['Brianna Grant', 'Devontae Grant']]) expect(same(a, b), `${a} != ${b}`).toBe(false)
    const hit = (to: string, first: string, last: string, by = 'phone') => ({ to, by, first, last })
    expect(ci.decideMatch({ first: 'Brianna', last: 'Grant' }, [hit('a', 'Brianna', 'Grant', 'phone and email'), hit('b', 'Devontae', 'Grant', 'email')])).toEqual({ kind: 'attach', to: 'a', by: 'phone and email' })
    expect(ci.decideMatch({ first: 'Ant', last: 'G' }, [hit('a', 'Anthony', 'Gonzalez')])).toEqual({ kind: 'new_possible', to: 'a', by: 'phone' })
    expect(ci.decideMatch({ first: 'Kim', last: 'Lee' }, [hit('a', 'Kim', 'Lee'), hit('b', 'Kim', 'Lee')]).kind).toBe('skip')
    expect(ci.decideMatch({ first: 'Kim', last: 'Lee' }, [])).toEqual({ kind: 'new' })
  })

  test('nothing is sent and nothing starts', async () => {
    expect(await sideEffects()).toEqual(beforeSide)
    // The duplicate check does not report Patricia (new) and Pat (on file) sharing a phone: they are already a Possible match.
    const { findDuplicates } = await import('../src/server/lib/duplicateCheck.js')
    expect((await findDuplicates(accountId)).filter((f: any) => f.check === 'phone')).toEqual([])
    // A time automation passes the imported cards by (the normal card in No Answer is picked up).
    const { scanTimeTriggers } = await import('../src/server/lib/automations/queue.js')
    await scanTimeTriggers(new Date())
    const ev = await prisma.automationEvent.findMany({ where: { accountId, type: 'time' } })
    expect(ev.map((e: any) => e.entityId)).toEqual([`${tag}-control`])
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    // The "first follow up" button too.
    const { firstFollowUpPreview } = await import('../src/server/lib/followUps.js')
    const due = (await firstFollowUpPreview(accountId)).cardIds
    expect(due).toContain(`${tag}-control`)
    const leads = (await prisma.pipelineState.findUnique({ where: { accountId } })).leads as any[]
    expect(leads.filter(l => l.importBatchId).length).toBe(10)
    expect(due.filter((id: string) => leads.find(l => l.id === id)?.importBatchId)).toEqual([])
  })

  test('a second apply makes nothing new', async () => {
    const mid = await liveCounts()
    const r = await m.applyMbq(prisma, accountId, rows, 'small.csv', 'test')
    expect(r.batchId).toBeNull()
    expect(r.plan.counts.skipped['already imported']).toBe(14)
    expect(await liveCounts()).toEqual(mid)
    expect(await prisma.importBatch.count({ where: { accountId } })).toBe(1)
  })

  test('undo puts everything back exactly; Restore brings the import back; undo again is exact again', async () => {
    const u = await ci.undoImport({ accountId, userId: ownerId }, batchId)
    expect(u.left).toEqual([])
    expect(await liveCounts()).toEqual(before)
    expect(await rawAll()).toEqual(beforeRaw)
    expect(await board()).toEqual(beforeBoard)
    expect(await sideEffects()).toEqual(beforeSide)
    // A second undo is refused.
    await expect(ci.undoImport({ accountId, userId: ownerId }, batchId)).rejects.toThrow(/already undone/)
    // The keys are free again: a plan would make them all again.
    expect((await m.planMbq(prisma, accountId, rows, 'small.csv')).counts.newCustomers).toBe(10)

    // Restore (Settings > Deleted Records) puts the import back, tags included.
    const { restoreDeletion } = await import('../src/server/lib/deletion.js')
    const r = await restoreDeletion({ accountId, userId: ownerId }, u.logId)
    expect(r.skipped.filter((s: any) => !/automation/.test(s.what))).toEqual([])
    expect(await liveCounts()).toMatchObject({ customers: before.customers + 10, cards: before.cards + 10, possibleMatches: 2 })
    expect(JSON.parse(await raw(on.larry.id)).tags).toEqual(['MyBudgetQuote import'])
    expect((await prisma.importBatch.findUnique({ where: { id: batchId } })).undoneAt).toBeNull()
    // And undo once more: exactly as before the import again.
    await ci.undoImport({ accountId, userId: ownerId }, batchId)
    expect(await liveCounts()).toEqual(before)
    expect(await rawAll()).toEqual(beforeRaw)
    expect(await board()).toEqual(beforeBoard)
  })
})
