/**
 * Christa's two Salesman logins made one (Jonathan, Oct 30 2026): "Move
 * EVERYTHING from the old account to the new one ... Signed jobs she sold stay
 * credited to her (the new account). Then turn off the old account's login
 * (archive it, don't delete it), so she can only sign in with the company
 * email."
 *
 *   OLD  3511b087-858b-4d82-8df5-04b18bd6f070  christaf0920@gmail.com   (personal email)
 *   NEW  7fcd17f6-20b7-4d1e-bfa8-4876ee0f582b  christa@gdfencepro.com   (company email)
 *
 * What it does, in ONE transaction (all or nothing):
 *
 *   1. Every column of every table whose value IS the old login's id (owner of
 *      customers and quotes, the login an appointment is with, who took a
 *      photo, who wrote a note, who recorded a payment, the actor of a History
 *      / audit entry, ...) is pointed at the new login. Found from the
 *      database itself (information_schema), not from a list, so a column
 *      added later is not missed.
 *   2. The old id inside JSON (History snapshots, settings, kv) and inside
 *      text keys (the morning follow up's once-a-day key
 *      "followup-morning:<login>:<day>") is replaced by the new id.
 *   3. The old email where it names the LOGIN (who did a History entry, whose
 *      bell notification it is, a lead's or account's rep email) becomes the
 *      new email. Where it is Christa's address as a CUSTOMER (she is also a
 *      customer: her own fence, quotes, portal invite, website request) it is
 *      left alone: that is her contact address, not a login.
 *   4. One per login rows: the old login's pending call (PendingTouch, one per
 *      login) moves unless the new login already has one (then the new one's
 *      is kept and the old one is dropped); a morning follow up key the new
 *      login already has for that day is kept and the old one's dropped.
 *   5. Receipt numbers set aside for the old login (ReceiptNumberBlock) move to
 *      the new login. A number in a block is never handed to anyone else, and
 *      a block holds numbers no other block holds, so the new login simply
 *      holds both sets: its phone gets the oldest unused first
 *      (contractBilling.reserveReceiptNumbers). No number is made, reused or
 *      lost; a receipt queued offline on her phone with an old block number
 *      is still accepted when it reaches the server under the new login.
 *   6. The old login's sign ins (CrmUserSession) are deleted: she is signed
 *      out of it everywhere.
 *   7. Rows ABOUT the old login itself (it was invited, its role or status was
 *      changed: CrmAuditLog / CrmUserActivity whose entity is that login) stay
 *      as they are: they are the old login's own history.
 *   8. The old login is switched off exactly as Settings > Team does it
 *      (status "deactivated": routes/crm-auth.ts refuses sign in, the
 *      password reset and every sign in check; nothing is deleted).
 *   9. One History entry (CrmAuditLog, action "merge_logins") records the
 *      merge: who asked, when, and the counts.
 *
 * Names need no change: both logins are "Christa Feagin", and quotes, jobs,
 * customers, cards and commissions name the rep by name (lib/salesScope.ts
 * isMine, lib/salesRep.ts sameName). Once the old login is switched off, a
 * name matched to a login (appointmentRep.loginByName, serviceTickets
 * cardOwnerOf) finds only the new one (before, two logins with the same full
 * name matched neither).
 *
 * Checks, inside the same transaction before it commits (it rolls back and
 * changes nothing if any fails):
 *   - no reference to the old id is left except the old login's row, the rows
 *     about the old login (7) and the merge entry (9);
 *   - the old email is left only where it is a customer's address (3);
 *   - every row that did not reference the old login is byte for byte the
 *     same as before (a hash of each row before and after), so nothing of
 *     anyone else's, and nothing the new login already had, changed;
 *   - the old login is "deactivated" and has no sign ins.
 *
 *   pnpm exec tsx scripts/merge-christa-accounts-2026-10-30.ts               dry run (default): does it all, checks, then rolls back
 *   pnpm exec tsx scripts/merge-christa-accounts-2026-10-30.ts --apply       does it (a copy of live, or dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/merge-christa-accounts-2026-10-30.ts --apply --live
 *                                                     on live: from ~/ezbiz/apps/portal, after a backup (under 30 minutes old)
 *
 * Run again, it changes nothing (and adds no second merge entry).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

export const OLD = { id: '3511b087-858b-4d82-8df5-04b18bd6f070', email: 'christaf0920@gmail.com' }
export const NEW = { id: '7fcd17f6-20b7-4d1e-bfa8-4876ee0f582b', email: 'christa@gdfencepro.com' }
const SCRIPT = 'merge-christa-accounts-2026-10-30.ts'
const MERGE_ACTION = 'merge_logins'

/** Columns where the old email, as a whole value, is the LOGIN: moved to the new email. */
export const STAFF_EMAIL_COLUMNS = new Set([
  'CrmAuditLog.userEmail', 'Notification.recipientId', 'Lead.assignedRepEmail', 'CrmAccount.assignedRepEmail',
  'ActivityLog.actor', 'ApiKey.createdBy', 'Automation.createdBy', 'AutomationRule.createdBy', 'ChangeOrder.createdBy',
  'ContractPayment.recordedBy', 'VendorPayment.recordedBy', 'CrmAppointment.createdBy', 'CrmAppointment.assignedTo',
  'CrmContactNote.createdBy', 'ImportBatch.createdBy', 'PaymentSchedule.createdBy', 'PlManualEntry.createdBy',
  'ServiceTicket.createdBy', 'Task.assignedTo', 'Task.createdBy', 'VendorBill.createdBy', 'WarrantyUpdate.createdBy',
  'CallLog.userName', 'Feedback.userName',
])
/** Columns where the old email is Christa's address as a CUSTOMER: left alone. */
export const CUSTOMER_EMAIL_COLUMNS = new Set([
  'CrmContact.email', 'Customer.email', 'EzBudgetQuote.customerEmail', 'IntakeLead.email', 'Lead.email',
  'PortalAccount.email', 'PortalInvite.email', 'Receipt.emailTo', 'SavedJob.customerEmail', 'SavedQuote.customerEmail',
])
/**
 * Tables where the old email may appear INSIDE a text or JSON value and is her customer address: a customer's
 * record or snapshot (History snapshots of her customer record and quotes, the customer merge of her two customer
 * records, her website request, her pipeline card, her customer activity line "Portal invite emailed to ...").
 */
