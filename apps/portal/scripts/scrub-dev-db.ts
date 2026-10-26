/**
 * Make the dev database (ezbiz_dev) unable to reach anybody.
 *
 *   cd apps/portal && npx tsx scripts/scrub-dev-db.ts
 *
 * Run by deploy/mac/refresh-dev-db.sh right after it copies live into
 * ezbiz_dev, before anything can start on it. Refuses any database but
 * ezbiz_dev (DATABASE_URL, from the environment or apps/portal/.env).
 *
 * 1. Forgets every stored sign in and key: phone push sign ups
 *    (PushSubscription), the push keys and the Gmail sign in
 *    (AccountKeyValue push_vapid, gmail_token), Google Calendar
 *    (GoogleCalendarToken, CalendarSyncState, CalendarEventLink), staff and
 *    portal sign ins (CrmUserSession, RefreshToken, PortalSession), API keys,
 *    integration settings (Integration.config), invite links.
 *    Dev makes its own push keys the first time push is turned on there.
 * 2. Replaces every email address and phone number in every text and JSON
 *    column of every table with a fake one (lib/devScrub.ts): staff become
 *    <login>@example.invalid with the same password; numbers become
 *    (0AB) CDE-WXYZ, keeping the last 4 digits; equal stays equal.
 * 3. Prints what it did, what free text may still hold (seven digit local
 *    numbers), and the dev sign in emails.
 */

import 'dotenv/config'
import { PrismaClient, type Prisma } from '@prisma/client'
import { databaseNameOf } from '../src/server/lib/liveGuard.js'
import { scrubJson, scrubText, staffEmailMap, keepPhones, LOCAL7_RE, type Counts } from '../src/server/lib/devScrub.js'

export const DEV_DATABASE_NAME = 'ezbiz_dev'
/** AccountKeyValue key: when the dev copy was last scrubbed. */
export const SCRUBBED_KEY = 'dev:scrubbed'

const db = databaseNameOf(process.env.DATABASE_URL)
if (db !== DEV_DATABASE_NAME) {
  console.error(`Refusing: scrub-dev-db only runs on ${DEV_DATABASE_NAME}; DATABASE_URL names "${db || 'nothing'}".`)
  process.exit(1)
}

const prisma = new PrismaClient()
const q = (s: string) => `"${s.replace(/"/g, '""')}"`

