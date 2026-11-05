/**
 * "Is this the same property": the street part of an address in the county's
 * words, the same as the portal's lib/properties.ts addressKey (the portal
 * test tests/properties.test.ts keeps the two the same). "10116 Southwest
 * 78th Court, Ocala FL", "10116 SW 78 Ct Ocala, FL 34476" and "10116 SW 78th
 * Ct" are one. '' for a blank address or one with no house number.
 *
 * No imports: the portal tests use it too.
 */

const WORDS: Record<string, string> = {
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', AV: 'AVE', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', PI: 'PL', TERRACE: 'TER', TERR: 'TER',
  TRAIL: 'TRL', DRIVE: 'DR', LANE: 'LN', HIGHWAY: 'HWY', BOULEVARD: 'BLVD', TRACE: 'TRCE', PARKWAY: 'PKWY', POINT: 'PT',
  RUN: 'RUN', LOOP: 'LOOP', WAY: 'WAY', PASS: 'PASS', COVE: 'CV', CROSSING: 'XING', SQUARE: 'SQ', EXTENSION: 'EXT',
  SR: 'HWY', US: 'HWY', CR: 'HWY', FL: 'HWY',
}
const STREET_TYPES = new Set(['ST', 'RD', 'AVE', 'CT', 'CIR', 'PL', 'TER', 'TRL', 'DR', 'LN', 'BLVD', 'TRCE', 'PKWY', 'PT', 'RUN', 'LOOP', 'LP', 'WAY', 'PASS', 'CV', 'XING', 'SQ', 'EXT', 'COURSE', 'RADIAL', 'MANOR', 'TRAK', 'TRACK', 'ROW', 'PATH', 'BND', 'GLN', 'HTS', 'XRD'])
const SAME_TYPE: Record<string, string> = { LP: 'LOOP', STR: 'ST', CRSE: 'COURSE', CRS: 'COURSE', RADL: 'RADIAL', MNR: 'MANOR', CRT: 'CT', TRK: 'TRACK', BEND: 'BND', GLEN: 'GLN', WY: 'WAY' }
const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

/** Address words in the county's form (portal lib/addressIndex.ts addressWords). */
function addressWords(s: string): string[] {
  return s.toUpperCase().replace(/[.,#]/g, ' ').replace(/\b(FL|SR|US|CR)-(\d)/g, '$1 $2').split(/\s+/).filter(Boolean)
    .map(t => WORDS[t] ?? t)
    .map(t => t.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'))
}

export function addressKey(address: string | null | undefined): string {
  const a = String(address ?? '').trim()
  if (!a) return ''
  const words = addressWords(a.split(',')[0] ?? '').map(w => SAME_TYPE[w] ?? w)
  let end = words.length
  for (let i = 2; i < words.length; i++) {
    if (STREET_TYPES.has(words[i])) { end = i + 1 + (DIRECTIONS.has(words[i + 1] ?? '') ? 1 : 0); break }
    if (words[i - 1] === 'HWY' && /^\d+[A-Z]?$/.test(words[i])) { end = i + 1 + (DIRECTIONS.has(words[i + 1] ?? '') ? 1 : 0); break }
  }
  if (!/\d/.test(words[0] ?? '')) return ''
  return words.slice(0, end).join(' ')
}

/** Two addresses are the same property. Blank never matches. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = addressKey(a)
  return !!x && x === addressKey(b)
}

/** A customer has a property at this address (their Primary, a rental, one sold). */
export function hasPropertyAt(c: { serviceAddress?: string | null; propertyAddresses?: string[] | null }, address: string | null | undefined): boolean {
  const key = addressKey(address)
  if (!key) return false
  return [c.serviceAddress ?? '', ...(c.propertyAddresses ?? [])].some(a => addressKey(a) === key)
}
