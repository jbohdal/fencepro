/**
 * People who stop the website instant quote part way (lib/widgetPartialLead.ts;
 * Jonathan, Oct 29 2026), against the dev database through the widget's own
 * routes (routes/quote-widget.ts):
 *   - nothing is saved before a name and a phone or email: not the address
 *     (the "where is it" lookup is not kept), not a photo, not a lead;
 *   - the name and phone typed: one lead "Didn't finish instant quote", with
 *     the address, the fence, the drawing and the estimate; one customer (the
 *     tag), one card (marked), one note, one draft quote;
 *   - the owner's push once (after the customer has stopped, or at once when
 *     the page closes), never again for updates;
 *   - updates while they keep going change that same lead, with no new push;
 *   - a later visit with the same name and phone updates it; a different name
 *     with the same phone is a new customer with a Possible match;
 *   - sending the quote finishes that same lead (customer, card, lead, quote)
 *     and clears "Didn't finish", with no second push;
 *   - the dev outbox has no text or email to the customer;
 *   - junk, robots, other sites and floods are refused.
 * Everything made here is removed after.
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import express from 'express'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll, beforeAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('website quotes not finished (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: widget } = await import('../src/server/routes/quote-widget.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { leadPushesSettled } = await import('../src/server/lib/leadAssign.js')
  const { devOutboxFile } = await import('../src/server/lib/outboundGate.js')
  const { partialLeadPushSweep, partialPushKey, PARTIAL_SOURCE, UNFINISHED, PARTIAL_PUSH_QUIET_MS } = await import('../src/server/lib/widgetPartialLead.js')
  const { fromLocalFt } = await import('../../web/src/widgetDraw')

  const app = express()
  app.set('trust proxy', 1)
  app.use('/p/quote', widget)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/quote/api`
  let ip = 10
  const call = async (p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.6.${ip++ % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: await r.json().catch(() => null) as any }
  }
  const visit = () => crypto.randomBytes(18).toString('base64url')

  const at = { lat: 29.185118, lng: -82.134209 }
  const p = (e: number, n: number) => fromLocalFt(at, { x: e, y: n })
  const ADDRESS = '110 SE Watula Ave, Ocala, FL 34471'
  const drawing = { v: 1, address: ADDRESS, at, runs: [{ id: 'r1', pts: [p(-30, 15), p(-55, 15), p(-55, 95), p(55, 95), p(55, 15), p(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }
  const pick = { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }
  const tag = crypto.randomBytes(3).toString('hex')
  const LAST = `DbPartial ${tag}`
  const NAME = `E2E ${LAST}`
  const n = Math.floor(Math.random() * 9000) + 1000
  const PHONE = `352-555-${n}`
  let accountId = ''
  const t0 = new Date()

  const outbox = (): Array<{ channel: string; to: string; title: string; body?: string }> => {
    try { return fs.readFileSync(devOutboxFile(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] }
  }
  const mine = async () => {
    const contacts = await prisma.crmContact.findMany({ where: { accountId, lastName: { contains: LAST, mode: 'insensitive' } }, select: { id: true, firstName: true, lastName: true, tags: true, phone: true, leadSource: true } })
    const ids = contacts.map(c => c.id)
    const state = await prisma.pipelineState.findUnique({ where: { accountId } })
    return {
      contacts,
      cards: ((state?.leads as any[]) ?? []).filter(l => ids.includes(l?.customerId)),
      leads: await prisma.intakeLead.findMany({ where: { crmContactId: { in: ids } } }),
      notes: await prisma.crmContactNote.findMany({ where: { crmContactId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
      quotes: await prisma.savedQuote.findMany({ where: { crmContactId: { in: ids } } }),
      matches: await prisma.customerPossibleMatch.count({ where: { contactId: { in: ids } } }),
    }
  }
  const pushesFor = (name: string) => outbox().filter(m => m.channel === 'push' && m.title === `New lead: ${name}`)

  beforeAll(async () => { accountId = (await resolveIntakeAccountId())! })
  afterAll(async () => {
    server.close()
    await leadPushesSettled()
    const contacts = await prisma.crmContact.findMany({ where: { accountId, lastName: { contains: LAST, mode: 'insensitive' } }, select: { id: true } })
    const ids = contacts.map(c => c.id)
    for (let k = 0; k < 5; k++) {
      const s = await prisma.pipelineState.findUnique({ where: { accountId } })
      const leads = ((s?.leads as any[]) ?? [])
      const keep = leads.filter(l => !ids.includes(l?.customerId))
      if (keep.length === leads.length) break
      const cards = leads.filter(l => ids.includes(l?.customerId)).map(l => l.id)
      const done = await prisma.pipelineState.updateMany({ where: { accountId, version: s!.version }, data: { leads: keep, version: { increment: 1 } } })
      if (done.count) { await prisma.automationEvent.deleteMany({ where: { entityId: { in: cards } } }); await prisma.cardFollowUp.deleteMany({ where: { cardId: { in: cards } } }); break }
    }
    const leads = await prisma.intakeLead.findMany({ where: { crmContactId: { in: ids } }, select: { id: true } })
    await prisma.automationEffect.deleteMany({ where: { key: { in: leads.map(l => partialPushKey(l.id)) } } })
    await prisma.automationEffect.deleteMany({ where: { key: { in: ids.flatMap(id => [`lead-repush:${id}:2h`, `lead-repush:${id}:8am`]) } } })
    await prisma.savedQuote.deleteMany({ where: { crmContactId: { in: ids } } })
    await prisma.intakeLead.deleteMany({ where: { crmContactId: { in: ids } } })
    await prisma.crmContactNote.deleteMany({ where: { crmContactId: { in: ids } } })
    await prisma.customerPossibleMatch.deleteMany({ where: { OR: [{ contactId: { in: ids } }, { matchId: { in: ids } }] } })
    const photos = await prisma.portalPhoto.findMany({ where: { crmCustomerId: { in: ids } }, select: { id: true, fileKey: true } })
    await prisma.portalPhoto.deleteMany({ where: { id: { in: photos.map(x => x.id) } } })
    for (const ph of photos) fs.rmSync(path.resolve(process.env.UPLOAD_DIR || './uploads', ph.fileKey), { force: true })
    await prisma.crmContact.deleteMany({ where: { id: { in: ids } } })
    await prisma.notification.deleteMany({ where: { title: { contains: LAST } } })
  })

  test('before the name and phone: the address is looked up but not kept, no photo is taken, no lead is made', async () => {
    const geo0 = await prisma.geoPoint.count({ where: { accountId } })
    const typed = `9${n} SE Partial Test Rd, Ocala, FL 34471`
    const placed = await call(`/place?address=${encodeURIComponent(typed)}`)
    expect(placed.status).toBe(200)
    expect(await prisma.geoPoint.count({ where: { accountId } })).toBe(geo0)
    expect(await prisma.geoPoint.count({ where: { address: typed } })).toBe(0)
    // A photo before the contact: refused, nothing written.
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('ffd8ffe000104a464946', 'hex')], { type: 'image/jpeg' }), 'yard.jpg')
    const before = fs.existsSync(path.resolve(process.env.UPLOAD_DIR || './uploads', 'intake')) ? fs.readdirSync(path.resolve(process.env.UPLOAD_DIR || './uploads', 'intake')).length : 0
    const ph = await fetch(`${base}/photo?sid=${visit()}`, { method: 'POST', body: fd, headers: { 'X-Forwarded-For': '10.7.5.1' } })
    expect(ph.status).toBe(403)
    const after = fs.existsSync(path.resolve(process.env.UPLOAD_DIR || './uploads', 'intake')) ? fs.readdirSync(path.resolve(process.env.UPLOAD_DIR || './uploads', 'intake')).length : 0
    expect(after).toBe(before)
    // The old draft save is gone.
    expect((await fetch(`${base}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)
    // Address, drawing and fence with no name and phone (or a bad phone and no email): refused, nothing saved.
    const sid = visit()
    for (const who of [{ name: '', phone: PHONE }, { name: NAME, phone: '' }, { name: NAME, phone: '123-4567' }, { name: NAME, phone: '111-111-1111' }, { name: 'X', phone: PHONE }, { name: NAME, email: 'not an email' }]) {
      const r = await call('/partial', { sessionId: sid, ...who, address: ADDRESS, drawing, pick, step: 3 })
      expect(r.status).toBe(400)
    }
    expect((await mine()).contacts).toHaveLength(0)
    expect(await prisma.intakeLead.count({ where: { sourceRef: sid } })).toBe(0)
  })

  let sid1 = ''
  let leadId = ''
  test('the name and phone typed: one lead "Didn\'t finish instant quote" with what they entered; no push yet, no message to the customer', async () => {
    sid1 = visit()
    const box0 = outbox().length
    const r = await call('/partial', { sessionId: sid1, name: NAME, phone: PHONE, email: '', address: ADDRESS, drawing, pick, step: 3, priceShown: false, wantsVisit: true })
    expect(r.status).toBe(201)
    const m = await mine()
    expect(m.contacts).toHaveLength(1)
    expect(m.contacts[0].tags).toEqual([UNFINISHED])
    expect(m.contacts[0].leadSource).toBe('Website Quote')
    expect(m.leads).toHaveLength(1)
    const lead = m.leads[0]
    leadId = lead.id
    expect(lead).toMatchObject({ source: PARTIAL_SOURCE, sourceRef: sid1, name: NAME, phone: PHONE, address: ADDRESS, status: 'imported' })
    expect(lead.fenceType).toMatch(/^Vinyl, Better/)
    expect(lead.estimate).toBeGreaterThan(1000)
    expect(lead.summary).toMatch(/^Didn't finish instant quote/)
    expect(lead.summary).toMatch(/Got as far as: 4\. Price/)
    expect(lead.summary).toMatch(/not shown to the customer/)
    expect((lead.payload as any).drawing.runs).toHaveLength(1)
    expect(m.cards).toHaveLength(1)
    expect(m.cards[0]).toMatchObject({ unfinishedQuote: true, leadSource: 'Website Quote' })
    expect(m.cards[0].notes).toMatch(/^Didn't finish instant quote · /)
    expect(m.notes).toHaveLength(1)
    expect(m.notes[0].body).toBe(lead.summary)
    expect(m.quotes).toHaveLength(1)
    expect(m.quotes[0]).toMatchObject({ status: 'DRAFT', leadSource: 'Website Quote' })
    expect((m.quotes[0].layout as any).widgetDrawing.unfinished).toBe(true)
    // The push waits until they stop; nothing at all goes to the customer.
    await leadPushesSettled()
    expect(pushesFor(NAME)).toHaveLength(0)
    expect(outbox().slice(box0).filter(x => x.channel === 'text' || x.channel === 'email')).toHaveLength(0)
  })

  test('they keep going: the same lead is updated (no second customer, card, note or quote) and no push', async () => {
    const r = await call('/partial', { sessionId: sid1, name: NAME, phone: PHONE, email: `e2e.partial.${tag}@example.invalid`, address: ADDRESS, drawing, pick: { ...pick, color: 'tan' }, step: 3, notes: 'Dog in the yard' })
    expect(r.status).toBe(200)
    const m = await mine()
    expect([m.contacts.length, m.cards.length, m.leads.length, m.notes.length, m.quotes.length]).toEqual([1, 1, 1, 1, 1])
    expect(m.leads[0].email).toBe(`e2e.partial.${tag}@example.invalid`)
    expect(m.leads[0].summary).toMatch(/Customer notes: Dog in the yard/)
    expect(m.notes[0].body).toMatch(/Dog in the yard/)
    expect(m.quotes[0].fenceStyle).toMatch(/^TV/)
    await leadPushesSettled()
    expect(pushesFor(NAME)).toHaveLength(0)
  })

  test('the owner\'s push: once, after they have stopped; a second pass sends none', async () => {
    // Still typing a moment ago: not yet.
    expect(await partialLeadPushSweep(new Date(), { accountIds: [accountId] })).not.toContain(leadId)
    const later = new Date(Date.now() + PARTIAL_PUSH_QUIET_MS + 5_000)
    expect(await partialLeadPushSweep(later, { accountIds: [accountId] })).toContain(leadId)
    expect(await partialLeadPushSweep(later, { accountIds: [accountId] })).not.toContain(leadId)
    const pushes = pushesFor(NAME)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].body).toMatch(/^Didn't finish instant quote · Ocala · Vinyl/)
    expect(pushes[0].body).toMatch(/Tap to assign/)
    const bell = await prisma.notification.findMany({ where: { title: { contains: LAST } } })
    expect(bell.map(b => b.title)).toEqual([`Didn't finish instant quote: ${NAME}`])
    expect(bell[0].link).toMatch(/^\/assign-lead\?customer=/)
    // More changes after the push: still one push.
    await call('/partial', { sessionId: sid1, name: NAME, phone: PHONE, address: ADDRESS, drawing, pick, step: 3 })
    await partialLeadPushSweep(new Date(Date.now() + 20 * 60_000), { accountIds: [accountId] })
    await leadPushesSettled()
    expect(pushesFor(NAME)).toHaveLength(1)
  })

  test('a later visit with the same name and phone updates the same lead; a different name with that phone is a new customer with a Possible match', async () => {
    const sid2 = visit()
    const r = await call('/partial', { sessionId: sid2, name: NAME.toUpperCase(), phone: PHONE.replace(/-/g, ''), address: ADDRESS, drawing, pick, step: 2 })
    expect(r.status).toBe(200)
    let m = await mine()
    expect([m.contacts.length, m.leads.length, m.cards.length]).toEqual([1, 1, 1])
    expect(m.leads[0].sourceRef).toBe(sid2)
    expect((m.leads[0].payload as any).sessions).toEqual([sid1, sid2])
    sid1 = sid2
    const other = await call('/partial', { sessionId: visit(), name: `Pat ${LAST}`, phone: PHONE, address: ADDRESS, step: 0 })
    expect(other.status).toBe(201)
    m = await mine()
    expect(m.contacts).toHaveLength(2)
    expect(m.matches).toBeGreaterThanOrEqual(1)
    const pat = m.leads.find(l => l.name === `Pat ${LAST}`)!
    expect(pat.summary).toMatch(/Address: 110 SE Watula/)
    expect(pat.summary).toMatch(/Drawing: none yet/)
    expect(pat.summary).toMatch(/Fence: not picked yet/)
  })

  test('they come back and send it: the same customer, card, lead and quote, "Didn\'t finish" cleared, no second push, no message to the customer', async () => {
    const box0 = outbox().length
    const before = await mine()
    const dana = before.contacts.find(c => c.firstName === 'E2E')!
    const quoteId = before.quotes.find(q => q.crmContactId === dana.id)!.id
    const r = await call('/submit', { draftId: sid1, name: NAME, phone: PHONE, email: `e2e.partial.${tag}@example.invalid`, address: ADDRESS, drawing, pick, wantsVisit: true })
    expect(r.status).toBe(201)
    await leadPushesSettled()
    const m = await mine()
    expect(m.contacts).toHaveLength(2)
    const c = m.contacts.find(x => x.id === dana.id)!
    expect(c.tags).toEqual([])
    const lead = m.leads.find(l => l.crmContactId === dana.id)!
    expect(lead.id).toBe(leadId)
    expect(lead).toMatchObject({ source: 'ez_quote', sourceRef: sid1 })
    expect(lead.summary).toMatch(/^Website, drawn by customer/)
    expect(lead.summary).toMatch(/stopped before sending/)
    expect(m.leads.filter(l => l.crmContactId === dana.id)).toHaveLength(1)
    const card = m.cards.find(k => k.customerId === dana.id)!
    expect(m.cards.filter(k => k.customerId === dana.id)).toHaveLength(1)
    expect(card.unfinishedQuote).toBeUndefined()
    expect(card.notes).toMatch(/^Website, drawn by customer · /)
    expect(card.notes).not.toMatch(/Didn't finish/)
    const quotes = m.quotes.filter(q => q.crmContactId === dana.id)
    expect(quotes.map(q => q.id)).toEqual([quoteId])
    expect((quotes[0].layout as any).widgetDrawing.unfinished).toBeUndefined()
    expect(m.notes.filter(x => x.crmContactId === dana.id)).toHaveLength(1)
    // Still the one push (the "Didn't finish" one went before); the bell says it was finished.
    expect(pushesFor(NAME)).toHaveLength(1)
    expect(await prisma.notification.count({ where: { title: `Website quote: ${NAME} finished the instant quote` } })).toBe(1)
    expect(outbox().slice(box0).filter(x => x.channel === 'text' || x.channel === 'email')).toHaveLength(0)
    // Sent again (another option): the finished lead's own rule, nothing new.
    const again = await call('/submit', { draftId: sid1, name: NAME, phone: PHONE, address: ADDRESS, drawing, pick, wantsVisit: true })
    expect(again.body.duplicate).toBe(true)
    // A late save from the page after sending changes nothing.
    const late = await call('/partial', { sessionId: sid1, name: NAME, phone: PHONE, address: ADDRESS, step: 3 })
    expect(late.body).toMatchObject({ success: true, finished: true })
    expect((await mine()).leads.find(l => l.id === leadId)!.source).toBe('ez_quote')
  })

  test('sent within a moment of typing the phone: one push, the finished quote\'s ("Website quote"), never "Didn\'t finish"', async () => {
    const name = `Quinn ${LAST}`
    const sid = visit()
    const ph = `352-555-${String((n + 7) % 10000).padStart(4, '0')}`
    expect((await call('/partial', { sessionId: sid, name, phone: ph, address: ADDRESS, drawing, pick, step: 3 })).status).toBe(201)
    expect((await call('/submit', { draftId: sid, name, phone: ph, address: ADDRESS, drawing, pick, wantsVisit: false })).status).toBe(201)
    await leadPushesSettled()
    await partialLeadPushSweep(new Date(Date.now() + 20 * 60_000), { accountIds: [accountId] })
    const pushes = pushesFor(name)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].body).toMatch(/^Website quote · /)
    const m = await mine()
    const q = m.contacts.filter(c => c.firstName === 'Quinn')
    expect(q).toHaveLength(1)
    expect(m.leads.filter(l => l.crmContactId === q[0].id).map(l => l.source)).toEqual(['ez_quote'])
  })

  test('the page closing: the push goes at once, once', async () => {
    const name = `Rory ${LAST}`
    const sid = visit()
    const ph = `352-555-${String((n + 11) % 10000).padStart(4, '0')}`
    await call('/partial', { sessionId: sid, name, phone: ph, address: ADDRESS, step: 1 })
    await call('/partial', { sessionId: sid, name, phone: ph, address: ADDRESS, step: 1, leaving: true })
    await call('/partial', { sessionId: sid, name, phone: ph, address: ADDRESS, step: 1, leaving: true })
    await leadPushesSettled()
    expect(pushesFor(name)).toHaveLength(1)
    expect(pushesFor(name)[0].body).toMatch(/^Didn't finish instant quote · Ocala/)
  })

  test('junk and robots: the hidden box filled saves nothing; another site is refused; test mode writes nothing; a flood of new leads from one address is stopped', async () => {
    const robot = visit()
    expect((await call('/partial', { sessionId: robot, name: `Robot ${LAST}`, phone: PHONE, step: 3, website: 'http://spam.example' })).status).toBe(200)
    expect(await prisma.intakeLead.count({ where: { sourceRef: robot } })).toBe(0)
    const cross = await call('/partial', { sessionId: visit(), name: `Cross ${LAST}`, phone: PHONE, step: 3 }, { 'Sec-Fetch-Site': 'cross-site' })
    expect(cross.status).toBe(403)
    const t = visit()
    expect((await call('/partial', { sessionId: t, name: `Test ${LAST}`, phone: PHONE, step: 3, test: true })).body.test).toBe(true)
    expect(await prisma.intakeLead.count({ where: { sourceRef: t } })).toBe(0)
    expect((await call('/partial', { sessionId: 'short', name: NAME, phone: PHONE, step: 3 })).status).toBe(400)
    // Five new leads an hour from one address; the sixth is refused (updates of a known lead are not counted).
    const statuses: number[] = []
    for (let k = 0; k < 6; k++) {
      const r = await call('/partial', { sessionId: visit(), name: `Flood${String.fromCharCode(65 + k)} ${LAST}`, email: `flood${k}.${tag}@example.invalid`, step: 0 }, { 'X-Forwarded-For': '10.7.4.4' })
      statuses.push(r.status)
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
  })

  test('the dev outbox: nothing to any customer from this run, only pushes to the owner', async () => {
    await leadPushesSettled()
    const mineOut = outbox().filter(x => new Date((x as any).at) >= t0 && (x.title.includes(LAST) || (x.body ?? '').includes(LAST) || x.to.includes(tag)))
    expect(mineOut.length).toBeGreaterThan(0)
    expect(mineOut.every(x => x.channel === 'push')).toBe(true)
  })
})
