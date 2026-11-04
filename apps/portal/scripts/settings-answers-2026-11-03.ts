/**
 * Two Settings changes Jonathan approved on Nov 3 2026, saved together:
 *
 *   Item 6: Settings → Pricing → "Sub extra labor, per hour" = $30
 *     (pricing.subExtraHourRate). Set only while it is blank; another value
 *     stops it with nothing changed.
 *
 *   Item 12: "Yes, but first save No dig 14% and Dig set 10% as their own
 *     numbers so a material change doesn't wipe the install difference. Show
 *     me before and after for every fence."
 *     Today each fence's Target Profit is the number saved on the fence
 *     (No dig 14, Dig set 10 on Vinyl and Wood). This saves 14 on the No dig
 *     choice and 10 on the Dig set choice of each material whose No dig
 *     fences are all at 14 and Dig set fences all at 10 (counting the fences
 *     the choice's number reaches: not one with its own number, or whose
 *     color or a nearer choice sets one) (Settings → Fence
 *     styles, the choice's "Pricing for every fence with No dig"; fenceRates.ts).
 *     A choice is nearer a fence than its material, so a number later set on
 *     the material no longer moves them. A material at other numbers (Chain
 *     link and Aluminum: 12 both) is left as it is and listed; one partly at
 *     14 / 10 stops it. Every fence's Target Profit, Target Margin and the
 *     Settings screen's 100 ft + 1 walk gate price must come out exactly the
 *     same, or it stops with nothing changed: only where the number lives
 *     changes. The before and after of every fence is printed.
 *
 *   pnpm exec tsx scripts/settings-answers-2026-11-03.ts                    dry run (default): reads only
 *   pnpm exec tsx scripts/settings-answers-2026-11-03.ts --apply            does it (dev)
 *   EZBIZ_LIVE_WRITE_OK=1 pnpm exec tsx scripts/settings-answers-2026-11-03.ts --apply --live
 *                                                    on live: from ~/ezbiz/apps/portal, after a backup
 *                                                    (bash ~/ezbiz/deploy/mac/backup.sh, under 30 minutes old)
 *
 * Settings are read the way the app reads them (lib/quotePricing.ts dataFor:
 * the saved config with the live Overhead % in use, Inventory and kits;
 * web/src/estimate.ts estimateConfig), and written as the Settings screen
 * saves them: only while still on the version read, the version goes up by
 * one (open phones read the new one). One audit log entry. Run again, it
 * changes nothing.
 */

import 'dotenv/config'
import { liveDatabaseMisuse, databaseNameOf, LIVE_DATABASE_NAME } from '../src/server/lib/liveGuard.js'
import { assertLiveWriteAllowed } from '../src/server/lib/liveWriteGuard.js'
import { estimateConfig } from '../../web/src/estimate.js'
import { catalogOf, materialOf, styleChoicesOf, optionOf, type FenceCatalog } from '../../web/src/fenceCatalog.js'
import { optionRate, withRate, followedRates, ownsProfit } from '../../web/src/fenceRates.js'
import { earnedProfitPct, targetMarginPct } from '../../web/src/targetMargin.js'
import { profitShown, example100ft, fenceName } from '../../web/src/fenceSettingsView.js'
import { setMaterialPriceSource, inventoryPriceSource } from '../../web/src/materialCalculator.js'
import { setSavedKitSets } from '../../web/src/materialKits.js'

const SCRIPT = 'scripts/settings-answers-2026-11-03.ts'
export const SUB_EXTRA_HOUR_RATE = 30
/** The install choices and the Target Profit each keeps as its own number. */
export const INSTALL_PROFIT: Readonly<Record<'nd' | 'ds', number>> = { nd: 14, ds: 10 }

type Json = any

/** One fence before and after. */
export interface FenceRow {
  name: string; material: string; install: string
  profit: [number | undefined, number | undefined]
  from: [string, string]
  margin: [number, number]
  price: [string, string]
  same: boolean
}

