/**
 * Plain warnings that catch a bad quote before it goes out. None of them
 * block saving; they say what to check. Pure, so each is tested on its own.
 */

import { formatFtIn, GATE_WIDTH_IN, type YardLayout, type GateType } from './yardLayout'

/** "Back (150' 0")" for a layout run, "Run 2 (81' 0")" for a typed one. */
export interface NamedRun { ft: number; label: string }

const TAPE = 'Check this run with a tape measure. A few inches either way changes the section count.'

/**
 * A run that lands right on a whole number of sections, or up to 6 inches
 * over one, is where a short tape changes the order: 80' at 8' wide is 10
 * sections, 80' 1" is 11.
 */
export function tapeChecks(runs: NamedRun[], widthsFt: number[]): string[] {
  const out: string[] = []
  runs.forEach((r, i) => {
    const w = widthsFt[i]
    if (!(r.ft > 0) || !(w > 0)) return
    const inches = Math.round(r.ft * 12 * 8) / 8
    const over = inches % (w * 12)
    if (inches >= w * 12 && over <= 6 + 1e-9) out.push(`${r.label}: ${TAPE}`)
  })
  return out
}

/** Which runs need a tape check, by index, for marking them on the screen. */
export function tapeFlags(runs: NamedRun[], widthsFt: number[]): boolean[] {
  return runs.map((r, i) => tapeChecks([r], [widthsFt[i]]).length > 0)
}

/** A gate on a side under 6 ft, or wider than its side. */
export function gateChecks(layout: YardLayout | null): string[] {
  if (!layout) return []
  const out: string[] = []
  for (const s of layout.sides) {
    if (!s.on || !s.gate || !(s.lengthIn > 0)) continue
    if (s.gate.widthIn > s.lengthIn) out.push(`${s.name}: the gate (${formatFtIn(s.gate.widthIn)}) is wider than the side (${formatFtIn(s.lengthIn)}).`)
    else if (s.lengthIn < 72) out.push(`${s.name} is under 6 ft (${formatFtIn(s.lengthIn)}) and has a gate. Check the measurement and the gate width.`)
  }
  return out
}

/** Margin under the target in Settings. */
export function marginCheck(gmPct: number, target: number, price: number): string | null {
  if (!(price > 0) || !(target > 0) || gmPct >= target) return null
  return `Margin is ${(gmPct * 100).toFixed(1)}%, under your ${(target * 100).toFixed(0)}% target in Settings.`
}

export interface PastQuote { id?: string; fenceStyle: string; finalPrice: number; runs?: number[]; status?: string }

/**
 * The normal price per foot for a style, from saved quotes: the middle 80%
 * of them (10th to 90th percentile). Null with fewer than 5 quotes.
 */
export function normalPerFoot(style: string, past: PastQuote[], excludeId?: string): { low: number; high: number; n: number } | null {
  const ppf = past
    .filter(q => q.fenceStyle === style && q.id !== excludeId && q.finalPrice > 0)
    .map(q => ({ q, feet: (q.runs ?? []).reduce((s, n) => s + n, 0) }))
    .filter(x => x.feet > 0)
    .map(x => x.q.finalPrice / x.feet)
    .sort((a, b) => a - b)
  if (ppf.length < 5) return null
  const at = (p: number) => ppf[Math.min(ppf.length - 1, Math.max(0, Math.round(p * (ppf.length - 1))))]
  return { low: at(0.1), high: at(0.9), n: ppf.length }
}

/** Far outside = more than 15% beyond the normal range. */
export function perFootCheck(perFoot: number, style: string, past: PastQuote[], excludeId?: string): string | null {
  if (!(perFoot > 0)) return null
  const n = normalPerFoot(style, past, excludeId)
  if (!n) return null
  const money = (v: number) => `$${v.toFixed(2)}`
  const range = `usually ${money(n.low)} to ${money(n.high)} a foot, from ${n.n} past quotes`
  if (perFoot > n.high * 1.15) return `${money(perFoot)} a foot is far above your past ${style} quotes (${range}).`
  if (perFoot < n.low * 0.85) return `${money(perFoot)} a foot is far below your past ${style} quotes (${range}).`
  return null
}

// ── Voice entry ───────────────────────────────────────────────────────────────

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/**
 * Spoken numbers as people say fence lengths: "one twenty" = 120, "one fifty
 * five" = 155, "a hundred and five" = 105, "eighty four" = 84, "120" = 120.
 * Returns the number and how many words it used, or null.
 */
