/**
 * Jobs whose Sales Order was marked Ordered or Received before Oct 27 2026,
 * when the job's materials did not follow the order (review Oct 27 2026): the
 * job still says "Materials: not ordered" (job page, Materials Confirmed
 * milestone, Schedule window). This raises each such job's materials to what
 * its orders say, with the app's own code (lib/materialsFromOrders.ts), never
 * backward: a job already received or loaded is left as it is.
 *
 *   npx tsx scripts/materials-from-orders-backfill.ts             lists each job and what would change; writes nothing
 *   npx tsx scripts/materials-from-orders-backfill.ts --apply     makes the changes in DATABASE_URL
 *   ... --apply --live                                            required as well for the live database, with
 *                                                                 EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 */

import 'dotenv/config'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('materials-from-orders-backfill.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

const WORDS: Record<string, string> = { not_ordered: 'not ordered', ordered: 'ordered', received: 'received', loaded: 'loaded' }

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { materialsFollowOrders } = await import('../src/server/lib/materialsFromOrders.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run: nothing is written)'}`)
  const states = await prisma.businessState.findMany({ select: { accountId: true, pendingOrders: true } })
  let n = 0
  for (const st of states) {
    const changes = await materialsFollowOrders(st.accountId, null, st.pendingOrders, { dryRun: !APPLY, by: 'materials-from-orders-backfill' })
    for (const c of changes) {
      n++
      const stage = c.stageFrom !== c.stageTo ? `; Operations stage ${c.stageFrom} -> ${c.stageTo}` : ''
      console.log(`${c.customer || '(no name)'} (job ${c.jobId}): materials ${WORDS[c.from] ?? c.from} -> ${WORDS[c.to]}${stage}${APPLY ? ' (done)' : ''}`)
    }
  }
  console.log(`\n${n} job${n === 1 ? '' : 's'} ${APPLY ? 'brought up to date' : 'would change'}.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
