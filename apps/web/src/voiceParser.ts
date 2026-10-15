/**
 * Voice phrase parser: what the salesman says → changes to the yard layout.
 * Our own rules, no AI service. Anything it cannot read comes back as
 * `unknown` so the screen can show it and say it back; it never guesses.
 *
 * Understands:
 *   lengths    "one twenty", "eighty one and a half", "eighty feet four
 *              inches", "80 4", "120", "a hundred and five"
 *   sides      the layout's side names ("left return", "back", ...), plus
 *              "rear", "back fence", "front fence", ... and the side being
 *              asked about when no side is named
 *   gates      "four foot gate in the middle", "ten foot double by the house",
 *              "walk gate near the corner", "gate 10 feet from the house",
 *              "no gate"
 *   finishes   "corner", "meets the house", "ties into the neighbor's fence",
 *              "stops", "no right return", "right return off"
 *   skips      "skip forty for the neighbor's fence", "gap of twelve feet"
 *   style      "white vinyl no dig", "tan dig set", "eight foot sections",
 *              "six foot tall"
 *   commands   "undo", "change the back to one sixty", "read it back",
 *              "what's the total", "done", "stop", "note ...", "photo"
 */

import { GATE_WIDTH_IN, formatFtIn, type EndFinish, type GateType, type YardLayout, type YardSide } from './yardLayout'

// ── Intents ───────────────────────────────────────────────────────────────────

export type GatePlace =
  | { at: 'middle' }
  | { at: 'near'; toward: 'house' | 'corner' | 'start' | 'end' | 'existing' }
  | { at: 'distance'; from: 'house' | 'corner' | 'start' | 'end'; distanceIn: number }

export type VoiceIntent =
  | { kind: 'side'; side: string; lengthIn?: number; gate?: { type: GateType; widthIn?: number; place?: GatePlace } | null; finish?: { finish: EndFinish; end?: 'start' | 'end' }; skip?: { kind: 'existing' | 'none'; lengthIn: number } | null; on?: boolean }
  | { kind: 'side-off'; side: string }
  | { kind: 'style'; color?: 'white' | 'tan'; install?: 'no-dig' | 'dig-set'; widthFt?: 6 | 8; heightFt?: 4 | 5 | 6 | 8 }
  | { kind: 'undo' }
  | { kind: 'readback' }
  | { kind: 'total' }
  | { kind: 'done' }
  | { kind: 'stop' }
  | { kind: 'note'; text: string }
  | { kind: 'photo' }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'number'; lengthIn: number }

export interface ParseResult {
  intents: VoiceIntent[]
  /** Words it could not make sense of, as said. Empty when everything was understood. */
  unknown: string[]
}

// ── Numbers ───────────────────────────────────────────────────────────────────

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
// Homophones ("to", "for", "won", "ate") count only next to other number words.
const WEAK = new Set(['to', 'too', 'for', 'won', 'ate', 'oh'])
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

interface Num { value: number; used: number }

function isNumWord(w: string | undefined, strong = true): boolean {
  if (w === undefined) return false
  if (/^\d+(\.\d+)?$/.test(w)) return true
  if (w in TENS) return true
  if (w in ONES) return !strong || !WEAK.has(w)
  return w === 'hundred' || w === 'half'
}

/** One spoken number at `at`: "one twenty" = 120, "two oh five" = 205, "eighty four", "120". */
export function readNumber(words: string[], at: number): Num | null {
  const w = words[at]
  if (w === undefined) return null
  if (/^\d+(\.\d+)?$/.test(w)) return { value: parseFloat(w), used: 1 }
  if (WEAK.has(w) && w !== 'oh') return null
  const small = (i: number, allowWeak = false): Num | null => {
    const a = words[i]
    if (a === undefined) return null
    if (a in TENS) {
      const b = words[i + 1]
      return b && b in ONES && ONES[b] > 0 && ONES[b] < 10 && !WEAK.has(b) ? { value: TENS[a] + ONES[b], used: 2 } : { value: TENS[a], used: 1 }
    }
    if (a in ONES && (allowWeak || !WEAK.has(a))) return { value: ONES[a], used: 1 }
    return null
  }
  const hundredsFrom = (h: number, i: number): Num => {
    if (words[i] === 'and' && isNumWord(words[i + 1])) i += 1
    const t = small(i)
    return t ? { value: h * 100 + t.value, used: i - at + t.used } : { value: h * 100, used: i - at }
  }
  if (w === 'a' && words[at + 1] === 'hundred') return hundredsFrom(1, at + 2)
  if (w === 'hundred') return hundredsFrom(1, at + 1)
  const h = small(at)
  if (!h) return null
  const i = at + h.used
  if (words[i] === 'hundred') return hundredsFrom(h.value, i + 1)
  // How lengths are said: "one twenty" = 120, "two oh five" = 205.
  if (h.used === 1 && h.value >= 1 && h.value <= 9) {
    if (words[i] === 'oh') {
      const d = small(i + 1)
      if (d && d.used === 1 && d.value < 10) return { value: h.value * 100 + d.value, used: 3 }
    }
    const t = small(i)
    if (t && t.value >= 10) return { value: h.value * 100 + t.value, used: 1 + t.used }
  }
  return h
}

