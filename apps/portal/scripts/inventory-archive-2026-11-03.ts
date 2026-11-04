/**
 * Inventory clean up (audit item 31): archive the 38 old green chain link
 * parts and the 7 vendor-printed pipe names. Archived, never deleted: kept,
 * hidden from the Inventory list unless asked (status 'archived', as the app
 * archives a part: web/src/wood.ts planWoodRealKits).
 *
 *   pnpm exec tsx scripts/inventory-archive-2026-11-03.ts                    dry run (default): reads only
 *   pnpm exec tsx scripts/inventory-archive-2026-11-03.ts --apply            does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/inventory-archive-2026-11-03.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Jonathan, Nov 3 2026: "Archive the 38 green and 7 pipe parts now. Archive
 * the 4 old 8 ft parts only after item 28 is done. No action on black
 * commercial. List the 2 rail aluminum gate prices for me to check."
 *
 * The parts are named here by id and name (audit before full, section 6,
 * groups 1 and 2). A part missing, or with another name under its id, stops
 * it with nothing changed. So does a part used by anything: a saved quote or
 * job (pull sheet included), a saved or built-in kit, a sales order, a vendor
 * order, a pull sheet, a job's quoted cost or takeoff, a change order, a
 * vendor document line matched to it, a vendor part link or a price history
 * row (by id or by name, the app's own name match). Written only while Inventory is still
 * on the version read (the version goes up by one, as a save in the app). One
 * audit log entry. Run again, it changes nothing.
 *
 * Also lists, read only, the Aluminum Emily 2-rail gates and the 3-rail ones
 * next to them (group 5): the prices for Jonathan to check. Nothing else is
 * touched (the 4 old 8 ft vinyl sections and black commercial stay as they are).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const SCRIPT = 'scripts/inventory-archive-2026-11-03.ts'

/** Old green chain link from the first price list (no kit or fence uses them; the "Green, …" set replaced them). */
export const GREEN: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'clr-b2', name: 'Gr, Bolt, 3/8" x 2" w/ Nut' },
  { id: 'clr-b3', name: 'Gr, Bolt, 3/8" x 3" w/ Nut' },
  { id: 'clr-b5', name: 'Gr, Bolt, 5/16 x 1-1/4" w/ Nut' },
  { id: 'clr-bb', name: 'Gr, Band, Brace, PS, 2-3/8", 3/4"' },
  { id: 'clr-bt', name: 'Gr, Band, Tension, PS, 2-3/8" x 3/4"' },
  { id: 'clr-cl', name: 'Gr, Cap, Loop, AL, 1-5/8" x 1-3/8"' },
  { id: 'clr-col', name: 'Gr, Collar, PS, 1-3/8" (Set of 2)' },
  { id: 'clr-cp', name: 'Gr, Cap, Post, AL, 2-3/8"' },
  { id: 'clr-fab-48', name: 'Gr, Fabric, 48" KK (9)' },
  { id: 'clr-fab-60', name: 'Gr, Fabric, 60" KK (9)' },
  { id: 'clr-fab-72', name: 'Gr, Fabric, 72" KK (9)' },
  { id: 'clr-fk1', name: 'Gr, Fork, PS, 1-3/8"' },
  { id: 'clr-fk2', name: 'Gr, Fork, PS, 2-1/2"' },
  { id: 'clr-g-44', name: 'Gate, Grn, 4 x 4 (1-3/8" .065)' },
  { id: 'clr-g-45', name: 'Gate, Grn, 4 x 5 (1-3/8" .065)' },
  { id: 'clr-g-46', name: 'Gate, Grn, 4 x 6 (1-3/8" .065)' },
  { id: 'clr-g-54', name: 'Gate, Grn, 5 x 4 (1-3/8" .065)' },
  { id: 'clr-g-55', name: 'Gate, Grn, 5 x 5 (1-3/8" .065)' },
  { id: 'clr-g-56', name: 'Gate, Grn, 5 x 6 (1-3/8" .065)' },
  { id: 'clr-g-64', name: 'Gate, Grn, 6 x 4 (1-3/8" .065)' },
  { id: 'clr-g-65', name: 'Gate, Grn, 6 x 5 (1-3/8" .065)' },
  { id: 'clr-g-66', name: 'Gate, Grn, 6 x 6 (1-3/8" .065)' },
  { id: 'clr-hf', name: 'Gr, Hinge, Female, 1-3/8" x 5/8"' },
  { id: 'clr-hm', name: 'Gr, Hinge, Male, PS, 2-3/8"' },
  { id: 'clr-hr', name: 'Gr, Hog Ring, 9GA, Alum' },
  { id: 'clr-ht', name: 'Chainlink, Green, Hardware, Hook Ties, 6-1/2" x 9ga (100)' },
  { id: 'clr-pp-10', name: 'Pipe, Grn, 2-1/2" X 10\' (.055)' },
  { id: 'clr-pp-8', name: 'Pipe, Grn, 2-1/2" X 8\' (.055)' },
  { id: 'clr-pp-9', name: 'Pipe, Grn, 2-1/2" X 9\' (.055)' },
  { id: 'clr-rail', name: 'Pipe, Grn, 1-3/8" X 21\' (.055)' },
  { id: 'clr-re', name: 'Gr, Rail End, AL, Offset, 1-3/8"' },
  { id: 'clr-tb-48', name: 'Gr, Tension Bar, 48"' },
  { id: 'clr-tb-60', name: 'Gr, Tension Bar, 60"' },
  { id: 'clr-tb-72', name: 'Gr, Tension Bar, 72"' },
  { id: 'clr-tp-106', name: 'Pipe, Grn, 1-5/8" X 10\'6\'\' (.055)' },
  { id: 'clr-tp-8', name: 'Pipe, Grn, 1-5/8" X 8\' (.055)' },
  { id: 'clr-tp-9', name: 'Pipe, Grn, 1-5/8" X 9\' (.055)' },
  { id: 'clr-tw', name: 'Gr, Wire, Tension, 9GA' },
]

