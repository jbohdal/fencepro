/**
 * The website quote drawn on the photo, against the dev database:
 *   - test mode (?test=1) prices everything and writes nothing (no draft, no
 *     customer, no quote, no card, no website lead, no note);
 *   - no draft is kept any more (nothing before the name and phone; the lead
 *     saved then is tests/widgetPartialLead.db.test.ts); a leftover draft past
 *     its 30 days is cleared;
 *   - sending makes exactly one customer, one pipeline card and one saved
 *     quote; sending again (twice at once, too) never makes a second; another
 *     option picked updates that quote;
 *   - prices only reach the page: no cost, margin or parts.
 * Records made here are removed after.
 */

import 'dotenv/config'
import express from 'express'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll, beforeAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the website quote drawn on the photo (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: widget } = await import('../src/server/routes/quote-widget.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { fromLocalFt } = await import('../../web/src/widgetDraw')

  const app = express()
  app.set('trust proxy', 1)
  app.use('/p/quote', widget)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/quote/api`
  // Each request from its own made up address, so the hourly limit is not what is tested here.
  let ip = 10
  const call = async (path: string, init: RequestInit = {}, cookie = '') => {
    const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.8.${ip++ % 250}`, ...(cookie ? { Cookie: cookie } : {}) } })
    return { status: r.status, body: await r.json(), setCookie: r.headers.get('set-cookie') ?? '' }
  }

  const at = { lat: 29.185118, lng: -82.134209 }
  const p = (e: number, n: number) => fromLocalFt(at, { x: e, y: n })
  const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [
    { id: 'r1', pts: [p(-30, 15), p(-55, 15), p(-55, 95), p(55, 95), p(55, 15), p(30, 15)], start: 'house', end: 'house', typedFt: [null, null, 112, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] },
  ] }
  const pick = { material: 'vinyl', color: 'white', height: '6', kind: 'privacy' }
  const NAME = 'E2E DbWidget Drawn'
  const PHONE = '352-555-0177'
  let accountId = ''
  const made: { draftIds: string[]; contact?: string } = { draftIds: [] }
  const counts = async () => {
    const contacts = await prisma.crmContact.findMany({ where: { accountId, firstName: 'E2E', lastName: 'DbWidget Drawn' }, select: { id: true } })
    const ids = contacts.map(c => c.id)
    const state = await prisma.pipelineState.findUnique({ where: { accountId } })
    return {
      contacts: ids.length,
      quotes: await prisma.savedQuote.count({ where: { crmContactId: { in: ids } } }),
      cards: ((state?.leads as any[]) ?? []).filter(l => ids.includes(l?.customerId)).length,
      leads: await prisma.intakeLead.count({ where: { crmContactId: { in: ids } } }),
      notes: await prisma.crmContactNote.count({ where: { crmContactId: { in: ids } } }),
    }
  }

  beforeAll(async () => { accountId = (await resolveIntakeAccountId())! })
  afterAll(async () => {
    server.close()
    const contacts = await prisma.crmContact.findMany({ where: { accountId, firstName: 'E2E', lastName: 'DbWidget Drawn' }, select: { id: true } })
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
    await prisma.savedQuote.deleteMany({ where: { crmContactId: { in: ids } } })
    await prisma.intakeLead.deleteMany({ where: { crmContactId: { in: ids } } })
    await prisma.crmContactNote.deleteMany({ where: { crmContactId: { in: ids } } })
    await prisma.customerPossibleMatch.deleteMany({ where: { contactId: { in: ids } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: ids } } })
    await prisma.widgetDraft.deleteMany({ where: { id: { in: made.draftIds } } })
    await prisma.notification.deleteMany({ where: { title: `Website quote: ${NAME}` } })
  })

  test('test mode: prices come back, nothing is written', async () => {
    // Only what this run could have made (other test files run alongside and make their own notifications).
    const t0 = new Date()
    const mine = async () => ({ ...(await counts()), drafts: await prisma.widgetDraft.count({ where: { createdAt: { gte: t0 } } }), notes: await prisma.notification.count({ where: { title: `Website quote: ${NAME}` } }), leads: await prisma.intakeLead.count({ where: { sourceRef: 'testtesttesttesttest01' } }) })
    const before = await mine()
    const r = await call('/submit', { method: 'POST', body: JSON.stringify({ draftId: 'testtesttesttesttest01', name: NAME, phone: PHONE, address: drawing.address, drawing, pick, test: true }) })
    expect(r.status).toBe(200)
    expect(r.body.test).toBe(true)
    expect(r.body.options.map((o: any) => o.name)).toEqual(['Good', 'Better', 'Best'])
    expect(await mine()).toEqual(before)
  })

  test('the website quote names the company as Settings > Company has it, never the account\'s sign up name', async () => {
    const r = await fetch(base + '/config')
    const j = await r.json() as any
    const accountId = await (await import('../src/server/lib/intake.js')).resolveIntakeAccountId()
    const b = await prisma.businessState.findUnique({ where: { accountId: accountId! }, select: { config: true } })
    expect(j.company).toBe(String((b?.config as any)?.company?.name || '').trim() || 'Getter Done Fence')
    expect(j.company).not.toBe('GD Fence Pro')
  })

  test('only prices reach the page: no cost, margin or parts', async () => {
    const r = await call('/submit', { method: 'POST', body: JSON.stringify({ draftId: 'testtesttesttesttest02', name: NAME, phone: PHONE, address: drawing.address, drawing, pick, test: true }) })
    const text = JSON.stringify({ ...r.body, preview: undefined })
    expect(text).not.toMatch(/cost|margin|gmPct|pullSheet|commission|unitCost|overhead/i)
    expect(Object.keys(r.body.options[0]).sort()).toEqual(['fenceStyle', 'key', 'name', 'perFoot', 'popular', 'price', 'styleLabel', 'text'])
    expect(JSON.stringify(r.body.preview)).not.toMatch(/cost|margin|pullSheet|overhead|costFactor/i)
  })

  // The visit's id, made by the page (memory only).
  const draftId = (await import('crypto')).randomBytes(18).toString('base64url')
  made.draftIds.push(draftId)
  const OLD_DRAFT = 'expiredexpiredexpired000'
  test('no draft is kept: the draft routes are gone and a leftover past its 30 days is cleared when a quote is sent', async () => {
    expect((await fetch(base + '/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: null, data: { step: 2, address: drawing.address, at, drawing, pick } }) })).status).toBe(404)
    expect((await fetch(base + '/draft')).status).toBe(404)
    // A leftover from before (made by the old page), past its 30 days: the next quote sent clears it (checked below).
    made.draftIds.push(OLD_DRAFT)
    await prisma.widgetDraft.create({ data: { id: OLD_DRAFT, data: {}, expiresAt: new Date(Date.now() - 1000) } })
  })

  test('contact before price (the default): /price says to add a name first', async () => {
    const r = await call('/price', { method: 'POST', body: JSON.stringify({ drawing, pick, draftId }) })
    expect(r.status).toBe(403)
    expect(r.body.contactFirst).toBe(true)
  })

  test('sending: one customer, one card, one saved quote, one website lead; retries and a second pick never make two', async () => {
    const send = (fenceStyle?: string) => call('/submit', { method: 'POST', body: JSON.stringify({ draftId, name: NAME, phone: PHONE, email: 'e2e.dbwidget@example.com', address: drawing.address, drawing, pick, ...(fenceStyle ? { fenceStyle } : {}) }) })
    // Twice at the same moment (the phone did not hear the answer): one wins.
    const [a, b] = await Promise.all([send(), send()])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(await counts()).toMatchObject({ contacts: 1, quotes: 1, cards: 1, leads: 1 })
    expect(await prisma.widgetDraft.count({ where: { id: OLD_DRAFT } })).toBe(0)
    const better = a.body.chosen
    expect(better.name).toBe('Better')
    const q1 = await prisma.savedQuote.findFirst({ where: { crmContactId: (await prisma.crmContact.findFirst({ where: { accountId, firstName: 'E2E', lastName: 'DbWidget Drawn' } }))!.id } })
    expect(q1!.fenceStyle).toBe(better.fenceStyle)
    expect(Math.round(q1!.finalPrice! * 100)).toBe(Math.round(better.price * 100))
    expect((q1!.layout as any).widgetDrawing.source).toBe('Website, drawn by customer')
    expect((q1!.layout as any).yard.sides[1].gate).toMatchObject({ position: 'distance', distanceIn: 132 })
    // Sent: the page can now get prices.
    expect((await call('/price', { method: 'POST', body: JSON.stringify({ drawing, pick, draftId }) })).status).toBe(200)
    // Good picked after: the same quote changes.
    const good = a.body.options.find((o: any) => o.name === 'Good')
    const c = await send(good.fenceStyle)
    expect(c.body.duplicate).toBe(true)
    const q2 = await prisma.savedQuote.findUnique({ where: { id: q1!.id } })
    expect([q2!.fenceStyle, Math.round(q2!.finalPrice! * 100)]).toEqual([good.fenceStyle, Math.round(good.price * 100)])
    expect(await counts()).toMatchObject({ contacts: 1, quotes: 1, cards: 1, leads: 1 })
    // Once the office has touched the quote, a new pick only leaves a note.
    await prisma.savedQuote.update({ where: { id: q1!.id }, data: { notes: 'salesman edit' } })
    await send(better.fenceStyle)
    expect((await prisma.savedQuote.findUnique({ where: { id: q1!.id } }))!.fenceStyle).toBe(good.fenceStyle)
    expect(await counts()).toMatchObject({ contacts: 1, quotes: 1, cards: 1, leads: 1 })
  })

  test('a robot that fills the hidden box is told all went well, and nothing is saved', async () => {
    const before = await counts()
    const r = await call('/submit', { method: 'POST', body: JSON.stringify({ draftId: 'robotrobotrobotrobot00', name: 'Robot Person', phone: '3525550999', address: drawing.address, drawing, pick, website: 'http://spam.example' }) })
    expect(r.status).toBe(201)
    expect(await prisma.intakeLead.count({ where: { sourceRef: 'robotrobotrobotrobot00' } })).toBe(0)
    expect(await counts()).toEqual(before)
  })

  test('bad drawings are refused in plain words', async () => {
    const far = { ...drawing, runs: [{ ...drawing.runs[0], pts: [p(0, 0), p(9000, 0)], typedFt: [null], gates: [null] }] }
    const r = await call('/submit', { method: 'POST', body: JSON.stringify({ draftId: 'badbadbadbadbadbadbad0', name: NAME, phone: PHONE, address: drawing.address, drawing: far, pick, test: true }) })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/too far|longer than/)
  })
})
