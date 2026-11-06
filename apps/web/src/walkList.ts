/**
 * The walk list (Jonathan, Nov 5 2026): on site the salesperson walks the fence
 * line with a measuring wheel and the phone builds the fence one step at a
 * time: feet, then what is there (a corner turning left or right, a gate of a
 * width, single or double, a tee where a fence branches off, an end post, or
 * back to start). No drawing at the house; the office draws the exact plan
 * later.
 *
 * It is turned into the same yard layout the quote has always been priced
 * from (yardLayout.ts deriveLayout), so the runs, posts, gates, sections, the 6
 * or 8 ft pick per run, farm fence spacing and wire rolls come out exactly as
 * the drawing would give them for the same fence:
 *   - a side is the fence between corners or ends; it is cut into runs at its
 *     gates, as a drawn side is (a tee does not cut the side it stands on: the
 *     branch's first post is counted as the style's tee post, as drawn)
 *   - the start is an end post; "Back to start" makes it a corner
 *   - a branch starts at its tee; another fence line starts with an end post
 * Turns left and right are for the rough sketch and the office's drawing only,
 * never the price (no price rule reads an angle).
 *
 * Saved on the quote as layout.walk (the salesperson's record of what was
 * measured), with the yard made from it as layout.yard.
 */

import { deriveLayout, type GateType, type SideGate, type TeePost, type YardLayout, type YardSide } from './yardLayout'

export type WalkWhat = 'corner' | 'gate' | 'tee' | 'end' | 'start'
export type Turn = 'left' | 'right'

export interface WalkStep {
  id: string
  /** Feet of fence walked to here, in inches (the gate's own width is not in it). */
  feetIn: number
  what: WalkWhat
  /** A corner: which way the fence turns (sketch and office drawing only). */
  turn?: Turn | null
  /** A gate: its opening and single (walk) or double. */
  gate?: { widthIn: number; type: GateType } | null
}

export interface WalkLine {
  id: string
  /** A branch: the tee step it starts from. Unset: a fence line of its own (starts with an end post). */
  fromTee?: string | null
  /** A branch: which way it goes from the tee, looking along the fence as it was walked (left when unset). */
  branchTurn?: Turn
  steps: WalkStep[]
}

export interface WalkList {
  v: 1
  lines: WalkLine[]
}