async function exists(table: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = $1`, table)
  return r[0].n > 0
}

async function forgetSignIns(): Promise<Record<string, number>> {
  const done: Record<string, number> = {}
  const run = async (label: string, table: string, sql: string) => {
    if (!(await exists(table))) return
    done[label] = await prisma.$executeRawUnsafe(sql)
  }
  await run('phone push sign ups (PushSubscription)', 'PushSubscription', `delete from "PushSubscription"`)
  await run('push keys, Gmail sign in and other stored sign ins (AccountKeyValue)', 'AccountKeyValue',
    `delete from "AccountKeyValue" where key in ('push_vapid', 'gmail_token') or key ilike '%token%' or key ilike '%secret%' or key ilike '%oauth%' or key ilike '%credential%' or key ilike '%api_key%' or key ilike '%apikey%'`)
  await run('Google Calendar sign ins (GoogleCalendarToken)', 'GoogleCalendarToken', `delete from "GoogleCalendarToken"`)
  await run('Google Calendar event links (CalendarEventLink)', 'CalendarEventLink', `delete from "CalendarEventLink"`)
  await run('Google Calendar connection (CalendarSyncState)', 'CalendarSyncState', `delete from "CalendarSyncState"`)
  await run('staff sign ins (CrmUserSession)', 'CrmUserSession', `delete from "CrmUserSession"`)
  await run('refresh tokens (RefreshToken)', 'RefreshToken', `delete from "RefreshToken"`)
  await run('customer portal sign ins (PortalSession)', 'PortalSession', `delete from "PortalSession"`)
  await run('API key use log (ApiKeyUsageLog)', 'ApiKeyUsageLog', `delete from "ApiKeyUsageLog"`)
  await run('API keys (ApiKey)', 'ApiKey', `delete from "ApiKey"`)
  await run('integration settings with keys (Integration)', 'Integration', `update "Integration" set config = '{}'::jsonb where config is not null and config::text <> '{}'`)
  await run('staff invite links (CrmUser.inviteTokenHash)', 'CrmUser', `update "CrmUser" set "inviteTokenHash" = null where "inviteTokenHash" is not null`)
  await run('portal invite links (PortalAccount.inviteToken)', 'PortalAccount', `update "PortalAccount" set "inviteToken" = null where "inviteToken" is not null`)
  return done
}

interface Col { table: string; column: string; kind: 'text' | 'json' | 'array' }

async function columns(): Promise<Col[]> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string; udt_name: string }[]>(
    `select c.table_name, c.column_name, c.data_type, c.udt_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.table_name <> '_prisma_migrations'
        and (c.data_type in ('text', 'character varying', 'jsonb', 'json') or c.udt_name in ('_text', '_varchar'))
      order by 1, 2`)
  return rows.map(r => ({
    table: r.table_name, column: r.column_name,
    kind: r.data_type === 'jsonb' || r.data_type === 'json' ? 'json' : r.data_type === 'ARRAY' ? 'array' : 'text',
  }))
}

// Rows worth reading: anything with an @ or four digits in a row. The exact work is done in lib/devScrub.ts.
const MAYBE = `(%s)::text ~ '@|[0-9]{4}'`

async function scrubColumn(tx: Prisma.TransactionClient, c: Col, staff: Map<string, string>): Promise<{ rows: number; counts: Counts }> {
  const counts: Counts = { emails: 0, phones: 0 }
  let rows = 0
  const col = q(c.column), tbl = q(c.table)
  const read = c.kind === 'json' ? `${col}::text` : col
  const found = await tx.$queryRawUnsafe<{ _ctid: string; v: unknown }[]>(
    `select ctid::text as _ctid, ${read} as v from ${tbl} where ${col} is not null and ${MAYBE.replace('%s', col)}`)
  for (const r of found) {
    let next: unknown
    let changed = false
    if (c.kind === 'json') {
      const before = JSON.parse(String(r.v))
      next = scrubJson(before, staff, counts)
      changed = JSON.stringify(next) !== JSON.stringify(before)
    } else if (c.kind === 'array') {
      const before = (r.v as string[]) ?? []
      next = before.map(s => typeof s === 'string' ? scrubText(s, staff, counts) : s)
      changed = (next as string[]).some((s, i) => s !== before[i])
    } else {
      next = scrubText(String(r.v), staff, counts)
      changed = next !== r.v
    }
    if (!changed) continue
    const set = c.kind === 'json' ? `$1::jsonb` : c.kind === 'array' ? `$1::text[]` : `$1`
    await tx.$executeRawUnsafe(`update ${tbl} set ${col} = ${set} where ctid = $2::tid`, c.kind === 'json' ? JSON.stringify(next) : next, r._ctid)
    rows++
  }
  return { rows, counts }
}

async function main() {
  console.log(`Scrubbing ${db} (contact details made fake, stored sign ins forgotten)...`)
  const forgot = await forgetSignIns()

  const users = await prisma.crmUser.findMany({ select: { email: true } })
  const staff = staffEmailMap(users.map(u => u.email))
  // The company's own published numbers (Settings > Company) are the business line, not a person: kept.
  const states = await prisma.businessState.findMany({ select: { config: true } })
  keepPhones(states.flatMap(b => { const c = (b.config as any)?.company ?? {}; return [c.phone, c.supportPhone] }))

  const per: Array<{ where: string; rows: number; emails: number; phones: number }> = []
  // The staff table first, so a unique email clash shows up before anything else changes.
  const cols = (await columns()).sort((a, b) => Number(b.table === 'CrmUser') - Number(a.table === 'CrmUser'))
  // All or nothing: a failure leaves the contact details as they were (and says so).
  await prisma.$transaction(async tx => {
    for (const c of cols) {
      const r = await scrubColumn(tx, c, staff)
      if (r.rows) per.push({ where: `${c.table}.${c.column}`, rows: r.rows, ...r.counts })
    }
    // The mark the dev database check reads (tests/devDbScrubbed.db.test.ts): everything older than this was scrubbed.
    const at = new Date()
    for (const { id } of await tx.crmAccount.findMany({ select: { id: true } })) {
      const value = { at: at.toISOString(), by: 'scripts/scrub-dev-db.ts' }
      await tx.accountKeyValue.upsert({ where: { accountId_key: { accountId: id, key: SCRUBBED_KEY } }, create: { accountId: id, key: SCRUBBED_KEY, value, updatedBy: 'scrub-dev-db' }, update: { value, updatedBy: 'scrub-dev-db', version: { increment: 1 } } })
    }
  }, { timeout: 60 * 60_000, maxWait: 60_000 })

  // What free text may still hold: seven digit local numbers (598-9785), not changed.
  let local7 = 0
  const local7Where: string[] = []
  for (const c of cols.filter(x => x.kind !== 'array')) {
    const col = q(c.column)
    const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(`select ${col}::text as v from ${q(c.table)} where ${col}::text ~ '(^|[^0-9.-])[2-9][0-9]{2}-[0-9]{4}([^0-9-]|$)'`)
    const n = rows.reduce((s, r) => s + (r.v.match(LOCAL7_RE)?.length ?? 0), 0)
    if (n) { local7 += n; local7Where.push(`${c.table}.${c.column} (${n})`) }
  }

  console.log('\nStored sign ins forgotten:')
  for (const [k, n] of Object.entries(forgot)) console.log(`  ${String(n).padStart(6)}  ${k}`)
  console.log('\nContact details made fake (rows changed, addresses, numbers):')
  for (const p of per) console.log(`  ${String(p.rows).padStart(6)} rows  ${String(p.emails).padStart(6)} emails  ${String(p.phones).padStart(6)} phones  ${p.where}`)
  const tot = per.reduce((s, p) => ({ rows: s.rows + p.rows, emails: s.emails + p.emails, phones: s.phones + p.phones }), { rows: 0, emails: 0, phones: 0 })
  console.log(`  ${String(tot.rows).padStart(6)} rows  ${String(tot.emails).padStart(6)} emails  ${String(tot.phones).padStart(6)} phones  in all`)
  console.log(`\nLeft as written: ${local7} seven digit local numbers in free text${local7Where.length ? ` (${local7Where.join(', ')})` : ''}. Names and street addresses are real.`)

  const logins = await prisma.crmUser.findMany({ select: { email: true, firstName: true, lastName: true, role: true, status: true }, orderBy: { createdAt: 'asc' } })
  console.log('\nDev sign in emails (same passwords as live):')
  for (const u of logins) console.log(`  ${u.email.padEnd(36)} ${`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()} (${u.role}, ${u.status})`)
}

main()
  .catch(err => { console.error('Scrub failed:', err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
