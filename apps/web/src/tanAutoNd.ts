/**
 * Tan no dig, 6 or 8 ft sections (best price): "TV-Auto ND Privacy". White
 * has a best price fence for No dig and Dig set; Tan had one for Dig set only
 * (Jonathan, Nov 2 2026: "every color should work the same way"). The rail
 * optimizer picks 6 or 8 ft per run, as on WV-Auto ND; the parts per width
 * are the TV-ND 6'x6' and 6'x8' lists (materialCalculator, materialKits MIXED
 * already had it).
 *
 * planTanAutoNd adds the style to a company's saved Settings that do not have
 * it, the same way planTanAutoDs adds Tan dig set: the man hours, Target
 * Profit %, margin, sub rate, price per foot and availability of that
 * company's own TV-ND 6'x6' style (TV-ND 6'x8' if there is no 6'x6').
 * Nothing else changes. Pure; the server runs it once per company
 * (lib/tanAutoNdSeed.ts).
 */

import type { FenceStyle } from './configStore'
import type { TanAutoDsPlan } from './tanAutoDs'

export const TAN_AUTO_ND = 'TV-Auto ND Privacy'
export const TAN_AUTO_ND_SOURCES = ["TV-ND 6'x6' Privacy", "TV-ND 6'x8' Privacy"] as const

export function planTanAutoNd(styles0: FenceStyle[]): TanAutoDsPlan {
  const styles: FenceStyle[] = JSON.parse(JSON.stringify(styles0))
  if (styles.some(s => s.name === TAN_AUTO_ND)) return { fenceStyles: styles, added: null, copiedFrom: null, skipped: 'already in Settings' }
  const src = TAN_AUTO_ND_SOURCES.map(n => styles.find(s => s.name === n)).find(Boolean)
  if (!src) return { fenceStyles: styles, added: null, copiedFrom: null, skipped: 'no TV-ND 6\'x6\' or 6\'x8\' style to copy the settings from' }
  const style: FenceStyle = {
    id: 'auto-tv-nd', name: TAN_AUTO_ND, category: src.category, margin: src.margin,
    ...(typeof src.targetProfitPct === 'number' ? { targetProfitPct: src.targetProfitPct } : {}),
    sectionsPerMH: src.sectionsPerMH, panelWidth: 6, mhPerWalkGate: src.mhPerWalkGate, mhPerDblGate: src.mhPerDblGate,
    isActive: src.isActive !== false, ...(src.quotable === false ? { quotable: false } : {}),
    ...(src.subRate !== undefined ? { subRate: src.subRate } : {}), ...(src.pricePerFoot !== undefined ? { pricePerFoot: src.pricePerFoot } : {}),
    autoRailMix: true, installMethod: 'no-dig', colorFamily: 'tan',
    material: 'vinyl', choices: { color: 'tan', style: 'privacy', width: 'auto', height: '6', install: 'nd' },
  }
  if (styles.some(s => s.id === style.id)) style.id = `auto-tv-nd-${Date.now().toString(36)}`
  // Next to the other best price styles, as in the defaults.
  let at = -1
  styles.forEach((s, i) => { if (s.autoRailMix) at = i })
  styles.splice(at + 1, 0, style)
  return { fenceStyles: styles, added: TAN_AUTO_ND, copiedFrom: src.name }
}
