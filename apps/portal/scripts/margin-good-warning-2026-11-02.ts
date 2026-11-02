/**
 * Settings > Pricing > Margin Thresholds: the "good" margin from 34% to 39.6%,
 * so a low quote shows a warning in the quote builder.
 *
 *   pnpm exec tsx scripts/margin-good-warning-2026-11-02.ts            dry run (default): reads only
 *   pnpm exec tsx scripts/margin-good-warning-2026-11-02.ts --apply    does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/margin-good-warning-2026-11-02.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *
 * Jonathan, Nov 2 2026: "Raise the 'good' margin warning to 39.6% so a low
 * quote shows a warning in the builder."
 *
 * It is config.margins.good on the company's BusinessState. Written as the
 * Settings screen saves it: only while still on the version read, the version
 * goes up by one (open phones read the new one), one audit entry. Only "good"
 * changes ("warning" stays). Run again, it changes nothing. Typing 39.6 in the
 * Settings screen does exactly the same.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const OLD = 0.34, NEW = 0.396
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('margin-good-warning-2026-11-02.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

type Json = any

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  console.log(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}`)
  const rows: Json[] = await prisma.businessState.findMany({ select: { accountId: true, config: true, version: true } })
  if (rows.length !== 1) { console.error(`Expected one company, found ${rows.length}. Nothing was changed.`); process.exit(3) }
  const b = rows[0]
  const was = b.config?.margins?.good
  console.log(`  good margin: ${was == null ? 'not saved' : `${was * 100}%`} → ${NEW * 100}%   warning stays ${b.config?.margins?.warning == null ? 'as is' : `${b.config.margins.warning * 100}%`}`)
  if (was === NEW) { console.log('Nothing to change.'); await prisma.$disconnect(); return }
  if (was !== OLD) { console.error(`It is not ${OLD * 100}% as expected. Nothing was changed.`); process.exit(3) }
  if (!APPLY) { console.log('Dry run: nothing changed.'); await prisma.$disconnect(); return }
  const config = { ...b.config, margins: { ...b.config.margins, good: NEW } }
  const n = await prisma.businessState.updateMany({ where: { accountId: b.accountId, version: b.version }, data: { config, version: { increment: 1 } } })
  if (n.count !== 1) { console.error('Changed since it was read; left as it is. Run it again.'); process.exit(3) }
  await auditSystem('update', 'BusinessState', b.accountId, { oldValues: { 'margins.good': OLD, version: b.version }, newValues: { 'margins.good': NEW, version: b.version + 1, by: 'scripts/margin-good-warning-2026-11-02.ts', why: "The builder's good margin warning (Jonathan, Nov 2 2026)" } })
  console.log('Done.')
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