export interface InstallPlan {
  /** Settings with the install choices' own numbers (unchanged when there is nothing to save). */
  next: Json
  /** What is saved: "Vinyl: No dig 14". Empty when already done. */
  saves: string[]
  /** Materials left as they are, with why. */
  left: string[]
  /** Materials partly at 14 / 10: it stops. */
  mixed: string[]
  rows: FenceRow[]
}

const exampleWords = (e: ReturnType<typeof example100ft>): string => (!e ? 'none' : 'cannot' in e ? `can't be quoted` : `$${(e.priceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

/**
 * Item 12 worked out on Settings as the app reads them (saved config, with
 * the live Overhead % on it when live overhead is on). Pure: Inventory's price
 * source and kits must be set first for the 100 ft prices (as estimate.ts does).
 */
export function planInstallProfits(saved: Json): InstallPlan {
  const before = estimateConfig(saved)
  const catalog = catalogOf(before)
  const left: string[] = [], mixed: string[] = [], saves: string[] = []
  const next: FenceCatalog = JSON.parse(JSON.stringify(catalogOf(saved)))
  for (const m of catalog.materials) {
    const dim = m.dims.find(d => d.key === 'install')
    if (!dim || !optionOf(m, 'install', 'nd') || !optionOf(m, 'install', 'ds')) continue
    // The fences the install choice's number would reach (fenceRates.ts order): not one with its own
    // number, nor one whose color or a nearer choice sets one. Marked with a number no one types.
    const MARK = 79.987
    const marked = { ...m, dims: m.dims.map(d => (d.key !== 'install' ? d : { ...d, options: d.options.map(o => ({ ...o, rateDefaults: withRate(o.rateDefaults, 'targetProfitPct', MARK) })) })) }
    const earned = (key: 'nd' | 'ds') => before.fenceStyles
      .filter(s => { const sc = styleChoicesOf(s); return sc?.material === m.key && sc.choices.install === key && !ownsProfit(s) && followedRates(marked, sc.choices).targetProfitPct?.value === MARK })
      .map(s => earnedProfitPct(s))
    const nd = earned('nd'), ds = earned('ds')
    const words = (key: 'nd' | 'ds', v: Array<number | undefined>) => `${optionOf(m, 'install', key)!.label} ${[...new Set(v)].map(x => (x === undefined ? 'none' : `${x}%`)).join(' / ') || 'no fences'}`
    const all = (v: Array<number | undefined>, want: number) => v.length > 0 && v.every(x => x === want)
    const any = (v: Array<number | undefined>, want: number) => v.some(x => x === want)
    if (all(nd, INSTALL_PROFIT.nd) && all(ds, INSTALL_PROFIT.ds)) {
      const nm = next.materials.find(x => x.key === m.key)!
      for (const key of ['nd', 'ds'] as const) {
        const opt = nm.dims.find(d => d.key === 'install')!.options.find(o => o.key === key)!
        if (optionRate(opt, 'targetProfitPct') === INSTALL_PROFIT[key]) continue
        opt.rateDefaults = withRate(opt.rateDefaults, 'targetProfitPct', INSTALL_PROFIT[key])
        saves.push(`${m.label}: ${opt.label} ${INSTALL_PROFIT[key]}%`)
      }
    } else if (any(nd, INSTALL_PROFIT.nd) || any(ds, INSTALL_PROFIT.ds)) {
      mixed.push(`${m.label}: ${words('nd', nd)}, ${words('ds', ds)}`)
    } else {
      left.push(`${m.label}: ${words('nd', nd)}, ${words('ds', ds)} (not 14% / 10%: left as it is)`)
    }
  }
  const nextSaved = saves.length ? { ...saved, fenceCatalog: next } : saved
  const after = estimateConfig(nextSaved)
  const afterById = new Map(after.fenceStyles.map(s => [s.id, s]))
  const rows: FenceRow[] = before.fenceStyles.map(b => {
    const a = afterById.get(b.id)
    const sc = styleChoicesOf(b)
    const mb = materialOf(catalog, sc?.material), ma = materialOf(catalogOf(after), sc?.material)
    const install = sc?.choices.install ? optionOf(mb, 'install', sc.choices.install)?.label ?? sc.choices.install : '-'
    const pb = earnedProfitPct(b), pa = a ? earnedProfitPct(a) : undefined
    const eb = example100ft(b, before), ea = a ? example100ft(a, after) : null
    const xb = exampleWords(eb), xa = a ? exampleWords(ea) : 'missing'
    const row: FenceRow = {
      name: fenceName(b), material: mb?.label ?? sc?.material ?? b.category, install,
      profit: [pb, pa],
      from: [profitShown(b, mb).from, a ? profitShown(a, ma).from : 'missing'],
      margin: [targetMarginPct(b), a ? targetMarginPct(a) : NaN],
      price: [xb, xa],
      // The whole example (cost, price, or why it cannot be quoted), not only the words shown.
      same: !!a && pb === pa && b.margin === a.margin && JSON.stringify(eb) === JSON.stringify(ea),
    }
    return row
  })
  return { next: nextSaved, saves, left, mixed, rows }
}

/** Item 6: the extra hour rate, blank (never typed, or cleared) or a number. */
export function subExtraHourRateOf(saved: Json): number | null | 'other' {
  const v = saved?.pricing?.subExtraHourRate
  if (v === undefined || v === null || v === '') return null
  return typeof v === 'number' && Number.isFinite(v) ? v : 'other'
}

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const dbUrl = process.env.DATABASE_URL || ''
const dbName = databaseNameOf(dbUrl)
const say = (...a: unknown[]) => console.log(...a)
const stop = (why: string): never => { console.error(`\nSTOPPED, nothing changed: ${why}`); process.exit(3) }
const pct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? 'none' : `${Math.round(v * 100) / 100}%`)

async function main() {
  if (APPLY) {
    if (dbName === 'ezbiz_livecopy') { console.error('DATABASE_URL names "ezbiz_livecopy", the read only copy of live: dry runs only. Nothing was changed.'); process.exit(2) }
    const misuse = liveDatabaseMisuse(dbUrl, process.cwd())
    if (misuse) { console.error(misuse); process.exit(2) }
    assertLiveWriteAllowed('settings-answers-2026-11-03.ts')
    if (dbName === LIVE_DATABASE_NAME && !args.includes('--live')) { console.error(`DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". With a fresh backup and Jonathan's OK, add --live.`); process.exit(2) }
  }
  const prisma: Json = (await import('../src/server/lib/prisma.js')).default
  const { dataFor } = await import('../src/server/lib/quotePricing.js')
  const { auditSystem } = await import('../src/server/lib/auditLog.js')
  say(`Database: ${dbName}${APPLY ? '' : ' (dry run, reads only)'}\n`)
  const rows: Json[] = await prisma.businessState.findMany({ select: { accountId: true, config: true, version: true } })
  if (rows.length !== 1) stop(`expected one company, found ${rows.length}.`)
  const b = rows[0]
  const saved: Json = b.config
  if (!saved || !Array.isArray(saved.fenceCatalog?.materials) || !saved.fenceCatalog.materials.length) stop('Settings have no saved fence choice tree (Settings → Fence styles).')

  // Item 6.
  const rate = subExtraHourRateOf(saved)
  if (rate === 'other') stop(`"Sub extra labor, per hour" is saved as ${JSON.stringify(saved.pricing.subExtraHourRate)}, not a number.`)
  if (rate !== null && rate !== SUB_EXTRA_HOUR_RATE) stop(`"Sub extra labor, per hour" is $${rate}, not blank.`)
  say(`Item 6. Settings → Pricing → Sub extra labor, per hour: ${rate === null ? `blank → $${SUB_EXTRA_HOUR_RATE}` : `$${rate} (already done)`}`)

  // Item 12, on Settings as the app reads them: the live Overhead % in use, Inventory prices and kits.
  const data = await dataFor(b.accountId)
  setMaterialPriceSource(data.inventory.length ? inventoryPriceSource(data.inventory as never) : null)
  setSavedKitSets(() => data.kits as never)
  const plan = planInstallProfits(data.config)
  say(`\nItem 12. Target Profit on the install choices (Settings → Fence styles):`)
  for (const s of plan.saves) say(`  save ${s}`)
  if (!plan.saves.length && !plan.mixed.length) say('  nothing to save (already saved)')
  for (const l of plan.left) say(`  ${l}`)

  const w = { name: Math.max(...plan.rows.map(r => r.name.length), 4), mat: 9, inst: 7, from: Math.max(...plan.rows.map(r => r.from[0].length), 4) }
  say(`\nEvery fence, before → after (Target Margin = Overhead + Target Profit; price: ${'100 ft with 1 walk gate'}):`)
  say(`  ${'Fence'.padEnd(w.name)}  ${'Material'.padEnd(w.mat)}  ${'Install'.padEnd(w.inst)}  ${'Target Profit'.padEnd(13)}  ${'From'.padEnd(w.from)} → ${'from'.padEnd(18)}  ${'Target Margin'.padEnd(15)}  Price`)
  for (const r of plan.rows) {
    say(`  ${r.name.padEnd(w.name)}  ${r.material.padEnd(w.mat)}  ${r.install.padEnd(w.inst)}  ${`${pct(r.profit[0])} → ${pct(r.profit[1])}`.padEnd(13)}  ${r.from[0].padEnd(w.from)} → ${r.from[1].padEnd(18)}  ${`${pct(r.margin[0])} → ${pct(r.margin[1])}`.padEnd(15)}  ${r.price[0]} → ${r.price[1]}${r.same ? '' : '   DIFFERS'}`)
  }
  const moved = plan.rows.filter(r => r.from[0] !== r.from[1]).length
  say(`\n  ${plan.rows.length} fences: ${plan.rows.filter(r => r.same).length} the same Target Profit, Target Margin and price; ${moved} change where their Target Profit comes from.`)

  if (plan.mixed.length) stop(`some materials are partly at No dig 14% / Dig set 10%; which number is meant for them is Jonathan's call:\n  ${plan.mixed.join('\n  ')}`)
  const differ = plan.rows.filter(r => !r.same)
  if (differ.length) stop(`${differ.length} fence${differ.length === 1 ? '' : 's'} would change Target Profit, Target Margin or price: ${differ.map(r => r.name).join(', ')}.`)

  if (rate === SUB_EXTRA_HOUR_RATE && !plan.saves.length) { say('\nNothing to change.'); await prisma.$disconnect(); return }
  if (!APPLY) { say('\nDry run: nothing changed.'); await prisma.$disconnect(); return }

  // Saved Settings as they are on file (not the read view with the live Overhead % on it), with the two changes.
  const config = {
    ...saved,
    pricing: { ...(saved.pricing ?? {}), subExtraHourRate: SUB_EXTRA_HOUR_RATE },
    ...(plan.saves.length ? { fenceCatalog: plan.next.fenceCatalog } : {}),
  }
  const n = await prisma.businessState.updateMany({ where: { accountId: b.accountId, version: b.version }, data: { config, version: { increment: 1 } } })
  if (n.count !== 1) { say('\nSettings changed since they were read; left as they are. Run again.'); await prisma.$disconnect(); process.exit(3) }
  await auditSystem('update', 'BusinessState', b.accountId, {
    oldValues: { 'pricing.subExtraHourRate': rate, installTargetProfit: 'not set (each fence used the number saved on it)', version: b.version },
    newValues: {
      'pricing.subExtraHourRate': SUB_EXTRA_HOUR_RATE, installTargetProfit: plan.saves, version: b.version + 1, by: SCRIPT,
      why: 'Jonathan, Nov 3 2026: item 6, sub extra labor $30 an hour; item 12, No dig 14% and Dig set 10% saved as their own numbers so a material change does not wipe the install difference. Every fence keeps its Target Profit, Target Margin and price.',
    },
  })
  say('\nDone.')
  await prisma.$disconnect()
}

if (process.argv[1] && /settings-answers-2026-11-03\.ts$/.test(process.argv[1])) main().catch(err => { console.error(err); process.exit(1) })