export const CUSTOMER_EMAIL_TABLES = new Set([
  'CrmContact', 'SavedQuote', 'SavedJob', 'IntakeLead', 'PortalAccount', 'PortalInvite', 'CustomerMerge',
  'PipelineState', 'AccountKeyValue', 'CrmAuditLog', 'CrmUserActivity', 'Lead', 'EzBudgetQuote', 'Receipt',
])

const q = (s: string) => `"${s.replace(/"/g, '""')}"`

interface Col { table: string; column: string; type: string; udt: string }

type Tx = { $queryRawUnsafe: (sql: string, ...v: unknown[]) => Promise<any[]>; $executeRawUnsafe: (sql: string, ...v: unknown[]) => Promise<number> }

/** SQL: this row is ABOUT the old login itself (it was invited, changed), kept as the old login's own history. */
function aboutOldLogin(table: string): string | null {
  if (table === 'CrmAuditLog') return `("entityType" IN ('CrmUser','user','login') AND "entityId" = '${OLD.id}' AND "action" <> '${MERGE_ACTION}')`
  if (table === 'CrmUserActivity') return `("entityType" IN ('CrmUser','user','login') AND "entityId" = '${OLD.id}' AND "userId" <> '${OLD.id}')`
  if (table === 'CrmUser') return `(id = '${OLD.id}')`
  return null
}

export interface MergeResult { counts: Record<string, number>; kept: Record<string, number>; total: number; checks: string[] }

