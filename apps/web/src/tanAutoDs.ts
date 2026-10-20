/**
 * Tan dig set, 6 or 8 ft panels (best price): "TV-Auto DS Privacy". The rail
 * optimizer picks 6 or 8 ft per run, as on WV-Auto DS; the parts per width are
 * the TV-DS 6'x6' and 6'x8' lists (materialCalculator, materialKits MIXED).
 *
 * planTanAutoDs adds the style to a company's saved Settings that do not have
 * it, with the man hours, Target Profit %, margin, sub rate, price per foot and availability of
 * that company's own TV-DS 6'x6' style (TV-DS 6'x8' if there is no 6'x6').
 * Nothing else changes: the choice tree already has Tan, Dig set and the auto
 * width, and the kits are the built in ones (no saved kit set is written).
 * Pure; the server runs it once per company (lib/tanAutoDsSeed.ts).
 */

import type { FenceStyle } from './configStore'

export const TAN_AUTO_DS = 'TV-Auto DS Privacy'
export const TAN_AUTO_DS_SOURCES = ["TV-DS 6'x6' Privacy", "TV-DS 6'x8' Privacy"] as const

export interface TanAutoDsPlan {
  fenceStyles: FenceStyle[]
  /** The style added, or null (already there, or no TV-DS style to copy from). */
  added: string | null
  /** The style its settings were copied from. */
  copiedFrom: string | null
  skipped?: string
}

export function planTanAutoDs(styles0: FenceStyle[]): TanAutoDsPlan {
  const styles: FenceStyle[] = JSON.parse(JSON.stringify(styles0))
  if (styles.some(s => s.name === TAN_AUTO_DS)) return { fenceStyles: styles, added: null, copiedFrom: null, skipped: 'already in Settings' }
  const src = TAN_AUTO_DS_SOURCES.map(n => styles.find(s => s.name === n)).find(Boolean)
  if (!src) return { fenceStyles: styles, added: null, copiedFrom: null, skipped: 'no TV-DS 6\'x6\' or 6\'x8\' style to copy the settings from' }
  const style: FenceStyle = {
    id: 'auto-tv-ds', name: TAN_AUTO_DS, category: src.category, margin: src.margin,
    ...(typeof src.targetProfitPct === 'number' ? { targetProfitPct: src.targetProfitPct } : {}),
    sectionsPerMH: src.sectionsPerMH, panelWidth: 6, mhPerWalkGate: src.mhPerWalkGate, mhPerDblGate: src.mhPerDblGate,
    isActive: src.isActive !== false, ...(src.quotable === false ? { quotable: false } : {}),
    ...(src.subRate !== undefined ? { subRate: src.subRate } : {}), ...(src.pricePerFoot !== undefined ? { pricePerFoot: src.pricePerFoot } : {}),
    autoRailMix: true, installMethod: 'dig-set', colorFamily: 'tan',
    material: 'vinyl', choices: { color: 'tan', style: 'privacy', width: 'auto', height: '6', install: 'ds' },
  }
  if (styles.some(s => s.id === style.id)) style.id = `auto-tv-ds-${Date.now().toString(36)}`
  // Next to the other auto mix styles, as in the defaults.
  let at = -1
  styles.forEach((s, i) => { if (s.autoRailMix) at = i })
  styles.splice(at + 1, 0, style)
  return { fenceStyles: styles, added: TAN_AUTO_DS, copiedFrom: src.name }
}