function readNumber(words: string[], at: number): { value: number; used: number } | null {
  const w = words[at]
  if (w === undefined) return null
  if (/^\d+(\.\d+)?$/.test(w)) return { value: parseFloat(w), used: 1 }
  // Under 100: "eighty four", "twelve", "thirty".
  const small = (i: number): { value: number; used: number } | null => {
    const a = words[i]
    if (a === undefined) return null
    if (a in TENS) {
      const b = words[i + 1]
      return b && b in ONES && ONES[b] > 0 && ONES[b] < 10 ? { value: TENS[a] + ONES[b], used: 2 } : { value: TENS[a], used: 1 }
    }
    return a in ONES ? { value: ONES[a], used: 1 } : null
  }
  const hundredsFrom = (hundreds: number, i: number) => {
    if (words[i] === 'and') i += 1
    const t = small(i)
    return t ? { value: hundreds * 100 + t.value, used: i - at + t.used } : { value: hundreds * 100, used: i - at }
  }
  if (w === 'a' && words[at + 1] === 'hundred') return hundredsFrom(1, at + 2)
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

export interface SpokenSide { name: string; lengthIn: number; gate?: { type: GateType; widthIn: number } }

/**
 * "left side one twenty, back one fifty, right return thirty with a four
 * foot gate" → the sides named in the layout, with their lengths and gates.
 * Sides are matched by their names in this layout (longest names first).
 */
export function parseSpokenSides(text: string, sideNames: string[]): SpokenSide[] {
  const clean = text.toLowerCase().replace(/[^a-z0-9.' -]/g, ' ').replace(/(\d)'/g, '$1 feet ').replace(/-/g, ' ').replace(/\.(?!\d)/g, ' ')
  const words = clean.split(/\s+/).filter(Boolean)
  const names = [...sideNames].sort((a, b) => b.length - a.length).map(n => ({ n, w: n.toLowerCase().split(/\s+/) }))
  const out: SpokenSide[] = []
  let cur: SpokenSide | null = null
  let i = 0
  while (i < words.length) {
    const hit = names.find(({ w }) => w.every((x, k) => words[i + k] === x))
    if (hit) {
      if (cur) out.push(cur)
      cur = { name: hit.n, lengthIn: 0 }
      i += hit.w.length
      // The length: a number, then optional feet / inches / and a half.
      const num = readNumber(words, words[i] === 'is' ? i + 1 : i)
      if (num) {
        i = (words[i] === 'is' ? i + 1 : i) + num.used
        let inches = num.value * 12
        if (words[i] === 'feet' || words[i] === 'foot' || words[i] === 'ft') i += 1
        if (words[i] === 'and' && words[i + 1] === 'a' && words[i + 2] === 'half') { inches += 6; i += 3 }
        else {
          const inch = readNumber(words, words[i] === 'and' ? i + 1 : i)
          const after = words[i + (words[i] === 'and' ? 1 : 0) + (inch?.used ?? 0)]
          if (inch && inch.value < 12 && (after === 'inches' || after === 'inch' || after === 'in')) {
            inches += inch.value; i += (words[i] === 'and' ? 1 : 0) + inch.used + 1
          }
        }
        cur.lengthIn = inches
      }
      continue
    }
    if (cur && (words[i] === 'gate' || (words[i] === 'double' && words[i + 1] === 'gate') || (words[i] === 'walk' && words[i + 1] === 'gate'))) {
      // Look back a few words for "a four foot" / "ten foot double".
      const back = words.slice(Math.max(0, i - 4), i)
      const type: GateType = words[i] === 'double' || back.includes('double') ? 'double' : 'walk'
      let widthIn = GATE_WIDTH_IN[type]
      for (let k = 0; k < back.length; k++) {
        if (back[k + 1] === 'foot' || back[k + 1] === 'feet' || back[k + 1] === 'ft') {
          const n = readNumber(back, k)
          if (n && n.value > 0 && n.value <= 20) widthIn = n.value * 12
        }
      }
      cur.gate = { type, widthIn }
      i += words[i] === 'gate' ? 1 : 2
      continue
    }
    i += 1
  }
  if (cur) out.push(cur)
  return out.filter(s => s.lengthIn > 0 || s.gate)
}
