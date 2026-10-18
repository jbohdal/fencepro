/**
 * The duplicate check: reads the database (in a read only transaction) for
 * things that should exist once and are there twice, and test records that
 * should not be on live. Runs a couple of minutes after every start (so after
 * every update.sh) and every night; anything new is a notification in the
 * app. Jonathan can mark a finding "This is fine" (the Rice family sharing a
 * phone): it is then left out until something about it changes.
 *
 *   phone      the same customer phone (10 digits) on two active customers
 *   card       one customer with two cards in the same stage
 *   rule       two automation rules with the same name or starter key
 *   seeded     a seeded thing twice (stage rules, active kit set per style, pipeline stage names)
 *   quote      the same quote (customer, style, price) created twice within a minute
 *   job        two active jobs for one quote
 *   appointment the same customer, type and start twice
 *   note       the same note on a customer twice within a minute
 *   test       records named E2E (test records) on this install
 */

import prisma from './prisma.js'

export interface Finding { key: string; check: string; title: string; detail: string }

const DISMISSED = 'duplicateCheckDismissed'
const ALERTED = 'duplicateCheckAlerted'

async function rows<T = any>(tx: any, sql: string): Promise<T[]> { return tx.$queryRawUnsafe(sql) as Promise<T[]> }

/** Every finding for one company, newest data (read only). */
export async function findDuplicates(accountId: string): Promise<Finding[]> {
  const a = accountId.replace(/'/g, "''")
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const out: Finding[] = []
    for (const r of await rows(tx, `select right(regexp_replace(phone,'\\D','','g'),10) p, count(*)::int n, string_agg("firstName"||' '||"lastName", ' / ' order by "createdAt") who
      from "CrmContact" where "accountId"='${a}' and "archivedAt" is null and length(regexp_replace(coalesce(phone,''),'\\D','','g')) >= 10 group by 1 having count(*) > 1`))
      out.push({ key: `phone:${r.p}:${r.n}`, check: 'phone', title: `Same phone on ${r.n} customers`, detail: `${r.who} share (${r.p.slice(0, 3)}) ${r.p.slice(3, 6)}-${r.p.slice(6)}` })
    for (const r of await rows(tx, `select l->>'customerId' c, l->>'stage' s, count(*)::int n, max(l->>'firstName')||' '||max(l->>'lastName') name
      from "PipelineState", jsonb_array_elements(leads::jsonb) l where "accountId"='${a}' and coalesce(l->>'customerId','') <> '' group by 1,2 having count(*) > 1`))
      out.push({ key: `card:${r.c}:${r.s}:${r.n}`, check: 'card', title: `${r.n} cards for one customer in ${r.s}`, detail: r.name })
    for (const r of await rows(tx, `select name, count(*)::int n from "AutomationRule" where "accountId"='${a}' group by 1 having count(*) > 1`))
      out.push({ key: `rule:${r.name}:${r.n}`, check: 'rule', title: `${r.n} automation rules named the same`, detail: r.name })
    for (const r of await rows(tx, `select starter, count(*)::int n from "AutomationRule" where "accountId"='${a}' and starter is not null group by 1 having count(*) > 1`))
      out.push({ key: `seeded:rule:${r.starter}:${r.n}`, check: 'seeded', title: `Starter rule made ${r.n} times`, detail: r.starter })
    for (const r of await rows(tx, `select starter, count(*)::int n from "StageRule" where "accountId"='${a}' and starter is not null group by 1 having count(*) > 1`))
      out.push({ key: `seeded:stage:${r.starter}:${r.n}`, check: 'seeded', title: `Stage rule made ${r.n} times`, detail: r.starter })
    for (const r of await rows(tx, `select k->>'styleName' s, count(*)::int n from "InventoryState", jsonb_array_elements(coalesce(kits::jsonb,'[]')) k
      where "accountId"='${a}' and coalesce((k->>'archived')::boolean,false) = false and k->>'styleName' is not null group by 1 having count(*) > 1`))
      out.push({ key: `seeded:kit:${r.s}:${r.n}`, check: 'seeded', title: `${r.n} material kits in use for one style`, detail: r.s })
    for (const r of await rows(tx, `select v, count(*)::int n from "PipelineState", jsonb_array_elements_text(coalesce(stages::jsonb,'[]')) s(v) where "accountId"='${a}' group by 1 having count(*) > 1`))
      out.push({ key: `seeded:stage-name:${r.v}:${r.n}`, check: 'seeded', title: `Pipeline stage listed ${r.n} times`, detail: r.v })
    for (const r of await rows(tx, `select a.id ia, b.id ib, a."customerName" name, a."fenceStyle" style, a."finalPrice"::text price, to_char(a."createdAt", 'YYYY-MM-DD') d from "SavedQuote" a join "SavedQuote" b
      on a.id < b.id and a."accountId"='${a}' and b."accountId"='${a}' and coalesce(a."crmContactId",a."customerName") = coalesce(b."crmContactId",b."customerName")
      and a."fenceStyle" = b."fenceStyle" and a."finalPrice" = b."finalPrice" and a."archivedAt" is null and b."archivedAt" is null and abs(extract(epoch from a."createdAt" - b."createdAt")) < 60`))
      out.push({ key: `quote:${r.ia}:${r.ib}`, check: 'quote', title: 'Same quote made twice within a minute', detail: `${r.name}, ${r.style}, $${r.price} (${r.d})` })
    for (const r of await rows(tx, `select "quoteId" q, count(*)::int n, max("customerName") name from "SavedJob" where "accountId"='${a}' and coalesce("quoteId",'') <> '' and "archivedAt" is null group by 1 having count(*) > 1`))
      out.push({ key: `job:${r.q}:${r.n}`, check: 'job', title: `${r.n} jobs for one quote`, detail: r.name })
    for (const r of await rows(tx, `select "crmContactId" c, type, "startAt"::text s, count(*)::int n from "CrmAppointment" where "accountId"='${a}' and "archivedAt" is null and "startAt" is not null group by 1,2,3 having count(*) > 1`))
      out.push({ key: `appointment:${r.c}:${r.type}:${r.s}`, check: 'appointment', title: 'Same appointment booked twice', detail: `${r.type} at ${r.s}` })
    for (const r of await rows(tx, `select a.id ia, b.id ib, left(a.body, 60) body from "CrmContactNote" a join "CrmContactNote" b on a.id < b.id and a."accountId"='${a}' and a."crmContactId" = b."crmContactId"
      and a.body = b.body and a."deletedAt" is null and b."deletedAt" is null and abs(extract(epoch from a."createdAt" - b."createdAt")) < 60`))
      out.push({ key: `note:${r.ia}:${r.ib}`, check: 'note', title: 'Same note saved twice within a minute', detail: r.body })
    for (const r of await rows(tx, `select 'customer' kind, id, "firstName"||' '||"lastName" name from "CrmContact" where "accountId"='${a}' and "archivedAt" is null and ("firstName" ilike 'E2E%' or "lastName" ilike 'E2E%')
      union all select 'job', id, "customerName" from "SavedJob" where "accountId"='${a}' and "archivedAt" is null and "customerName" ilike 'E2E%'
      union all select 'quote', id, "customerName" from "SavedQuote" where "accountId"='${a}' and "archivedAt" is null and "customerName" ilike 'E2E%'`))
      out.push({ key: `test:${r.kind}:${r.id}`, check: 'test', title: `Test record (${r.kind})`, detail: r.name })
    return out
  }, { timeout: 30_000 })
}

