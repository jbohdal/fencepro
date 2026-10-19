/**
 * Every style code the app has ever had, with its choices (fenceCatalog.ts
 * explains the choice tree). Kept apart, with no imports, so the quote math
 * (quoteCalc) can read a style's choices without loading anything else.
 */

import type { FenceStyle } from './configStore'

export interface StyleChoices { material: string; choices: Record<string, string> }

/** Every style code the app has ever had, with its choices. The codes stay the internal names. */
export const LEGACY_STYLE_CHOICES: Record<string, StyleChoices> = (() => {
  const out: Record<string, StyleChoices> = {}
  const vinyl = (code: string, c: Record<string, string>) => { out[code] = { material: 'vinyl', choices: { style: 'privacy', ...c } } }
  for (const [cc, colorKey] of [['WV', 'white'], ['TV', 'tan']] as const) {
    for (const [ii, install] of [['ND', 'nd'], ['DS', 'ds']] as const) {
      vinyl(`${cc}-Auto ${ii} Privacy`, { height: '6', color: colorKey, install, width: 'auto' })
      for (const h of ['6', '8']) for (const w of ['6', '8']) vinyl(`${cc}-${ii} ${h}'x${w}' Privacy`, { height: h, color: colorKey, install, width: w })
    }
  }
  out["WV-ND Bell 4'x6'"] = { material: 'vinyl', choices: { style: 'bell', height: '4', color: 'white', install: 'nd', width: '6' } }
  for (const h of ['4', '5', '6']) {
    out[`CL - ${h}' Galv`] = { material: 'chain', choices: { height: h, finish: 'galv', grade: 'res', install: 'nd' } }
    out[`CL - ${h}' Black`] = { material: 'chain', choices: { height: h, finish: 'black', grade: 'res', install: 'nd' } }
  }
  out["CL - Com 6'"] = { material: 'chain', choices: { height: '6', finish: 'galv', grade: 'com', install: 'nd' } }
  out["CL - Com 6'+1'"] = { material: 'chain', choices: { height: '6+1', finish: 'galv', grade: 'com', install: 'nd' } }
  out["CL - Com 6'+1' Black"] = { material: 'chain', choices: { height: '6+1', finish: 'black', grade: 'com', install: 'nd' } }
  out['Alum - ND - Emily - 48'] = { material: 'alum', choices: { panel: 'emily', height: '4', install: 'nd' } }
  out['Alum - DS - Emily - 48'] = { material: 'alum', choices: { panel: 'emily', height: '4', install: 'ds' } }
  out['Alum - DS - Ind Abigail'] = { material: 'alum', choices: { panel: 'abigail', height: '6', install: 'ds' } }
  out['Durafence'] = { material: 'other', choices: { product: 'durafence' } }
  return out
})()

/** A style's material and choices: saved on it (made in Settings), else from its old code. */
export function styleChoicesOf(s: Pick<FenceStyle, 'name'> & { material?: string; choices?: Record<string, string> }): StyleChoices | null {
  if (s.material && s.choices) return { material: s.material, choices: s.choices }
  return LEGACY_STYLE_CHOICES[s.name] ?? null
}