let seq = 0
export const walkId = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`
export const emptyWalk = (): WalkList => ({ v: 1, lines: [{ id: walkId('l'), steps: [] }] })

/** A line is finished once it ends (End post, Back to start). */
export const lineDone = (l: WalkLine) => { const last = l.steps[l.steps.length - 1]; return !!last && (last.what === 'end' || last.what === 'start') }
export const walkDone = (w: WalkList) => w.lines.length > 0 && w.lines.every(lineDone)

/** Every tee step, numbered in walking order ("Tee 1", "Tee 2"), with its line. */
export function teesOf(w: WalkList): Array<{ n: number; step: WalkStep; line: WalkLine }> {
  const out: Array<{ n: number; step: WalkStep; line: WalkLine }> = []
  for (const line of w.lines) for (const step of line.steps) if (step.what === 'tee') out.push({ n: out.length + 1, step, line })
  return out
}

/** Feet of fence (gates not counted), inches. */
export const fenceIn = (w: WalkList) => w.lines.reduce((t, l) => t + l.steps.reduce((s, x) => s + Math.max(0, x.feetIn || 0), 0), 0)
/** Feet including gates, inches (what the top of the screen shows). */
export const totalIn = (w: WalkList) => fenceIn(w) + w.lines.reduce((t, l) => t + l.steps.reduce((s, x) => s + (x.what === 'gate' ? Math.max(0, x.gate?.widthIn ?? 0) : 0), 0), 0)

const ft = (inches: number) => {
  const f = Math.round((inches / 12) * 100) / 100
  return `${Number.isInteger(f) ? f : f.toFixed(f * 10 % 1 === 0 ? 1 : 2)} ft`
}
export const feetText = ft

/** One step as the list reads it: "Side 1: 48 ft, Corner left", "Gate 4 ft single". */
export function stepLines(w: WalkList): Array<{ lineId: string; stepId: string; text: string; side: number; problem?: string }> {
  const out: Array<{ lineId: string; stepId: string; text: string; side: number; problem?: string }> = []
  let side = 0
  const tees = new Map(teesOf(w).map(t => [t.step.id, t.n]))
  for (const [li, line] of w.lines.entries()) {
    side += 1
    for (const s of line.steps) {
      const feet = s.feetIn > 0 ? `${ft(s.feetIn)}, ` : ''
      const what = s.what === 'corner' ? `Corner ${s.turn ?? ''}`.trim()
        : s.what === 'gate' ? `Gate ${ft(s.gate?.widthIn ?? 0)} ${s.gate?.type === 'double' ? 'double' : 'single'}`
          : s.what === 'tee' ? `Tee ${tees.get(s.id)} (a fence branches off here)`
            : s.what === 'end' ? 'End post' : 'Back to start'
      const problem = !(s.feetIn > 0) && s.what !== 'gate' && !(s.what === 'start' || s.what === 'end') ? `Side ${side} has no feet yet. Tap it to add the feet.` : undefined
      // The first step of a branch or of another fence line says which it is.
      const head = s !== line.steps[0] ? '' : line.fromTee && tees.has(line.fromTee) ? `Branch from Tee ${tees.get(line.fromTee)} (goes ${line.branchTurn ?? 'left'}) · ` : li > 0 && !line.fromTee ? `Fence line ${w.lines.filter((l, k) => k <= li && !l.fromTee).length} · ` : ''
      out.push({ lineId: line.id, stepId: s.id, side, text: `${head}Side ${side}: ${feet}${what}`, ...(problem ? { problem } : {}) })
      if (s.what === 'corner' || s.what === 'end' || s.what === 'start') side += 1
    }
    if (li < w.lines.length - 1 && lineDone(line)) side -= 1
  }
  return out
}

/**
 * The fence piece by piece in walking order, for the crew (the install packet): "Side 1: 13 ft fence", "4 ft single
 * gate", "Side 1: 13 ft fence, then corner right". A branch or another fence line says so on its first row.
 */
export function walkPieceRows(w: WalkList): string[] {
  const out: string[] = []
  const tees = new Map(teesOf(w).map(t => [t.step.id, t.n]))
  for (const l of stepLines(w)) {
    const line = w.lines.find(x => x.id === l.lineId)!
    const s = line.steps.find(x => x.id === l.stepId)!
    const head = l.text.includes(' · ') ? `${l.text.split(' · ')[0]} · ` : ''
    const fence = s.feetIn > 0 ? `Side ${l.side}: ${ft(s.feetIn)} fence` : ''
    if (s.what === 'gate') {
      if (fence) out.push(head + fence)
      out.push(`${fence ? '' : head}${ft(s.gate?.widthIn ?? 0)} ${s.gate?.type === 'double' ? 'double' : 'single'} gate`)
      continue
    }
    const then = s.what === 'corner' ? `corner ${s.turn ?? 'left'}` : s.what === 'tee' ? `tee ${tees.get(s.id)} (a branch starts here)` : s.what === 'end' ? 'end post' : 'back to the start'
    out.push(head + (fence ? `${fence}, then ${then}` : `Side ${l.side}: ${then}`))
  }
  return out
}

/** What to fix before prices, in plain words; [] when the walk can be priced. */
export function walkProblems(w: WalkList): string[] {
  const out: string[] = []
  if (!w.lines.some(l => l.steps.length)) return ['Walk the fence: type the feet to the first corner, gate or end.']
  const ids = new Set(teesOf(w).map(t => t.step.id))
  for (const [i, line] of w.lines.entries()) {
    if (!line.steps.length) continue
    if (!lineDone(line)) out.push(`${w.lines.length > 1 ? `Fence line ${i + 1}` : 'The fence'} has no end yet. Finish it with End post or Back to start.`)
    if (line.fromTee && !ids.has(line.fromTee)) out.push(`A branch starts at a tee that is no longer there. Remove the branch or add the tee back.`)
    for (const s of line.steps) if (s.what === 'gate' && !(s.gate && s.gate.widthIn > 0)) out.push('A gate has no width. Tap it to add the width.')
  }
  for (const l of stepLines(w)) if (l.problem) out.push(l.problem)
  if (!(fenceIn(w) > 0)) out.push('There are no feet of fence yet.')
  return [...new Set(out)]
}

// ── To the yard layout the quote is priced from ──────────────────────────────

/** Headings for the sketch and the office drawing: square corners, left or right. */
const HEADINGS = [0, 90, 180, 270]

/**
 * The yard layout for this walk: one side per stretch between corners or ends,
 * its gates where they were walked (exact feet from the side's start), its
 * turns as headings, branches as tees, Back to start as a corner joining the
 * line's first side.
 */
/** The lines in the order they are laid out: a branch after the line its tee is on. */
function lineOrder(w: WalkList): WalkLine[] {
  const done = new Set<string>()
  const order: WalkLine[] = []
  const place = (l: WalkLine, depth = 0) => {
    if (done.has(l.id) || depth > 20) return
    if (l.fromTee) {
      const host = w.lines.find(x => x.steps.some(s => s.id === l.fromTee))
      if (host && !done.has(host.id)) place(host, depth + 1)
    }
    done.add(l.id); order.push(l)
  }
  for (const l of w.lines) place(l)
  return order
}

export function walkToYard(w: WalkList): YardLayout {
  const sides: YardSide[] = []
  /** Where each tee step stands: its side and inches along it. */
  const teeAt = new Map<string, { sideId: string; atIn: number }>()
  const order = lineOrder(w)
  let n = 0
  for (const line of order) {
    if (!line.steps.length) continue
    const tee = line.fromTee ? teeAt.get(line.fromTee) : undefined
    let heading = 0
    if (tee) {
      const host = sides.find(s => s.id === tee.sideId)
      heading = ((host?.heading ?? 0) + (line.branchTurn === 'right' ? 270 : 90)) % 360
    }
    const first = sides.length
    let cur: YardSide | null = null
    let at = 0
    const open = (): YardSide => {
      n += 1
      const s: YardSide = { id: `w${line.id}_${n}`, name: `Side ${n}`, on: true, lengthIn: 0, startFinish: cur ? 'corner' : 'free', endFinish: 'free', gate: null, skip: null, heading }
      if (!cur && tee) s.tee = { sideId: tee.sideId, atIn: tee.atIn }
      sides.push(s); cur = s; at = 0
      return s
    }
    let side = open()
    for (const step of line.steps) {
      const feet = Math.max(0, step.feetIn || 0)
      at += feet
      side.lengthIn = at
      if (step.what === 'gate') {
        const g: SideGate = { type: step.gate?.type ?? 'walk', widthIn: Math.max(0, step.gate?.widthIn ?? 0), position: 'distance', distanceIn: at }
        const gates = [...(side.gates ?? (side.gate ? [side.gate] : [])), g]
        if (gates.length === 1) { side.gate = g; delete side.gates } else { side.gate = null; side.gates = gates }
        at += g.widthIn
        side.lengthIn = at
      } else if (step.what === 'tee') {
        teeAt.set(step.id, { sideId: side.id, atIn: at })
      } else if (step.what === 'corner') {
        side.endFinish = 'corner'
        heading = (heading + (step.turn === 'left' ? 90 : step.turn === 'right' ? 270 : 90)) % 360
        side = open()
      } else if (step.what === 'end') {
        side.endFinish = 'free'
      } else if (step.what === 'start') {
        // Back to start: the end is a corner with the line's first side.
        side.endFinish = 'corner'
        side.joinsSideId = sides[first].id
        sides[first].startFinish = 'corner'
      }
    }
    void HEADINGS
  }
  return { shape: 'custom', closed: false, sides }
}

/**
 * The stretches of fence the walk is priced by, in the priced order (walkToYard, then deriveLayout's runs): each
 * ends at a gate, a corner, an end post or back at the start (a tee does not end one), with the steps it is made of.
 * Stretches with no feet are left out, as the price leaves them out.
 */
export function walkPieces(w: WalkList): Array<{ inches: number; stepIds: string[] }> {
  const out: Array<{ inches: number; stepIds: string[] }> = []
  for (const line of lineOrder(w)) {
    let inches = 0, ids: string[] = []
    const cut = () => { if (inches > 0) out.push({ inches, stepIds: ids }); inches = 0; ids = [] }
    for (const step of line.steps) {
      inches += Math.max(0, step.feetIn || 0); ids.push(step.id)
      if (step.what !== 'tee') cut()
    }
    cut()
  }
  return out
}

/**
 * The steps to check with a tape measure: the priced runs flagged (quoteChecks tapeFlags) laid on the walk's
 * stretches. Only when the stretches are the runs, length for length; otherwise none is marked.
 */
export function tapeSteps(w: WalkList, runs: Array<{ inches: number }>, flags: boolean[]): Set<string> {
  const pieces = walkPieces(w)
  const out = new Set<string>()
  if (pieces.length !== runs.length || pieces.some((p, i) => Math.abs(p.inches - runs[i].inches) > 0.01)) return out
  pieces.forEach((p, i) => { if (flags[i]) out.add(p.stepIds[p.stepIds.length - 1]) })
  return out
}

/**
 * Where each walked side starts and ends on the rough sketch (feet, square corners, separate fence lines side by
 * side, a branch from its tee), keyed by walkToYard's side id, with the walk steps that make it. A side that goes
 * back to the start ends on the line's first post. The office site plan lays a walk list out with this.
 */
export function walkSideEnds(w: WalkList): Map<string, { a: { x: number; y: number }; b: { x: number; y: number }; steps: string[] }> {
  const sk = sketchOf(w)
  const sketch = new Map(w.lines.map((l, i) => [l.id, sk[i]]))
  const out = new Map<string, { a: { x: number; y: number }; b: { x: number; y: number }; steps: string[] }>()
  let n = 0
  for (const line of lineOrder(w)) {
    if (!line.steps.length) continue
    const pts = sketch.get(line.id)?.points ?? []
    n += 1
    let from = 0, ids: string[] = []
    line.steps.forEach((s, i) => {
      ids.push(s.id)
      const last = i === line.steps.length - 1
      if (s.what === 'corner' || last) {
        const b = s.what === 'start' ? pts[0] : pts[i + 1]
        out.set(`w${line.id}_${n}`, { a: pts[from], b, steps: ids })
        if (s.what === 'corner') { n += 1; from = i + 1; ids = [] }
      }
    })
  }
  return out
}

/** The runs, posts and gates the walk prices with (deriveLayout of walkToYard). */
export function walkResult(w: WalkList, nearIn: number, teeAs: TeePost) {
  return deriveLayout(walkToYard(w), nearIn, { teeAs })
}

// ── From a drawn yard (the price proof; an old quote's change order) ─────────

/**
 * The walk list of a drawn yard: each side walked in order, its gate (and skip,
 * as an end post and another fence line) where deriveLayout puts it, corners
 * as left turns, a closed yard back to start, a tee side as a branch. Same
 * runs, posts and gates as the drawing (tests/walkList.test.ts proves it).
 */
export function yardToWalk(yard: YardLayout, nearIn: number): WalkList {
  const r = deriveLayout(yard, nearIn)
  const lines: WalkLine[] = []
  const teeSteps = new Map<string, string>() // "sideId@atIn" -> tee step id, added on the host side's walk
  // Tees first: where each tee side starts along its host.
  const teeMarks = new Map<string, number[]>()
  yard.sides.forEach((s, i) => { if (s.on && s.lengthIn > 0 && s.tee && yard.sides.findIndex(x => x.id === s.tee!.sideId) < i) teeMarks.set(s.tee.sideId, [...(teeMarks.get(s.tee.sideId) ?? []), s.tee.atIn]) })
  let line: WalkLine | null = null
  // Every side switched on, measured or not: a side not measured yet still has its corners counted (deriveLayout).
  const sidesOn = yard.sides.map((s, i) => ({ s, i, res: r.sides[i] })).filter(x => x.s.on)
  for (const [k, { s, i, res }] of sidesOn.entries()) {
    const prevJoins = res.finishes.start === 'corner' && !!line
    if (!prevJoins || s.tee) { line = { id: walkId('l'), steps: [] }; lines.push(line) }
    if (s.tee) {
      const id = teeSteps.get(`${s.tee.sideId}@${s.tee.atIn}`)
      if (id) line!.fromTee = id
    }
    // Along the side: its gate, skip and tee marks in order.
    type Mark = { at: number; kind: 'gate' | 'skipFrom' | 'skipTo' | 'tee'; w?: number; atTee?: number }
    const marks: Mark[] = []
    if (res.gateSpan) marks.push({ at: res.gateSpan[0], kind: 'gate', w: res.gateSpan[1] - res.gateSpan[0] })
    for (const [a, b] of (res as unknown as { gateSpans?: Array<[number, number]> }).gateSpans ?? []) if (!res.gateSpan || a !== res.gateSpan[0]) marks.push({ at: a, kind: 'gate', w: b - a })
    if (res.skipSpan) { marks.push({ at: res.skipSpan[0], kind: 'skipFrom' }); marks.push({ at: res.skipSpan[1], kind: 'skipTo' }) }
    for (const t of teeMarks.get(s.id) ?? []) marks.push({ at: t, kind: 'tee', atTee: t })
    marks.sort((a, b) => a.at - b.at)
    let pos = 0
    const gateOf = (m: Mark) => (s.gates ?? (s.gate ? [s.gate] : [])).find(g => Math.abs(g.widthIn - (m.w ?? 0)) < 0.01) ?? s.gate
    for (const m of marks) {
      if (m.kind === 'gate') {
        line!.steps.push({ id: walkId('g'), feetIn: m.at - pos, what: 'gate', gate: { widthIn: m.w!, type: gateOf(m)?.type ?? 'walk' } })
        pos = m.at + m.w!
      } else if (m.kind === 'tee') {
        const id = walkId('t')
        line!.steps.push({ id, feetIn: m.at - pos, what: 'tee' })
        teeSteps.set(`${s.id}@${m.atTee}`, id)
        pos = m.at
      } else if (m.kind === 'skipFrom') {
        line!.steps.push({ id: walkId('e'), feetIn: m.at - pos, what: 'end' })
        pos = m.at
      } else {
        line = { id: walkId('l'), steps: [] }; lines.push(line)
        pos = m.at
      }
    }
    const rest = s.lengthIn - pos
    const end = res.finishes.end
    const next = sidesOn[k + 1]
    const closesToFirst = end === 'corner' && yard.closed && i === yard.sides.length - 1
    if (closesToFirst) line!.steps.push({ id: walkId('s'), feetIn: rest, what: 'start' })
    else if (end === 'corner' && next) line!.steps.push({ id: walkId('c'), feetIn: rest, what: 'corner', turn: 'left' })
    else line!.steps.push({ id: walkId('e'), feetIn: rest, what: 'end' })
  }
  return { v: 1, lines: lines.filter(l => l.steps.length) }
}

// ── The rough sketch: square corners from the turns, not to scale ────────────

export interface SketchLine { points: Array<{ x: number; y: number }>; gates: Array<{ x: number; y: number }>; tees: Array<{ x: number; y: number; n: number }> }

/** Points of each fence line walked with square corners (feet, y up), gates and tees marked. */
export function sketchOf(w: WalkList): SketchLine[] {
  const out: SketchLine[] = []
  const teePos = new Map<string, { x: number; y: number; dir: number }>()
  const nums = new Map(teesOf(w).map(t => [t.step.id, t.n]))
  let offsetX = 0
  for (const line of w.lines) {
    let x = 0, y = 0, dir = 0
    const t = line.fromTee ? teePos.get(line.fromTee) : undefined
    if (t) { x = t.x; y = t.y; dir = (t.dir + (line.branchTurn === 'right' ? 270 : 90)) % 360 } else { x = offsetX; y = 0 }
    const pts = [{ x, y }]
    const gates: SketchLine['gates'] = [], tees: SketchLine['tees'] = []
    const go = (d: number) => { const r = (dir * Math.PI) / 180; x += Math.cos(r) * d; y += Math.sin(r) * d }
    for (const s of line.steps) {
      go(Math.max(0, s.feetIn) / 12)
      if (s.what === 'gate') { const w2 = (s.gate?.widthIn ?? 0) / 12; go(w2 / 2); gates.push({ x, y }); go(w2 / 2) }
      pts.push({ x, y })
      if (s.what === 'tee') { teePos.set(s.id, { x, y, dir }); tees.push({ x, y, n: nums.get(s.id) ?? 0 }) }
      if (s.what === 'corner') dir = (dir + (s.turn === 'right' ? 270 : 90)) % 360
      if (s.what === 'start') pts.push({ ...pts[0] })
    }
    out.push({ points: pts, gates, tees })
    if (!t) offsetX = Math.max(offsetX, ...pts.map(p => p.x)) + 20
  }
  return out
}

/** The table the crew and the office read: side, feet, what is at its end, its gates. */
export function walkTable(w: WalkList): Array<{ side: string; feet: string; end: string; gates: string }> {
  const yard = walkToYard(w)
  return yard.sides.map(s => {
    const gates = (s.gates ?? (s.gate ? [s.gate] : [])).map(g => `${ft(g.widthIn)} ${g.type === 'double' ? 'double' : 'single'} at ${ft(g.distanceIn ?? 0)}`)
    const end = s.joinsSideId ? 'Back to start (corner)' : s.endFinish === 'corner' ? 'Corner' : 'End post'
    return { side: `${s.name}${s.tee ? ` (branch from ${yard.sides.find(x => x.id === s.tee!.sideId)?.name ?? 'a tee'})` : ''}`, feet: ft(s.lengthIn), end, gates: gates.join('; ') || '—' }
  })
}

// ── Pictures: the rough sketch, and the sheet the crew and the office read ───

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** The rough sketch as an SVG body fitted into w × h (square corners, gates as gaps, tees numbered), and its label. */
export function sketchSvgBody(walk: WalkList, w: number, h: number, opts: { label?: boolean } = {}): string {
  const lines = sketchOf(walk)
  const pts = lines.flatMap(l => l.points)
  if (!pts.length) return ''
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  // Words grow with the picture: the install packet's sketch is drawn wide and shown phone width.
  const fs = Math.max(12, Math.round(w / 30))
  const pad = Math.max(24, fs * 2), lab = opts.label === false ? 0 : fs + 10
  const sx = (w - pad * 2) / Math.max(1, maxX - minX), sy = (h - pad * 2 - lab) / Math.max(1, maxY - minY)
  const k = Math.min(sx, sy)
  const X = (x: number) => pad + (x - minX) * k, Y = (y: number) => h - pad - (y - minY) * k
  let out = ''
  for (const l of lines) {
    out += `<polyline points="${l.points.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>`
    for (const p of l.points) out += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5" fill="#111827"/>`
    for (const g of l.gates) out += `<rect x="${(X(g.x) - 7).toFixed(1)}" y="${(Y(g.y) - 7).toFixed(1)}" width="14" height="14" fill="#fff" stroke="#c2410c" stroke-width="2.5"/>`
    for (const t of l.tees) out += `<text x="${(X(t.x) + 6).toFixed(1)}" y="${(Y(t.y) - 6).toFixed(1)}" font-size="${fs}" font-family="Arial" fill="#1d4ed8">Tee ${t.n}</text>`
  }
  // Where each fence line was started (a branch starts at its tee): so the sketch reads in the table's order.
  for (const [i, l] of lines.entries()) {
    if (walk.lines[i]?.fromTee || !l.points.length) continue
    const p = l.points[0]
    out += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${(fs / 2).toFixed(1)}" fill="#15803d"/><text x="${(X(p.x) - fs * 0.6).toFixed(1)}" y="${(Y(p.y) - fs * 0.8).toFixed(1)}" font-size="${fs}" font-weight="bold" font-family="Arial" fill="#15803d" paint-order="stroke" stroke="#fff" stroke-width="4">Start</text>`
  }
  if (lab) out += `<text x="${w / 2}" y="${h - 6}" text-anchor="middle" font-size="${fs}" font-family="Arial" fill="#4b5563">Rough sketch, not to scale</text>`
  return out
}

