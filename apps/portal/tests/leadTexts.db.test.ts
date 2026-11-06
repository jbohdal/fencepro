/**
 * A new lead's thanks and follow up texts are tasks with the text ready,
 * sent from the phone, never by Twilio (lib/leadTexts.ts; Jonathan, Nov 6
 * 2026). Against the dev database (DEV_DB=1; refuses any other), on a
 * throwaway company.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('a new lead\'s texts, ready to send from the phone (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { recordIntake } = await import('../src/server/lib/intake.js')
  const { leadPushesSettled, assignLead } = await import('../src/server/lib/leadAssign.js')
  const lt = await import('../src/server/lib/leadTexts.js')
  const { isCustomerText } = await import('../src/server/lib/customerText.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const tag = `ltx-${crypto.randomUUID().slice(0, 8)}`
  const n = Math.floor(Math.random() * 9000) + 1000
  let accountId = '', base = '', owner = '', sales = '', ownerId = '', salesId = ''
  let server: ReturnType<express.Express['listen']>

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = (firstName: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const o = await user('Olive', 'super_admin'), s = await user('Sally', 'sales_rep')
    ownerId = o.id; salesId = s.id
    const sign = (u: { id: string; email: string }, role: string) => jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = sign(o, 'super_admin'); sales = sign(s, 'sales_rep')
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [] } as any })
    const app = express(); app.use(express.json())
    app.use('/api/automations', automations)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await leadPushesSettled()
    await lt.removeLeadTextsOf((await prisma.crmContact.findMany({ where: { accountId }, select: { id: true } })).map(c => c.id))
    await prisma.notification.deleteMany({ where: { title: { contains: tag } } }).catch(() => {})
    await prisma.crmContactNote.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.intakeLead.deleteMany({ where: { accountId } })
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.appointment.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  const call = async (method: string, p: string, token: string) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}` } })
    return { status: r.status, json: await r.json().catch(() => null) as any }
  }
  const tasksOf = (id: string) => prisma.task.findMany({ where: { createdBy: { startsWith: `lead-texts:${id}:` } }, orderBy: { dueDate: 'asc' } })
  const lead = async (key: string, name: string, phone: string) => {
    const r = await recordIntake(accountId, { source: 'ez_quote', sourceRef: `${tag}-${key}`, name, phone, address: '12 Elm St, Ocala, FL 34470', summary: 'Website quote', leadSource: 'Website Quote', payload: {} })
    await lt.leadTextsSettled()
    return r.contactId!
  }

  test('a new lead: the thanks now, follow ups at 24 hours, 3 days and 7 days, each with the text written; once per customer', async () => {
    const id = await lead('a', `Dana ${tag}`, `35255${n}01`)
    const tasks = await tasksOf(id)
    expect(tasks.map(t => t.title)).toEqual([`Text Dana ${tag} thanks`, `Text Dana ${tag}: follow up 1 of 3`, `Text Dana ${tag}: follow up 2 of 3`, `Text Dana ${tag}: follow up 3 of 3`])
    const start = tasks[0].dueDate!.getTime()
    expect(tasks.map(t => Math.round((t.dueDate!.getTime() - start) / 3_600_000))).toEqual([0, 24, 72, 168])
    for (const t of tasks) {
      const [text, link] = t.description!.split('\n')
      expect(isCustomerText(text)).toBe(true)
      expect(text).toMatch(/^Getter Done Fence: /)
      expect(link).toBe(`sms:35255${n}01?&body=${encodeURIComponent(text)}`)
      expect(t.assignedTo).toBeNull()
    }
    expect(tasks[0].description).toContain("Thanks for reaching out Dana! We received your info and we'll confirm your estimate shortly.")
    expect(await lt.startLeadTexts({ accountId, contactId: id, name: 'Dana', phone: `35255${n}01` })).toBe(0)
  })

  test('the thanks button: the owner reads it, the tap marks it done and the button goes; a Salesman not on the lead gets nothing', async () => {
    const id = await lead('b', `Eli ${tag}`, `35255${n}02`)
    const got = await call('GET', `/api/automations/lead-thanks/${id}`, owner)
    expect(got.json.data.text).toMatch(/Thanks for reaching out Eli!/)
    expect(got.json.data.phone).toBe(`35255${n}02`)
    expect((await call('GET', `/api/automations/lead-thanks/${id}`, sales)).json.data).toBeNull()
    expect((await call('POST', `/api/automations/lead-thanks/${id}/sent`, sales)).status).toBe(404)
    expect((await call('POST', `/api/automations/lead-thanks/${id}/sent`, owner)).json.data.done).toBe(true)
    expect((await call('GET', `/api/automations/lead-thanks/${id}`, owner)).json.data).toBeNull()
    expect((await tasksOf(id)).find(t => t.title.endsWith('thanks'))!.status).toBe('completed')
  })

  test('assigned: the open texts go on that person\'s list; booked: the follow ups close by themselves, the thanks stays', async () => {
    const id = await lead('c', `Finn ${tag}`, `35255${n}03`)
    const r = await assignLead({ accountId, contactId: id, toUserId: salesId, by: { id: ownerId, name: 'Olive' }, byOwner: true })
    expect(r.ok).toBe(true)
    expect(new Set((await tasksOf(id)).map(t => t.assignedTo))).toEqual(new Set([`Sally ${tag}`]))
    // Now hers: the Salesman reads the thanks.
    expect((await call('GET', `/api/automations/lead-thanks/${id}`, sales)).json.data.text).toMatch(/Finn/)
    await prisma.appointment.create({ data: { accountId, crmContactId: id, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000), assignedToUserId: salesId } as any })
    expect(await lt.closeBookedLeadTexts()).toBeGreaterThanOrEqual(3)
    const after = await tasksOf(id)
    expect(after.filter(t => t.status === 'completed').map(t => t.title.split(': ')[1])).toEqual(['follow up 1 of 3', 'follow up 2 of 3', 'follow up 3 of 3'])
    expect(after.find(t => t.title.endsWith('thanks'))!.status).toBe('pending')
    expect(after[1].description).toMatch(/Closed by itself on \d\d\/\d\d\/\d{4}: they booked a visit\.$/)
  })

  test('the same person sending again (a new customer, the same phone) gets no second set; once booked, none at all', async () => {
    const first = await lead('e', `Hana ${tag}`, `35255${n}05`)
    expect((await tasksOf(first)).length).toBe(4)
    const again = await lead('e2', `Hana ${tag}`, `(352) 55${String(n).slice(0, 1)}-${String(n).slice(1)}05`.replace(/^\((\d{3})\) (\d{2})(\d)-(\d+)$/, '($1) $2$3-$4'))
    expect(await tasksOf(again)).toEqual([])
    // Booked on the second customer: the first one's follow ups close too (the same phone).
    await prisma.appointment.create({ data: { accountId, crmContactId: again, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000) } as any })
    await lt.closeBookedLeadTexts()
    expect((await tasksOf(first)).filter(t => t.status === 'pending').map(t => t.title)).toEqual([`Text Hana ${tag} thanks`])
  })

  test('a phone lead with no name: "Thanks for reaching out!" and "Hi there", never the phone number', async () => {
    const r = await recordIntake(accountId, { source: 'retell', sourceRef: `${tag}-f`, name: '', phone: `+1 (352) 55${n}06`.replace(/55(\d{4})06$/, '5$106'), summary: 'Phone call', leadSource: 'Phone', payload: {} })
    await lt.leadTextsSettled()
    const tasks = await tasksOf(r.contactId!)
    expect(tasks[0].description).toMatch(/^Getter Done Fence: Thanks for reaching out! We received/)
    expect(tasks[1].description).toMatch(/^Getter Done Fence: Hi there, we noticed/)
    // Deleted: the thanks closes too (it has no card to hide it by).
    await prisma.crmContact.update({ where: { id: r.contactId! }, data: { deletedAt: new Date() } })
    await lt.closeBookedLeadTexts()
    expect((await tasksOf(r.contactId!)).every(t => t.status === 'completed')).toBe(true)
  })

  test('a lead that already booked gets only the thanks; one with no phone gets none', async () => {
    const id = await lead('d', `Gail ${tag}`, `35255${n}04`)
    await lt.removeLeadTextsOf([id])
    await prisma.appointment.create({ data: { accountId, crmContactId: id, startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000) } as any })
    expect(await lt.startLeadTexts({ accountId, contactId: id, name: 'Gail', phone: `35255${n}04` })).toBe(1)
    expect(await lt.startLeadTexts({ accountId, contactId: 'nobody', name: 'X', phone: '' })).toBe(0)
  })
})
