/**
 * Fake contact details for the dev copy (lib/devScrub.ts, scripts/scrub-dev-db.ts).
 */
import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { scrubText, scrubJson, staffEmailMap, fakeEmail, isFakePhone, isFakeEmail, LOCAL7_RE, type Counts } from '../src/server/lib/devScrub.js'

const staff = staffEmailMap(['jbohdal@gdfencepro.com', 'Office@GDFencePro.com', 'jbohdal@gmail.com'])

describe('emails', () => {
  test('staff keep their login name on example.invalid, each one different', () => {
    expect(staff.get('jbohdal@gdfencepro.com')).toMatch(/^jbohdal(-\d)?@example\.invalid$/)
    expect(staff.get('office@gdfencepro.com')).toBe('office@example.invalid')
    expect(new Set(staff.values()).size).toBe(3)
    expect(fakeEmail('JBohdal@GDFencePro.com', staff)).toBe(staff.get('jbohdal@gdfencepro.com'))
  })
  test('customers become c-<hash>@example.invalid; the same address always the same fake', () => {
    const a = fakeEmail('Pat.Smith@gmail.com', staff)
    expect(a).toMatch(/^c-[0-9a-f]{10}@example\.invalid$/)
    expect(fakeEmail('pat.smith@GMAIL.com', staff)).toBe(a)
    expect(fakeEmail('pat.smyth@gmail.com', staff)).not.toBe(a)
  })
  test('reserved test domains and file names are left alone', () => {
    expect(scrubText('a@example.test, b@example.com, logo@2x.png, x@y.invalid', staff)).toBe('a@example.test, b@example.com, logo@2x.png, x@y.invalid')
  })
})

describe('phones', () => {
  test('every layout keeps its shape and its last 4 digits, with an area code that does not exist', () => {
    const c: Counts = { emails: 0, phones: 0 }
    const out = scrubText('Call (352) 598-9785 or 352.598.9785 or +1 352 598 9785 or 3525989785 or 13525989785', staff, c)
    expect(c.phones).toBe(5)
    const nums = out.match(/[\d().+ -]{10,}/g)!.map(s => s.replace(/\D/g, '').slice(-10))
    expect(new Set(nums).size).toBe(1) // equal numbers stay equal
    expect(nums[0]).toMatch(/^0\d{5}9785$/)
    expect(out).toMatch(/^Call \(0\d\d\) \d{3}-9785 or 0\d\d\.\d{3}\.9785 or \+1 0\d\d \d{3} 9785 or 0\d{5}9785 or 10\d{5}9785$/)
  })
  test('different numbers with the same last 4 stay different', () => {
    expect(scrubText('3525559785', staff)).not.toBe(scrubText('3526669785', staff))
  })
  test('dates, money, ids and timestamps are not numbers to change', () => {
    const s = '2026-10-26 $1,234.56 1729900000 1729900000123 parcel 9021-0431-20 id 5f0c2e1a-3a52-4b1c-9d2e-123456789012'
    expect(scrubText(s, staff)).toBe(s)
  })
  test('running it again changes nothing', () => {
    const once = scrubText('pat@gmail.com (352) 598-9785 3525989785', staff)
    const c: Counts = { emails: 0, phones: 0 }
    expect(scrubText(once, staff, c)).toBe(once)
    expect(c).toEqual({ emails: 0, phones: 0 })
  })
  test('a seven digit local number is counted (not changed); a whole number is not one', () => {
    expect('call 598-9785 today'.match(LOCAL7_RE)).toHaveLength(1)
    expect('(012) 345-9785 and 352-598-9785'.match(LOCAL7_RE)).toBeNull()
  })
  test('the fake check', () => {
    expect(isFakePhone(scrubText('(352) 598-9785', staff))).toBe(true)
    expect(isFakePhone('(352) 555-0142')).toBe(true)
    expect(isFakePhone('')).toBe(true)
    expect(isFakePhone('(352) 598-9785')).toBe(false)
    expect(isFakeEmail('c-1234567890@example.invalid')).toBe(true)
    expect(isFakeEmail('pat@gmail.com')).toBe(false)
  })
})

describe('JSON', () => {
  test('strings and keys inside JSON; numbers and images untouched', () => {
    const v = { customer: { email: 'pat@gmail.com', phone: '352-598-9785', cents: 3525989785 }, 'pat@gmail.com': 1, sig: 'data:image/png;base64,3525989785', list: ['jbohdal@gdfencepro.com'] }
    const out = scrubJson(v, staff) as any
    expect(out.customer.email).toMatch(/@example\.invalid$/)
    expect(out.customer.phone).toMatch(/^0\d\d-\d{3}-9785$/)
    expect(out.customer.cents).toBe(3525989785)
    expect(out.sig).toBe(v.sig)
    expect(out.list[0]).toBe(staff.get('jbohdal@gdfencepro.com'))
    expect(Object.keys(out)).toContain(fakeEmail('pat@gmail.com', staff))
  })
})

describe('the scrub script and the refresh', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
  test('the script refuses any database but ezbiz_dev', () => {
    const s = read('../scripts/scrub-dev-db.ts')
    expect(s).toMatch(/if \(db !== DEV_DATABASE_NAME\)[\s\S]*process\.exit\(1\)/)
    expect(s).toMatch(/DEV_DATABASE_NAME = 'ezbiz_dev'/)
    for (const t of ['PushSubscription', 'push_vapid', 'gmail_token', 'GoogleCalendarToken', 'CalendarSyncState', 'CrmUserSession', 'PortalSession', 'ApiKey']) expect(s).toContain(t)
  })
  test('refresh-dev-db.sh runs the scrub right after the copy, and stops if it fails', () => {
    const s = read('../../../deploy/mac/refresh-dev-db.sh')
    expect(s).toMatch(/set -euo pipefail/)
    const restore = s.indexOf('pg_restore'), scrub = s.indexOf('scrub-dev-db.ts')
    expect(restore).toBeGreaterThan(0)
    expect(scrub).toBeGreaterThan(restore)
  })
})
