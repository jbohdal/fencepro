/**
 * Jonathan, Oct 26 2026: "Change order PDF: header shows the office line
 * (352) 789 4314; keep my direct (352) 844 2677 on the 'Questions' line.
 * Replace the generic 'Why' with a required reason the person types when
 * making the change order." The parts without a database.
 */

import { describe, test, expect } from 'vitest'
import { pdfText } from './pdfText'
import { changeOrderPdf } from '../src/server/lib/changeOrderPdf.js'
import { changeOrderPhones } from '../src/server/lib/signedDocuments.js'
import { reasonProblem, REASON_REQUIRED } from '../src/server/lib/changeOrders.js'

const base = {
  company: { name: 'Getter Done Fence', phone: '3527894314', email: 'sales@gdfencepro.com' }, number: 1, customerName: 'R2B Dana Whitfield', address: '3011 SE 18th Ave, Ocala, FL 34471',
  reason: 'Customer asked for a walk gate on the back side', lines: [{ id: 'a', description: 'Add 1 walk gate in the Back side (4 ft of fence becomes the gate)', amountCents: 57000 }],
  totalCents: 57000, originalCents: 564000, signedBy: 'R2B Dana Whitfield', signedVia: 'in_person', contractRev: 2, signature: null,
  record: { at: new Date('2026-10-26T13:55:08Z'), ip: '127.0.0.1', accepted: 'Change order CO-1: total $570.00' },
}

describe('the signed change order PDF phones', () => {
  test('the header gives the office line, the Questions line the direct phone', async () => {
    const t = pdfText(await changeOrderPdf({ ...base, questionsPhone: '3528442677' }))
    expect(t).toContain('(352) 789 4314')
    expect(t).toContain('Questions: (352) 844 2677.')
    expect(t).not.toContain('Questions: (352) 789 4314')
    expect(t.indexOf('(352) 789 4314')).toBeLessThan(t.indexOf('Change Order CO-1'))
    expect(t.indexOf('(352) 844 2677')).toBeGreaterThan(t.indexOf('Change Order CO-1'))
  })
  test('no direct phone: the Questions line gives the company phone (as before)', async () => {
    expect(pdfText(await changeOrderPdf(base))).toContain('Questions: (352) 789 4314.')
  })
  test('the reason the person typed shows under Why', async () => {
    const t = pdfText(await changeOrderPdf(base))
    expect(t).toMatch(/Why\s+Customer asked for a walk gate on the back side/)
  })
  test('which phone goes where: Settings > Company before the quote\'s copy; the owner\'s Direct phone for Questions', () => {
    const settings = { phone: '3527894314', supportPhone: '3527894314' }
    // A quote made while the company phone was the direct line still prints the office line on top.
    expect(changeOrderPhones(settings, { phone: '3528442677' }, '3528442677')).toEqual({ header: '3527894314', questions: '3528442677' })
    expect(changeOrderPhones(settings, {}, null)).toEqual({ header: '3527894314', questions: '3527894314' })
    expect(changeOrderPhones({ supportPhone: '3527894314' }, {}, '3528442677')).toEqual({ header: '3527894314', questions: '3528442677' })
    expect(changeOrderPhones({}, { phone: '3525550100' }, null)).toEqual({ header: '3525550100', questions: '3525550100' })
  })
})

describe('the reason for the change is required', () => {
  test('blank, spaces or too short are refused with plain words; a real reason passes', () => {
    for (const r of ['', '   ', 'ok', undefined, null]) expect(reasonProblem(r)).toBe(REASON_REQUIRED)
    expect(reasonProblem('Customer asked for a gate')).toBeNull()
    expect(REASON_REQUIRED).toMatch(/^Type the reason for the change/)
  })
})
