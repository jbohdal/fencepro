/**
 * Two drawing change orders on one job (round 3 walkthrough, Oct 26 2026):
 * CO-1 made the Back 50 -> 60 ft, CO-2 put a walk gate in; both were signed,
 * but CO-2 had been drawn from the signed quote, so once it was approved its
 * drawing (Back 50) replaced CO-1's and the job, pull sheet and installer card
 * lost 10 ft.
 *
 * Each change order with a drawing keeps the drawing it started from (its
 * `base`) as well as the drawing it ends with. What it changes is the
 * difference between the two, side by side (by the yard side's id), and the
 * job's drawing is rebuilt from the signed quote with every approved change
 * order's own difference put on in the order they were approved. So signing
 * them in any order never drops one's change, and a new change order starts
 * from the drawing with every signed and still open change order's change in
 * it.
 *
 * Pure, no imports: the server (lib/changeOrderWork.ts) and the web app
 * (ChangeOrders.tsx) run the same code. Turning a yard into runs and posts
 * (yardLayout.ts deriveLayout, at the style's section width) is passed in.
 */

type Json = any

/** The work's shape: what the drawing decides (never a price or a cost). */
export interface WorkShape {
  fenceStyle: string
  runs: number[]
  runRails?: string[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  /** The yard as drawn (null: a quote typed as a run list). */
  yard: Json | null
  /** Line posts beyond the runs' own (vinyl tees). */
  teeLinePosts?: number
}

/** A yard turned into what the calculator takes (yardLayout.ts deriveLayout at the style's width). */
export interface DerivedRuns { runs: number[]; corners: number; ends: number; walkGates: number; dblGates: number; linePosts?: number; runNames?: string[] }
export type DeriveRuns = (yard: Json, fenceStyle: string) => DerivedRuns | null

/** One change order's change: the drawing it started from and the one it ends with. */
export interface ChangeStep { number: number; base: WorkShape; work: WorkShape }

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The shape of a saved quote, a change order's stored work, or a shape already. */
export function shapeOf(x: Json): WorkShape {
  const layout = isObj(x?.layout) ? x.layout : null
  const yard = isObj(x?.yard) ? x.yard : isObj(layout?.yard) ? layout!.yard : null
  const runs: number[] = Array.isArray(x?.runs) ? x.runs.map((r: Json) => num(typeof r === 'number' ? r : r?.ft)).filter((f: number) => f > 0) : []
  const rails = Array.isArray(x?.runRails) ? x.runRails.map(String) : undefined
  const tee = num(x?.teeLinePosts, num(layout?.teeLinePosts))
  return {
    fenceStyle: String(x?.fenceStyle ?? ''), runs, ...(rails && rails.some((r: string) => r !== 'auto') ? { runRails: rails } : {}),
    corners: num(x?.corners), ends: num(x?.ends), walkGates: num(x?.walkGates), dblGates: num(x?.dblGates),
    tearOutSections: num(x?.tearOutSections), tearOutGates: num(x?.tearOutGates), yard, ...(tee > 0 ? { teeLinePosts: tee } : {}),
  }
}

/** The yard without the site plan's hand placed corners and photo (they do not change the work). */
const workYard = (y: Json) => (isObj(y) ? { ...y, plan: undefined } : null)

/** The same work: same style, runs, posts, gates, tear out and yard. */
export function sameShape(a: WorkShape, b: WorkShape): boolean {
  const k = (s: WorkShape) => [s.fenceStyle, s.runs, s.corners, s.ends, s.walkGates, s.dblGates, s.tearOutSections, s.tearOutGates, workYard(s.yard)]
  return same(k(a), k(b))
}

const sideName = (s: Json) => String(s?.name || 'a side')
const FIELD_WORDS: Record<string, string> = { lengthIn: 'length', gate: 'gate', skip: 'skip', on: 'fence on or off', startFinish: 'start', endFinish: 'end', heading: 'direction', name: 'name', tee: 'tee', meetsHouse: 'house end' }

/**
 * Put one change (base -> mine) on the yard as it is now. A side is matched by
 * its id; each of its fields that the change touched takes the change's value.
 * When the yard now has a different value there too (another change order
 * changed the same thing), the change's value wins and it is said.
 */
export function mergeYard(base: Json, mine: Json, cur: Json): { yard: Json; conflicts: string[] } {
  const conflicts: string[] = []
  const bSides: Json[] = Array.isArray(base?.sides) ? base.sides : []
  const mSides: Json[] = Array.isArray(mine?.sides) ? mine.sides : []
  const cSides: Json[] = Array.isArray(cur?.sides) ? cur.sides : []
  const byId = (xs: Json[]) => new Map(xs.filter(s => s && s.id).map(s => [String(s.id), s]))
  const bMap = byId(bSides), mMap = byId(mSides)
  const out: Json[] = []
  for (const c of cSides) {
    const id = String(c?.id ?? '')
    const b = bMap.get(id), m = mMap.get(id)
    if (!b) { out.push(c); continue }                       // added since: not this change's
    if (!m) {                                                 // this change took the side out
      if (!same(c, b)) conflicts.push(`${sideName(c)} was changed by another change order and taken out by this one`)
      continue
    }
    const next = { ...c }
    for (const key of new Set([...Object.keys(b), ...Object.keys(m)])) {
      if (key === 'id' || same(m[key], b[key])) continue
      if (!same(c[key], b[key]) && !same(c[key], m[key])) conflicts.push(`${sideName(c)}: ${FIELD_WORDS[key] ?? key}`)
      if (m[key] === undefined) delete next[key]; else next[key] = m[key]
    }
    out.push(next)
  }
  // Sides this change added, after the side before them in its drawing.
  const have = new Set(out.map(s => String(s?.id ?? '')))
  mSides.forEach((m, i) => {
    const id = String(m?.id ?? '')
    if (!id || bMap.has(id) || have.has(id)) return
    let at = out.length
    for (let j = i - 1; j >= 0; j--) { const k = out.findIndex(s => String(s?.id) === String(mSides[j]?.id)); if (k >= 0) { at = k + 1; break } }
    out.splice(at, 0, m); have.add(id)
  })
  // The yard's own fields (shape, closed, counts typed over, the site plan).
  const yard: Json = { ...(isObj(cur) ? cur : {}) }
  for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(mine ?? {})])) {
    if (key === 'sides' || same(mine?.[key], base?.[key])) continue
    if (key !== 'plan' && !same(cur?.[key], base?.[key]) && !same(cur?.[key], mine?.[key])) conflicts.push(`the yard's ${key === 'cornersOverride' ? 'corner count' : key === 'endsOverride' ? 'end post count' : key}`)
    if (mine?.[key] === undefined) delete yard[key]; else yard[key] = mine[key]
  }
  yard.sides = out
  return { yard, conflicts }
}

