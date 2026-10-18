/**
 * Automation pieces that need no database: templates, conditions, the Gmail
 * message, the prepared text link, stage mapping, rule checks, the permit
 * packet PDF and the county parcel lookup (with a fake county service).
 */

import { describe, test, expect } from 'vitest'
import { fillTemplate, evalConditions, opsStageOfJob, jobFieldsForOpsStage, cityOf, type EntityContext } from '../src/server/lib/automations/context.js'
import { rawMessage } from '../src/server/lib/automations/gmail.js'
import { smsLink } from '../src/server/lib/automations/steps.js'
import { ruleSchema, STARTER_RULES } from '../src/server/lib/automations/types.js'
import { renderPacket, lookupParcel, portalFor } from '../src/server/lib/automations/permits.js'

const ctx = (over: Partial<EntityContext> = {}): EntityContext => ({
  board: 'sales', entityKind: 'card', entityId: 'c1', card: { stage: 'Signed Contract' }, job: null, stage: 'Signed Contract', stageLabel: 'Signed Contract',
  customerId: 'k1', firstName: 'Dave', lastName: 'Diamond', name: 'Dave Diamond', email: 'dave@example.com', phone: '(352) 555-0100',
  address: '100 Pecan Dr, Ocala, FL 34472', city: 'Ocala', county: 'Marion', style: 'WV-6ft Privacy', priceCents: 480000, salesman: 'Mike',
  tags: ['Residential', 'HOA'], permit: null, permitRequired: false, installDate: '2026-10-22', appointmentAt: null, proposalSentDate: '',
  proposalLink: 'https://ezbiz.example/p/abc', quoteId: 'q1', ...over,
})

describe('templates', () => {
  test('fields are filled, unknown ones are left as typed', () => {
    expect(fillTemplate('Hi {first name}, install {install date}. {proposal link} {Price} {nope}', ctx()))
      .toBe('Hi Dave, install Thursday, October 22. https://ezbiz.example/p/abc $4,800 {nope}')
  })
})

describe('conditions', () => {
  test('price range in cents, city, county, tag, style, salesman, permit', () => {
    const ok = evalConditions([
      { field: 'price', op: 'between', value: { minCents: 300000, maxCents: 500000 } },
      { field: 'city', op: 'is', value: 'ocala' },
      { field: 'county', op: 'is', value: 'Marion' },
      { field: 'tag', op: 'has', value: 'hoa' },
      { field: 'style', op: 'contains', value: 'privacy' },
      { field: 'salesman', op: 'is', value: 'Mike' },
      { field: 'permit_required', op: 'is', value: false },
    ], ctx())
    expect(ok.ok).toBe(true)
    const no = evalConditions([{ field: 'price', op: 'between', value: { minCents: 500001 } }, { field: 'tag', op: 'has_not', value: 'HOA' }], ctx())
    expect(no.ok).toBe(false)
    expect(no.results.map(r => r.ok)).toEqual([false, false])
    expect(no.results[0].actual).toBe('$4,800')
  })
})

describe('Gmail message', () => {
  test('headers on one line each, body in base64, base64url overall', () => {
    const raw = rawMessage('jonathan@example.com', { to: 'dave@example.com', subject: 'Your install\r\nBcc: evil@example.com', text: 'Hi Dave,\nSee you Thursday.', messageId: 'run1.0@ezbiz.automations' })
    expect(raw).not.toMatch(/[+/=]/)
    const msg = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    expect(msg).toContain('Subject: Your install Bcc: evil@example.com\r\n')
    expect(msg).not.toMatch(/^Bcc:/m)
    expect(msg).toContain('Message-ID: <run1.0@ezbiz.automations>')
    const body = msg.split('\r\n\r\n')[1]
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString()).toBe('Hi Dave,\r\nSee you Thursday.')
  })
  test('a subject with accents is encoded', () => {
    const msg = Buffer.from(rawMessage('a@b.c', { to: 'x@y.z', subject: 'Instalación', text: 'x', messageId: 'm' }).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    expect(msg).toContain('Subject: =?UTF-8?B?')
  })
})

describe('prepared text', () => {
  test('sms link with the body, for iPhone and Android', () => {
    expect(smsLink('(352) 555-0100', 'Hi Dave & co')).toBe('sms:3525550100?&body=Hi%20Dave%20%26%20co')
  })
})