export async function mergeLogins(tx: Tx): Promise<MergeResult> {
  const counts: Record<string, number> = {}
  const kept: Record<string, number> = {}
  const add = (k: string, n: number) => { if (n) counts[k] = (counts[k] ?? 0) + n }
  const checks: string[] = []

  // ── The two logins ──────────────────────────────────────────────────────
  const users = await tx.$queryRawUnsafe(`SELECT id, email, "firstName", "lastName", role::text AS role, status::text AS status, "crmAccountId" FROM "CrmUser" WHERE id IN ($1, $2)`, OLD.id, NEW.id)
  const oldU = users.find(u => u.id === OLD.id), newU = users.find(u => u.id === NEW.id)
  if (!oldU || !newU) throw new Error(`Both logins must exist (old: ${!!oldU}, new: ${!!newU}). Nothing was changed.`)
  if (oldU.email.toLowerCase() !== OLD.email || newU.email.toLowerCase() !== NEW.email) throw new Error('A login\'s email is not what this script was written for. Nothing was changed.')
  if (oldU.crmAccountId !== newU.crmAccountId) throw new Error('The two logins are in different companies. Nothing was changed.')
  if (newU.status !== 'active') throw new Error(`The new login is "${newU.status}", not active. Nothing was changed.`)
  const full = (u: any) => `${u.firstName} ${u.lastName}`.replace(/\s+/g, ' ').trim().toLowerCase()
  if (full(oldU) !== full(newU)) throw new Error(`The names differ ("${oldU.firstName} ${oldU.lastName}" / "${newU.firstName} ${newU.lastName}"): rep names would need moving too. Nothing was changed.`)

  // ── Every column that could hold a login reference ─────────────────────
  const cols: Col[] = (await tx.$queryRawUnsafe(`
    SELECT c.table_name AS table, c.column_name AS column, c.data_type AS type, c.udt_name AS udt
    FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json') OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
    ORDER BY 1, 2`)) as Col[]
  const tables = [...new Set((await tx.$queryRawUnsafe(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r: any) => r.t as string))]
  const colsOf = (t: string) => cols.filter(c => c.table === t)
  const hasCol = async (t: string, c: string) => (await tx.$queryRawUnsafe(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, t, c)).length > 0

  // Rows that reference the old login (or name it by email in a login column): the only rows that may change.
  const touchedWhere = (t: string): string => {
    const staff = colsOf(t).filter(c => STAFF_EMAIL_COLUMNS.has(`${t}.${c.column}`) && c.type !== 'jsonb').map(c => `lower(${q(c.column)}) = '${OLD.email}'`)
    return [`r::text LIKE '%${OLD.id}%'`, ...staff].join(' OR ')
  }

  // ── Before: a hash of every row that does not reference the old login ──
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE merge_before (tbl text, h text) ON COMMIT DROP`)
  for (const t of tables) {
    await tx.$executeRawUnsafe(`INSERT INTO merge_before SELECT '${t}', md5(r::text) FROM ${q(t)} r WHERE NOT (${touchedWhere(t)})`)
  }
  const newRowsBefore = Number((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM (${tables.map(t => `SELECT 1 FROM ${q(t)} r WHERE r::text LIKE '%${NEW.id}%' OR lower(r::text) LIKE '%${NEW.email}%'`).join(' UNION ALL ')}) x`))[0].n)

  // Already done? (old login switched off and nothing left on it: a second run changes nothing)
  const leftBefore = Number((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM (${tables.map(t => {
    const about = aboutOldLogin(t)
    return `SELECT 1 FROM ${q(t)} r WHERE (${touchedWhere(t)})${about ? ` AND NOT ${about}` : ''} AND NOT (${q(t) === '"CrmAuditLog"' ? `"action" = '${MERGE_ACTION}'` : 'false'})`
  }).join(' UNION ALL ')}) x`))[0].n)
  if (leftBefore === 0 && oldU.status === 'deactivated') {
    checks.push('Already merged: the old login is switched off and nothing references it. Nothing to do.')
    return { counts, kept, total: 0, checks }
  }

  // ── 6. Sign ins of the old login: deleted ──────────────────────────────
  add('CrmUserSession: old login\'s sign ins deleted', await tx.$executeRawUnsafe(`DELETE FROM "CrmUserSession" WHERE "userId" = $1`, OLD.id))

  // ── 4. One per login rows ───────────────────────────────────────────────
  const newTouch = await tx.$queryRawUnsafe(`SELECT 1 FROM "PendingTouch" WHERE "userId" = $1`, NEW.id)
  if (newTouch.length) add('PendingTouch: old pending call dropped (the new login already has one; kept)', await tx.$executeRawUnsafe(`DELETE FROM "PendingTouch" WHERE "userId" = $1`, OLD.id))
  // The morning follow up's once-a-day key: the new login's own key for that day wins.
  add('AutomationEffect: old day key dropped (the new login has that day already)', await tx.$executeRawUnsafe(
    `DELETE FROM "AutomationEffect" o WHERE o.key LIKE $1 AND EXISTS (SELECT 1 FROM "AutomationEffect" n WHERE n.key = replace(o.key, $2, $3))`,
    `%${OLD.id}%`, OLD.id, NEW.id))

  // ── 1, 2, 5. The old id, everywhere ────────────────────────────────────
  for (const t of tables) {
    const about = aboutOldLogin(t)
    const skip = about ? ` AND NOT ${about}` : ''
    const bumpVersion = await hasCol(t, 'version')
    for (const c of colsOf(t)) {
      if (t === 'CrmUser' && c.column === 'id') continue
      const col = q(c.column)
      let n = 0
      if (c.type === 'jsonb' || c.type === 'json') {
        n = await tx.$executeRawUnsafe(`UPDATE ${q(t)} r SET ${col} = replace(${col}::text, $1, $2)::${c.type}${bumpVersion ? ', "version" = r."version" + 1' : ''} WHERE ${col}::text LIKE $3${skip}`, OLD.id, NEW.id, `%${OLD.id}%`)
        if (n) add(`${t}.${c.column} (inside JSON)`, n)
      } else if (c.type === 'ARRAY') {
        n = await tx.$executeRawUnsafe(`UPDATE ${q(t)} r SET ${col} = array_replace(${col}, $1, $2)${bumpVersion ? ', "version" = r."version" + 1' : ''} WHERE $1 = ANY(${col})${skip}`, OLD.id, NEW.id)
        if (n) add(`${t}.${c.column} (list)`, n)
      } else {
        n = await tx.$executeRawUnsafe(`UPDATE ${q(t)} r SET ${col} = $2${bumpVersion ? ', "version" = r."version" + 1' : ''} WHERE ${col} = $1${skip}`, OLD.id, NEW.id)
        if (n) add(`${t}.${c.column}`, n)
        const inText = await tx.$executeRawUnsafe(`UPDATE ${q(t)} r SET ${col} = replace(${col}, $1, $2)${bumpVersion ? ', "version" = r."version" + 1' : ''} WHERE ${col} LIKE $3${skip}`, OLD.id, NEW.id, `%${OLD.id}%`)
        if (inText) add(`${t}.${c.column} (inside text)`, inText)
      }
    }
  }

  // ── 3. The old email where it is the login ─────────────────────────────
  for (const c of cols) {
    if (c.type !== 'text' && c.type !== 'character varying') continue
    const key = `${c.table}.${c.column}`
    const about = aboutOldLogin(c.table)
    const skip = about ? ` AND NOT ${about}` : ''
    const hits = Number((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${q(c.table)} r WHERE lower(${q(c.column)}) = $1${skip}`, OLD.email))[0].n)
    if (!hits) continue
    if (STAFF_EMAIL_COLUMNS.has(key)) add(`${key} (email)`, await tx.$executeRawUnsafe(`UPDATE ${q(c.table)} r SET ${q(c.column)} = $2 WHERE lower(${q(c.column)}) = $1${skip}`, OLD.email, NEW.email))
    else if (CUSTOMER_EMAIL_COLUMNS.has(key)) kept[`${key}: her address as a customer`] = (kept[`${key}: her address as a customer`] ?? 0) + hits
    else if (!(c.table === 'CrmUser' && c.column === 'email')) throw new Error(`The old email is in ${key} (${hits} row(s)), a column this script does not know as a login or a customer address. Nothing was changed; look at it first.`)
  }

  // ── 8. Switch the old login off, as Settings > Team does ──────────────
  add('CrmUser: old login switched off (deactivated)', await tx.$executeRawUnsafe(`UPDATE "CrmUser" SET status = 'deactivated', "updatedAt" = now() WHERE id = $1 AND status <> 'deactivated'`, OLD.id))

  // ── 9. One History entry for the merge ─────────────────────────────────
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  await tx.$executeRawUnsafe(
    `INSERT INTO "CrmAuditLog" (id, "userId", "userEmail", action, "entityType", "entityId", "oldValues", "newValues", "createdAt")
     VALUES (gen_random_uuid()::text, NULL, $1, $2, 'CrmUser', $3, $4::jsonb, $5::jsonb, now())`,
    `script ${SCRIPT} (Jonathan's request, Oct 30 2026)`, MERGE_ACTION, NEW.id,
    JSON.stringify({ from: { id: OLD.id, email: OLD.email, statusBefore: oldU.status } }),
    JSON.stringify({ to: { id: NEW.id, email: NEW.email }, oldLoginStatus: 'deactivated', moved: counts, keptAsCustomerAddress: kept,
      summary: `Christa Feagin's old login (${OLD.email}) merged into ${NEW.email}: ${total} change(s); the old login is switched off.` }))

  // ── Checks (inside the transaction: a failure rolls everything back) ───
  const leftId = await tx.$queryRawUnsafe(`SELECT tbl, count(*)::int AS n FROM (${tables.map(t => {
    const about = aboutOldLogin(t)
    return `SELECT '${t}' AS tbl FROM ${q(t)} r WHERE r::text LIKE '%${OLD.id}%'${about ? ` AND NOT ${about}` : ''}${t === 'CrmAuditLog' ? ` AND "action" <> '${MERGE_ACTION}'` : ''}`
  }).join(' UNION ALL ')}) x GROUP BY tbl`)
  if (leftId.length) throw new Error(`CHECK FAILED: the old id is still in ${leftId.map((r: any) => `${r.tbl} (${r.n})`).join(', ')}. Rolled back.`)
  checks.push('No reference to the old login\'s id is left (except its own row, the rows about it, and the merge entry).')

  const leftEmail = await tx.$queryRawUnsafe(`SELECT tbl, count(*)::int AS n FROM (${tables.map(t => {
    const about = aboutOldLogin(t)
    return `SELECT '${t}' AS tbl FROM ${q(t)} r WHERE lower(r::text) LIKE '%${OLD.email}%'${about ? ` AND NOT ${about}` : ''}${t === 'CrmAuditLog' ? ` AND "action" <> '${MERGE_ACTION}'` : ''}`
  }).join(' UNION ALL ')}) x GROUP BY tbl`)
  const strayEmail = leftEmail.filter((r: any) => !CUSTOMER_EMAIL_TABLES.has(r.tbl))
  if (strayEmail.length) throw new Error(`CHECK FAILED: the old email is still in ${strayEmail.map((r: any) => `${r.tbl} (${r.n})`).join(', ')}, not as a customer's address. Rolled back.`)
  // Settings and kv: only the customer activity (History lines of her customer record) may carry it.
  const kvKeys = await tx.$queryRawUnsafe(`SELECT key FROM "AccountKeyValue" r WHERE lower(r::text) LIKE $1 AND key <> 'fencepro_customer_activity'`, `%${OLD.email}%`)
  if (kvKeys.length) throw new Error(`CHECK FAILED: the old email is in settings (AccountKeyValue ${kvKeys.map((r: any) => r.key).join(', ')}). Look at it first. Rolled back.`)
  const staffLeft = cols.filter(c => STAFF_EMAIL_COLUMNS.has(`${c.table}.${c.column}`) && (c.type === 'text' || c.type === 'character varying'))
  for (const c of staffLeft) {
    const about = aboutOldLogin(c.table)
    const n = Number((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${q(c.table)} r WHERE lower(${q(c.column)}) = $1${about ? ` AND NOT ${about}` : ''}${c.table === 'CrmAuditLog' ? ` AND "action" <> '${MERGE_ACTION}'` : ''}`, OLD.email))[0].n)
    if (n) throw new Error(`CHECK FAILED: ${c.table}.${c.column} still names the old login by email (${n}). Rolled back.`)
  }
  for (const r of leftEmail) kept[`${r.tbl}: rows with her customer address (any column)`] = r.n
  checks.push('The old email is left only where it is her address as a customer.')

  await tx.$executeRawUnsafe(`CREATE TEMP TABLE merge_after (tbl text, h text) ON COMMIT DROP`)
  for (const t of tables) await tx.$executeRawUnsafe(`INSERT INTO merge_after SELECT '${t}', md5(r::text) FROM ${q(t)} r`)
  await tx.$executeRawUnsafe(`CREATE INDEX ON merge_after (tbl, h)`)
  const changedOthers = await tx.$queryRawUnsafe(`
    SELECT b.tbl, count(*)::int AS n FROM merge_before b
    WHERE NOT EXISTS (SELECT 1 FROM merge_after a WHERE a.tbl = b.tbl AND a.h = b.h)
    GROUP BY b.tbl`)
  if (changedOthers.length) throw new Error(`CHECK FAILED: rows that did not reference the old login changed: ${changedOthers.map((r: any) => `${r.tbl} (${r.n})`).join(', ')}. Rolled back.`)
  const untouched = Number((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM merge_before`))[0].n)
  checks.push(`All ${untouched} rows that did not reference the old login are unchanged (row hashes before = after), including the ${newRowsBefore} the new login already had.`)

  const st = await tx.$queryRawUnsafe(`SELECT status::text AS status, (SELECT count(*)::int FROM "CrmUserSession" WHERE "userId" = $1) AS sessions FROM "CrmUser" WHERE id = $1`, OLD.id)
  if (st[0]?.status !== 'deactivated' || st[0]?.sessions !== 0) throw new Error('CHECK FAILED: the old login is not switched off, or still has sign ins. Rolled back.')
  checks.push('The old login is "deactivated" with no sign ins (sign in refuses it: routes/crm-auth.ts /login).')

  return { counts, kept, total, checks }
}