async function getList(accountId: string, key: string): Promise<string[]> {
  const r = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key } } }).catch(() => null)
  return Array.isArray(r?.value) ? (r!.value as string[]) : []
}
async function setList(accountId: string, key: string, value: string[]): Promise<void> {
  await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key } }, create: { accountId, key, value }, update: { value } })
}

/** Findings not marked "This is fine". */
export async function openFindings(accountId: string): Promise<Finding[]> {
  const dismissed = new Set(await getList(accountId, DISMISSED))
  return (await findDuplicates(accountId)).filter(f => !dismissed.has(f.key))
}

export async function dismissFinding(accountId: string, key: string): Promise<void> {
  const list = await getList(accountId, DISMISSED)
  if (!list.includes(key)) await setList(accountId, DISMISSED, [...list, key].slice(-500))
}

/** Check every company; a notification for anything new (each finding is told once). Returns the findings. */
export async function runDuplicateCheck(why: string): Promise<number> {
  let total = 0
  for (const { id } of await prisma.crmAccount.findMany({ select: { id: true } })) {
    const found = await openFindings(id)
    total += found.length
    const told = new Set(await getList(id, ALERTED))
    const fresh = found.filter(f => !told.has(f.key))
    if (fresh.length) {
      await prisma.notification.create({ data: {
        title: `Possible duplicates: ${fresh.length} new`,
        body: fresh.slice(0, 4).map(f => `${f.title}: ${f.detail}`).join('; ') + (fresh.length > 4 ? `; and ${fresh.length - 4} more` : ''),
        type: 'warning', link: '/dashboard',
      } })
      await setList(id, ALERTED, [...told, ...fresh.map(f => f.key)].slice(-1000))
    }
  }
  console.log(`[duplicates] ${why}: ${total} open finding${total === 1 ? '' : 's'}`)
  return total
}

/** After every start (so after every update.sh), and every night at 3 am. */
export function startDuplicateCheck(): void {
  if (process.env.DISABLE_CRON === '1') return
  const run = (why: string) => { runDuplicateCheck(why).catch(err => console.error('[duplicates] check failed:', String((err as Error)?.message || err).slice(0, 200))) }
  setTimeout(() => run('after start'), 2 * 60_000).unref()
  let lastNight = ''
  setInterval(() => {
    const now = new Date(), day = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const hour = Number(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
    if (hour === 3 && lastNight !== day) { lastNight = day; run('nightly') }
  }, 10 * 60_000).unref()
}
