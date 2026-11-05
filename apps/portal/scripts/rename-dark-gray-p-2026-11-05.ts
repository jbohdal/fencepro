/**
 * Jonathan, Nov 5 2026: "Rename 'Dark Gray p' to 'Dark Gray' everywhere
 * customers see it (no sent quotes use it yet)." The same save as Settings →
 * Price List → Vinyl Colors → Edit with the new name (lib/vinylColors.ts
 * saveVinylColor): the color's name becomes "Dark Gray"; its Inventory parts
 * keep their "Dark Gray p" names (the archived old Dark Gray has the plain
 * names), so no part, kit, fence or price changes. The dry run proves that.
 *
 *   pnpm exec tsx scripts/rename-dark-gray-p-2026-11-05.ts                (shows what it would do)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/rename-dark-gray-p-2026-11-05.ts --apply --live
 *
 * Run again, it changes nothing (already renamed).
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { auditSystem } from '../src/server/lib/auditLog.js'

const KEY = 'dark-gray-p', FROM = 'Dark Gray p', TO = 'Dark Gray'
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)

if (APPLY) {
  const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }
  assertLiveWriteAllowed('rename-dark-gray-p-2026-11-05.ts')
  if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
}

// Key order inside a saved object is the database's own; what is in it is compared.
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canon((v as any)[k])])) : v
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const noStamp = (kits: any[]) => kits.map(k => ({ ...k, updatedAt: null }))

async function main() {
  const prisma = (await import('../src/server/lib/prisma.js')).default
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const { saveVinylColor, quotesUsing } = await import('../src/server/lib/vinylColors.js')
  const m = await pricingModule() as any
  console.log(`Database: ${dbName}${APPLY ? '' : ' (shows what it would do, reads only)'}\n`)
  const owner = await prisma.crmUser.findFirst({ where: { role: 'super_admin', crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, firstName: true, lastName: true, crmAccountId: true } })
  if (!owner?.crmAccountId) { console.error('No owner login linked to a company.'); process.exit(2) }
  const accountId = owner.crmAccountId
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const inv = await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
  const cfg = (b?.config ?? {}) as any
  const st = { fenceStyles: cfg.fenceStyles ?? [], fenceCatalog: m.fenceCatalogOf(cfg), items: (inv?.items ?? []) as any[], kits: (inv?.kits ?? []) as any[] }
  const opt = st.fenceCatalog.materials.find((x: any) => x.key === 'vinyl')?.dims.find((d: any) => d.key === 'color')?.options.find((o: any) => o.key === KEY)
  if (!opt) { console.error(`No vinyl color "${KEY}". Nothing was changed.`); process.exit(2) }
  if (opt.label === TO) { console.log(`Already called ${TO}. Nothing to do.`); return }
  if (opt.label !== FROM) { console.error(`Expected "${FROM}", found "${opt.label}". Nothing was changed.`); process.exit(2) }
  const styles = st.fenceStyles.filter((s: any) => s?.choices?.color === KEY).map((s: any) => s.name)
  const used = await quotesUsing(prisma, accountId, styles, false)
  console.log(`Quotes and jobs on ${FROM}: ${used.map(u => u.what).join('; ') || 'none'}`)
  const input = { ...m.inputFromColor(st, KEY), name: TO }
  const plan = m.planVinylColor(st, input, { today: new Date().toISOString().slice(0, 10), newId: (p: string) => `${p}_dry`, key: KEY })
  const ok = same(plan.state.items, st.items) && same(noStamp(plan.state.kits), noStamp(st.kits)) && same(plan.state.fenceStyles, st.fenceStyles) && plan.priced.length === 0 && plan.tallPrices.length === 0
  const labels = m.styleLabels({ ...cfg, fenceCatalog: plan.state.fenceCatalog }, { inventory: st.items, kits: st.kits }) as Record<string, string>
  console.log(`Rename ${FROM} → ${TO}. Fences will read:`)
  for (const s of styles) console.log(`  ${labels[s]}`)
  console.log(`Parts, kits, fences and costs unchanged: ${ok ? 'yes' : 'NO'}`)
  if (!ok) {
    const diff = (what: string, a: any[], b: any[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (!same(a[i], b[i])) console.log(`  ${what} differs: ${JSON.stringify(b[i])?.slice(0, 300)}\n    was: ${JSON.stringify(a[i])?.slice(0, 300)}`) }
    diff('part', st.items, plan.state.items); diff('kit', noStamp(st.kits), noStamp(plan.state.kits)); diff('fence', st.fenceStyles, plan.state.fenceStyles)
    if (plan.priced.length) console.log(`  costs: ${JSON.stringify(plan.priced)}`)
  }
  if (!ok) { console.error('The save would change more than the name. Nothing was changed.'); process.exit(2) }
  if (!APPLY) return
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || 'Owner'
  const out = await saveVinylColor({ accountId, userId: owner.id, name }, input, KEY)
  await auditSystem('update', 'VinylColor', KEY, { oldValues: { label: FROM }, newValues: { label: TO, renamed: { from: FROM, to: TO }, by: 'scripts/rename-dark-gray-p-2026-11-05.ts', why: 'Jonathan, Nov 5 2026: "Rename \'Dark Gray p\' to \'Dark Gray\' everywhere customers see it."' } })
  console.log(`\n${out.message}`)
}

main().then(() => process.exit(0), err => { console.error(err); process.exit(1) })