/** Stephens Pipe & Steel's printed names at $0: each is a "DS, Pipe, …" part the app already has (lib/digSetPipeMatch.ts). */
export const PIPES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'inv-1eef2011', name: '1-5/8" GALV x 6\' x 18ga-SPS' },
  { id: 'inv-4c9b61cd', name: '1-5/8" GALV x 7\' x 18ga-SPS' },
  { id: 'inv-6aabcc5d', name: '2-1/2" GALV x 6\' x 18ga-SPS' },
  { id: 'inv-f4a56afa', name: '2-1/2" GALV x 7\' x 18ga-SPS' },
  { id: 'inv-3cc0bc1b', name: 'PLY BLK 1-5/8" x 7\' x PP055' },
  { id: 'inv-6a0c822f', name: 'PLY BLK 2-1/2" x 6\' x PP055' },
  { id: 'inv-e9ec0077', name: 'PLY BLK 2-1/2" x 7\' x PP055' },
]

/** Aluminum Emily gates, 3-rail and 2-rail side by side: listed only. */
export const EMILY_GATES = ['al-g-44', 'al-2r-g-44', 'al-g-45', 'al-2r-g-45', 'al-g-46', 'al-2r-g-46'] as const

type Json = any
/** The app's part name match (materialCalculator.ts): spaces and capitals ignored. */
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '')

/**
 * Where each part is named in a record: every string in it, whole, equal to
 * the part's id or (by the app's name match) its name. Returns part id → places.
 */
export function partsNamedIn(parts: ReadonlyArray<{ id: string; name: string }>, where: string, value: unknown, out: Map<string, Set<string>>): void {
  const byId = new Map(parts.map(p => [p.id, p.id]))
  const byName = new Map(parts.map(p => [norm(p.name), p.id]))
  const seen = new Set<unknown>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const hit = byId.get(v) ?? byName.get(norm(v))
      if (hit) { if (!out.has(hit)) out.set(hit, new Set()); out.get(hit)!.add(where) }
      return
    }
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    for (const x of Object.values(v as Record<string, unknown>)) walk(x)
  }
  walk(value)
}

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

const say = (...a: unknown[]) => console.log(...a)
const usd = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'no price' }
const stop = (why: string): never => { console.error(`\nSTOPPED, nothing changed: ${why}`); process.exit(3) }
const statusOf = (i: Json) => i?.status || 'active'

