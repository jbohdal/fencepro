/**
 * Jonathan, Nov 5 2026: the records whose address is not their customer's
 * (scripts/properties-first-2026-11-05.ts listed 129), sorted by him, record
 * by record (scripts/properties-sort-2026-11-05.json, ids only):
 *
 *   own      a different house: a property of its own on that customer
 *            (labeled Other, its address the record's), the record moved
 *            onto it. Deleted records are left where they are.
 *   primary  the customer's address was blank or had no house number: the
 *            record's address becomes their Primary's (drafts follow; jobs
 *            and visits keep their own address copy).
 *   mailing  the customer's address is a mailing address (a PO Box, a home
 *            far away): it goes to their billing address, and the job's
 *            address becomes their Primary's.
 *   leave    decided to stay on the Primary as it is (a typo, the same house): nothing done.
 *   delete   test records (3 quotes, 2 visits at 15271 SE 24th St Rd under
 *            "Christa Feagin"): deleted, in Settings > Deleted Records as one
 *            entry to restore from. Her Summerfield records are not touched.
 *
 * Rebuilt from the database it runs on: a record changed since the list was
 * made (deleted, moved to another customer or property, another address, or
 * for "delete" not at that address) is left as it is and said so. Records
 * whose address is not their customer's that are not in the list are listed,
 * not changed. Nothing else is changed.
 *
 *   pnpm exec tsx scripts/properties-sort-2026-11-05.ts [--list <file.csv>]       (reads only)
 *   pnpm exec tsx scripts/properties-sort-2026-11-05.ts --apply                    (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/properties-sort-2026-11-05.ts --apply --live
 *
 * Run again, it changes nothing (every record is where it was put).
 */

