/**
 * Add a vinyl color the way Settings → Price List → Vinyl Colors → Add Color
 * does (the same server function, lib/vinylColors.ts saveVinylColor), for a
 * company where clicking through the form is not wanted.
 *
 *   npx tsx scripts/add-vinyl-color.ts --chai-gray                 shows what it would make, writes nothing
 *   npx tsx scripts/add-vinyl-color.ts --input color.json          the same, from a form's answers (VinylColorInput, cents)
 *   ... --apply                                                    writes to the database in DATABASE_URL
 *   ... --apply --live                                             required as well for the live database, with
 *                                                                  EZBIZ_LIVE_WRITE_OK=1 and a backup from the last 30 minutes
 *
 * --chai-gray is Jonathan's Chai Gray (Oct 21, 2026): per section, 6x8,
 * $184.00 a section with 15 pickets, 2 rails at 8 ft, 3 picket stiffeners,
 * 1 rail stiffener and 2 U channel; one post price $38.92 (78" ND, 102" DS),
 * cap $3.86, gate upright $13.36; ND and DS. Refused if a color of that name
 * is already there. Undo it in the app (Price List → Vinyl Colors) within 24 hours.
 */

import 'dotenv/config'
import fs from 'fs'
import { liveDatabaseMisuse, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'

const APPLY = process.argv.includes('--apply')
if (APPLY) assertLiveWriteAllowed('add-vinyl-color.ts')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = (() => { try { return decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) } catch { return '' } })()
const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
if (misuse) { console.error(misuse); process.exit(2) }
if (APPLY && dbName === LIVE_DATABASE_NAME && !process.argv.includes('--live')) {
  console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". Take a backup, then add --live.`)
  process.exit(2)
}

const CHAI_GRAY = {
  name: 'Chai Gray', mode: 'section', sizes: ['6x8'], methods: ['nd', 'ds'], samePostPrice: true,
  posts: { '6': { allCents: 3892 } }, capCents: 386, uprightCents: 1336,
  sections: { '6x8': { costCents: 18400, pickets: 15, rails: 2, railFt: 8, picketStiffeners: 3, railStiffeners: 1, uChannels: 2 } },
}

async function main() {
  const at = process.argv.indexOf('--input')
  const input = process.argv.includes('--chai-gray') ? CHAI_GRAY : at > 0 ? JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) : null
  if (!input) { console.error('Say which color: --chai-gray, or --input <file.json>.'); process.exit(2) }
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const accountId = await resolveIntakeAccountId()
  if (!accountId) { console.error('No company is set up in this database.'); process.exit(2) }
  console.log(`Vinyl color "${input.name}", database "${dbName}", company ${accountId}, ${APPLY ? 'APPLY' : 'plan only'}`)
  // The plan, from the saved Settings and Inventory, as the form would make it.
  const m = await pricingModule() as any
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const inv = await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
  const cfg = (b?.config ?? {}) as any
  const plan = m.planVinylColor({ fenceStyles: cfg.fenceStyles ?? [], fenceCatalog: m.fenceCatalogOf(cfg), items: inv?.items ?? [], kits: inv?.kits ?? [] }, input, { today: 'plan', newId: (p: string) => `${p}_plan` })
  console.log(`  fences: ${plan.created.styles.map((s: any) => s.label).join('; ')}`)
  console.log(`  kit sets: ${plan.created.kits.length}`)
  for (const i of plan.created.items) console.log(`  catalog item: ${i.name}  ${i.cents == null ? '$0 (in the section kit)' : `$${(i.cents / 100).toFixed(2)}`}`)
  if (!APPLY) { console.log('\nNothing was written. Add --apply to make it.'); await prisma.$disconnect(); return }
  const { saveVinylColor } = await import('../src/server/lib/vinylColors.js')
  const out = await saveVinylColor({ accountId, userId: null, name: 'add-vinyl-color script' }, input)
  console.log(`\n${out.message}`)
  console.log(`Undo in the app until ${out.record.undoUntil} (Settings → Price List → Vinyl Colors).`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err?.message || err); process.exit(1) })
