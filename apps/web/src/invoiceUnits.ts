/**
 * Units for Needs a match (Inventory > Invoices): how a vendor's unit turns
 * into Inventory units, as `vendorPer` of theirs = `invPer` of ours.
 *
 * Both ways are offered in words with the units in them, so the direction is
 * plain:
 *   - the vendor sells a box (BX, CS, BDL ...) and Inventory counts each:
 *     "1 BX = 100 each"            (vendorPer 1, invPer 100)
 *   - the vendor sells each and Inventory counts the box:
 *     "100 EA = 1 box"             (vendorPer 100, invPer 1)
 *     300 EA hook ties to "Hook Ties ... (100)" = 3 boxes, never 30,000 each.
 * A unit printed in the description ("50ft/rll", "(220/lb)", "@1000ft") is
 * offered first and picked to start with; so is the pack count in the
 * Inventory item's name ("(100)") when the vendor sells each. A tap still
 * decides. No React here, so it is tested on its own.
 */

export interface UnitPreset { label: string; vendorPer: number; invPer: number }

/** Vendor units that are a pack of several (Inventory usually counts what is inside). */
const PACK_UNITS = new Set(['BX', 'BOX', 'CS', 'CASE', 'BDL', 'BUN', 'BNDL', 'BD', 'PK', 'PKG', 'CT', 'CTN', 'BG', 'BAG', 'KIT', 'SET', 'PAL', 'PLT'])
/** Vendor units that are one thing (or one foot, one pound). */
const SINGLE_UNITS = new Set(['EA', 'EACH', 'PC', 'PCS', 'FT', 'LF', 'LB', 'LBS', 'UN', 'STK', 'LG', 'LEN', 'RL', 'RLL', 'ROLL', 'GAL', 'SF', 'SQ', 'TN', 'TON', 'SHT'])

const unitKey = (u: string) => u.trim().toUpperCase().replace(/[./]$/, '')

/** Conversions printed in the vendor's description: "(220/lb)", "(140/#)", "50ft/rll", "@1000ft". */
export function unitHints(line: { description: string; unit: string }): UnitPreset[] {
  const d = line.description, u = unitKey(line.unit), out: UnitPreset[] = []
  let m = /(\d+)\s*\/\s*(?:lbs?|#)/i.exec(d)
  if (m && (u === 'LB' || u === 'LBS')) out.push({ label: `1 lb = ${m[1]} each`, vendorPer: 1, invPer: Number(m[1]) })
  m = /(\d+)\s*(?:ft|')\s*\/\s*r(?:ll|l|oll)\b/i.exec(d)
  if (m && (u === 'FT' || u === 'LF')) out.push({ label: `${m[1]} ft = 1 roll`, vendorPer: Number(m[1]), invPer: 1 })
  m = /@\s*(\d+)\s*(?:ft|')/i.exec(d) ?? /\((\d+)\s*'\)/.exec(d)
  if (m && (u === 'RLL' || u === 'RL' || u === 'ROLL')) out.push({ label: `1 roll = ${m[1]} ft`, vendorPer: 1, invPer: Number(m[1]) })
  m = /\b(?:box|bx|bag|pack|pk|case|cs|bundle|bdl)\s+of\s+(\d+)\b/i.exec(d)
  if (m && PACK_UNITS.has(u)) out.push({ label: `1 ${line.unit.trim()} = ${m[1]} each`, vendorPer: 1, invPer: Number(m[1]) })
  return out
}

/** The pack count in an Inventory item's name: "Hook Ties, 6-1/2\" x 9ga (100)" → 100. */
export function packOfName(name: string | undefined | null): number | null {
  const m = /\((\d{2,5})\)\s*$/.exec(String(name ?? '').trim()) ?? /\b(?:box|bag|pack|bundle|case) of (\d{2,5})\b/i.exec(String(name ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * The unit choices for one line, in order: what the description says, then
 * the Inventory item's pack count, then same unit, then the common packs in
 * the direction that fits the vendor's unit (both when it is not known).
 */
export function unitPresets(line: { description: string; unit: string }, itemName?: string | null): UnitPreset[] {
  const u = unitKey(line.unit) || 'EA'
  const shown = line.unit.trim() || 'EA'
  const out: UnitPreset[] = [...unitHints(line)]
  const pack = packOfName(itemName)
  const single = SINGLE_UNITS.has(u), packed = PACK_UNITS.has(u)
  if (pack && !packed) out.push({ label: `${pack} ${shown} = 1 box`, vendorPer: pack, invPer: 1 })
  out.push({ label: 'Same unit', vendorPer: 1, invPer: 1 })
  const eachToBox = [{ n: 100, what: 'box' }, { n: 50, what: 'box' }, { n: 10, what: 'bundle' }]
  if (!packed) for (const p of eachToBox) out.push({ label: `${p.n} ${shown} = 1 ${p.what}`, vendorPer: p.n, invPer: 1 })
  if (!single) for (const p of eachToBox) out.push({ label: `1 ${shown} = ${p.n} each`, vendorPer: 1, invPer: p.n })
  if ((u === 'FT' || u === 'LF') && !out.some(p => p.vendorPer === 50 && p.invPer === 1 && /roll/.test(p.label))) out.push({ label: '50 ft = 1 roll', vendorPer: 50, invPer: 1 })
  // One button per conversion (the first wording wins).
  const seen = new Set<string>()
  return out.filter(p => { const k = `${p.vendorPer}:${p.invPer}`; if (seen.has(k)) return false; seen.add(k); return true })
}

/** The choice to start with: what the description says, else the item's pack count, else same unit. */
export function startingPreset(line: { description: string; unit: string }, itemName?: string | null): UnitPreset {
  return unitPresets(line, itemName)[0]
}

/**
 * The landed price per Inventory unit for a choice, rounded to the cent, and
 * whether it would be $0.00 for a real amount (never saved: the unit is wrong).
 */
export function unitPreview(line: { qty: number | null; landedCents: number | null; totalCents: number | null }, vendorPer: number, invPer: number): { invQty: number; cents: number; zero: boolean } | null {
  if (!(vendorPer > 0) || !(invPer > 0) || !(line.qty != null && line.qty > 0)) return null
  const landed = line.landedCents ?? line.totalCents
  if (landed == null) return null
  const invQty = (line.qty * invPer) / vendorPer
  const cents = Math.floor(landed / invQty + 0.5)
  return { invQty, cents, zero: landed > 0 && cents < 1 }
}