describe('Operations stages', () => {
  test('the board\'s mapping, both ways', () => {
    expect(opsStageOfJob({ status: 'staging', materialsStatus: 'not_ordered', drawingComplete: false, locatesDate: null })).toBe('awaiting_locates')
    expect(opsStageOfJob({ status: 'staging', materialsStatus: 'ordered' })).toBe('materials_ordered')
    expect(opsStageOfJob({ status: 'completed' })).toBe('completed')
    for (const s of ['awaiting_locates', 'materials_ordered', 'ready_to_pull', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'on_hold']) {
      const f = jobFieldsForOpsStage(s, '2026-10-18')!
      expect(opsStageOfJob({ materialsStatus: 'not_ordered', drawingComplete: false, locatesDate: null, ...f } as any)).toBe(s)
    }
    expect(jobFieldsForOpsStage('nope', '2026-10-18')).toBeNull()
  })
  test('city from an address', () => {
    expect(cityOf('100 Pecan Dr, Ocala, FL 34472')).toBe('Ocala')
    expect(cityOf('5 Main St, Belleview FL 34420')).toBe('Belleview')
  })
})

describe('rules', () => {
  test('every starter rule is valid and switched off', () => {
    for (const r of STARTER_RULES) {
      expect(ruleSchema.parse(r).enabled).toBe(false)
    }
    expect(STARTER_RULES.map(r => r.starter)).toEqual(['signed_contract_tasks', 'install_reminder_email', 'job_complete_walkthrough', 'walkthrough_signed_invoice_review', 'no_answer_follow_up'])
  })
  test('a rule with no steps or a bad webhook address is refused', () => {
    expect(() => ruleSchema.parse({ name: 'x', board: 'sales', trigger: { type: 'card_left', stage: 'A' }, steps: [] })).toThrow()
    expect(() => ruleSchema.parse({ name: 'x', board: 'sales', trigger: { type: 'card_left', stage: 'A' }, steps: [{ type: 'webhook', url: 'ftp://x' }] })).toThrow()
  })
})

describe('permits', () => {
  test('Marion County portal', () => {
    expect(portalFor('Marion')?.url).toBe('https://selfservice.marionfl.org/energov_prod/selfservice#/home')
    expect(portalFor('Nowhere')).toBeNull()
  })
  test('parcel lookup asks the county service by street', async () => {
    const asked: string[] = []
    const fake = (async (url: string) => {
      asked.push(decodeURIComponent(String(url).replace(/\+/g, ' ')))
      return { ok: true, json: async () => ({ features: [{ attributes: { parcel: '9021-0431-20', name: 'RAMOUTAR HARINARAIN', situs_1: '100 PECAN DR', acres: 0.25 } }] }) }
    }) as unknown as typeof fetch
    const p = await lookupParcel('100 Pecan Dr, Ocala, FL 34472', fake)
    expect(p).toEqual({ parcel: '9021-0431-20', owner: 'RAMOUTAR HARINARAIN', situs: '100 PECAN DR', acres: 0.25 })
    expect(asked[0]).toContain("situs_1 = '100 PECAN DR'")
  })
  test('the packet is a PDF with the site plan drawn', async () => {
    const svg = '<svg viewBox="0 0 640 480"><g><polygon points="10,10 200,10 200,100 10,100" fill="#CBC4D6" stroke="#746C80" stroke-width="1.5"/><line x1="10" y1="200" x2="300" y2="200" stroke="#7c3aed" stroke-width="4" stroke-dasharray="6 4"/><circle cx="10" cy="200" r="5" fill="#111"/><rect x="295" y="195" width="10" height="10" fill="#111"/><path d="M 10 300 L 100 350" stroke="#000" fill="none"/><text x="100" y="190" text-anchor="middle" font-size="12">48 ft &amp; gate</text></g></svg>'
    const pdf = await renderPacket({
      company: 'Getter Done Fence',
      job: { customerName: 'Dave Diamond', customerAddress: '100 Pecan Dr, Ocala, FL 34472', customerPhone: '352', customerEmail: 'd@x', fenceStyle: 'WV-6ft', totalFeet: 120, sections: 15, walkGates: 1, dblGates: 0, contractValue: 4800, createdAt: new Date() },
      permit: { status: 'needed', county: 'Marion', parcelId: '9021-0431-20', permitNumber: '' },
      quote: { runs: [60, 60], proposal: { planSvg: svg }, acceptedAt: new Date(), acceptedBy: 'Dave' },
      parcel: { parcel: '9021-0431-20', owner: 'DIAMOND DAVE', situs: '100 PECAN DR', acres: 0.25 },
    })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(2000)
  })
})