/** A count: the change's difference put on the count now. */
const plus = (cur: number, base: number, mine: number) => Math.max(0, cur + (mine - base))
/** One value: the change's when it changed it, else as it is now. */
function pick<T>(cur: T, base: T, mine: T, what: string, conflicts: string[]): T {
  if (same(mine, base)) return cur
  if (!same(cur, base) && !same(cur, mine)) conflicts.push(what)
  return mine
}

/**
 * The work now with one change order's change put on it. When the work now
 * is what the change order was drawn from, it is the change order's own
 * drawing, untouched.
 */
export function applyChange(cur: WorkShape, step: ChangeStep, derive: DeriveRuns): { shape: WorkShape; conflicts: string[]; merged: boolean } {
  const { base, work: mine } = step
  if (sameShape(base, cur)) return { shape: mine, conflicts: [], merged: false }
  const conflicts: string[] = []
  const fenceStyle = pick(cur.fenceStyle, base.fenceStyle, mine.fenceStyle, 'the fence style', conflicts)
  const out: WorkShape = {
    ...cur, fenceStyle,
    tearOutSections: plus(cur.tearOutSections, base.tearOutSections, mine.tearOutSections),
    tearOutGates: plus(cur.tearOutGates, base.tearOutGates, mine.tearOutGates),
  }
  if (cur.yard && base.yard && mine.yard) {
    const m = mergeYard(base.yard, mine.yard, cur.yard)
    conflicts.push(...m.conflicts)
    out.yard = m.yard
    const d = derive(m.yard, fenceStyle)
    if (d) {
      Object.assign(out, { runs: d.runs.filter(f => f > 0), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates })
      if (num(d.linePosts) > 0) out.teeLinePosts = d.linePosts; else delete out.teeLinePosts
      // Rails picked run by run belong to the runs they were picked for: kept only while the runs are the same.
      if (!same(out.runs, cur.runs)) delete out.runRails
      return { shape: out, conflicts, merged: true }
    }
  }
  // A run list (no drawing): run by run when the list is as long as it was, else the whole list.
  if (mine.runs.length === base.runs.length && cur.runs.length === base.runs.length) {
    out.runs = cur.runs.map((f, i) => pick(f, base.runs[i], mine.runs[i], `run ${i + 1}`, conflicts))
  } else if (!same(mine.runs, base.runs)) {
    if (!same(cur.runs, base.runs)) conflicts.push('the runs')
    out.runs = mine.runs
    delete out.runRails
  }
  out.corners = plus(cur.corners, base.corners, mine.corners)
  out.ends = plus(cur.ends, base.ends, mine.ends)
  out.walkGates = plus(cur.walkGates, base.walkGates, mine.walkGates)
  out.dblGates = plus(cur.dblGates, base.dblGates, mine.dblGates)
  // A drawing that no longer matches the runs is left out (the runs are the work).
  if (out.yard && !same(out.runs, cur.runs)) out.yard = null
  return { shape: out, conflicts, merged: true }
}

