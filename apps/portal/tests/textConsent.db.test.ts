/**
 * Texting consent: a team member records yes or no on the customer page, the
 * website checkbox records yes (with its words) or no, every answer is kept
 * in the history, and a text to a customer who has not said yes is not sent.
 * Against the dev database (DEV_DB=1; refuses any other). Twilio is switched
 * off for the test (nothing can be sent). Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('texting consent (dev database)', async () => {
  // Read when sms.ts loads: no Twilio, so a text "sent" here only goes to the log.
  process.env.TWILIO_ACCOUNT_SID = ''; process.env.TWILIO_AUTH_TOKEN = ''; process.env.TWILIO_FROM_NUMBER = ''
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: contacts } = await import('../src/server/routes/crm-contacts.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { recordWebsiteTextConsent, textAllowedTo } = await import('../src/server/lib/textConsent.js')
  const { sendCustomerSms, sendFollowUp, sendLeadConfirmation } = await import('../src/server/lib/sms.js')
  const { TEXT_CONSENT_WORDING, describeTextConsent } = await import('../src/server/lib/textConsentModel.js')
  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: 'sales_rep', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
  const userName = `${user.firstName} ${user.lastName}`.trim()

  const app = express()
  app.use(express.json())
  app.use('/api/crm-contacts', contacts)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const send = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json() as any }))

  const made: string[] = []
  afterAll(async () => {
    await prisma.crmContact.deleteMany({ where: { id: { in: made } } })
    server.close()
  })
  // Area code 000 is never a real number, so no real customer shares it.
  const fakePhone = () => `(000) ${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`
  const create = async (phone = fakePhone()) => {
    const id = crypto.randomUUID(); made.push(id)
    const r = await send('POST', '/api/crm-contacts', { id, firstName: 'E2E', lastName: 'Text Consent', phone })
    expect(r.status).toBe(201)
    return { id, phone }
  }

  test('a new customer is "Not asked"; Record yes then Record no keeps both, with who and when', async () => {
    const c = await create()
    let r = await send('GET', `/api/crm-contacts/${c.id}/text-consent`)
    expect(r.json.data.textConsent).toBe('unknown')
    expect(describeTextConsent(r.json.data)).toBe('Not asked')
    expect(r.json.data.history).toEqual([])

    r = await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'yes' })
    expect(r.status).toBe(200)
    expect(r.json.data).toMatchObject({ textConsent: 'yes', textConsentSource: 'verbal', textConsentBy: userName })
    expect(describeTextConsent(r.json.data)).toMatch(new RegExp(`^Yes, verbal, recorded by ${userName} on [A-Z][a-z]{2} \\d{1,2}$`))

    r = await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'no' })
    expect(r.json.data.textConsent).toBe('no')
    expect(r.json.data.history.map((h: any) => h.consent)).toEqual(['no', 'yes'])
    expect(r.json.data.history.every((h: any) => h.byName === userName && h.byUserId === user.id && h.source === 'verbal')).toBe(true)

    // Audited: who changed it, from what to what.
    const log = await prisma.crmAuditLog.findMany({ where: { entityType: 'CrmContact', entityId: c.id, action: 'update' }, orderBy: { createdAt: 'asc' } })
    expect(log.map(l => (l.newValues as any)?.textConsent)).toEqual(['yes', 'no'])
    expect(log.every(l => l.userId === user.id)).toBe(true)
  })

  test('only yes or no can be recorded, and an ordinary customer save cannot change it', async () => {
    const c = await create()
    expect((await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'maybe' })).status).toBe(400)
    await send('PATCH', `/api/crm-contacts/${c.id}`, { textConsent: 'yes', textConsentSource: 'verbal' })
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: c.id } })).textConsent).toBe('unknown')
    expect((await send('POST', `/api/crm-contacts/${crypto.randomUUID()}/text-consent`, { consent: 'yes' })).status).toBe(404)
  })

  test('the website checkbox: checked is a yes with the exact words, unchecked a no; the same answer again adds nothing', async () => {
    const c = await create()
    await recordWebsiteTextConsent(c.id, true, { ip: '203.0.113.9', userAgent: 'test' })
    let row = await prisma.crmContact.findUniqueOrThrow({ where: { id: c.id } })
    expect(row).toMatchObject({ textConsent: 'yes', textConsentSource: 'website_checkbox', textConsentBy: 'website' })
    expect(row.textConsentAt).toBeInstanceOf(Date)
    expect(describeTextConsent({ ...row, textConsentAt: row.textConsentAt!.toISOString() } as any)).toMatch(/^Yes, website checkbox checked on /)
    let hist = await prisma.crmTextConsent.findMany({ where: { crmContactId: c.id } })
    expect(hist).toHaveLength(1)
    expect(hist[0].wording).toBe(TEXT_CONSENT_WORDING)
    expect(TEXT_CONSENT_WORDING).toBe('Text me updates about my quote and installation. Msg frequency varies. Msg and data rates may apply. Reply STOP to opt out. Terms: gdfencepro.com/terms.cfm')
    expect(hist[0].ip).toBe('203.0.113.9')

    expect(await recordWebsiteTextConsent(c.id, true)).toBeNull()
    expect(await prisma.crmTextConsent.count({ where: { crmContactId: c.id } })).toBe(1)

    const d = await create()
    await recordWebsiteTextConsent(d.id, false)
    row = await prisma.crmContact.findUniqueOrThrow({ where: { id: d.id } })
    expect(row).toMatchObject({ textConsent: 'no', textConsentSource: 'website_checkbox' })
    hist = await prisma.crmTextConsent.findMany({ where: { crmContactId: d.id } })
    expect(hist.map(h => h.consent)).toEqual(['no'])
  })

  test('a text goes only to a customer who said yes; anything else is held back with the reason', async () => {
    const c = await create()
    // Not asked: not sent.
    let r = await sendCustomerSms(c.phone, 'hello')
    expect(r).toMatchObject({ success: false, blocked: true })
    expect(r.error).toMatch(/has not agreed to texts/)
    expect((await sendFollowUp(c.phone, 'hello')).blocked).toBe(true)
    expect((await sendLeadConfirmation(c.phone, 'E2E')).blocked).toBe(true)

    await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'yes' })
    r = await sendCustomerSms(c.phone.replace(/\D/g, ''), 'hello')
    expect(r.success).toBe(true)
    expect(r.blocked).toBeFalsy()
    expect((await textAllowedTo(`+1${c.phone.replace(/\D/g, '')}`, accountId)).allowed).toBe(true)

    // Said no: not sent.
    await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'no' })
    r = await sendCustomerSms(c.phone, 'hello')
    expect(r.blocked).toBe(true)
    expect(r.error).toMatch(/said no to texts/)

    // A second customer with the same number said yes: one no still holds it back.
    const twin = await create(c.phone)
    await send('POST', `/api/crm-contacts/${twin.id}/text-consent`, { consent: 'yes' })
    expect((await sendCustomerSms(c.phone, 'hello')).blocked).toBe(true)

    // A number on no customer is never texted.
    expect((await sendCustomerSms('(000) 000-0001', 'hello')).blocked).toBe(true)
  })

  test('an automation does not prepare a text for a customer who has not said yes, and says why', async () => {
    const { runStep, describeSteps } = await import('../src/server/lib/automations/steps.js')
    const c = await create()
    const entity = { board: 'sales', entityKind: 'card', entityId: crypto.randomUUID(), customerId: c.id, firstName: 'E2E', lastName: 'Text Consent', name: 'E2E Text Consent', phone: c.phone, email: '' } as any
    const step = { type: 'prepare_text', body: 'Hi', assignTo: '' } as any
    const out = await runStep({ accountId, runId: crypto.randomUUID(), ruleId: 'r', ruleName: 'r', stepIndex: 0, step, entity, now: new Date() })
    expect(out.detail).toMatch(/^text not prepared\. Not sent: E2E Text Consent has not agreed to texts/)
    expect(out.link).toBeUndefined()
    const [dry] = await describeSteps(accountId, [step], entity, new Date())
    expect(dry.warning).toMatch(/would not be prepared/)
    await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'yes' })
    expect((await describeSteps(accountId, [step], entity, new Date()))[0].warning).toBeUndefined()
  })

  test('a deleted customer takes its history with it', async () => {
    const c = await create()
    await send('POST', `/api/crm-contacts/${c.id}/text-consent`, { consent: 'yes' })
    await prisma.crmContact.delete({ where: { id: c.id } })
    expect(await prisma.crmTextConsent.count({ where: { crmContactId: c.id } })).toBe(0)
  })
})