/** The walk list sheet (install packet, permit area): the table of sides and the rough sketch, as one SVG. */
/** The rough sketch alone, labelled "Rough sketch, not to scale" (the install packet, beside its own table of the walk). */
export function walkSketchSvg(walk: WalkList): string {
  const W = 760, H = 380
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${sketchSvgBody(walk, W, H, { label: true })}</svg>`
}

export function walkSheetSvg(walk: WalkList): string {
  const rows = walkTable(walk)
  const W = 760, rowH = 24, top = 46
  const tableH = top + rowH * (rows.length + 1) + 16
  const sketchH = 360
  const H = tableH + sketchH
  const cols = [16, 230, 330, 470]
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>`
  s += `<text x="16" y="28" font-size="18" font-weight="bold" font-family="Arial" fill="#111827">Fence as measured (walk list) · ${esc(feetText(totalIn(walk)))} with gates</text>`
  const head = ['Side', 'Feet', 'At its end', 'Gates (width, single or double, feet from the side’s start)']
  head.forEach((t, i) => { s += `<text x="${cols[i]}" y="${top + 16}" font-size="12" font-weight="bold" font-family="Arial" fill="#374151">${esc(t)}</text>` })
  rows.forEach((r, k) => {
    const y = top + rowH * (k + 1) + 16
    if (k % 2 === 0) s += `<rect x="8" y="${y - 16}" width="${W - 16}" height="${rowH}" fill="#f3f4f6"/>`
    ;[r.side, r.feet, r.end, r.gates].forEach((t, i) => { s += `<text x="${cols[i]}" y="${y}" font-size="13" font-family="Arial" fill="#111827">${esc(t)}</text>` })
  })
  s += `<g transform="translate(0 ${tableH})">${sketchSvgBody(walk, W, sketchH)}</g></svg>`
  return s
}