const FEET = new Set(['feet', 'foot', 'ft', 'footer', "'"])
const INCH = new Set(['inches', 'inch', 'in', '"'])

/** A length: "80 feet 4 inches", "80 4", "eighty one and a half", "120". Inches. */
export function readLength(words: string[], at: number): { inches: number; used: number } | null {
  const n = readNumber(words, at)
  if (!n) return null
  let i = at + n.used
  let inches = n.value * 12
  let sawFeet = false
  if (FEET.has(words[i])) { i += 1; sawFeet = true }
  if (words[i] === 'and' && words[i + 1] === 'a' && words[i + 2] === 'half') return { inches: inches + 6, used: i + 3 - at }
  if (words[i] === 'and' && words[i + 1] === 'half') return { inches: inches + 6, used: i + 2 - at }
  // "and four inches", "four inches", "80 4" (digits, second under 12)
  const j = words[i] === 'and' ? i + 1 : i
  const inch = readNumber(words, j)
  if (inch && inch.value < 12) {
    const after = words[j + inch.used]
    if (INCH.has(after)) return { inches: inches + inch.value, used: j + inch.used + 1 - at }
    if (after === 'and' && words[j + inch.used + 1] === 'a' && words[j + inch.used + 2] === 'half' && INCH.has(words[j + inch.used + 3])) {
      return { inches: inches + inch.value + 0.5, used: j + inch.used + 4 - at }
    }
    if (!sawFeet && j === i && /^\d+$/.test(words[at]) && /^\d+$/.test(words[j]) && n.used === 1 && !FEET.has(after) && words[j + inch.used] !== 'foot') {
      return { inches: inches + inch.value, used: j + inch.used - at }
    }
  }
  if (n.value % 1 !== 0) inches = Math.round(n.value * 12 * 8) / 8
  return { inches, used: i - at }
}

// ── Words ─────────────────────────────────────────────────────────────────────

