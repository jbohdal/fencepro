/**
 * Close out what customers deleted before Oct 30 2026 left open (Jonathan,
 * Oct 30 2026: "check every customer deleted so far for the same leftovers and
 * clean them up too"). Since then deleting a customer, quote or job closes out
 * its contract, tasks, appointments, permit, unread notices and job steps
 * (lib/closeOut.ts). This does the same for every customer still deleted,
 * its deleted quotes and jobs, and its cards:
 *
 *   contract Active -> Cancelled; task Pending / In progress -> Cancelled;
 *   appointment Scheduled / Confirmed / On my way / Rescheduled -> Cancelled;
 *   permit Needed / Applied / Approved / Inspection scheduled -> Cancelled;
 *   unread notices about the job -> read; the job's steps -> taken off.
 *
 * Each is added to the customer's deletion log row (snapshot.closed, .steps),
 * so restoring the customer (Settings > Deleted Records) reopens exactly
 * these. Nothing is sent (plain row updates; no route, automation or calendar
 * call). Money (invoices, payments) is not touched.
 *
 * One transaction. The tables it changes are locked against writes (reads go
 * on) while it runs; a hash of every other row of them, of the company
 * documents (without the job steps taken off) and of the customers, quotes,
 * jobs and automation runs is taken before and after, and if anything else
 * differs nothing is saved. Run again, it changes nothing.
 *
 *   pnpm exec tsx scripts/close-out-deleted-customers-2026-10-30.ts            dry run (default): reads only
 *   pnpm exec tsx scripts/close-out-deleted-customers-2026-10-30.ts --apply    does it (dev, or a throwaway copy)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/close-out-deleted-customers-2026-10-30.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after the deploy
 *                                                    (update.sh), a backup and Jonathan's OK
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { closeOutLeftover, leftoversOfDeletedCustomers, type Leftover } from '../src/server/lib/closeOut.js'

const SCRIPT = 'close-out-deleted-customers-2026-10-30.ts'
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed(SCRIPT)
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

const say = (...a: unknown[]) => console.log(...a)
const TYPES = ['contract', 'task', 'appointment', 'permit', 'notification', 'job steps'] as const
const WORD: Record<string, string> = { contract: 'contracts cancelled', task: 'tasks cancelled', appointment: 'appointments cancelled', permit: 'permits cancelled', notification: 'notices marked read', 'job steps': "jobs' steps taken off" }
/** The tables it changes, locked against writes for the run. */
const LOCKED = ['Contract', 'Task', 'CrmAppointment', 'Permit', 'Notification', 'BusinessState', 'DeletionLog']

function countsOf(ls: Leftover[]): Record<string, number> {
  const n: Record<string, number> = Object.fromEntries(TYPES.map(t => [t, 0]))
  for (const l of ls) { for (const c of l.found.closed) n[c.model]++; n['job steps'] += l.found.steps.length }
  return n
}

function print(ls: Leftover[]) {
  for (const l of ls) {
    say(`\n${l.name} (customer ${l.contactId}${l.logId ? `, deletion ${l.logId}` : ', NO deletion log: a restore could not reopen these'})`)
    for (const c of l.found.closed) say(`    ${c.model.padEnd(12)} ${c.label}: ${c.model === 'notification' ? 'unread' : c.before.status}`)
    for (const s of l.found.steps) say(`    ${'job steps'.padEnd(12)} ${s.label}: ${Array.isArray(s.items) ? s.items.length : 0} kept`)
  }
  const n = countsOf(ls)
  say(`\n${ls.length} deleted customer(s) with something left open. ${TYPES.map(t => `${n[t]} ${WORD[t]}`).join(', ')}.`)
}

/**
 * A hash of everything this must not change: every row of the locked tables
 * but the ones it closes and the deletion logs it adds to; the company
 * documents without version, updatedAt and the job steps it takes off; and the
 * customers, quotes, jobs and automation runs as they are.
 */
async function hashOfTheRest(tx: any, ls: Leftover[]): Promise<Record<string, string>> {
  const ids = (m: string) => ls.flatMap(l => l.found.closed.filter(c => c.model === m).map(c => c.id))
  const steps = ls.flatMap(l => l.found.steps.map(s => s.jobId))
  const logs = ls.map(l => l.logId).filter((x): x is string => !!x)
  const one = async (table: string, skip: string[]) => {
    const r = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS h FROM "${table}" t WHERE NOT (t.id = ANY($1::text[]))`, skip)
    return `${r[0].n}:${r[0].h}`
  }
  const out: Record<string, string> = {
    Contract: await one('Contract', ids('contract')),
    Task: await one('Task', ids('task')),
    CrmAppointment: await one('CrmAppointment', ids('appointment')),
    Permit: await one('Permit', ids('permit')),
    Notification: await one('Notification', ids('notification')),
    DeletionLog: await one('DeletionLog', logs),
    CrmContact: await one('CrmContact', []),
    SavedQuote: await one('SavedQuote', []),
    SavedJob: await one('SavedJob', []),
    AutomationRun: await one('AutomationRun', []),
  }
  const b = await tx.$queryRawUnsafe(`SELECT md5(coalesce(string_agg((to_jsonb(b) - 'version' - 'updatedAt' - 'jobChecklists')::text || (b."jobChecklists"::jsonb - $1::text[])::text, '|' ORDER BY b.id), '')) AS h FROM "BusinessState" b`, steps)
  out.BusinessState = b[0].h
  return out
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const found: Leftover[] = await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    return leftoversOfDeletedCustomers(tx)
  }, { timeout: 60_000 })
  const deleted = await prisma.crmContact.count({ where: { deletedAt: { not: null } } })
  say(`${deleted} customer(s) deleted (not restored).`)
  print(found)
  if (!APPLY) { await prisma.$disconnect(); say('\nDry run: nothing changed.'); return }
  if (!found.length) { await prisma.$disconnect(); say('\nNothing to do.'); return }

  const at = new Date()
  const done = await prisma.$transaction(async (tx: any) => {
    // Reads go on; no save to these tables lands until this is done (seconds).
    await tx.$executeRawUnsafe(`LOCK TABLE ${LOCKED.map(t => `"${t}"`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`)
    // Read again under the lock: what is closed is what is there now.
    const now = await leftoversOfDeletedCustomers(tx)
    const before = await hashOfTheRest(tx, now)
    const closed: Leftover[] = []
    for (const l of now) closed.push({ ...l, found: await closeOutLeftover(tx, l, at) })
    const after = await hashOfTheRest(tx, now)
    const differs = Object.keys(before).filter(k => before[k] !== after[k])
    if (differs.length) throw new Error(`Something else would have changed (${differs.join(', ')}). Nothing was saved.`)
    const planned = countsOf(now), made = countsOf(closed)
    if (TYPES.some(t => planned[t] !== made[t])) throw new Error(`Closed ${JSON.stringify(made)}, expected ${JSON.stringify(planned)}. Nothing was saved.`)
    return closed
  }, { timeout: 120_000 })
  const n = countsOf(done)
  say(`\nSaved: ${TYPES.map(t => `${n[t]} ${WORD[t]}`).join(', ')}. Every other row checked unchanged.`)

  const left = await prisma.$transaction(async (tx: any) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return leftoversOfDeletedCustomers(tx) }, { timeout: 60_000 })
  await prisma.$disconnect()
  say(`RESULT (from the database): ${left.length} deleted customer(s) with something still open.`)
  if (left.length) process.exit(1)
  say('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