// ── Command line ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const APPLY = args.includes('--apply')
  const dbUrl = process.env.DATABASE_URL || ''
  const dbName = databaseNameOf(dbUrl)
  if (!dbUrl) { console.error('DATABASE_URL is not set: give it on the command line. Nothing was changed.'); process.exit(2) }
  if (APPLY) {
    if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
    const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
    if (misuse) { console.error(misuse); process.exit(2) }
    assertLiveWriteAllowed(SCRIPT)
    if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
  }
  const prisma = (await import('../src/server/lib/prisma.js')).default
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run: everything is done and checked, then rolled back)'}`)
  class DryRun extends Error {}
  let result: MergeResult | null = null
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('merge-logins:${OLD.id}'))`)
      result = await mergeLogins(tx)
      if (!APPLY) throw new DryRun()
    }, { timeout: 600_000, maxWait: 30_000 })
  } catch (err) {
    if (!(err instanceof DryRun)) { await prisma.$disconnect(); console.error(err instanceof Error ? err.message : err); process.exit(1) }
  }
  await prisma.$disconnect()
  const r = result as MergeResult | null
  if (!r) { console.error('Nothing ran.'); process.exit(1) }
  console.log(`\n${APPLY ? 'Changed' : 'Would change'} (${r.total}):`)
  for (const [k, n] of Object.entries(r.counts).sort()) console.log(`  ${String(n).padStart(5)}  ${k}`)
  if (Object.keys(r.kept).length) {
    console.log('\nLeft as they are (her own address as a customer, not a login):')
    for (const [k, n] of Object.entries(r.kept).sort()) console.log(`  ${String(n).padStart(5)}  ${k}`)
  }
  console.log('\nChecks:')
  for (const c of r.checks) console.log(`  OK  ${c}`)
  console.log(APPLY ? '\nDone.' : '\nDry run: nothing changed.')
}

if (process.argv[1] && /merge-christa-accounts-2026-10-30\.ts$/.test(process.argv[1])) main().catch(err => { console.error(err); process.exit(1) })