import 'dotenv/config'
import fs from 'fs'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIST = args.includes('--list') ? args[args.indexOf('--list') + 1] : null
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)
if (APPLY) {
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('properties-sort-2026-11-05.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Kind = 'quote' | 'job' | 'appointment'
interface Decided { n: number; action: 'own' | 'primary' | 'mailing' | 'delete' | 'leave'; kind: Kind; id: string }

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const P = await import('../src/server/lib/properties.js')
  const { deleteRootsTx, idsInSnapshot } = await import('../src/server/lib/deletion.js')
  const TEST_ADDRESS = P.addressKey('15271 SE 24th Street Rd')
  const spec: { records: Decided[] } = JSON.parse(fs.readFileSync(new URL('./properties-sort-2026-11-05.json', import.meta.url), 'utf8'))
  console.log(`Database: ${dbName}${APPLY ? '' : ' (shows what it would do, reads only)'}\n`)

  const model = { quote: 'savedQuote', job: 'savedJob', appointment: 'appointment' } as const
  const addrOf = (k: Kind, r: any) => String((k === 'appointment' ? r.address : r.customerAddress) ?? '').trim()
  const read = async (d: Decided) => (prisma as any)[model[d.kind]].findUnique({ where: { id: d.id } })
  const primaryOf = (contactId: string) => prisma.customerProperty.findFirst({ where: { crmContactId: contactId, isPrimary: true } })
  const contactOf = (id: string) => prisma.crmContact.findUnique({ where: { id }, select: { id: true, accountId: true, firstName: true, lastName: true, serviceAddress: true, billingAddress: true, billingDifferent: true } })
  const name = (c: any) => `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim()

  // ── The plan, from this database ──
  type Item = Decided & { contactId: string; accountId: string; customer: string; address: string; primary: any; ok: boolean; why: string; status: string }
  const items: Item[] = []
  for (const d of spec.records) {
    if (d.action === 'leave') continue
    const r = await read(d)
    const c = r?.crmContactId ? await contactOf(r.crmContactId) : null
    const primary = c ? await primaryOf(c.id) : null
    const address = r ? addrOf(d.kind, r) : ''
    let why = ''
    if (!r) why = 'not on this database'
    else if (!c || !c.accountId) why = 'its customer is not on file'
    else if (!primary) why = 'the customer has no Primary property (run properties-first first)'
    else if (d.action === 'delete') {
      if (r.deletedAt) why = 'already deleted'
      else if (P.addressKey(address) !== TEST_ADDRESS) why = `not at 15271 SE 24th St Rd now (${address})`
      else if (P.addressKey(primary.address) === TEST_ADDRESS) why = 'the customer\'s own address is the test address now'
    } else if (r.deletedAt) why = 'deleted since'
    else if (r.propertyId && r.propertyId !== primary.id && d.action === 'own') {
      const on = await prisma.customerProperty.findUnique({ where: { id: r.propertyId } })
      why = on && P.sameAddress(on.address, address) ? 'already on a property of its own (done)' : 'moved to another property since'
    } else if (P.sameAddress(address, primary.address) || address === String(primary.address).trim()) why = d.action === 'own' ? 'its address is the customer\'s now' : 'done: it is the customer\'s Primary address'
    items.push({ ...d, contactId: c?.id ?? '', accountId: c?.accountId ?? '', customer: name(c), address, primary, ok: !why, why, status: r ? (r.deletedAt ? 'deleted' : String(r.status ?? r.type ?? '')) : '' })
  }

  // Records not in the list whose address is not their customer's: listed, left as they are.
  const listed = new Set(spec.records.map(r => r.id))
  const props = await prisma.customerProperty.findMany({ select: { id: true, crmContactId: true, address: true, isPrimary: true } })
  const primaryAddr = new Map(props.filter(p => p.isPrimary).map(p => [p.crmContactId, p.address]))
  const onProp = new Map(props.map(p => [p.id, p]))
  const unlisted: string[] = []
  for (const k of ['quote', 'job', 'appointment'] as Kind[]) {
    const rows = await (prisma as any)[model[k]].findMany({ where: { deletedAt: null, ...(k === 'appointment' ? {} : { crmContactId: { not: null } }) }, select: { id: true, crmContactId: true, propertyId: true, ...(k === 'appointment' ? { address: true } : { customerAddress: true }) } })
    for (const r of rows) {
      const a = addrOf(k, r)
      if (listed.has(r.id) || !a || !P.addressKey(a)) continue
      const p = r.propertyId ? onProp.get(r.propertyId) : null
      if (p && !p.isPrimary) continue // on a property of its own already
      if (P.addressKey(a) !== P.addressKey(primaryAddr.get(r.crmContactId))) unlisted.push(`${k} ${r.id}: ${a} (customer's: ${primaryAddr.get(r.crmContactId) ?? 'none'})`)
    }
  }

  // ── What it does ──
  const show = (it: Item) => `  #${it.n} ${it.customer}: ${it.kind} ${it.status} at ${it.address}${it.ok ? '' : `  LEFT AS IS: ${it.why}`}`
  const own = items.filter(i => i.action === 'own')
  const groups = new Map<string, Item[]>()
  for (const i of own.filter(x => x.ok)) { const k = `${i.contactId}|${P.addressKey(i.address)}`; groups.set(k, [...(groups.get(k) ?? []), i]) }
  console.log(`(a) Its own property: ${groups.size} new properties, ${own.filter(i => i.ok).length} records moved onto them`)
  for (const i of own) console.log(show(i))
  for (const action of ['primary', 'mailing', 'delete'] as const) {
    const set = items.filter(i => i.action === action)
    const seen = new Set<string>()
    console.log(`\n${{ primary: '(b) Their Primary takes the record\'s address', mailing: '(c) Mailing address to billing; the job\'s address their Primary', delete: 'Test records deleted' }[action]}:`)
    for (const i of set) {
      console.log(show(i))
      if (action !== 'delete' && i.ok && !seen.has(i.contactId)) {
        seen.add(i.contactId)
        const c = await contactOf(i.contactId)
        if (action === 'mailing') console.log(`      billing: ${c?.billingAddress?.trim() ? `already "${c.billingAddress}" (kept; the mailing address is not copied)` : `"${c?.serviceAddress}"`}; Primary: "${i.primary.address}" → "${i.address}"`)
        else console.log(`      Primary: "${i.primary.address}" → "${i.address}"`)
      }
    }
  }
  console.log(`\nNot in the list, address not their customer's (left as they are): ${unlisted.length}`)
  for (const u of unlisted.slice(0, 40)) console.log(`  ${u}`)
  if (LIST) {
    fs.writeFileSync(LIST, [['#', 'action', 'customer', 'kind', 'id', 'status', 'address', 'customer address (Primary)', 'done?'], ...items.map(i => [i.n, i.action, i.customer, i.kind, i.id, i.status, i.address, i.primary?.address ?? '', i.ok ? 'yes' : `left: ${i.why}`])].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n')
    console.log(`\nThe list: ${LIST}`)
  }
  if (!APPLY) { console.log('\nNothing changed. Add --apply to do it.'); await prisma.$disconnect(); return }

  const owner = await prisma.crmUser.findFirst({ where: { role: 'super_admin', crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, crmAccountId: true } })
  if (!owner?.crmAccountId) { console.error('No owner login linked to a company.'); process.exit(2) }
  const done = await prisma.$transaction(async tx => {
    const out = { properties: 0, moved: 0, primaries: 0, billing: 0, deleted: 0, deletionLogId: null as string | null }
    // (a) A property for each different house, its records on it.
    for (const g of groups.values()) {
      const first = g[0]
      const all = await tx.customerProperty.findMany({ where: { crmContactId: first.contactId } })
      let p = all.find(x => P.sameAddress(x.address, first.address))
      if (!p) {
        // The fullest way the address was written (with its city and ZIP).
        const address = [...g].map(i => i.address).sort((a, b) => b.length - a.length)[0]
        p = await P.addProperty(tx, first.accountId, first.contactId, { label: 'Other', address })
        out.properties++
      }
      for (const i of g) { await (tx as any)[model[i.kind]].update({ where: { id: i.id }, data: { propertyId: p!.id } }); out.moved++ }
    }
    // (b) and (c): the customer's Primary takes the record's address (once a customer).
    const done = new Set<string>()
    for (const i of items.filter(x => (x.action === 'primary' || x.action === 'mailing') && x.ok)) {
      if (done.has(i.contactId)) continue
      done.add(i.contactId)
      if (i.action === 'mailing') {
        const c = await tx.crmContact.findUnique({ where: { id: i.contactId } })
        if (!c?.billingAddress?.trim()) { await tx.crmContact.update({ where: { id: i.contactId }, data: { billingAddress: c?.serviceAddress ?? null, billingDifferent: true } }); out.billing++ }
      }
      await P.updateProperty(tx, i.accountId, i.contactId, i.primary.id, { address: i.address, city: null, state: null, zip: null }, { draftsOnly: true })
      out.primaries++
    }
    // Test records: one Deleted Records entry.
    const del = items.filter(x => x.action === 'delete' && x.ok)
    if (del.length) {
      const at = new Date()
      const actor = { accountId: del[0].accountId, userId: owner.id }
      const snap = await deleteRootsTx(tx, actor, { contactIds: [], quoteIds: del.filter(x => x.kind === 'quote').map(x => x.id), jobIds: [], cardIds: [] }, at)
      for (const a of del.filter(x => x.kind === 'appointment')) {
        const row = await tx.appointment.findUnique({ where: { id: a.id } })
        if (!row || row.deletedAt) continue
        // The row as deleted (what Restore compares with, as lib/deletion.ts keeps its own).
        const gone = await tx.appointment.update({ where: { id: a.id }, data: { deletedAt: at } })
        snap.rows.push({ model: 'appointment', id: a.id, row: JSON.parse(JSON.stringify(gone)) } as any)
      }
      const root = del.find(x => x.kind === 'quote') ?? del[0]
      const log = await tx.deletionLog.create({ data: {
        accountId: actor.accountId, entityType: 'quote', entityId: root.id, entityLabel: `Test records at 15271 SE 24th St Rd (${root.customer}): ${del.length}`,
        snapshot: JSON.parse(JSON.stringify(snap)), ids: idsInSnapshot(snap), deletedByUserId: owner.id, deletedAt: at, reason: 'Test records (Jonathan, Nov 5 2026)',
      } })
      out.deleted = del.length; out.deletionLogId = log.id
    }
    return out
  }, { timeout: 600_000 })
  await auditSystem('update', 'CustomerProperty', null, { newValues: { propertiesSorted: done, by: 'scripts/properties-sort-2026-11-05.ts' } }).catch(() => {})
  console.log('\nDone:', JSON.stringify(done))
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
