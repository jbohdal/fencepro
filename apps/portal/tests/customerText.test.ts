/**
 * Every customer text in the registered form (lib/customerText.ts): starts
 * "Getter Done Fence:", ends "Reply STOP to opt out.", each once, phones
 * written (352) 844 2677. Oct 25 2026: the install text Manuel Cotrich got had
 * no "Reply STOP to opt out.". Each text path is checked here, and a scan of
 * the web app's Text buttons makes sure none opens a texting app with a
 * message that skips customerText.
 */

import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { customerText, isCustomerText, formatPhonesIn, STOP_WORDS } from '../src/server/lib/customerText.js'
import { installText } from '../src/server/lib/installDays.js'
import { photoRequestText } from '../src/server/lib/serviceTicketModel.js'
import { asText, confirmationSms, onMyWaySms, DEFAULT_MESSAGE_TEMPLATES, fillTemplate } from '../../web/src/appointmentMessages'
import { DEFAULT_TEMPLATES as FOLLOW_UP_TEMPLATES } from '../../web/src/followUpRules'

const CO = 'Getter Done Fence'
const ends = (t: string) => {
  expect(t.startsWith(`${CO}: `)).toBe(true)
  expect(t.endsWith(STOP_WORDS)).toBe(true)
  expect(t.match(/reply stop to opt out/gi)?.length).toBe(1)
  expect(t.match(new RegExp(`${CO}:`, 'g'))?.length).toBe(1)
  expect(isCustomerText(t, CO)).toBe(true)
}

describe('customerText', () => {
  it('adds the company name and the STOP line, once each', () => {
    expect(customerText('Hi Manuel, your fence installation is scheduled to start on 10/26/2026.', CO))
      .toBe('Getter Done Fence: Hi Manuel, your fence installation is scheduled to start on 10/26/2026. Reply STOP to opt out.')
    // Already there, typed again, or mid text: still once each.
    ends(customerText('Getter Done Fence: Hi Manuel. Reply STOP to opt out.', CO))
    ends(customerText('getter done fence: Hi Manuel. reply stop to opt out', CO))
    ends(customerText('Hi Manuel. Reply STOP to opt out. See you Monday.', CO))
    expect(customerText('Hi Manuel. Reply STOP to opt out. See you Monday.', CO)).toBe('Getter Done Fence: Hi Manuel. See you Monday. Reply STOP to opt out.')
  })
  it('ends a sentence with a stop, leaves a link at the end as it is', () => {
    expect(customerText('Hi Manuel, thanks', CO)).toBe('Getter Done Fence: Hi Manuel, thanks. Reply STOP to opt out.')
    expect(customerText('Sign here: https://x.ts.net/p/abc123', CO)).toBe('Getter Done Fence: Sign here: https://x.ts.net/p/abc123 Reply STOP to opt out.')
  })
  it('writes phone numbers (352) 844 2677, never touching a link', () => {
    expect(formatPhonesIn('Call 352-844-2677 or (352)8442677 or +1 352 844 2677.')).toBe('Call (352) 844 2677 or (352) 844 2677 or (352) 844 2677.')
    expect(formatPhonesIn('https://x.ts.net/p/r/3528442677abc')).toBe('https://x.ts.net/p/r/3528442677abc')
  })
  it('the company name from Settings, Getter Done Fence when there is none', () => {
    expect(customerText('Hi', '')).toBe('Getter Done Fence: Hi. Reply STOP to opt out.')
  })
})

describe('every customer text path', () => {
  it('the install texts (Schedule install, a move, a rain day, off the schedule)', () => {
    for (const kind of ['scheduled', 'moved', 'off'] as const) {
      const t = installText(kind, { company: CO, firstName: 'Manuel', start: '2026-10-26', phone: '3528442677' })
      ends(t)
      expect(t).toContain('(352) 844 2677')
    }
  })
  it('the appointment confirmations (estimate, install, service, other) and On my way', () => {
    const company = { name: CO, phone: '3527894314' }
    for (const type of ['estimate', 'install', 'service', 'other', 'follow_up'] as const) {
      ends(confirmationSms({ customerName: 'Manuel Cotrich', startAt: '2026-10-26T13:00:00.000Z', allDay: false, address: '1301 SE Silver Springs Pl', type, assignedTo: 'Jonathan Bohdal', rep: { userId: 'u', firstName: 'Jonathan', lastName: 'Bohdal', phone: '3528442677' } } as any, { company }))
    }
    ends(onMyWaySms({ customerName: 'Manuel Cotrich', startAt: '2026-10-26T13:00:00.000Z', allDay: false, address: '', type: 'install', assignedTo: '' } as any, 12, { company }))
    // A template saved in Settings that already has the words: still once.
    ends(asText(`${DEFAULT_MESSAGE_TEMPLATES.confirm.install} Reply STOP to opt out.`, company))
  })
  it('the service photo request', () => {
    ends(photoRequestText('Manuel', 'https://x.ts.net/p/s/abc'))
  })
  it('the follow up text templates', () => {
    for (const t of FOLLOW_UP_TEMPLATES) ends(customerText(fillTemplate(t.body, { firstName: 'Manuel', myName: 'Jonathan', company: CO } as any), CO))
  })
})

/**
 * The web app's Text buttons: every sms: link that carries a message must
 * build it with customerText (or a function that uses it). An empty body is a
 * blank text the person types; the install packet's link is to the crew.
 */
describe('no Text button skips customerText', () => {
  const web = path.resolve(__dirname, '../../web/src')
  const files = fs.readdirSync(web).filter(f => /\.(tsx?|ts)$/.test(f))
  const OK_BODY = /^(''|""|customerText\(|asText\(|confirmationSms\(|onMyWaySms\(|photoRequestText\(|text\.body$|textOf\(|body$|text$)/
  it('each smsLink(phone, body) builds its body through customerText', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(web, f), 'utf8')
      for (const m of src.matchAll(/smsLink\(([^,]+),\s*([^)]*(?:\([^)]*\))?[^)]*)\)/g)) {
        const arg = m[2].trim()
        if (f === 'appointmentLogic.ts') continue
        if (!OK_BODY.test(arg)) bad.push(`${f}: smsLink(${m[1].trim()}, ${arg})`)
      }
    }
    expect(bad).toEqual([])
  })
  it('the bodies named `body` / `text` in those files come from customerText', () => {
    const src = (f: string) => fs.readFileSync(path.join(web, f), 'utf8')
    expect(src('Payments.tsx')).toMatch(/const body = customerText\(/)
    expect(src('FollowUpPrompt.tsx')).toMatch(/const body = customerText\(/)
    expect(src('ServiceRequests.tsx')).toMatch(/const text = link \? photoRequestText\(/)
  })
  it('the automations\' prepared texts and the server\'s own texts go through it', () => {
    const lib = path.resolve(__dirname, '../src/server/lib')
    expect(fs.readFileSync(path.join(lib, 'automations/steps.ts'), 'utf8')).toMatch(/body = customerText\(body,/)
    expect(fs.readFileSync(path.join(lib, 'sms.ts'), 'utf8')).toMatch(/sendSms\(to, customerText\(body, COMPANY_NAME\)\)/)
  })
})
