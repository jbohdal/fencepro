/**
 * Jonathan, Nov 5 2026: "Existing customers: their current address becomes
 * their first property, Primary, and all their existing quotes, jobs and
 * records attach to it. Nothing else changes. Dry run first on a copy of
 * live, then apply after a backup."
 *
 * For every customer with no property yet (deleted, archived and merged ones
 * too, so a restore or an undone merge finds theirs): one property, "Home",
 * Primary, with the customer's address, city, state and ZIP (the county's map
 * point when the county knows the address). Then every quote, job,
 * appointment and portal photo of theirs with no property is put on it.
 * Nothing else is changed: each record keeps its own address copy as it is.
 * Listed for Jonathan: the records whose own address is not the customer's
 * (a rental, a move): those he may want to move to a property of their own.
 *
 *   pnpm exec tsx scripts/properties-first-2026-11-05.ts               (shows what it would do, reads only)
 *   pnpm exec tsx scripts/properties-first-2026-11-05.ts --apply       (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/properties-first-2026-11-05.ts --apply --live
 *   --list <file>   writes the records whose address differs to that file (CSV)
 *
 * Run again, it changes nothing (everyone has a property, every record one).
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
  assertLiveWriteAllowed('properties-first-2026-11-05.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { addressKey } = await import('../src/server/lib/properties.js')
  const { addressParts, countyPoint } = await import('../src/server/lib/addressIndex.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (shows what it would do, reads only)'}\n`)

  const contacts = await prisma.crmContact.findMany({ select: { id: true, accountId: true, firstName: true, lastName: true, serviceAddress: true, city: true, state: true, zip: true, deletedAt: true, archivedAt: true, mergedIntoId: true } })
  const having = new Set((await prisma.customerProperty.findMany({ select: { crmContactId: true } })).map(p => p.crmContactId))
  const toMake = contacts.filter(c => c.accountId && !having.has(c.id))
  const made = toMake.map(c => {
    const address = (c.serviceAddress ?? '').trim()
    const parts = addressParts(address)
    const point = address ? countyPoint(address) : null
    return {
      accountId: c.accountId!, crmContactId: c.id, label: 'Home', isPrimary: true, address,
      city: c.city || parts.city || null, state: c.state || parts.state || null, zip: c.zip || parts.zip || null,
      lat: point?.lat ?? null, lng: point?.lng ?? null,
    }
  })
  const byId = new Map(contacts.map(c => [c.id, c]))
  console.log(`Customers: ${contacts.length} (${contacts.filter(c => !c.deletedAt && !c.mergedIntoId).length} not deleted or merged). With a property already: ${having.size}.`)
  console.log(`  First property (Home, Primary) to make: ${made.length}`)
  console.log(`    with an address: ${made.filter(m => m.address).length}; no address on file: ${made.filter(m => !m.address).length}; on the county map: ${made.filter(m => m.lat != null).length}`)

  // The records to put on it.
  const kinds = [
    { name: 'quotes', rows: await prisma.savedQuote.findMany({ where: { propertyId: null, crmContactId: { not: null } }, select: { id: true, crmContactId: true, customerAddress: true, deletedAt: true, status: true } }), addr: (r: any) => r.customerAddress, contact: (r: any) => r.crmContactId },
    { name: 'jobs', rows: await prisma.savedJob.findMany({ where: { propertyId: null, crmContactId: { not: null } }, select: { id: true, crmContactId: true, customerAddress: true, deletedAt: true, status: true } }), addr: (r: any) => r.customerAddress, contact: (r: any) => r.crmContactId },
    { name: 'appointments', rows: await prisma.appointment.findMany({ where: { propertyId: null }, select: { id: true, crmContactId: true, address: true, deletedAt: true, type: true } }), addr: (r: any) => r.address, contact: (r: any) => r.crmContactId },
    { name: 'portal photos', rows: await prisma.portalPhoto.findMany({ where: { propertyId: null }, select: { id: true, crmCustomerId: true } }), addr: () => '', contact: (r: any) => r.crmCustomerId },
  ] as const
  const primaryOf = new Map<string, string>() // contact -> its primary's address (to compare)
  for (const p of await prisma.customerProperty.findMany({ where: { isPrimary: true }, select: { crmContactId: true, address: true } })) primaryOf.set(p.crmContactId, p.address)
  for (const m of made) primaryOf.set(m.crmContactId, m.address)
  const differ: string[][] = []
  console.log('\nRecords put on the customer\'s Primary property (each keeps its own address copy as it is):')
  for (const k of kinds) {
    const rows = (k.rows as any[]).filter(r => primaryOf.has(k.contact(r)))
    const blank = rows.filter(r => !String(k.addr(r) ?? '').trim()).length
    const other = rows.filter(r => { const a = String(k.addr(r) ?? '').trim(); return a && addressKey(a) !== addressKey(primaryOf.get(k.contact(r))) })
    console.log(`  ${k.name}: ${rows.length}${k.name === 'portal photos' ? '' : ` (no address on the record: ${blank}; an address not the customer's: ${other.length}, ${other.filter(r => !r.deletedAt).length} not deleted)`}`)
    for (const r of other) {
      const c = byId.get(k.contact(r))
      differ.push([k.name, r.id, `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim(), String(k.addr(r)), primaryOf.get(k.contact(r)) ?? '', r.deletedAt ? 'deleted' : (r.status ?? r.type ?? '')])
    }
    const orphan = (k.rows as any[]).length - rows.length
    if (orphan) console.log(`    (${orphan} name a customer that is not on file: left as they are)`)
  }
  if (LIST) {
    const csv = [['kind', 'id', 'customer', 'record address', 'customer address (Primary)', 'status'], ...differ].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    fs.writeFileSync(LIST, csv + '\n')
    console.log(`\nThe ${differ.length} records with another address: ${LIST}`)
  }

  if (!APPLY) { console.log('\nNothing changed. Add --apply to do it.'); await prisma.$disconnect(); return }

  const done = await prisma.$transaction(async tx => {
    let properties = 0
    for (let i = 0; i < made.length; i += 500) properties += (await tx.customerProperty.createMany({ data: made.slice(i, i + 500) })).count
    const primaries = await tx.customerProperty.findMany({ where: { isPrimary: true }, select: { id: true, crmContactId: true } })
    const pid = new Map(primaries.map(p => [p.crmContactId, p.id]))
    const counts: Record<string, number> = {}
    const put = async (name: string, model: string, field: string, rows: any[]) => {
      const groups = new Map<string, string[]>()
      for (const r of rows) { const p = pid.get(r[field]); if (p) groups.set(p, [...(groups.get(p) ?? []), r.id]) }
      let n = 0
      for (const [p, ids] of groups) n += (await (tx as any)[model].updateMany({ where: { id: { in: ids }, propertyId: null }, data: { propertyId: p } })).count
      counts[name] = n
    }
    await put('quotes', 'savedQuote', 'crmContactId', kinds[0].rows as any[])
    await put('jobs', 'savedJob', 'crmContactId', kinds[1].rows as any[])
    await put('appointments', 'appointment', 'crmContactId', kinds[2].rows as any[])
    await put('portal photos', 'portalPhoto', 'crmCustomerId', kinds[3].rows as any[])
    return { properties, ...counts }
  }, { timeout: 600_000 })
  await auditSystem('update', 'CustomerProperty', null, { newValues: { firstProperties: done, by: 'scripts/properties-first-2026-11-05.ts' } }).catch(() => {})
  console.log('\nDone:', JSON.stringify(done))
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
