/**
 * Which Inventory part a vendor's chain link dig set post pipe is (Jonathan,
 * Oct 2026, for Stephens Pipe & Steel quote 06-251126). His rule, and only
 * his rule (nothing beyond it is guessed):
 *
 *   - 0.055 wall pipe: Galvanized is printed "1-5/8" GALV x 6' x 18ga-SPS",
 *     Black is printed "PLY BLK 1-5/8" x 6' x PP055" (or "BLK PLY ...");
 *   - 1-5/8" = line post, 2-1/2" = terminal post (end, corner and gate);
 *   - 6 ft long = 4 ft tall dig set chain link, 7 ft long = 5 ft tall.
 *
 * The part is the dig set post part the chain link dig set added to Inventory
 * (web/src/chainDigSet.ts digSetPostName): "DS, Pipe, Galv, Line Post,
 * 1-5/8" 0.055 wall, 4' Chain Link". Any other length (8 ft for 6 ft tall is
 * not in his rule yet) is not matched: it waits in Needs a match.
 *
 * Used as the first suggestion in Needs a match (a tap still decides) and by
 * scripts/stephens-dig-set-quotes.ts.
 */

export interface DigSetPipe {
  finish: 'Galv' | 'Blk'
  role: 'Line Post' | 'Terminal Post'
  diameter: '1-5/8' | '2-1/2'
  lengthFt: 6 | 7
  heightFt: 4 | 5
  /** The Inventory part name. */
  part: string
  /** The rule in words, for the suggestion. */
  why: string
}

/** Post length (ft) → chain link height (ft), from Jonathan's rule. */
export const DIG_SET_HEIGHT_FOR_LENGTH: Record<number, 4 | 5> = { 6: 4, 7: 5 }

const BLACK = /^\s*(?:PLY\s+BLK|BLK\s+PLY)\s+(1-5\/8|2-1\/2)"\s*x\s*(\d+)'\s*x\s*PP055\s*$/i
const GALV = /^\s*(?:GALV\s+)?(1-5\/8|2-1\/2)"\s*(?:GALV\s+)?x\s*(\d+)'\s*x\s*18\s*ga-?SPS\s*$/i

export function digSetPipeFor(description: string): DigSetPipe | null {
  const d = description.replace(/\s+/g, ' ').trim()
  let finish: DigSetPipe['finish'] | null = null
  let m = BLACK.exec(d)
  if (m) finish = 'Blk'
  else {
    m = GALV.exec(d)
    if (m && /\bGALV\b/i.test(d)) finish = 'Galv'
  }
  if (!m || !finish) return null
  const diameter = m[1] as DigSetPipe['diameter']
  const lengthFt = Number(m[2])
  const heightFt = DIG_SET_HEIGHT_FOR_LENGTH[lengthFt]
  if (!heightFt) return null
  const role: DigSetPipe['role'] = diameter === '1-5/8' ? 'Line Post' : 'Terminal Post'
  return {
    finish, role, diameter, lengthFt: lengthFt as 6 | 7, heightFt,
    part: `DS, Pipe, ${finish}, ${role}, ${diameter}" 0.055 wall, ${heightFt}' Chain Link`,
    why: `Jonathan's rule: ${lengthFt} ft long = ${heightFt} ft tall dig set, ${diameter}" = ${role === 'Line Post' ? 'line post' : 'terminal post'}`,
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/** The Inventory item for a vendor line by the rule, when Inventory has that part. */
export function digSetPipeItem<T extends { id?: unknown; name?: unknown; status?: unknown }>(description: string, items: T[]): { item: T; rule: DigSetPipe } | null {
  const rule = digSetPipeFor(description)
  if (!rule) return null
  const item = items.find(i => i && typeof i.name === 'string' && norm(i.name) === norm(rule.part) && i.status !== 'discontinued')
  return item ? { item, rule } : null
}
