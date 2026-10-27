/**
 * Automation tasks left open before Oct 27 2026 (recheck gap 1): the
 * "Signed Contract" rule's "File the fence permit for …", "Schedule the
 * install for …" and "Order materials for …" never closed, so they piled up on
 * the office's Today even after the permit was Approved, the job was
 * scheduled, or the job was Paid. The app now closes them by itself
 * (lib/taskAutoClose.ts); this closes the ones already open whose job says
 * they are done, with the app's own check, and says why on each.
 *
 *   npx tsx scripts/task-close-backfill.ts             lists each task it would close and why; writes nothing
 *   npx tsx scripts/task-close-backfill.ts --apply     closes them in DATABASE_URL
 *   ... --apply --live                                 required as well for the live database, with
 *                                                      EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('task-close-backfill.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { closeFinishedTasks } = await import('../src/server/lib/taskAutoClose.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run: nothing is written)'}`)
  const r = await closeFinishedTasks({ dryRun: !APPLY })
  const byReason = new Map<string, number>()
  for (const t of r.closed) {
    console.log(`  ${APPLY ? 'closed' : 'would close'}: "${t.title}" (${t.customer || 'no name'}, job ${t.jobId}): ${t.reason}`)
    const key = t.reason.replace(/ \d{2}\/\d{2}\/\d{4}/g, ' <date>')
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }
  console.log(`\nOpen tasks made by an automation: ${r.open}`)
  console.log(`  that ask for a permit, a schedule or materials: ${r.checked}`)
  console.log(`  whose job could not be found (deleted, or the card has no job): ${r.noJob}`)
  console.log(`  still to do: ${r.stillOpen}`)
  console.log(`  ${APPLY ? 'closed' : 'would close'}: ${r.closed.length}`)
  for (const [why, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${n} × ${why}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
