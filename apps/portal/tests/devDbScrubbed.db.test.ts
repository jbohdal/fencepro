/**
 * The dev database cannot reach anybody (scripts/scrub-dev-db.ts, run by
 * deploy/mac/refresh-dev-db.sh after it copies live):
 *   - no phone push sign up, push key, Gmail sign in or Google Calendar sign
 *     in copied from live (anything older than the scrub);
 *   - every email address and phone number in the main contact fields of the
 *     records copied from live is a fake one (example.invalid and other
 *     reserved domains; numbers with no such area code or exchange, or 555-01xx).
 * Records the tests themselves made after the scrub are not judged here.
 * Only reads. Only with DEV_DB=1 on ezbiz_dev.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll } from 'vitest'
import { isFakeEmail, isFakePhone } from '../src/server/lib/devScrub.js'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

/** table → its email and phone columns. */
const CONTACT_FIELDS: Record<string, { emails: string[]; phones: string[] }> = {
  CrmContact: { emails: ['email'], phones: ['phone'] },
  CrmUser: { emails: ['email'], phones: ['phone'] },
  PortalAccount: { emails: ['email'], phones: [] },
  PortalInvite: { emails: ['email'], phones: [] },
  SavedQuote: { emails: ['customerEmail'], phones: ['customerPhone'] },
  SavedJob: { emails: ['customerEmail'], phones: ['customerPhone'] },
  IntakeLead: { emails: ['email'], phones: ['phone'] },
  Lead: { emails: ['email', 'assignedRepEmail'], phones: ['phone'] },
  Receipt: { emails: ['emailTo'], phones: ['textedTo'] },
  VendorContact: { emails: ['email'], phones: ['phone'] },
  EzBudgetQuote: { emails: ['customerEmail'], phones: ['customerPhone'] },
  Customer: { emails: ['email'], phones: ['phone'] },
  CrmAuditLog: { emails: ['userEmail'], phones: [] },
  Notification: { emails: ['recipientId'], phones: [] },
}

describe.skipIf(!process.env.DEV_DB || !onDev)('the dev database is scrubbed', () => {
  let prisma: any
  let scrubbedAt: Date | null = null
  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const marks = await prisma.accountKeyValue.findMany({ where: { key: 'dev:scrubbed' }, select: { value: true } })
    const times = marks.map((m: any) => new Date(m.value?.at)).filter((d: Date) => !Number.isNaN(d.getTime()))
    scrubbedAt = times.length ? new Date(Math.max(...times.map((d: Date) => d.getTime()))) : null
  })

  test('it was scrubbed (bash deploy/mac/refresh-dev-db.sh, or npx tsx scripts/scrub-dev-db.ts)', () => {
    expect(scrubbedAt, 'no dev:scrubbed mark: run apps/portal/scripts/scrub-dev-db.ts on ezbiz_dev').not.toBeNull()
  })

  test("no push sign up, push key, Gmail or Google sign in copied from live", async () => {
    const before = { lte: scrubbedAt! }
    expect(await prisma.pushSubscription.count({ where: { createdAt: before } })).toBe(0)
    expect(await prisma.accountKeyValue.count({ where: { key: { in: ['push_vapid', 'gmail_token'] }, updatedAt: before } })).toBe(0)
    expect(await prisma.googleCalendarToken.count({ where: { createdAt: before } })).toBe(0)
    expect(await prisma.calendarSyncState.count()).toBe(0)
  })

  test('every email and phone in the main contact fields is a fake one', async () => {
    const bad: string[] = []
    let checked = 0
    for (const [table, f] of Object.entries(CONTACT_FIELDS)) {
      const cols: { column_name: string }[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, table)
      const have = new Set(cols.map(c => c.column_name))
      if (!have.size) continue
      const wanted = [...f.emails, ...f.phones].filter(c => have.has(c))
      if (!wanted.length) continue
      const when = have.has('createdAt') ? `where "createdAt" <= $1` : ''
      const rows: Record<string, string | null>[] = await prisma.$queryRawUnsafe(
        `select ${wanted.map(c => `"${c}"`).join(', ')} from "${table}" ${when}`, ...(when ? [scrubbedAt] : []))
      for (const r of rows) {
        for (const c of f.emails) if (have.has(c)) { checked++; if (!isFakeEmail(r[c])) bad.push(`${table}.${c}: ${r[c]}`) }
        for (const c of f.phones) if (have.has(c)) { checked++; if (!isFakePhone(r[c])) bad.push(`${table}.${c}: ${r[c]}`) }
      }
    }
    expect(bad.slice(0, 20)).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })
})
