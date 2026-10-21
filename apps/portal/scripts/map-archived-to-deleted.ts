/**
 * Turn the rows the old Delete button archived into real deletes (Settings >
 * Deleted Records), with their cards, quotes and jobs. See
 * src/server/lib/archivedToDeleted.ts for exactly which rows move and why.
 *
 *   npx tsx scripts/map-archived-to-deleted.ts            plan only, reads, writes nothing
 *   npx tsx scripts/map-archived-to-deleted.ts --apply    writes to the database in DATABASE_URL
 *   ... --apply --live                                    required as well for the live database
 *
 * Safe to run twice: a company already done is skipped.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('map-archived-to-deleted.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

async function main() {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { archivedToDeletedPlan, applyArchivedToDeleted } = await import('../src/server/lib/archivedToDeleted.js')
  const { move, stay } = await archivedToDeletedPlan()
  console.log(`Database "${dbName}", ${APPLY ? 'APPLY' : 'plan only'}`)
  const count = (xs: Array<{ type: string }>) => ['customer', 'quote', 'job'].map(t => `${xs.filter(x => x.type === t).length} ${t}s`).join(', ')
  console.log(`To deleted: ${count(move)} (${move.filter(m => m.why === 'delete button').length} by the old Delete button, ${move.filter(m => m.why === 'scheduled deletion').length} waiting in a scheduled deletion)`)
  for (const m of move) console.log(`  ${m.type} ${m.id} archived ${m.archivedAt.toISOString().slice(0, 10)} (${m.why})`)
  console.log(`Stay archived: ${count(stay)}`)
  for (const s of stay) console.log(`  ${s.type} ${s.id} archived ${s.archivedAt.toISOString().slice(0, 10)}`)
  if (APPLY) {
    const out = await applyArchivedToDeleted()
    for (const o of out) console.log('moved' in o ? `${o.accountId}: ${o.moved} moved to Deleted Records` : `${o.accountId}: already done`)
  }
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