async function main() {
  if (APPLY) {
    if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
    const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
    if (misuse) { console.error(misuse); process.exit(2) }
    assertLiveWriteAllowed('inventory-archive-2026-11-03.ts')
    if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
  }
  const prisma: Json = (await import('../src/server/lib/prisma.js')).default
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}\n`)
  const companies: Json[] = await prisma.businessState.findMany({ select: { accountId: true, config: true, pendingOrders: true, purchaseOrders: true, pullSheets: true } })
  if (companies.length !== 1) stop(`expected one company, found ${companies.length}.`)
  const b = companies[0]
  const accountId: string = b.accountId
  const inv: Json = await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true, version: true } }) ?? stop('no Inventory for the company.')
  const items: Json[] = Array.isArray(inv.items) ? inv.items : []
  const kits: Json[] = Array.isArray(inv.kits) ? inv.kits : []

  // Each part by id, with the name named here.
  const targets = [...GREEN.map(p => ({ ...p, group: 'Old green chain link' })), ...PIPES.map(p => ({ ...p, group: 'Vendor-printed pipe name' }))]
  if (targets.length !== 45 || new Set(targets.map(t => t.id)).size !== 45) stop('the list is not 45 different parts.')
  const problems: string[] = []
  const found = targets.map(t => {
    const hits = items.filter(i => i?.id === t.id)
    if (hits.length !== 1) problems.push(`${t.id} "${t.name}": ${hits.length ? `${hits.length} parts have this id` : 'not in Inventory'}`)
    else if (hits[0].name !== t.name) problems.push(`${t.id}: named "${hits[0].name}", not "${t.name}"`)
    const byName = items.filter(i => i?.id !== t.id && norm(i?.name) === norm(t.name))
    if (byName.length) problems.push(`"${t.name}" is also the name of ${byName.map(i => i.id).join(', ')}`)
    return { ...t, item: hits[0] as Json }
  })
  if (problems.length) stop(`parts not as named:\n  ${problems.join('\n  ')}`)

  // Used by anything? Every place a part can be named.
  const used = new Map<string, Set<string>>()
  const look = (where: string, v: unknown) => partsNamedIn(targets, where, v, used)
  const [quotes, jobs, quoted, takeoffs, changeOrders, pendingItems, vLines, vLinks, history, kv, options, webQuotes] = await Promise.all([
    prisma.savedQuote.findMany({ where: { accountId } }),
    prisma.savedJob.findMany({ where: { accountId } }),
    prisma.jobQuotedCost.findMany({ where: { accountId } }),
    prisma.jobTakeoff.findMany({ where: { accountId } }),
    prisma.changeOrder.findMany({ where: { accountId } }),
    prisma.inventoryPendingOrderItem.findMany({}),
    prisma.vendorInvoiceLine.findMany({ where: { invoice: { accountId } } }),
    prisma.vendorItemLink.findMany({ where: { accountId } }),
    prisma.priceHistory.findMany({ where: { accountId } }),
    prisma.accountKeyValue.findMany({ where: { accountId } }),
    prisma.quoteOption.findMany({}),
    prisma.ezBudgetQuote.findMany({}),
  ])
  for (const q of quotes) look(`saved quote ${q.id.slice(0, 8)} ${q.customerName ?? ''}${q.deletedAt ? ' (deleted)' : ''}`, q)
  for (const j of jobs) look(`job ${j.id.slice(0, 8)} ${j.customerName ?? ''}${j.deletedAt ? ' (deleted)' : ''}`, j)
  for (const k of kits) look(`saved kit "${k.name ?? k.styleName}"${k.archived ? ' (archived)' : ''}`, k)
  // Built-in kits (the coded styles with no saved kit), for every fence in Settings.
  const { builtInKitSet } = await import('../../web/src/materialKits.js')
  for (const s of (Array.isArray(b.config?.fenceStyles) ? b.config.fenceStyles : []) as Json[]) {
    if (!s?.name || kits.some(k => k.styleName === s.name)) continue
    const set = builtInKitSet(s.name)
    if (set) look(`built-in kit of ${s.name}`, set)
  }
  look('Settings', b.config)
  look('sales orders', b.pendingOrders)
  look('vendor orders', b.purchaseOrders)
  look('pull sheets', b.pullSheets)
  for (const r of quoted) look(`quoted cost of quote ${r.quoteId.slice(0, 8)}`, r)
  for (const r of takeoffs) look(`job takeoff ${r.jobId.slice(0, 8)}`, r)
  for (const r of changeOrders) look(`change order ${r.id.slice(0, 8)}`, r)
  for (const r of pendingItems) look(`material order line ${r.id.slice(0, 8)}`, r)
  // A vendor document line names a part by the one it is matched to; its description is the vendor's own print (where these 7 names came from).
  for (const r of vLines) look(`vendor document line ${r.id.slice(0, 8)} "${r.description}"`, { inventoryItemId: r.inventoryItemId, inventoryName: r.inventoryName })
  for (const r of vLinks) look(`vendor part link ${r.key}`, r)
  for (const r of history) look(`price history ${r.day}`, r)
  for (const r of kv) look(`${r.key}`, r.value)
  for (const r of options) look(`quote option ${r.id.slice(0, 8)}`, r)
  for (const r of webQuotes) look(`website quote ${r.id.slice(0, 8)}`, r)
  // Inventory itself: another part pointing at one of these (priced from it).
  for (const i of items) if (!targets.some(t => t.id === i?.id)) look(`Inventory part ${i?.id} "${i?.name}"`, i)
  if (used.size) stop(`${used.size} of these parts are used:\n  ${[...used].map(([id, w]) => `${id} "${targets.find(t => t.id === id)!.name}": ${[...w].join('; ')}`).join('\n  ')}`)

  // Before → after, each part.
  const todo = found.filter(f => statusOf(f.item) !== 'archived')
  for (const group of ['Old green chain link', 'Vendor-printed pipe name']) {
    const list = found.filter(f => f.group === group)
    say(`${group} (${list.length}):`)
    for (const f of list) {
      const was = statusOf(f.item)
      say(`  ${f.id.padEnd(13)} ${f.name.padEnd(58)} ${usd(f.item.unitCost).padStart(9)}  ${was === 'archived' ? 'archived (already)' : `${was} → archived`}`)
    }
    say('')
  }
  say(`Used by: nothing (saved quotes ${quotes.length}, jobs ${jobs.length}, saved kits ${kits.length}, built-in kits, sales orders, vendor orders, pull sheets, quoted costs ${quoted.length}, takeoffs ${takeoffs.length}, change orders ${changeOrders.length}, vendor document lines ${vLines.length}, vendor part links ${vLinks.length}, price history ${history.length}).`)

  // The Emily gates, for Jonathan to check (read only).
  say('\nAluminum Emily gates, for Jonathan to check (nothing changed):')
  say(`  ${'id'.padEnd(11)} ${'name'.padEnd(42)} ${'cost'.padStart(9)}  ${'vendor'.padEnd(14)} last changed`)
  for (const id of EMILY_GATES) {
    const i = items.find(x => x?.id === id)
    if (!i) { say(`  ${id.padEnd(11)} NOT IN INVENTORY`); continue }
    say(`  ${id.padEnd(11)} ${String(i.name).padEnd(42)} ${usd(i.unitCost).padStart(9)}  ${String(i.supplier || 'none').padEnd(14)} ${i.priceUpdatedAt || 'no date'}${i.priceImported ? ' (imported)' : ''}${statusOf(i) !== 'active' ? ` [${statusOf(i)}]` : ''}`)
  }

  if (!todo.length) { say('\nNothing to change: all 45 are archived.'); await prisma.$disconnect(); return }
  say(`\n${todo.length} part${todo.length === 1 ? '' : 's'} to archive${todo.length < 45 ? ` (${45 - todo.length} already archived)` : ''}.`)
  if (!APPLY) { say('Dry run: nothing changed.'); await prisma.$disconnect(); return }

  const ids = new Set(todo.map(f => f.id))
  const next = items.map(i => (ids.has(i?.id) ? { ...i, status: 'archived' } : i))
  // Only while Inventory is still on the version read: a save in between leaves it to run again.
  const r = await prisma.inventoryState.updateMany({ where: { accountId, version: inv.version }, data: { items: next, version: { increment: 1 } } })
  if (r.count !== 1) { say('\nInventory changed since it was read; left as it is. Run again.'); await prisma.$disconnect(); process.exit(3) }
  await auditSystem('update', 'InventoryState', accountId, {
    oldValues: { version: inv.version, parts: todo.map(f => ({ id: f.id, name: f.name, status: statusOf(f.item) })) },
    newValues: { version: inv.version + 1, status: 'archived', ids: [...ids], by: SCRIPT, why: 'Jonathan, Nov 3 2026 (item 31): "Archive the 38 green and 7 pipe parts now." Archived, not deleted; none is used by anything.' },
  })
  say(`\nDone: ${todo.length} archived.`)
  await prisma.$disconnect()
}

if (process.argv[1] && /inventory-archive-2026-11-03\.ts$/.test(process.argv[1])) main().catch(err => { console.error(err); process.exit(1) })