/** Lower case words, numbers kept, punctuation that matters turned into words. */
export function words(text: string): string[] {
  return text.toLowerCase()
    .replace(/(\d)\s*'\s*(\d+)\s*"/g, '$1 feet $2 inches')
    .replace(/(\d)\s*'/g, '$1 feet ').replace(/(\d)\s*"/g, '$1 inches ')
    .replace(/(\d)(ft|in)\b/g, '$1 $2')
    .replace(/½/g, ' and a half ')
    .replace(/\b(\d+)\.5\b/g, '$1 and a half')
    .replace(/[’`]/g, "'")
    .replace(/neighbou?r'?s/g, 'neighbors').replace(/what's/g, 'what is').replace(/that's/g, 'that is').replace(/it's/g, 'it is').replace(/there's/g, 'there is')
    .replace(/[^a-z0-9.\s-]/g, ' ').replace(/-/g, ' ').replace(/\.(?!\d)/g, ' ')
    .split(/\s+/).filter(Boolean)
}

const FILLER = new Set(['the', 'a', 'an', 'is', 'its', 'it', 'of', 'and', 'with', 'there', 'that', 'this', 'about', 'um', 'uh', 'okay', 'ok', 'so', 'then', 'next', 'side', 'fence', 'run', 'we', 'have', 'got', 'has', 'be', 'should', 'will', 'please', 'just', 'on', 'one', 'yeah', 'alright', 'all', 'right', 'run', 'length', 'long', 'total', 'at'])

// ── Side names ────────────────────────────────────────────────────────────────

interface SideMatch { name: string; w: string[] }

const ALIASES: Record<string, string[][]> = {
  back: [['rear'], ['back', 'fence'], ['back', 'line'], ['back', 'side'], ['rear', 'fence']],
  front: [['front', 'fence'], ['front', 'line'], ['front', 'side'], ['street', 'side']],
  'left side': [['left', 'fence'], ['left', 'line']],
  'right side': [['right', 'fence'], ['right', 'line']],
}

function numberWordsFor(token: string): string[] {
  const n = Number(token)
  if (!Number.isInteger(n)) return [token]
  const name = Object.keys(ONES).find(k => ONES[k] === n && !WEAK.has(k))
  return name ? [token, name] : [token]
}

/** Every way the layout's side names can be said, longest first. */
export function sideMatchers(sideNames: string[]): SideMatch[] {
  const out: SideMatch[] = []
  for (const name of sideNames) {
    const base = words(name)
    // "Side 1" can be said "side one".
    const variants: string[][] = [[]]
    for (const t of base) {
      const opts = numberWordsFor(t)
      const next: string[][] = []
      for (const v of variants) for (const o of opts) next.push([...v, o])
      variants.splice(0, variants.length, ...next)
    }
    for (const v of variants) out.push({ name, w: v })
    for (const a of ALIASES[name.toLowerCase()] ?? []) out.push({ name, w: a })
  }
  // "left" alone means the left side when there is no other "left ..." to mean.
  for (const dir of ['left', 'right']) {
    const side = sideNames.find(n => n.toLowerCase() === `${dir} side`)
    if (side) out.push({ name: side, w: [dir] })
  }
  return out.sort((a, b) => b.w.length - a.w.length)
}

function matchSide(ws: string[], i: number, matchers: SideMatch[]): SideMatch | null {
  for (const m of matchers) {
    if (m.w.every((x, k) => ws[i + k] === x)) {
      // A bare "left" / "right" before "return" belongs to the return.
      if (m.w.length === 1 && (ws[i + 1] === 'return' || ws[i + 1] === 'returned')) continue
      return m
    }
  }
  return null
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export interface ParseContext {
  sideNames: string[]
  /** The side the app just asked about; a phrase with no side name goes here. */
  currentSide?: string
}

const has = (ws: string[], ...phrases: string[]) => phrases.some(p => { const q = p.split(' '); return ws.some((_, i) => q.every((x, k) => ws[i + k] === x)) })

export function parseUtterance(text: string, ctx: ParseContext): ParseResult {
  const ws = words(text)
  if (ws.length === 0) return { intents: [], unknown: [] }
  const joined = ws.join(' ')

  // Whole phrase commands.
  if (/^(note|crew note|add a note|add note)\b/.test(joined)) {
    const body = text.trim().replace(/^\s*(crew note|add a note|add note|note)[\s,:.-]*/i, '').trim()
    return body ? { intents: [{ kind: 'note', text: body }], unknown: [] } : { intents: [], unknown: [text.trim()] }
  }
  if (/^(undo|undo that|scratch that|take that back|go back|never mind|nevermind)$/.test(joined)) return { intents: [{ kind: 'undo' }], unknown: [] }
  if (/^(read it back|read back|read that back|read it|what do you have|what have you got|repeat that|say it back|read me the sides)$/.test(joined)) return { intents: [{ kind: 'readback' }], unknown: [] }
  if (/^(what is the total|what is my total|whats the total|total|how much|what is the price|what does it come to|what is the footage|total footage|how many feet)$/.test(joined)) return { intents: [{ kind: 'total' }], unknown: [] }
  if (/^(done|i am done|im done|all done|that is it|thats it|that is all|finished|we are done|were done|done with sides)$/.test(joined)) return { intents: [{ kind: 'done' }], unknown: [] }
  if (/^(stop|stop listening|cancel|quit|pause|voice off)$/.test(joined)) return { intents: [{ kind: 'stop' }], unknown: [] }
  if (/^(photo|take a photo|take a picture|picture|camera|open the camera|snap a photo)$/.test(joined)) return { intents: [{ kind: 'photo' }], unknown: [] }
  if (/^(yes|yeah|yep|yup|correct|right|that is right|keep it|keep that|sure|ok|okay)$/.test(joined)) return { intents: [{ kind: 'yes' }], unknown: [] }
  if (/^(no|nope|wrong|that is wrong|not right)$/.test(joined)) return { intents: [{ kind: 'no' }], unknown: [] }

  const matchers = sideMatchers(ctx.sideNames)
  const intents: VoiceIntent[] = []
  const unknown: string[] = []

  // Style words anywhere in the phrase.
  const style = readStyle(ws)
  if (style) intents.push(style.intent)
  const styleUsed = style?.used ?? new Set<number>()

  // "change the back to one sixty", "make the back one sixty"
  const changeMatch = joined.match(/^(?:change|make|set|fix)\s+(?:the\s+)?(.+?)\s+(?:to|is|be|should be)?\s*(.+)$/)
  let tokens = ws
  let change = false
  if (changeMatch) {
    const sideWs = words(changeMatch[1])
    const m = matchSide(sideWs, 0, matchers)
    if (m && m.w.length === sideWs.length) { tokens = [...m.w, ...words(changeMatch[2])]; change = true }
  }

  // Split into pieces, one per side named; a lead piece with no side goes to the current side.
  const pieces: Array<{ side: string | null; off: boolean; ws: string[]; at: number[] }> = []
  let cur: { side: string | null; off: boolean; ws: string[]; at: number[] } = { side: null, off: false, ws: [], at: [] }
  for (let i = 0; i < tokens.length;) {
    if (!change && styleUsed.has(i)) { i += 1; continue }
    // "no right return", "skip the right return", "turn off the back"
    const neg = (tokens[i] === 'no' || tokens[i] === 'without') ? 1 : (tokens[i] === 'skip' && tokens[i + 1] === 'the') ? 2 : (tokens[i] === 'turn' && tokens[i + 1] === 'off') ? (tokens[i + 2] === 'the' ? 3 : 2) : 0
    const m = matchSide(tokens, i + neg, matchers)
    if (m) {
      if (cur.ws.length || cur.side) pieces.push(cur)
      const after = i + neg + m.w.length
      const offWord = tokens[after] === 'off' || tokens[after] === 'is' && tokens[after + 1] === 'off'
      cur = { side: m.name, off: neg > 0 || offWord, ws: [], at: [] }
      i = after + (offWord ? (tokens[after] === 'off' ? 1 : 2) : 0)
      continue
    }
    cur.ws.push(tokens[i]); cur.at.push(i)
    i += 1
  }
  if (cur.ws.length || cur.side) pieces.push(cur)

  for (const p of pieces) {
    if (p.off) {
      intents.push({ kind: 'side-off', side: p.side! })
      const rest = p.ws.filter(w => !FILLER.has(w))
      if (rest.length) unknown.push(rest.join(' '))
      continue
    }
    const side = p.side ?? ctx.currentSide ?? null
    const read = readSidePhrase(p.ws)
    if (!p.side && read.empty) {
      const rest = p.ws.filter(w => !FILLER.has(w))
      if (rest.length) unknown.push(rest.join(' '))
      continue
    }
    if (!side) {
      // A bare number answers a question ("fifteen or fifty?").
      if (read.lengthIn !== undefined && !read.gate && !read.finish && !read.skip && read.leftover.length === 0 && pieces.length === 1 && !style) {
        intents.push({ kind: 'number', lengthIn: read.lengthIn })
      } else {
        unknown.push(p.ws.join(' '))
      }
      continue
    }
    if (read.empty && p.side) {
      // Just the side's name: "the back" — nothing to change.
      unknown.push(p.side)
      continue
    }
    const it: VoiceIntent = { kind: 'side', side }
    if (read.lengthIn !== undefined) it.lengthIn = read.lengthIn
    if (read.gate !== undefined) it.gate = read.gate
    if (read.finish) it.finish = read.finish
    if (read.skip !== undefined) it.skip = read.skip
    intents.push(it)
    if (read.leftover.length) unknown.push(read.leftover.join(' '))
  }
  if (intents.length === 0 && unknown.length === 0) unknown.push(text.trim())
  return { intents, unknown }
}

interface SidePhrase {
  lengthIn?: number
  gate?: { type: GateType; widthIn?: number; place?: GatePlace } | null
  finish?: { finish: EndFinish; end?: 'start' | 'end' }
  skip?: { kind: 'existing' | 'none'; lengthIn: number } | null
  leftover: string[]
  empty: boolean
}

function readSidePhrase(ws: string[]): SidePhrase {
  const out: SidePhrase = { leftover: [], empty: true }
  const used = new Set<number>()
  const take = (from: number, n: number) => { for (let k = from; k < from + n; k++) used.add(k) }

  // Skips: "skip forty for the neighbor's fence", "gap of twelve feet", "existing fence forty feet"
  for (let i = 0; i < ws.length; i++) {
    if (used.has(i)) continue
    const isSkip = ws[i] === 'skip' || ws[i] === 'gap' || ws[i] === 'opening' || (ws[i] === 'existing' && (ws[i + 1] === 'fence' || isNumWord(ws[i + 1]))) || (ws[i] === 'leave' && ws[i + 1] === 'out')
    if (!isSkip) continue
    let j = i + 1
    if (ws[i] === 'leave') j += 1
    if (ws[j] === 'of' || ws[j] === 'fence') j += 1
    const len = readLength(ws, j)
    if (!len) continue
    let end = j + len.used
    let kind: 'existing' | 'none' = ws[i] === 'gap' || ws[i] === 'opening' ? 'none' : 'existing'
    // what the skip is for
    const tail = ws.slice(end, end + 6)
    if (has(tail, 'no fence', 'nothing', 'open', 'opening', 'gap')) kind = 'none'
    if (has(tail, 'neighbors fence', 'neighbor', 'existing', 'old fence', 'their fence', 'fence')) kind = kind === 'none' && !has(tail, 'neighbor', 'existing', 'old fence', 'their fence') ? 'none' : 'existing'
    while (end < ws.length && ['for', 'the', 'neighbors', 'neighbor', 'fence', 'existing', 'old', 'their', 'no', 'nothing', 'there', 'open', 'opening', 'gap', 'of'].includes(ws[end])) end += 1
    out.skip = { kind, lengthIn: len.inches }
    take(i, end - i)
    break
  }

  // Gates: "[four foot] [walk|double|single] gate [place]", "ten foot double [place]", "no gate"
  for (let i = 0; i < ws.length; i++) {
    if (used.has(i)) continue
    if (ws[i] === 'no' && ws[i + 1] === 'gate' || ws[i] === 'remove' && ws[i + 1] === 'the' && ws[i + 2] === 'gate') {
      out.gate = null; take(i, ws[i] === 'no' ? 2 : 3); break
    }
    const isGate = ws[i] === 'gate' || ws[i] === 'gates' || ((ws[i] === 'double' || ws[i] === 'drive' || ws[i] === 'driveway') && !used.has(i))
    if (!isGate) continue
    let type: GateType = 'walk'
    let start = i
    let end = i + 1
    if (ws[i] === 'double' || ws[i] === 'drive' || ws[i] === 'driveway') { type = 'double'; if (ws[i + 1] === 'gate') end += 1 }
    // Look back: "a four foot walk", "ten foot double", "single"
    let b = start - 1
    if (b >= 0 && (ws[b] === 'walk' || ws[b] === 'single' || ws[b] === 'man' || ws[b] === 'pedestrian')) { start = b; b -= 1 }
    if (b >= 0 && (ws[b] === 'double' || ws[b] === 'drive' || ws[b] === 'driveway')) { type = 'double'; start = b; b -= 1 }
    let widthIn: number | undefined
    if (b >= 0 && FEET.has(ws[b])) {
      // the number before "foot"
      for (let k = Math.max(0, b - 3); k < b; k++) {
        const n = readNumber(ws, k)
        if (n && k + n.used === b && n.value > 0 && n.value <= 20 && !used.has(k)) { widthIn = n.value * 12; start = k; break }
      }
    } else if (b >= 0 && /^\d+$/.test(ws[b]) && Number(ws[b]) <= 20) { widthIn = Number(ws[b]) * 12; start = b }
    while (start > 0 && (ws[start - 1] === 'a' || ws[start - 1] === 'with' || ws[start - 1] === 'and')) start -= 1
    if (widthIn === undefined && type === 'walk' && (ws[end] === 'is' || ws[end] === 'at') ) {
      // "gate is four feet wide" — width after
      const n = readNumber(ws, end + 1)
      if (n && FEET.has(ws[end + 1 + n.used]) && ws[end + 2 + n.used] === 'wide') { widthIn = n.value * 12; end = end + 3 + n.used }
    }
    const place = readGatePlace(ws, end)
    if (place) end = place.end
    out.gate = { type, ...(widthIn !== undefined ? { widthIn } : {}), ...(place ? { place: place.place } : {}) }
    take(start, end - start)
    break
  }

  // Finishes
  for (let i = 0; i < ws.length; i++) {
    if (used.has(i)) continue
    const end: 'start' | 'end' | undefined = ws[i] === 'starts' || ws[i] === 'starting' || ws[i] === 'from' ? 'start' : ws[i] === 'ends' || ws[i] === 'ending' ? 'end' : undefined
    const at = end ? i + 1 : i
    const rest = ws.slice(at, at + 6).join(' ')
    let m: RegExpMatchArray | null
    let finish: EndFinish | null = null, n = 0
    if ((m = rest.match(/^(?:at |on |to |off |into |against )?(?:the )?(?:house|home|wall of the house|house wall)\b/))) { finish = 'house'; n = m[0].split(' ').length }
    else if ((m = rest.match(/^(?:meets|meet|meeting|hits|goes to|runs to|comes off|ties to|ties into|attaches to|butts up to) (?:the )?(?:house|home)\b/))) { finish = 'house'; n = m[0].split(' ').length }
    else if ((m = rest.match(/^(?:ties into|ties in to|ties in|tie into|tie in to|tie in|meets|joins|connects to|goes into|runs into|butts into|butts up to) (?:the |a |an )?(?:neighbors |neighbor |existing |old |their )?(?:fence)?\b/))) { finish = 'existing'; n = m[0].trim().split(' ').length }
    else if ((m = rest.match(/^(?:at |to |into )?(?:the )?(?:neighbors fence|existing fence|old fence|their fence)\b/))) { finish = 'existing'; n = m[0].split(' ').length }
    else if ((m = rest.match(/^(?:stops|stop|stops here|dead ends|dead end|free end|open end|just stops|ends there|ends here|end post)\b(?: here)?/))) { finish = 'free'; n = m[0].split(' ').length }
    else if (end === 'end' && (m = rest.match(/^(?:here|there|right there|right here)\b/))) { finish = 'free'; n = m[0].split(' ').length }
    else if ((m = rest.match(/^(?:at )?(?:a |the )?corner\b/)) && !(ws[at - 1] === 'near' || ws[at - 1] === 'by' || ws[at - 2] === 'near' || ws[at - 2] === 'by')) { finish = 'corner'; n = m[0].split(' ').length }
    if (finish && n > 0) {
      out.finish = { finish, ...(end ? { end } : {}) }
      take(i, (at - i) + n)
      break
    }
  }

  // Length: the first number left that is not part of the above. Words
  // already taken (a gate's "four foot") are hidden from it.
  const free = ws.map((w, i) => (used.has(i) ? '§' : w))
  for (let i = 0; i < ws.length; i++) {
    if (used.has(i)) continue
    if (!isNumWord(ws[i]) && !(ws[i] === 'a' && ws[i + 1] === 'hundred')) continue
    const len = readLength(free, i)
    if (!len) continue
    out.lengthIn = len.inches
    take(i, len.used)
    break
  }

  const extra = ['feet', 'foot', 'ft', 'long', 'wide', 'in', 'there', 'for', 'to', 'by', 'near', 'of']
  out.leftover = ws.filter((w, i) => !used.has(i) && !FILLER.has(w) && !extra.includes(w))
  out.empty = out.lengthIn === undefined && out.gate === undefined && !out.finish && out.skip === undefined
  return out
}

function readGatePlace(ws: string[], at: number): { place: GatePlace; end: number } | null {
  const rest = ws.slice(at, at + 8).join(' ')
  let m: RegExpMatchArray | null
  if ((m = rest.match(/^(?:in |at |right in )?(?:the )?(?:middle|center|centre|centered)\b(?: of (?:it|the side|the run|that side))?/))) return { place: { at: 'middle' }, end: at + m[0].split(' ').length }
  if ((m = rest.match(/^(?:by|near|next to|close to|beside|against|up by|at|toward|towards) (?:the )?(house|home|corner|start|beginning|end|existing fence|neighbors fence)\b/))) {
    const t = m[1]
    const toward = t === 'house' || t === 'home' ? 'house' : t === 'corner' ? 'corner' : t === 'start' || t === 'beginning' ? 'start' : t === 'end' ? 'end' : 'existing'
    return { place: { at: 'near', toward }, end: at + m[0].split(' ').length }
  }
  // "10 feet from the house"
  const n = readLength(ws, at)
  if (n) {
    const r = ws.slice(at + n.used, at + n.used + 4).join(' ')
    const f = r.match(/^(?:in )?(?:from|off) (?:the )?(house|home|corner|start|beginning|end)\b/)
    if (f) {
      const t = f[1]
      const from = t === 'house' || t === 'home' ? 'house' : t === 'corner' ? 'corner' : t === 'end' ? 'end' : 'start'
      return { place: { at: 'distance', from, distanceIn: n.inches }, end: at + n.used + f[0].split(' ').length }
    }
  }
  return null
}

function readStyle(ws: string[]): { intent: Extract<VoiceIntent, { kind: 'style' }>; used: Set<number> } | null {
  const used = new Set<number>()
  const intent: Extract<VoiceIntent, { kind: 'style' }> = { kind: 'style' }
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], n1 = ws[i + 1], n2 = ws[i + 2]
    if ((w === 'white' || w === 'tan' || w === 'beige' || w === 'almond') && (n1 === 'vinyl' || n1 === 'privacy' || n1 === 'fence' || n1 === 'no' || n1 === 'dig' || n1 === undefined || n1 === 'and')) {
      intent.color = w === 'white' ? 'white' : 'tan'; used.add(i); if (n1 === 'vinyl' || n1 === 'privacy') used.add(i + 1)
    }
    if ((w === 'vinyl' || w === 'privacy') && !used.has(i)) used.add(i)
    if ((w === 'no' && n1 === 'dig') || w === 'nodig' || (w === 'pipe' && n1 === 'and' && n2 === 'donut')) { intent.install = 'no-dig'; used.add(i); if (w === 'no') used.add(i + 1) }
    if ((w === 'dig' && n1 === 'set' && ws[i - 1] !== 'no') || w === 'digset' || (w === 'in' && n1 === 'concrete') || (w === 'set' && n1 === 'in' && n2 === 'concrete')) {
      intent.install = 'dig-set'; used.add(i); used.add(i + 1); if (w === 'set') used.add(i + 2)
    }
    // "eight foot sections", "six foot wide", "8 foot panels", "six foot tall"
    if ((w === 'six' || w === '6' || w === 'eight' || w === '8' || w === 'four' || w === '4' || w === 'five' || w === '5') && FEET.has(n1)) {
      const v = Number(ONES[w] ?? w) as 4 | 5 | 6 | 8
      if (n2 === 'sections' || n2 === 'section' || n2 === 'panels' || n2 === 'panel' || n2 === 'wide' || n2 === 'rails' || n2 === 'rail') {
        if (v === 6 || v === 8) { intent.widthFt = v; used.add(i); used.add(i + 1); used.add(i + 2) }
      } else if (n2 === 'tall' || n2 === 'high' || n2 === 'privacy' || n2 === 'height') {
        intent.heightFt = v; used.add(i); used.add(i + 1); used.add(i + 2)
      }
    }
  }
  const any = intent.color || intent.install || intent.widthFt || intent.heightFt
  return any ? { intent, used } : null
}

// ── Questions: ask instead of accepting something odd ─────────────────────────

const TEEN_TO_TENS: Record<number, number> = { 13: 30, 14: 40, 15: 50, 16: 60, 17: 70, 18: 80, 19: 90 }
const TENS_TO_TEEN: Record<number, number> = Object.fromEntries(Object.entries(TEEN_TO_TENS).map(([a, b]) => [b, Number(a)]))

export interface VoiceQuestion {
  text: string
  /** Lengths in inches the answer can pick, as the words to say. */
  choices: Array<{ say: string; lengthIn: number }>
  /** What gets applied, with the length filled in by the answer. */
  intent: Extract<VoiceIntent, { kind: 'side' }>
}

const sayFeet = (ft: number) => (Number.isInteger(ft) ? spokenNumber(ft) : `${spokenNumber(Math.floor(ft))} and a half`)

/** Common English for a number, for read back: 120 → "one twenty". */
export function spokenNumber(n: number): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  const under100 = (v: number) => (v < 20 ? ones[v] : tens[Math.floor(v / 10)] + (v % 10 ? ` ${ones[v % 10]}` : ''))
  if (n < 100) return under100(n)
  const h = Math.floor(n / 100), r = n % 100
  if (n < 1000) return r === 0 ? `${ones[h]} hundred` : r < 10 ? `${ones[h]} oh ${ones[r]}` : `${ones[h]} ${under100(r)}`
  return String(n)
}

/**
 * Questions before a side length is taken: a teen that might be a tens
 * ("fifteen or fifty?") when the other sides say so, a side under 6 ft or
 * over 600 ft, a gate wider than the side, and the tape measure reminder
 * when the run lands right on a whole number of sections.
 */
export function questionsFor(it: Extract<VoiceIntent, { kind: 'side' }>, layout: YardLayout, widthFt: number | null): VoiceQuestion | null {
  const side = layout.sides.find(s => s.name === it.side)
  if (!side) return null
  const L = it.lengthIn
  if (L !== undefined) {
    const ft = L / 12
    const others = layout.sides.filter(s => s.name !== it.side && s.on && s.lengthIn > 0).map(s => s.lengthIn / 12)
    const median = others.length ? others.sort((a, b) => a - b)[Math.floor(others.length / 2)] : null
    // Teens and tens sound alike; hundreds too ("one fifteen" / "one fifty").
    const low = ft % 100, hundreds = Math.floor(ft / 100) * 100
    const alt = Number.isInteger(ft) ? (TEEN_TO_TENS[low] ?? TENS_TO_TEEN[low]) : undefined
    if (alt !== undefined && median !== null) {
      const altFt = hundreds + alt
      const far = (x: number) => Math.max(x, median) / Math.max(1, Math.min(x, median))
      if (far(ft) >= 2 && far(altFt) * 1.5 < far(ft)) {
        return { text: `${side.name}: ${sayFeet(ft)} or ${sayFeet(altFt)}?`, choices: [{ say: sayFeet(ft), lengthIn: L }, { say: sayFeet(altFt), lengthIn: altFt * 12 }], intent: it }
      }
    }
    if (ft < 6 || ft > 600) {
      return { text: `${side.name} ${formatFtIn(L)}? That is ${ft < 6 ? 'under 6' : 'over 600'} feet. Say yes to keep it, or say the length again.`, choices: [{ say: 'yes', lengthIn: L }], intent: it }
    }
  }
  const gateW = it.gate ? (it.gate.widthIn ?? side.gate?.widthIn ?? GATE_WIDTH_IN[it.gate.type]) : side.gate?.widthIn
  const len = L ?? side.lengthIn
  if (gateW && len > 0 && gateW >= len && (it.gate || L !== undefined)) {
    return { text: `The gate (${formatFtIn(gateW)}) is as wide as the ${side.name.toLowerCase()} (${formatFtIn(len)}) or wider. Say the length again.`, choices: [], intent: it }
  }
  // Tape reminder for a side that is one run; a gate or skip splits it, and
  // the quote's own warnings check each piece.
  const split = (it.gate ?? side.gate) || (it.skip ?? side.skip)
  if (L !== undefined && widthFt && !split) {
    const over = L % (widthFt * 12)
    if (L >= widthFt * 12 && over <= 6) {
      return { text: `${side.name} ${formatFtIn(L)} lands right on ${Math.floor(L / (widthFt * 12))} sections. Check it with a tape measure. Say yes to keep it, or say the length again.`, choices: [{ say: 'yes', lengthIn: L }], intent: it }
    }
  }
  return null
}

/** The answer to a question: one of its choices, "yes" for the first, or a new length. */
export function answerQuestion(q: VoiceQuestion, text: string): { lengthIn: number } | null {
  const r = parseUtterance(text, { sideNames: [] })
  const ws = words(text)
  if (r.intents[0]?.kind === 'yes') return q.choices[0] ? { lengthIn: q.choices[0].lengthIn } : null
  for (const c of q.choices) if (c.say !== 'yes' && words(c.say).join(' ') === ws.join(' ')) return { lengthIn: c.lengthIn }
  const len = readLength(ws, 0)
  if (len && len.used === ws.filter(w => !FILLER.has(w) || isNumWord(w)).length) return { lengthIn: len.inches }
  if (len) return { lengthIn: len.inches }
  return null
}

// ── Apply to the layout ──────────────────────────────────────────────────────

export function applySideIntent(layout: YardLayout, it: Extract<VoiceIntent, { kind: 'side' }>): YardLayout {
  const sides = layout.sides.map(s => ({ ...s }))
  const i = sides.findIndex(s => s.name === it.side)
  if (i < 0) return layout
  const s: YardSide = sides[i]
  s.on = true
  if (it.lengthIn !== undefined) s.lengthIn = it.lengthIn
  if (it.gate === null) s.gate = null
  else if (it.gate) {
    const g = it.gate
    const widthIn = g.widthIn ?? (s.gate?.type === g.type ? s.gate.widthIn : GATE_WIDTH_IN[g.type])
    let position: NonNullable<YardSide['gate']>['position'] = s.gate?.position ?? 'middle'
    let distanceIn: number | undefined = s.gate?.distanceIn
    if (g.place?.at === 'middle') position = 'middle'
    if (g.place?.at === 'near') position = nearEnd(layout, i, g.place.toward)
    if (g.place?.at === 'distance') {
      const fromEnd = nearEnd(layout, i, g.place.from) === 'end'
      position = 'distance'
      distanceIn = fromEnd && s.lengthIn > 0 ? Math.max(0, s.lengthIn - g.place.distanceIn - widthIn) : g.place.distanceIn
    }
    s.gate = { type: g.type, widthIn, position, ...(position === 'distance' ? { distanceIn } : {}) }
  }
  if (it.skip === null) s.skip = null
  else if (it.skip) s.skip = { kind: it.skip.kind, lengthIn: it.skip.lengthIn, position: 'middle' }
  if (it.finish) {
    const end = it.finish.end ?? chooseEnd(layout, i, it.finish.finish)
    const j = end === 'start' ? (i > 0 ? i - 1 : layout.closed ? sides.length - 1 : null) : (i < sides.length - 1 ? i + 1 : layout.closed ? 0 : null)
    if (it.finish.finish === 'corner') {
      if (end === 'start') { s.startFinish = 'corner'; if (j !== null) sides[j].endFinish = 'corner' }
      else { s.endFinish = 'corner'; if (j !== null) sides[j].startFinish = 'corner' }
    } else if (end === 'start') {
      s.startFinish = it.finish.finish
      if (j !== null && sides[j].endFinish === 'corner') sides[j].endFinish = 'free'
    } else {
      s.endFinish = it.finish.finish
      if (j !== null && sides[j].startFinish === 'corner') sides[j].startFinish = 'free'
    }
  }
  return { ...layout, sides }
}

export function applySideOff(layout: YardLayout, side: string): YardLayout {
  return { ...layout, sides: layout.sides.map(s => (s.name === side ? { ...s, on: false } : s)) }
}

/** Which end of a side a word like "house" or "corner" points to. */
function nearEnd(layout: YardLayout, i: number, toward: string): 'start' | 'end' {
  const s = layout.sides[i]
  if (toward === 'start') return 'start'
  if (toward === 'end') return 'end'
  const want: EndFinish = toward === 'house' ? 'house' : toward === 'existing' ? 'existing' : 'corner'
  if (s.endFinish === want && s.startFinish !== want) return 'end'
  return s.startFinish === want ? 'start' : (want === 'corner' && s.endFinish !== 'corner' ? 'start' : 'end')
}

/** For "meets the house" with no "starts" / "ends": the end that is not a corner. */
function chooseEnd(layout: YardLayout, i: number, f: EndFinish): 'start' | 'end' {
  const s = layout.sides[i]
  const prevJoined = s.startFinish === 'corner' && (i > 0 || layout.closed)
  const nextJoined = s.endFinish === 'corner' && (i < layout.sides.length - 1 || layout.closed)
  if (f === 'corner') return prevJoined ? 'end' : 'start'
  if (s.startFinish === f) return 'start'
  if (s.endFinish === f) return 'end'
  if (!prevJoined) return 'start'
  if (!nextJoined) return 'end'
  return 'end'
}

// ── Read back ─────────────────────────────────────────────────────────────────

/** "Left return, 30 feet, 4 foot walk gate in the middle" */
export function describeSide(s: YardSide, ends?: { start: EndFinish; end: EndFinish }): string {
  if (!s.on) return `No ${s.name.toLowerCase()}`
  const parts = [s.name]
  if (s.lengthIn > 0) parts.push(feetWords(s.lengthIn))
  if (s.gate) {
    const g = s.gate
    const where = g.position === 'middle' ? 'in the middle' : g.position === 'distance' ? `${feetWords(g.distanceIn ?? 0)} from the start`
      : `near the ${({ house: 'house', corner: 'corner', existing: 'existing fence', free: 'end' } as Record<EndFinish, string>)[(g.position === 'start' ? ends?.start ?? s.startFinish : ends?.end ?? s.endFinish)]}`
    parts.push(`${Math.round(g.widthIn / 12)} foot ${g.type === 'double' ? 'double' : 'walk'} gate ${where}`)
  }
  if (s.skip && s.skip.lengthIn > 0) parts.push(`skip ${feetWords(s.skip.lengthIn)} ${s.skip.kind === 'existing' ? 'for existing fence' : 'with no fence'}`)
  return parts.join(', ')
}

function feetWords(inches: number): string {
  const ft = Math.floor(inches / 12), inch = Math.round((inches - ft * 12) * 8) / 8
  return inch ? `${ft} feet ${inch} inches` : `${ft} feet`
}