/** The work after each change in turn, from the signed quote's. */
export function foldChanges(start: WorkShape, steps: ChangeStep[], derive: DeriveRuns): { shape: WorkShape; after: Array<{ number: number; shape: WorkShape; merged: boolean; conflicts: string[] }> } {
  let cur = start
  const after: Array<{ number: number; shape: WorkShape; merged: boolean; conflicts: string[] }> = []
  for (const s of steps) {
    const r = applyChange(cur, s, derive)
    after.push({ number: s.number, shape: r.shape, merged: r.merged, conflicts: r.conflicts })
    cur = r.shape
  }
  return { shape: cur, after }
}

/** What a change touches: "Back: length", "Left side: gate" (to say when two open change orders touch the same thing). */
export function touches(step: ChangeStep): string[] {
  const out: string[] = []
  const { base, work: mine } = step
  if (base.yard && mine.yard) {
    const bMap = new Map((base.yard.sides ?? []).map((s: Json) => [String(s.id), s]))
    for (const m of mine.yard.sides ?? []) {
      const b: Json = bMap.get(String(m.id))
      if (!b) { out.push(`${sideName(m)}: added`); continue }
      for (const key of new Set([...Object.keys(b), ...Object.keys(m)])) if (key !== 'id' && !same(m[key], b[key])) out.push(`${sideName(m)}: ${FIELD_WORDS[key] ?? key}`)
    }
    for (const b of base.yard.sides ?? []) if (!(mine.yard.sides ?? []).some((m: Json) => String(m.id) === String(b.id))) out.push(`${sideName(b)}: taken out`)
  } else if (!same(mine.runs, base.runs)) out.push('the runs')
  if (mine.fenceStyle !== base.fenceStyle) out.push('the fence style')
  return out
}

// ── A change order's own words (round 3 recheck, Oct 26 2026) ────────────────
//
// Two drawing change orders open on one job: CO-1 said "Add 10 ft of fence,
// 2 panels more (146 ft to 156 ft)", the whole fence before and after, counted
// from the drawing it started on. CO-2 was signed first, so the job went 142 to
// 152 ft and CO-1's words were no longer true. A change order's words now say
// only its own change, side by side ("Left side 40 ft → 50 ft"), which stays
// true whatever order they are signed in (each side is merged on its own, and
// panels are counted per run, never pooled).

/** One side (or run) the change makes longer, shorter, adds or takes out; feet, null when not there. */
export interface SideChange { name: string; wasFt: number | null; nowFt: number | null }

const ftIn = (inches: unknown) => Math.round((num(inches) / 12) * 100) / 100
const fenced = (s: Json) => !!s && s.on !== false && num(s.lengthIn) > 0

/** The sides (by id) whose length changed, were added or taken out; else the runs, when the list is as long. Null: no way to say it side by side. */
export function sideChanges(base: WorkShape, mine: WorkShape): SideChange[] | null {
  if (base.yard && mine.yard && Array.isArray(base.yard.sides) && Array.isArray(mine.yard.sides)) {
    const bMap = new Map<string, Json>((base.yard.sides as Json[]).filter(s => s?.id).map(s => [String(s.id), s]))
    const mIds = new Set((mine.yard.sides as Json[]).map(s => String(s?.id ?? '')))
    const out: SideChange[] = []
    for (const m of mine.yard.sides as Json[]) {
      const b = bMap.get(String(m?.id ?? ''))
      const was = fenced(b) ? ftIn(b.lengthIn) : null, now = fenced(m) ? ftIn(m.lengthIn) : null
      if (was !== now) out.push({ name: sideName(m), wasFt: was, nowFt: now })
    }
    for (const b of base.yard.sides as Json[]) if (!mIds.has(String(b?.id ?? '')) && fenced(b)) out.push({ name: sideName(b), wasFt: ftIn(b.lengthIn), nowFt: null })
    return out
  }
  if (base.runs.length && base.runs.length === mine.runs.length) {
    const out: SideChange[] = []
    base.runs.forEach((f, i) => { if (f !== mine.runs[i]) out.push({ name: `Run ${i + 1}:`, wasFt: f, nowFt: mine.runs[i] }) })
    return out
  }
  return null
}

/** "Left side 40 ft → 50 ft", "Front 20 ft added", "Back taken out (60 ft)", joined with commas. Null when nothing to say. */
export function sideChangeWords(changes: SideChange[] | null): string | null {
  if (!changes || !changes.length) return null
  return changes.map(c => c.wasFt !== null && c.nowFt !== null ? `${c.name} ${c.wasFt} ft → ${c.nowFt} ft`
    : c.nowFt !== null ? `${c.name} ${c.nowFt} ft added` : `${c.name} taken out (${c.wasFt} ft)`).join(', ')
}

