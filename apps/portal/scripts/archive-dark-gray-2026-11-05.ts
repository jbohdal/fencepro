/**
 * Jonathan, Nov 5 2026: "archive the old Dark Gray, keeping the new one I
 * just added." The old color (key dark-gray, made Nov 2, switched off by
 * him) with its fences, material kits and catalog items, the same way
 * Settings → Price List → Vinyl Colors → Archive does (lib/vinylColors.ts
 * archiveVinylColor). The new one, "Dark Gray p" (key dark-gray-p), is not
 * touched. Quotes are not touched: Dave Diamond's sent quote keeps its price.
 *
 *   pnpm exec tsx scripts/archive-dark-gray-2026-11-05.ts                (shows what it would do)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/archive-dark-gray-2026-11-05.ts --apply --live
 *
 * Run again, it changes nothing (already archived).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const KEY = 'dark-gray', KEEP = 'dark-gray-p'
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('archive-dark-gray-2026-11-05.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { archiveCheck, archiveVinylColor } = await import('../src/server/lib/vinylColors.js')
  console.log(`Database: ${dbName}${APPLY ? '' : ' (shows what it would do, reads only)'}\n`)
  const owner = await prisma.crmUser.findFirst({ where: { role: 'super_admin', crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, firstName: true, lastName: true, crmAccountId: true } })
  if (!owner?.crmAccountId) { console.error('No owner login linked to a company.'); process.exit(2) }
  const accountId = owner.crmAccountId
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const colors = ((b?.config as any)?.fenceCatalog?.materials ?? []).find((m: any) => m?.key === 'vinyl')?.dims?.find((d: any) => d?.key === 'color')?.options ?? []
  const old = colors.find((o: any) => o.key === KEY), keep = colors.find((o: any) => o.key === KEEP)
  if (!old) { console.error(`No vinyl color "${KEY}". Nothing was changed.`); process.exit(2) }
  if (old.label !== 'Dark Gray' || !keep) { console.error(`Expected the old "Dark Gray" (${KEY}) and the new one (${KEEP}); found "${old.label}" and ${keep ? `"${keep.label}"` : 'no new one'}. Nothing was changed.`); process.exit(2) }
  if (old.archived) { console.log('The old Dark Gray is already archived. Nothing to do.'); return }
  const c = await archiveCheck(accountId, KEY)
  console.log(`Archive the old ${c.label}: ${c.fences.length} fences, ${c.kits} material kits, ${c.items} catalog items.`)
  for (const f of c.fences) console.log(`  ${f}`)
  console.log(`Keep their prices: ${c.keep.map(q => q.what).join('; ') || 'none'}`)
  if (c.blocking.length) { console.error(`Waiting for: ${c.blocking.map(q => q.what).join('; ')}. Nothing was changed.`); process.exit(2) }
  console.log(`Not touched: ${keep.label} (${KEEP}).`)
  if (!APPLY) return
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'Owner'
  const out = await archiveVinylColor({ accountId, userId: owner.id, name }, KEY, true)
  await auditSystem('soft_delete', 'VinylColor', KEY, { newValues: { archived: true, styles: out.styles, items: out.items, kits: out.kits, by: 'scripts/archive-dark-gray-2026-11-05.ts', why: 'Jonathan, Nov 5 2026: "archive the old Dark Gray, keeping the new one I just added."' } })
  console.log(`\nArchived: ${out.styles.length} fences, ${out.kits.length} kits, ${out.items.length} catalog items.`)
}

main().then(() => process.exit(0), err => { console.error(err); process.exit(1) })