/** A change order's own change, side by side, from the drawing it started on and the one it ends with. */
export function ownChangeWords(work: Json): string | null {
  if (!isObj(work) || !isObj(work.base)) return null
  return sideChangeWords(sideChanges(shapeOf(work.base), shapeOf(work)))
}

/** Gate widths when a drawing's gate has none (yardLayout.ts GATE_WIDTH_IN). */
const GATE_IN: Record<string, number> = { walk: 48, double: 120 }
const gateKind = (g: Json) => (g?.type === 'double' ? 'double' : 'walk')
const gateFt = (g: Json) => Math.round(((num(g?.widthIn) || GATE_IN[gateKind(g)]) / 12) * 100) / 100
/** "the Back side", "the Left side" (a name that says side already), "the Left return" (as changeOrderDraft.ts names it). */
export const theSide = (name: string) => `the ${/(^|\s)(side|return|run)$/i.test(name) ? name : `${name} side`}`

/**
 * The gates a change puts in, takes out or changes, side by side (round 3
 * recheck, Oct 26 2026: the crew packet said "CO-2: added a walk gate and
 * removed 4 ft", with no side): "a walk gate in the Back side (4 ft of fence
 * becomes the gate)", "the walk gate in the Front side taken out", "the gate
 * in the Back side is now a double gate (10 ft)". Empty when no drawing.
 */
export function sideGateChanges(base: WorkShape, mine: WorkShape): Array<{ kind: 'added' | 'removed' | 'changed'; words: string }> {
  if (!base.yard || !mine.yard || !Array.isArray(base.yard.sides) || !Array.isArray(mine.yard.sides)) return []
  const bMap = new Map<string, Json>((base.yard.sides as Json[]).filter(s => s?.id).map(s => [String(s.id), s]))
  const out: Array<{ kind: 'added' | 'removed' | 'changed'; words: string }> = []
  for (const m of mine.yard.sides as Json[]) {
    const b = bMap.get(String(m?.id ?? ''))
    const was = b && b.on !== false ? b.gate : null, now = m?.on !== false ? m?.gate : null
    const where = theSide(sideName(m))
    if (now && !was) {
      // The same side length: the gate takes its width out of the fence there.
      const into = b && num(b.lengthIn) === num(m.lengthIn) ? ` (${gateFt(now)} ft of fence becomes the gate)` : ''
      out.push({ kind: 'added', words: `a ${gateKind(now)} gate in ${where}${into}` })
    } else if (was && !now) out.push({ kind: 'removed', words: `the ${gateKind(was)} gate in ${where} taken out` })
    else if (was && now && (gateKind(was) !== gateKind(now) || gateFt(was) !== gateFt(now))) out.push({ kind: 'changed', words: `the gate in ${where} is now a ${gateKind(now)} gate (${gateFt(now)} ft)` })
  }
  const mIds = new Set((mine.yard.sides as Json[]).map(s => String(s?.id ?? '')))
  for (const b of base.yard.sides as Json[]) if (!mIds.has(String(b?.id ?? '')) && b?.on !== false && b?.gate) out.push({ kind: 'removed', words: `the ${gateKind(b.gate)} gate in ${theSide(sideName(b))} taken out` })
  return out
}

/** A change order's gate changes, side by side, from its drawing (sideGateChanges). */
export function ownGateChanges(work: Json): Array<{ kind: 'added' | 'removed' | 'changed'; words: string }> {
  if (!isObj(work) || !isObj(work.base)) return []
  return sideGateChanges(shapeOf(work.base), shapeOf(work))
}

/**
 * A fence line's words written before this, with the whole fence before and
 * after ("Add 10 ft of fence, 2 panels more (146 ft to 156 ft)"): the totals
 * become the change order's own sides ("(Left side 40 ft → 50 ft)"), so the
 * words stay true whichever change order is signed first. "Still 7 panels in
 * all" (the whole fence) becomes "same panels". Other lines are left as they are.
 */
export function ownLineWords(description: string, sides: string | null): string {
  if (!sides) return description
  const m = /\((\d+(?:\.\d+)?) ft to (\d+(?:\.\d+)?) ft( of fence, gates not counted)?([^)]*)\)/.exec(description)
  if (!m) return description
  const words = `(${sides}${m[3] ? '; the fence feet leave out the gates' : ''}${m[4] ?? ''})`
  return (description.slice(0, m.index) + words + description.slice(m.index + m[0].length)).replace(/: still \d+ panels? in all/, ': same panels')
}

/** "the Back side's length" words for a clash: the same things two changes touch. */
export function clashes(a: ChangeStep, b: ChangeStep): string[] {
  const t = new Set(touches(a))
  return touches(b).filter(x => t.has(x))
}
