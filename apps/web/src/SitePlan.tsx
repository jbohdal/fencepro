/**
 * The site plan, drawn as SVG from a yard layout: fence in brand purple with
 * footage and sections on every side, corner posts as squares, end and gate
 * posts as filled dots, line posts as open dots at the real section spacing,
 * gate swings as dashed arcs, skips as gray dashed lines, the house as a gray
 * box and the street marked. Optionally on top of an aerial photo, where the
 * corners can be dragged onto the yard. On the plain drawing the corner posts
 * can be dragged for odd yards; the labels keep the typed lengths.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildPlan, type Plan, type PlanGate } from './sitePlanGeometry'
import { dragVertex, slideTee, setHouse } from './yardDrawing'
import { dirDeg, houseCorners, norm180 } from './yardChain'
import { boxesOverlap, placeLabels, planScreen, screenLeaves, textWidth, PLAN_COLORS, type PlanScreen } from './sitePlanLabels'
import { deriveLayout, type HouseRect, type LayoutResult, type PlanPoint, type YardLayout } from './yardLayout'
import { gateDistanceTextExact } from './gateSlide'
import { sectionsForRun } from './sectionCount'
import { formatPieceLen } from './yardLayout'

const formatPieceLenFt = (inches: number) => formatPieceLen(inches).replace(/'$/, ' ft').replace(/' /, ' ft ')
import { currentPlanAt, stepDeg, normDeg, type AerialBackdrop } from './sitePlanPhoto'

const { PURPLE, GRAY, LIGHT, INK } = PLAN_COLORS

export type { AerialBackdrop }

/** A photo pin on the plan: where it was taken and which way it faced (degrees, 0 = up the page). */
export interface PlanPin { id: string; x: number; y: number; angle?: number | null; count?: number; highlight?: boolean }

/** Where the returns meet the house, feet from its back corner (whole feet). */
export interface HouseMeets { left?: number; right?: number }

/** "Meets the house 12 ft from the back corner", while the house or a return is dragged. */
export function meetsText(m: HouseMeets, names: { left?: string; right?: string } = {}): string {
  const ft = (n: number) => (n === 0 ? 'at the back corner' : `${n} ft from the back corner`)
  if (m.left !== undefined && m.right !== undefined) {
    if (m.left === m.right) return m.left === 0 ? 'Meets the house at the back corners' : `Meets the house ${m.left} ft from the back corner`
    return `${names.left ?? 'Left return'} ${m.left} ft, ${(names.right ?? 'right return').toLowerCase()} ${m.right} ft from the back corner`
  }
  if (m.left !== undefined) return `${names.left ?? 'Left return'} meets the house ${ft(m.left)}`
  if (m.right !== undefined) return `${names.right ?? 'Right return'} meets the house ${ft(m.right)}`
  return ''
}

type PointDrag<M> = { mode: M; k: number; start: YardLayout; s0: PlanPoint; touch: boolean; moved: boolean }
type HouseEdit<M> = { mode: M; start: YardLayout; rect: HouseRect; p0: PlanPoint; a0: number; touch: boolean; moved: boolean }
type Drag =
  | PointDrag<'vertex'> | PointDrag<'tee'>
  | HouseEdit<'houseMove'> | HouseEdit<'houseRot'> | HouseEdit<'houseSize'>
  | { mode: 'plan'; sx: number; sy: number; at: PlanPoint; ftPerPx: number; moved: boolean }
  | { mode: 'house' | 'attach'; which: 'both' | 'left' | 'right'; sy: number; ftPerPx: number; bounds: Plan['bounds']; left: number; right: number; last: string; moved: boolean }
  | { mode: 'gate'; sideId: string; grabIn: number; sx: number; sy: number; touch: boolean; moved: boolean }

/** A fence move's old line: drawn dashed along a side of the new line, this many feet inside it. */
export interface PlanOldLine { sideId: string; offsetFt: number; ft: number; label: string }

export default function SitePlan({ layout, result, runSections, widthFt = 8, onSideTap, aerial, onDrawingChange, onAngleTap, checks = false, title, pins, onPinTap, onPlanTap, onHouseMeetsChange, onHouseDragEnd, onGateTap, oldLine, damaged, onSectionTap, onPlanMove, onRotate, onLineUpTap, lineUpTaps, onGateSlide, gateLocked, onGateDistanceTap }: {
  layout: YardLayout
  result?: LayoutResult
  runSections?: number[]
  widthFt?: number
  /** A side tapped: its line, or its length label (`label`: the length is what the finger is after). */
  onSideTap?: (sideId: string, via?: 'label' | 'line') => void
  /** Drawn to the photo's real scale, centered on it; corners can be dragged. */
  aerial?: AerialBackdrop | null
  /**
   * With this, every corner and end point can be dragged (each side keeps its
   * typed length and only the angles change, yardDrawing.ts), a tee's start
   * slides along its side, and the house can be moved, turned and sized.
   * `done` when the finger lifts.
   */
  onDrawingChange?: (next: YardLayout, done: boolean) => void
  /** With this, each corner shows its angle as a chip; tapping it types the angle (the index of the side starting there). */
  onAngleTap?: (sideIndex: number) => void
  /** Show the drawing's checks: sides that cross ("Side 3 crosses Side 6, check the drawing"). */
  checks?: boolean
  title?: string
  pins?: PlanPin[]
  onPinTap?: (id: string) => void
  /** Tapping the plan (not a side) gives the spot in plan feet: "where were you standing?" */
  onPlanTap?: (pt: PlanPoint) => void
  /** With this, the house can be slid and each return's meeting point dragged along the house (drawing only). */
  onHouseMeetsChange?: (m: HouseMeets) => void
  onHouseDragEnd?: () => void
  /** With this, tapping a gate on the plan cycles its swing and hinge. */
  onGateTap?: (sideId: string) => void
  /** A move: the old line, dashed. */
  oldLine?: PlanOldLine | null
  /** A repair: sections marked damaged ("run:section", runs in the order the layout counts them), drawn red. */
  damaged?: string[]
  /** With this, each section can be tapped (a repair's damaged sections). */
  onSectionTap?: (key: string) => void
  /** On the photo: the center button moves the whole plan; the new middle of the plan, feet right and up of the photo's center. */
  onPlanMove?: (planAt: PlanPoint) => void
  /** On the photo: a two-finger twist turns the photo (whole degrees). */
  onRotate?: (rotDeg: number) => void
  /** Line up: each tap on the photo, in drawing units (y down). */
  onLineUpTap?: (pt: PlanPoint) => void
  /** Line up: the taps to mark, in drawing units. */
  lineUpTaps?: PlanPoint[]
  /** With this, a gate can be dragged along its side: called with where the finger puts its start
   *  (inches from the side's start, not yet snapped or kept on the side; the caller does that, gateSlide.ts). */
  onGateSlide?: (sideId: string, startIn: number) => void
  /** A signed quote: pressing a gate shows this instead of moving it. */
  gateLocked?: string | null
  /** With this, tapping the length of a piece next to a gate types that distance. */
  onGateDistanceTap?: (sideId: string, which: 'before' | 'after') => void
}) {
  const plan = useMemo(() => buildPlan(layout, result, runSections, widthFt), [layout, result, runSections, widthFt])
  const derived = useMemo(() => result ?? deriveLayout(layout), [layout, result])
  // Ids for the magnifier (it shows the drawing again, closer); only on a plan where gates slide.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const drawId = `plan-draw-${uid}`
  const interactive = !!onGateSlide || !!onDrawingChange
  // The gate being dragged, and where the finger is (drawing units) for the magnifier on a phone.
  const [gateDrag, setGateDrag] = useState<{ sideId: string; finger: PlanPoint | null } | null>(null)
  // A corner, tee or the house being dragged: what, and the finger (drawing units) for the magnifier on a phone.
  // The house tapped: its turn and size handles show (a drag on it moves it any time).
  const [houseSel, setHouseSel] = useState(false)
  const [pointDrag, setPointDrag] = useState<{ mode: Drag['mode']; k: number; finger: PlanPoint | null } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<Drag | null>(null)
  // While something is dragged the drawing keeps its scale, so it stays under the finger.
  const [heldBounds, setHeldBounds] = useState<Plan['bounds'] | null>(null)
  const [live, setLive] = useState('')
  // Labels a little bigger when the drawing is shown small (a phone), so they stay readable.
  const [fontScale, setFontScale] = useState(1)
  const [unitsPerPx, setUnitsPerPx] = useState(1)
  const measure = () => {
    const el = svgRef.current
    if (!el) return
    const w = el.clientWidth
    if (!(w > 0)) return
    const f = Math.min(1.35, Math.max(1, 520 / w))
    setFontScale(prev => (Math.abs(prev - f) > 0.04 ? Math.round(f * 100) / 100 : prev))
    // Drawing units per screen pixel, so drag handles are a finger's size on any screen.
    const u = el.viewBox.baseVal.width / w
    setUnitsPerPx(prev => (Math.abs(prev - u) > 0.03 ? u : prev))
  }
  useEffect(() => {
    const el = svgRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  // Also after every draw (an opening animation can end without a resize), so the scale
  // never changes under a finger at the start of a drag. Sets state only when it changed.
  useLayoutEffect(measure)
  const fs = aerial ? 1 : fontScale

  // Feet → screen.
  const sc: PlanScreen = planScreen(plan, { aerial: aerial ?? null, held: heldBounds, fontScale: fs })
  const { W, H, toX, toY, fromX, fromY, ftPerPx } = sc
  const P = (p: PlanPoint) => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`
  // The angle at each corner: chips to tap and type in the builder; on the proposal and crew packet, the corners that are not square.
  const editingAngles = !!onAngleTap
  // (Static: only on a drawing whose angles were set, so an older quote's proposal looks as it did.)
  const angleSpots = plan.angles.filter(a => (editingAngles ? a.typable : plan.chain && Math.abs(a.deg - 90) > 0.5 && a.deg < 179.5)).map(a => {
    const off = editingAngles ? Math.max(26, 30 * unitsPerPx) : 20 * fs
    const x = toX(a.at.x) + a.inward.x * off, y = toY(a.at.y) - a.inward.y * off
    const text = `${Math.round(a.deg)}°`
    const fz = editingAngles ? Math.max(11, 11.5 * unitsPerPx) : 11 * fs
    const hw = textWidth(text, fz, 700) / 2 + (editingAngles ? 5 * unitsPerPx : 2), hh = fz * 0.75 + (editingAngles ? 3 * unitsPerPx : 1)
    return { a, x, y, text, fz, hw, hh, box: { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh } }
  })
  // Chips at corners close together are moved further into their angle until they clear each other.
  for (let k = 1; k < angleSpots.length; k++) {
    const sp = angleSpots[k]
    for (let t = 0; t < 4 && angleSpots.slice(0, k).some(o => boxesOverlap(o.box, sp.box, 2)); t++) {
      const step = sp.hh * 2 + 3
      sp.x += sp.a.inward.x * step; sp.y -= sp.a.inward.y * step
      sp.box = { x0: sp.x - sp.hw, y0: sp.y - sp.hh, x1: sp.x + sp.hw, y1: sp.y + sp.hh }
    }
  }
  const angleKey = angleSpots.map(s => `${s.a.sideId}:${s.x.toFixed(1)},${s.y.toFixed(1)},${s.hw.toFixed(1)}`).join('|')
  const labels = useMemo(() => placeLabels(plan, sc, fs, angleSpots.map(s => s.box)), [plan, heldBounds, fs, aerial?.sizePx, aerial?.ftPerPx, aerial?.shiftFt?.x, aerial?.shiftFt?.y, angleKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const rot = aerial ? normDeg(aerial.rotDeg ?? 0) : 0

  // Two fingers on the photo: a twist turns it. A pinch with no twist does nothing here.
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const twist = useRef<{ a0: number; rot0: number; engaged: boolean; last: number } | null>(null)
  const fingerAngle = () => {
    const [p, q] = [...touches.current.values()]
    return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI
  }
  function touchDown(e: React.PointerEvent) {
    if (!aerial || !onRotate || e.pointerType !== 'touch') return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.size === 2) {
      // A second finger: no drag, a twist.
      drag.current = null
      setHeldBounds(null)
      twist.current = { a0: fingerAngle(), rot0: rot, engaged: false, last: rot }
    }
  }
  function touchMove(e: React.PointerEvent): boolean {
    if (!touches.current.has(e.pointerId)) return false
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const t = twist.current
    if (!t || touches.current.size !== 2) return false
    const d = normDeg(fingerAngle() - t.a0)
    // A few degrees before it counts as a twist, so a pinch never turns the photo.
    if (!t.engaged && Math.abs(d) < 4) return true
    t.engaged = true
    const next = stepDeg(t.rot0 + d)
    if (next !== t.last) { t.last = next; onRotate?.(next) }
    return true
  }
  function touchUp(e: React.PointerEvent) {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) twist.current = null
  }

  function screenY(e: React.PointerEvent): number {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    return pt.matrixTransform(svg.getScreenCTM()!.inverse()).y
  }
  function svgPoint(e: React.PointerEvent): PlanPoint {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const m = svg.getScreenCTM()!.inverse()
    const q = pt.matrixTransform(m)
    return { x: fromX(q.x), y: fromY(q.y) }
  }
  function planTap(e: React.MouseEvent) {
    if (!onPlanTap || drag.current) return
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    onPlanTap({ x: fromX(q.x), y: fromY(q.y) })
  }
  const capture = (e: React.PointerEvent) => {
    e.stopPropagation()
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* a pointer the browser no longer tracks */ }
  }
  function startPlanMove(e: React.PointerEvent) {
    if (!onPlanMove || twist.current) return
    capture(e)
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    drag.current = { mode: 'plan', sx: q.x, sy: q.y, at: currentPlanAt(layout), ftPerPx, moved: false }
  }
  function startDrag(e: React.PointerEvent, mode: 'vertex' | 'tee', k: number) {
    if (!onDrawingChange || twist.current) return
    capture(e)
    if (!aerial) setHeldBounds(plan.bounds)
    // Dragging a corner puts the house's handles away.
    setHouseSel(false)
    drag.current = { mode, k, start: layout, s0: svgPoint(e), touch: e.pointerType !== 'mouse', moved: false } as Drag
  }
  function startHouseEdit(e: React.PointerEvent, mode: 'houseMove' | 'houseRot' | 'houseSize') {
    if (!onDrawingChange || !plan.houseRect || twist.current) return
    capture(e)
    if (!aerial) setHeldBounds(plan.bounds)
    const p0 = svgPoint(e), r = plan.houseRect
    drag.current = { mode, start: layout, rect: r, p0, a0: dirDeg({ x: r.cx, y: r.cy }, p0), touch: e.pointerType !== 'mouse', moved: false } as Drag
  }
  function startHouseDrag(e: React.PointerEvent, which: 'both' | 'left' | 'right') {
    if (!onHouseMeetsChange) return
    capture(e)
    const at = (w: 'left' | 'right') => Math.round(plan.houseAttach.find(h => h.which === w)?.distFt ?? 0)
    setHeldBounds(plan.bounds)
    drag.current = { mode: which === 'both' ? 'house' : 'attach', which, sy: screenY(e), ftPerPx, bounds: plan.bounds, left: at('left'), right: at('right'), last: '', moved: false }
  }
  /** Where `p` (plan feet) falls along side `sd`, as a fraction of the side (not clamped). */
  function along(sd: Plan['sides'][number], p: PlanPoint): number {
    const dx = sd.b.x - sd.a.x, dy = sd.b.y - sd.a.y, L2 = dx * dx + dy * dy
    return L2 > 0 ? ((p.x - sd.a.x) * dx + (p.y - sd.a.y) * dy) / L2 : 0
  }
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function startGateDrag(e: React.PointerEvent, sd: Plan['sides'][number]) {
    if (twist.current) return
    if (gateLocked) {
      // Signed: the gate stays put; say why.
      e.stopPropagation()
      setLive(gateLocked)
      if (lockTimer.current) clearTimeout(lockTimer.current)
      lockTimer.current = setTimeout(() => setLive(''), 3000)
      return
    }
    if (!onGateSlide) return
    const i = layout.sides.findIndex(s => s.id === sd.sideId)
    const at = derived.sides[i]?.gateAtIn
    if (i < 0 || at == null) return
    capture(e)
    if (!aerial) setHeldBounds(plan.bounds)
    const svg = svgRef.current!
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    // Held where it was picked up, so the gate does not jump to center on the finger.
    drag.current = { mode: 'gate', sideId: sd.sideId, grabIn: along(sd, svgPoint(e)) * layout.sides[i].lengthIn - at, sx: q.x, sy: q.y, touch: e.pointerType !== 'mouse', moved: false }
  }
  const has = (w: 'left' | 'right') => plan.houseAttach.some(h => h.which === w)
  const names = { left: plan.houseAttach.find(h => h.which === 'left')?.name, right: plan.houseAttach.find(h => h.which === 'right')?.name }
  function moveDrag(e: React.PointerEvent) {
    if (touchMove(e)) return
    const d = drag.current
    if (!d) return
    if (d.mode === 'plan') {
      // In drawing units, which do not move with the plan, so it stays under the finger.
      const svg = svgRef.current!
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
      const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
      const dx = q.x - d.sx, dy = q.y - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      d.moved = true
      onPlanMove?.({ x: d.at.x + dx * d.ftPerPx, y: d.at.y - dy * d.ftPerPx })
      return
    }
    if (d.mode === 'gate') {
      if (!onGateSlide) return
      const svg = svgRef.current!
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
      const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
      // A tap on a gate is not a drag.
      if (!d.moved && Math.hypot(q.x - d.sx, q.y - d.sy) < 5 * unitsPerPx) return
      d.moved = true
      const sd = plan.sides.find(x => x.sideId === d.sideId)
      const s = layout.sides.find(x => x.id === d.sideId)
      if (!sd || !s) return
      onGateSlide(d.sideId, along(sd, svgPoint(e)) * s.lengthIn - d.grabIn)
      setGateDrag({ sideId: d.sideId, finger: d.touch ? { x: q.x, y: q.y } : null })
      return
    }
    if (d.mode === 'vertex' || d.mode === 'tee') {
      if (!onDrawingChange) return
      const now = svgPoint(e)
      // A tap on a corner is not a drag.
      if (!d.moved && Math.hypot(now.x - d.s0.x, now.y - d.s0.y) / ftPerPx < 4) return
      d.moved = true
      const next = d.mode === 'vertex' ? dragVertex(d.start, d.k, now) : slideTee(d.start, d.k, now)
      onDrawingChange(next, false)
      setPointDrag({ mode: d.mode, k: d.k, finger: d.touch ? { x: toX(now.x), y: toY(now.y) } : null })
      return
    }
    if (d.mode === 'houseMove' || d.mode === 'houseRot' || d.mode === 'houseSize') {
      if (!onDrawingChange) return
      const now = svgPoint(e)
      if (!d.moved && Math.hypot(now.x - d.p0.x, now.y - d.p0.y) / ftPerPx < 4) return
      d.moved = true
      const r = d.rect
      let next: HouseRect
      if (d.mode === 'houseMove') {
        next = { ...r, cx: r.cx + now.x - d.p0.x, cy: r.cy + now.y - d.p0.y }
      } else if (d.mode === 'houseRot') {
        // Whole degrees; square to the page when within 3.
        let rot = Math.round(r.rotDeg + norm180(dirDeg({ x: r.cx, y: r.cy }, now) - d.a0))
        const sq = Math.round(rot / 90) * 90
        if (Math.abs(rot - sq) <= 3) rot = sq
        next = { ...r, rotDeg: norm180(rot) }
      } else {
        // The grabbed corner (the house's first, out past it) moves with the finger; the middle stays. Whole feet.
        const a = (-r.rotDeg * Math.PI) / 180, dx = now.x - d.p0.x, dy = now.y - d.p0.y
        const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
        next = { ...r, w: Math.max(8, Math.round(r.w - 2 * lx)), d: Math.max(8, Math.round(r.d - 2 * ly)) }
      }
      onDrawingChange(setHouse(d.start, next), false)
      setPointDrag({ mode: d.mode, k: 0, finger: d.touch ? { x: toX(now.x), y: toY(now.y) } : null })
      return
    }
    if (!onHouseMeetsChange) return
    const dyPx = screenY(e) - d.sy
    if (!d.moved && Math.abs(dyPx) < 4) return
    d.moved = true
    const dyFt = dyPx * d.ftPerPx
    let m: HouseMeets
    if (d.mode === 'house') {
      // The fence stays put and the house slides: toward the back fence, the
      // returns meet it further from its back corner. Whole feet.
      let k = Math.round(-dyFt)
      const floor = -Math.min(has('left') ? d.left : Infinity, has('right') ? d.right : Infinity)
      if (Number.isFinite(floor)) k = Math.max(k, floor)
      m = { ...(has('left') ? { left: d.left + k } : {}), ...(has('right') ? { right: d.right + k } : {}) }
      // Keep the fence where it was on screen; the house moves under the finger.
      // (A drawing with its own angles already keeps the fence put: the house moves to meet it.)
      if (!plan.chain) setHeldBounds({ ...d.bounds, minY: d.bounds.minY - k, maxY: d.bounds.maxY - k })
    } else {
      // One return's meeting point slides along the house wall under the finger.
      const v = Math.max(0, Math.round((d.which === 'left' ? d.left : d.right) + dyFt))
      m = d.which === 'left' ? { left: v } : { right: v }
    }
    setLive(meetsText(m, names))
    const key = JSON.stringify(m)
    if (key !== d.last) { d.last = key; onHouseMeetsChange(m) }
  }
  const endDrag = (e?: React.PointerEvent) => {
    if (e) touchUp(e)
    const d = drag.current
    if (d && (d.mode === 'house' || d.mode === 'attach') && d.moved) onHouseDragEnd?.()
    if (d && d.moved && (d.mode === 'vertex' || d.mode === 'tee' || d.mode === 'houseMove' || d.mode === 'houseRot' || d.mode === 'houseSize')) onDrawingChange?.(layout, true)
    // Swallow the click that follows a drag so it is not a tap on a side.
    if (d?.moved) setTimeout(() => { drag.current = null }, 0)
    else drag.current = null
    setHeldBounds(null)
    // The signed quote's "make a change order" stays up a moment after the finger lifts.
    setLive(l => (gateLocked && l === gateLocked ? l : ''))
    setGateDrag(null)
    setPointDrag(null)
  }

  // Each section as its own piece of the line, keyed "run:section" (runs counted as the layout counts them).
  const sectionSegs = useMemo(() => {
    const out: Array<{ key: string; a: PlanPoint; b: PlanPoint }> = []
    if (!onSectionTap && !damaged?.length) return out
    let r = 0
    for (const sd of plan.sides) for (const f of sd.fence) {
      const len = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y)
      const n = runSections?.[r] ?? Math.max(1, Math.ceil(len / widthFt - 1e-9))
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n
        out.push({ key: `${r}:${k}`, a: { x: f.a.x + (f.b.x - f.a.x) * t0, y: f.a.y + (f.b.y - f.a.y) * t0 }, b: { x: f.a.x + (f.b.x - f.a.x) * t1, y: f.a.y + (f.b.y - f.a.y) * t1 } })
      }
      r++
    }
    return out
  }, [plan, runSections, widthFt, !!onSectionTap, damaged?.length])  // eslint-disable-line react-hooks/exhaustive-deps
  const old = useMemo(() => {
    if (!oldLine || !(oldLine.ft > 0)) return null
    const sd = plan.sides.find(x => x.sideId === oldLine.sideId)
    if (!sd) return null
    const len = Math.hypot(sd.b.x - sd.a.x, sd.b.y - sd.a.y)
    if (!(len > 0)) return null
    const dir = { x: (sd.b.x - sd.a.x) / len, y: (sd.b.y - sd.a.y) / len }
    const off = oldLine.offsetFt || 0
    const a = { x: sd.a.x - sd.out.x * off, y: sd.a.y - sd.out.y * off }
    const b = { x: a.x + dir.x * oldLine.ft, y: a.y + dir.y * oldLine.ft }
    return { a, b, label: oldLine.label }
  }, [oldLine, plan])

  /** A piece label next to a gate: the distance before it or after it (null for any other label). */
  function pieceSide(l: { kind: string; key: string; sideId: string }): 'before' | 'after' | null {
    if (l.kind !== 'fence') return null
    const sd = plan.sides.find(x => x.sideId === l.sideId)
    const g = sd?.pieces.find(p => p.kind === 'gate')
    const p = sd?.pieces[Number(l.key.slice(l.key.lastIndexOf('-') + 1))]
    if (!g || !p) return null
    if (Math.abs(p.toIn - g.fromIn) < 0.01) return 'before'
    if (Math.abs(p.fromIn - g.toIn) < 0.01) return 'after'
    return null
  }

  const center = plan.vertices.reduce((t, p) => ({ x: t.x + p.x / plan.vertices.length, y: t.y + p.y / plan.vertices.length }), { x: 0, y: 0 })
  const houseC = plan.house ? { x: plan.house.reduce((t, p) => t + toX(p.x), 0) / plan.house.length, y: plan.house.reduce((t, p) => t + toY(p.y), 0) / plan.house.length } : null
  const houseMovable = !aerial && !!onHouseMeetsChange && plan.houseAttach.length > 0 && !!houseC
  // A house no two fence ends pin down: moved, turned and sized by hand (it keeps touching where one end meets it).
  const houseEditable = !!onDrawingChange && !!plan.houseRect && !houseMovable && (plan.houseMode === 'one' || plan.houseMode === 'free' || (plan.houseMode === 'auto' && plan.houseAttach.length === 0))

  // The angle chips (placed above, before the labels, so the labels keep off them); shown live while a corner is dragged.
  const angleMarks = (
    <g data-plan-angles>
      {angleSpots.map(({ a, x, y, text, fz, hw, hh }) => {
        const sideName = layout.sides[a.side]?.name ?? ''
        const attrs = { 'data-plan-angle': sideName, 'data-angle-deg': a.deg.toFixed(2), 'data-angle-turn': a.turn, ...(a.tee ? { 'data-angle-tee': 'true' } : {}) }
        if (!editingAngles) {
          return <text key={`ang-${a.sideId}`} x={x} y={y + fz * 0.36} textAnchor="middle" fontSize={fz} fontWeight={700} fill={INK} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3} {...attrs}>{text}</text>
        }
        const hit = Math.max(16, 22 * unitsPerPx)
        return (
          <g key={`ang-${a.sideId}`} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); if (!drag.current) onAngleTap!(a.side) }} {...attrs}>
            <circle cx={x} cy={y} r={hit} fill="white" fillOpacity={0.01} />
            <rect x={x - hw} y={y - hh} width={hw * 2} height={hh * 2} rx={hh} fill={a.tee ? INK : 'white'} fillOpacity={0.95} stroke={a.tee ? INK : PURPLE} strokeWidth={1.5} pointerEvents="none" />
            <text x={x} y={y + fz * 0.36} textAnchor="middle" fontSize={fz} fontWeight={700} fill={a.tee ? 'white' : PURPLE} pointerEvents="none">{text}</text>
          </g>
        )
      })}
    </g>
  )
  /** The magnifier above a finger (drawing units): the drawing again, closer. */
  const loupeAt = (f: PlanPoint, key: string) => {
    const R = 58 * unitsPerPx, Z = 2.5
    const lp = { x: Math.min(Math.max(f.x, R + 4), W - R - 4), y: f.y - R - 34 * unitsPerPx < R + 4 ? f.y + R + 44 * unitsPerPx : f.y - R - 34 * unitsPerPx }
    const clipId = `plan-loupe-${key}-${uid}`
    return (
      <g data-plan-loupe pointerEvents="none">
        <clipPath id={clipId}><circle cx={lp.x} cy={lp.y} r={R} /></clipPath>
        <circle cx={lp.x} cy={lp.y} r={R} fill="white" />
        <g clipPath={`url(#${clipId})`}>
          <use href={`#${drawId}`} transform={`translate(${lp.x} ${lp.y}) scale(${Z}) translate(${-f.x} ${-f.y})`} />
        </g>
        <circle cx={lp.x} cy={lp.y} r={R} fill="none" stroke="white" strokeWidth={5 * unitsPerPx} />
        <circle cx={lp.x} cy={lp.y} r={R} fill="none" stroke={INK} strokeOpacity={0.5} strokeWidth={1.5 * unitsPerPx} />
        <path d={`M${lp.x - 12 * unitsPerPx},${lp.y} h${24 * unitsPerPx} M${lp.x},${lp.y - 12 * unitsPerPx} v${24 * unitsPerPx}`} stroke={INK} strokeWidth={1.5 * unitsPerPx} />
      </g>
    )
  }
  // While a corner, a tee or the house is dragged: what it is now, in words, at the top of the drawing.
  const pointLive = (() => {
    if (!pointDrag) return null
    const angleAt = (i: number) => plan.angles.find(a => a.side === i)
    const lines: string[] = []
    if (pointDrag.mode === 'vertex') {
      const k = pointDrag.k
      const here = angleAt(k), before = angleAt(k - 1)
      const moved = layout.sides[Math.max(0, k - 1)]
      if (here) lines.push(`${Math.round(here.deg)}° here`)
      if (k > 0 && before) lines.push(`${Math.round(before.deg)}° where ${moved.name} starts`)
      if (k === 0 && here) lines.length = 0
      if (k === 0) { const a1 = angleAt(1); if (a1) lines.push(`${Math.round(a1.deg)}° where ${layout.sides[1].name} starts`) }
      if (moved && moved.lengthIn > 0) lines.push(`${moved.name} stays ${formatPieceLenFt(moved.lengthIn)}`)
    } else if (pointDrag.mode === 'tee') {
      const s = layout.sides[pointDrag.k], an = layout.sides.find(x => x.id === s?.tee?.sideId)
      if (s?.tee && an) lines.push(`${s.name} starts ${Math.round(s.tee.atIn / 12)} ft along ${an.name}`)
    } else if (plan.houseRect) {
      const h = plan.houseRect
      lines.push(pointDrag.mode === 'houseRot' ? `House turned ${Math.round(norm180(h.rotDeg))}°` : pointDrag.mode === 'houseSize' ? `House ${Math.round(h.w)} × ${Math.round(h.d)} ft` : 'Moving the house')
    }
    if (!lines.length) return null
    const fsz = Math.max(15 * fs, 14 * unitsPerPx)
    const text = lines.join('  ·  ')
    const bw = Math.min(W - 8, textWidth(text, fsz, 700) + 24 * unitsPerPx), bh = fsz + 16 * unitsPerPx
    return (
      <g pointerEvents="none" data-plan-drag-live={pointDrag.mode}>
        {pointDrag.finger && loupeAt(pointDrag.finger, 'pt')}
        <rect x={W / 2 - bw / 2} y={6} width={bw} height={bh} rx={8 * unitsPerPx} fill={INK} fillOpacity={0.92} />
        <text x={W / 2} y={6 + 8 * unitsPerPx + fsz * 0.85} textAnchor="middle" fontSize={fsz} fontWeight={700} fill="white" data-plan-drag-text>{text}</text>
      </g>
    )
  })()

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none touch-none bg-white rounded-xl border border-gray-200"
      role="img" aria-label={title ?? 'Site plan'} data-site-plan data-ft-per-unit={String(ftPerPx)} onPointerDownCapture={touchDown} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      {...(aerial ? { 'data-photo-rotation': String(rot), 'data-ft-per-px': String(aerial.ftPerPx) } : {})}
      onClick={e => { if (houseSel) setHouseSel(false); if (onPlanTap) planTap(e) }} style={onPlanTap ? { cursor: 'crosshair' } : undefined}>
      {/* The drawing itself (the magnifier shows it again, closer, while a gate is dragged on a phone). */}
      <g {...(interactive ? { id: drawId } : {})}>
      {aerial && (aerial.baked
        // Already turned and cut to the frame (proposal, crew packet, PDF).
        ? <image href={aerial.href} x={0} y={0} width={W} height={H} preserveAspectRatio="none" data-plan-photo />
        : (() => {
          const S = aerial.imagePx ?? W
          return (
            <g transform={`translate(${W / 2} ${H / 2}) rotate(${rot})`} opacity={0.9} data-plan-photo>
              {aerial.tiles
                // Map tiles, a hair bigger so no seam shows between them.
                ? aerial.tiles.map(t => <image key={t.href} href={t.href} x={t.x} y={t.y} width={t.size + 0.6} height={t.size + 0.6} preserveAspectRatio="none" />)
                : <image href={aerial.href} x={-S / 2} y={-S / 2} width={S} height={S} preserveAspectRatio="none" />}
            </g>
          )
        })())}

      {plan.house && houseC && (
        <g>
          <polygon points={plan.house.map(P).join(' ')} fill={LIGHT} fillOpacity={aerial ? 0.45 : 1} stroke={houseSel && houseEditable ? INK : aerial ? 'white' : GRAY} strokeWidth={aerial || (houseSel && houseEditable) ? 2 : 1.5} strokeDasharray={aerial ? '6 4' : undefined}
            onPointerDown={houseMovable ? e => startHouseDrag(e, 'both') : houseEditable ? e => startHouseEdit(e, 'houseMove') : undefined}
            onClick={houseEditable ? e => { e.stopPropagation(); if (!drag.current?.moved) setHouseSel(v => !v) } : undefined}
            style={houseMovable ? { cursor: 'ns-resize' } : houseEditable ? { cursor: 'move' } : undefined} data-plan-house {...(houseEditable ? { 'data-plan-house-editable': houseSel ? 'selected' : 'true' } : {})} />
          {/* While the house can be dragged its handle sits where the word was. */}
          {!houseMovable && <text x={houseC.x} y={houseC.y + (plan.houseNotToScale ? -2 : 5)}
            textAnchor="middle" fontSize={14 * fs} fontWeight={600} fill={INK} pointerEvents="none">House</text>}
          {plan.houseNotToScale && !houseMovable && (
            <text x={houseC.x} y={houseC.y + 13}
              textAnchor="middle" fontSize={11} fill={GRAY} data-house-not-to-scale>house not to scale</text>
          )}
        </g>
      )}

      {plan.sides.map(sd => (
        <g key={sd.sideId}>
          {sd.placeholder && <line x1={toX(sd.a.x)} y1={toY(sd.a.y)} x2={toX(sd.b.x)} y2={toY(sd.b.y)} stroke={LIGHT} strokeWidth={3} strokeDasharray="8 6" />}
          {sd.fence.map((f, k) => <line key={k} x1={toX(f.a.x)} y1={toY(f.a.y)} x2={toX(f.b.x)} y2={toY(f.b.y)} stroke={PURPLE} strokeWidth={4} strokeLinecap="round" />)}
          {sd.skip && <line x1={toX(sd.skip.a.x)} y1={toY(sd.skip.a.y)} x2={toX(sd.skip.b.x)} y2={toY(sd.skip.b.y)} stroke={GRAY} strokeWidth={3} strokeDasharray="7 6" />}
          {sd.gate && <GateSwing gate={sd.gate} sc={sc} />}
          {onSideTap && (
            <line x1={toX(sd.a.x)} y1={toY(sd.a.y)} x2={toX(sd.b.x)} y2={toY(sd.b.y)} stroke="transparent" strokeWidth={30}
              style={{ cursor: 'pointer' }} onClick={() => onSideTap(sd.sideId)} data-plan-side={sd.name} />
          )}
        </g>
      ))}

      {old && (
        <g data-plan-old-line>
          <line x1={toX(old.a.x)} y1={toY(old.a.y)} x2={toX(old.b.x)} y2={toY(old.b.y)} stroke="#92400E" strokeWidth={3} strokeDasharray="10 7" strokeLinecap="round" />
          <text x={(toX(old.a.x) + toX(old.b.x)) / 2} y={(toY(old.a.y) + toY(old.b.y)) / 2 - 8} textAnchor="middle" fontSize={12 * fs} fontWeight={700} fill="#92400E"
            style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>{old.label}</text>
        </g>
      )}

      {sectionSegs.map(sg => {
        const hit = damaged?.includes(sg.key)
        return (
          <g key={`sec-${sg.key}`}>
            {hit && <line x1={toX(sg.a.x)} y1={toY(sg.a.y)} x2={toX(sg.b.x)} y2={toY(sg.b.y)} stroke="#DC2626" strokeWidth={7} strokeLinecap="round" data-plan-damaged={sg.key} />}
            {onSectionTap && <line x1={toX(sg.a.x)} y1={toY(sg.a.y)} x2={toX(sg.b.x)} y2={toY(sg.b.y)} stroke="transparent" strokeWidth={26}
              style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSectionTap(sg.key) }} data-plan-section={sg.key} />}
          </g>
        )
      })}

      {/* Corner and tee handles under the labels: a tap on a length or a gate distance wins where they overlap. */}
      {onDrawingChange && plan.handles.map(k => plan.vertices[k] && (() => {
        // Every corner and end point: at least 44 px across on a phone.
        const r = Math.max(14, 22 * unitsPerPx)
        const x = toX(plan.vertices[k].x), y = toY(plan.vertices[k].y)
        return (
          <g key={`drag-${k}`} style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={e => startDrag(e, 'vertex', k)} onClick={e => e.stopPropagation()} data-plan-corner={k}>
            <circle cx={x} cy={y} r={r} fill="white" fillOpacity={0.01} />
            <circle cx={x} cy={y} r={Math.min(r, 13)} fill="none" stroke={PURPLE} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="3 3" pointerEvents="none" />
          </g>
        )
      })())}
      {onDrawingChange && plan.tees.map(t => {
        const i = layout.sides.findIndex(s => s.id === t.sideId)
        const r = Math.max(14, 22 * unitsPerPx)
        const x = toX(t.at.x), y = toY(t.at.y)
        return (
          <g key={`tee-${t.sideId}`} style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={e => startDrag(e, 'tee', i)} onClick={e => e.stopPropagation()} data-plan-tee={t.name}>
            <circle cx={x} cy={y} r={r} fill="white" fillOpacity={0.01} />
            <circle cx={x} cy={y} r={Math.min(r, 13)} fill="none" stroke={INK} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="2 3" pointerEvents="none" />
          </g>
        )
      })}

      {labels.map(l => (
        <g key={l.key} data-plan-text={l.kind}>
          {l.leader && <line x1={l.leader.x1} y1={l.leader.y1} x2={l.leader.x2} y2={l.leader.y2} stroke={GRAY} strokeWidth={1} data-plan-leader />}
          {l.lines.map((ln, k) => (
            <text key={k} x={l.x} y={l.y + ln.dy} textAnchor={l.anchor} fontSize={ln.size} fontWeight={ln.weight} fill={ln.fill}
              style={{ paintOrder: 'stroke', ...(l.kind === 'side' && onSideTap ? { cursor: 'pointer' } : {}), ...(onGateDistanceTap && pieceSide(l) ? { cursor: 'pointer', textDecoration: 'underline' } : {}) }} stroke="white" strokeWidth={k === 0 && l.kind === 'side' ? 4 : 3}
              onClick={l.kind === 'side' && onSideTap ? e => { e.stopPropagation(); onSideTap(l.sideId, 'label') } : pieceSide(l) && onGateDistanceTap ? e => { e.stopPropagation(); onGateDistanceTap(l.sideId, pieceSide(l)!) } : undefined}
              {...(l.kind === 'side' ? {} : { 'data-plan-piece': l.sideName, 'data-piece-kind': l.kind })}
              {...(onGateDistanceTap && pieceSide(l) ? { 'data-gate-distance-text': pieceSide(l)! } : {})}>{ln.text}</text>
          ))}
          {onGateDistanceTap && pieceSide(l) && (() => {
            // A finger sized target around the distance (the text alone is a few pixels on a phone).
            const pad = Math.max(6, 12 * unitsPerPx)
            return <rect x={l.box.x0 - pad} y={l.box.y0 - pad} width={l.box.x1 - l.box.x0 + pad * 2} height={l.box.y1 - l.box.y0 + pad * 2} fill="transparent"
              style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onGateDistanceTap(l.sideId, pieceSide(l)!) }} data-gate-distance-tap={pieceSide(l)!} />
          })()}
          {l.kind === 'side' && onSideTap && (
            <rect x={l.box.x0 - 4} y={l.box.y0 - 4} width={l.box.x1 - l.box.x0 + 8} height={l.box.y1 - l.box.y0 + 8} fill="transparent"
              style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSideTap(l.sideId, 'label') }} data-plan-label={l.sideName} />
          )}
        </g>
      ))}

      {/* Posts take no taps: the corner handles and side taps under them get the finger. */}
      <g pointerEvents="none">
      {plan.posts.map((p, i) => {
        const x = toX(p.x), y = toY(p.y)
        if (p.hinge) return <rect key={i} x={x - 4.5} y={y - 4.5} width={9} height={9} fill={INK} stroke="white" strokeWidth={1.5} data-plan-hinge />
        if (p.kind === 'corner') return <rect key={i} x={x - 6} y={y - 6} width={12} height={12} fill={PURPLE} stroke="white" strokeWidth={1.5} />
        if (p.kind === 'line') return <circle key={i} cx={x} cy={y} r={3.2} fill="white" stroke={PURPLE} strokeWidth={1.8} />
        // A tee: where a side starts from another side (posted as the end post it is counted as).
        if (p.kind === 'tee') return (
          <g key={i} data-plan-tee-post>
            <circle cx={x} cy={y} r={6.5} fill={PURPLE} stroke="white" strokeWidth={1.5} />
            <text x={x} y={y + 3.4} textAnchor="middle" fontSize={8.5} fontWeight={800} fill="white" pointerEvents="none">T</text>
          </g>
        )
        return <circle key={i} cx={x} cy={y} r={5.5} fill={p.kind === 'gate' ? INK : PURPLE} stroke="white" strokeWidth={1.5} />
      })}
      </g>
      </g>

      {pins?.map(pn => {
        const x = toX(pn.x), y = toY(pn.y)
        const hasDir = typeof pn.angle === 'number' && Number.isFinite(pn.angle)
        const r = ((pn.angle ?? 0) * Math.PI) / 180
        const tip = { x: x + Math.sin(r) * 22, y: y - Math.cos(r) * 22 }
        const side = (d: number) => ({ x: x + Math.sin(r + d) * 9, y: y - Math.cos(r + d) * 9 })
        const color = pn.highlight ? '#B45309' : INK
        return (
          <g key={pn.id} onClick={e => { if (onPinTap) { e.stopPropagation(); onPinTap(pn.id) } }} style={onPinTap ? { cursor: 'pointer' } : undefined} data-plan-pin={pn.id}>
            {hasDir && <polygon points={`${tip.x},${tip.y} ${side(Math.PI / 2).x},${side(Math.PI / 2).y} ${side(-Math.PI / 2).x},${side(-Math.PI / 2).y}`} fill={color} opacity={0.85} />}
            <circle cx={x} cy={y} r={9} fill={color} stroke="white" strokeWidth={2} />
            {(pn.count ?? 1) > 1 && <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="white">{pn.count}</text>}
            {onPinTap && <circle cx={x} cy={y} r={22} fill="transparent" />}
          </g>
        )
      })}

      {aerial && (() => {
        // True north on the turned photo: the arrow turns with it. Points worked out here
        // (no transform), so the PDF draws it the same.
        const cx = W - 34, cy = 46
        const t = (x: number, y: number) => { const r = (rot * Math.PI) / 180; return `${(cx + x * Math.cos(r) - y * Math.sin(r)).toFixed(1)},${(cy + x * Math.sin(r) + y * Math.cos(r)).toFixed(1)}` }
        return (
          <g aria-label="North" data-plan-north={String(rot)}>
            <circle cx={cx} cy={cy} r={22} fill="white" fillOpacity={0.8} stroke={GRAY} strokeWidth={1} />
            <polygon points={`${t(0, -18)} ${t(7, 6)} ${t(0, 1)} ${t(-7, 6)}`} fill={INK} stroke="white" strokeWidth={1.2} />
            <text x={cx} y={cy + 38} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>N</text>
          </g>
        )
      })()}

      {aerial && onPlanMove && (
        <g onPointerDown={startPlanMove} onClick={e => e.stopPropagation()} style={{ cursor: 'move' }} data-plan-move>
          {/* At least 44 px across on a phone. */}
          <circle cx={toX(center.x)} cy={toY(center.y)} r={Math.max(16, 22 * unitsPerPx)} fill={PURPLE} fillOpacity={0.85} stroke="white" strokeWidth={2} />
          <path d={`M${toX(center.x) - 9},${toY(center.y)} h18 M${toX(center.x)},${toY(center.y) - 9} v18`} stroke="white" strokeWidth={2.5} />
        </g>
      )}

      {aerial && onLineUpTap && (
        // Line up: every tap lands here, not on a side or a button.
        <rect x={0} y={0} width={W} height={H} fill="transparent" style={{ cursor: 'crosshair' }} data-plan-lineup-area
          onClick={e => {
            e.stopPropagation()
            const svg = svgRef.current!
            const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
            const q = pt.matrixTransform(svg.getScreenCTM()!.inverse())
            onLineUpTap({ x: q.x, y: q.y })
          }} />
      )}
      {aerial && lineUpTaps && lineUpTaps.length > 0 && (
        <g pointerEvents="none" data-plan-lineup-taps={lineUpTaps.length}>
          {lineUpTaps.length === 2 && <line x1={lineUpTaps[0].x} y1={lineUpTaps[0].y} x2={lineUpTaps[1].x} y2={lineUpTaps[1].y} stroke="#F97316" strokeWidth={3} strokeDasharray="8 5" />}
          {lineUpTaps.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={11} fill="none" stroke="white" strokeWidth={4} />
              <circle cx={p.x} cy={p.y} r={11} fill="#F97316" fillOpacity={0.35} stroke="#F97316" strokeWidth={2.5} />
              <text x={p.x} y={p.y - 16} textAnchor="middle" fontSize={13} fontWeight={700} fill="#9A3412" style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>{i + 1}</text>
            </g>
          ))}
        </g>
      )}

      {angleMarks}

      {checks && plan.crossings.map((c, k) => (
        <g key={`x-${k}`} pointerEvents="none" data-plan-crossing={`${c.aName}|${c.bName}`}>
          <circle cx={toX(c.at.x)} cy={toY(c.at.y)} r={11} fill="#DC2626" fillOpacity={0.18} stroke="#DC2626" strokeWidth={2.5} />
          <path d={`M${toX(c.at.x) - 5},${toY(c.at.y) - 5} l10,10 M${toX(c.at.x) + 5},${toY(c.at.y) - 5} l-10,10`} stroke="#DC2626" strokeWidth={2.5} />
        </g>
      ))}

      {houseMovable && (() => {
        // At least 44 px across on screen.
        const rA = Math.max(16, 22 * unitsPerPx), rH = Math.max(24, 24 * unitsPerPx)
        // The house grip hangs just below the house (toward the street) when there is room,
        // so it never covers the returns' grips; otherwise in the middle of the house.
        const hb = Math.max(...plan.house!.map(p => toY(p.y)))
        const below = hb + rH + 8 + rH < H - 30
        // No room below: on the front wall, clear of the returns' grips at the house's sides.
        const hc = below ? { x: houseC!.x, y: hb + rH + 8 } : { x: houseC!.x, y: Math.max(houseC!.y, Math.min(hb, H - 30 - rH)) }
        return (
          <g>
            {plan.houseAttach.map(h => {
              // The grip sits just inside the house wall, level with where the return meets it.
              const x = toX(h.at.x) + (houseC!.x > toX(h.at.x) ? 1 : -1) * (rA + 3), y = toY(h.at.y)
              return (
                <g key={h.which} onPointerDown={e => startHouseDrag(e, h.which)} onClick={e => e.stopPropagation()} style={{ cursor: 'ns-resize' }} data-plan-house-attach={h.name}>
                  <line x1={toX(h.at.x)} y1={y} x2={x} y2={y} stroke={INK} strokeWidth={2} />
                  <circle cx={x} cy={y} r={rA} fill="white" fillOpacity={0.85} stroke={INK} strokeWidth={2} />
                  <path d={`M${x},${y - rA * 0.62} l-${rA * 0.3},${rA * 0.36} h${rA * 0.6} z M${x},${y + rA * 0.62} l-${rA * 0.3},-${rA * 0.36} h${rA * 0.6} z`} fill={INK} />
                </g>
              )
            })}
            <g onPointerDown={e => startHouseDrag(e, 'both')} onClick={e => e.stopPropagation()} style={{ cursor: 'ns-resize' }} data-plan-house-handle>
              {below && <line x1={hc.x} y1={hb} x2={hc.x} y2={hc.y - rH} stroke={INK} strokeWidth={2} />}
              <circle cx={hc.x} cy={hc.y} r={rH} fill={INK} fillOpacity={0.85} stroke="white" strokeWidth={2} />
              <path d={`M${hc.x},${hc.y - rH * 0.62} l-${rH * 0.3},${rH * 0.34} h${rH * 0.6} z M${hc.x},${hc.y + rH * 0.62} l-${rH * 0.3},-${rH * 0.34} h${rH * 0.6} z M${hc.x - rH * 0.38},${hc.y} h${rH * 0.76}`} fill="white" stroke="white" strokeWidth={2} />
            </g>
          </g>
        )
      })()}

      {/* The middle of each corner and end handle over the labels and angle chips (a gate's grip, drawn next, stays clear of them); the rest of its 44 px sits under the labels. */}
      {onDrawingChange && plan.handles.map(k => plan.vertices[k] && (
        <circle key={`core-${k}`} cx={toX(plan.vertices[k].x)} cy={toY(plan.vertices[k].y)} r={Math.max(9, 12 * unitsPerPx)} fill="white" fillOpacity={0.01}
          style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={e => startDrag(e, 'vertex', k)} onClick={e => e.stopPropagation()} data-plan-corner-core={k} />
      ))}

      {((!aerial && onGateTap) || onGateSlide || gateLocked) && plan.sides.map(sd => {
        if (!sd.gate) return null
        const cx = (toX(sd.gate.a.x) + toX(sd.gate.b.x)) / 2, cy = (toY(sd.gate.a.y) + toY(sd.gate.b.y)) / 2
        // Clear of the corner handles at the side's two ends (a short side's gate sits close to them).
        const coreR = onDrawingChange ? Math.max(9, 12 * unitsPerPx) : 0
        const toEnd = Math.min(Math.hypot(cx - toX(sd.a.x), cy - toY(sd.a.y)), Math.hypot(cx - toX(sd.b.x), cy - toY(sd.b.y)))
        const r = Math.max(6, Math.min(Math.max(18, 20 * unitsPerPx), toEnd - coreR))
        const tap = !aerial && onGateTap ? onGateTap : null
        const slides = !!onGateSlide && !gateLocked
        // Arrows along the side: drag me this way or that.
        const len = Math.hypot(toX(sd.gate.b.x) - toX(sd.gate.a.x), toY(sd.gate.b.y) - toY(sd.gate.a.y)) || 1
        const ux = (toX(sd.gate.b.x) - toX(sd.gate.a.x)) / len, uy = (toY(sd.gate.b.y) - toY(sd.gate.a.y)) / len
        const arrow = (k: number) => {
          const tx = cx + ux * r * 0.75 * k, ty = cy + uy * r * 0.75 * k, bx = cx + ux * r * 0.35 * k, by = cy + uy * r * 0.35 * k
          return `M${tx.toFixed(1)},${ty.toFixed(1)} L${(bx - uy * r * 0.25).toFixed(1)},${(by + ux * r * 0.25).toFixed(1)} L${(bx + uy * r * 0.25).toFixed(1)},${(by - ux * r * 0.25).toFixed(1)} Z`
        }
        const i = layout.sides.findIndex(s => s.id === sd.sideId)
        return (
          <g key={`gate-${sd.sideId}`} style={{ cursor: slides ? 'grab' : tap ? 'pointer' : 'not-allowed', touchAction: 'none' }}
            onPointerDown={slides || gateLocked ? e => startGateDrag(e, sd) : undefined}
            onClick={e => { e.stopPropagation(); if (drag.current) return; if (tap) tap(sd.sideId); else if (!gateLocked) onSideTap?.(sd.sideId) }}
            data-plan-gate-grip={sd.name} data-gate-start-in={String(derived.sides[i]?.gateAtIn ?? '')} {...(gateLocked ? { 'data-gate-locked': 'true' } : {})}>
            <circle cx={cx} cy={cy} r={r} fill="white" fillOpacity={0.01}
              stroke={INK} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="3 3" {...(tap ? { 'data-plan-gate-tap': sd.name } : {})} />
            {slides && <path d={`${arrow(1)} ${arrow(-1)}`} fill={INK} fillOpacity={0.55} pointerEvents="none" />}
          </g>
        )
      })}

      {gateDrag && (() => {
        // While a gate is dragged: "12 ft ← [5 ft gate] → 31 ft" and the sections of both pieces, live.
        const i = layout.sides.findIndex(s => s.id === gateDrag.sideId)
        const s = layout.sides[i], r = derived.sides[i], sd = plan.sides.find(x => x.sideId === gateDrag.sideId)
        if (!s?.gate || !r || r.gateAtIn == null || !sd?.gate) return null
        const at = r.gateAtIn, w = s.gate.widthIn
        const before = at, after = Math.max(0, r.lengthIn - at - w)
        let off = 0
        for (let k = 0; k < i; k++) off += derived.sides[k].runs.length
        const secs = (match: (span: [number, number]) => boolean) => {
          const k = r.pieceSpans.findIndex(match)
          if (k < 0) return 0
          const [a, b] = r.pieceSpans[k]
          return runSections?.[off + k] ?? sectionsForRun((b - a) / 12, widthFt)
        }
        const bs = before > 0.01 ? secs(([, b]) => Math.abs(b - at) < 0.01) : 0
        const as = after > 0.01 ? secs(([a]) => Math.abs(a - (at + w)) < 0.01) : 0
        const line1 = gateDistanceTextExact(before, w, after)
        const sec = (n: number) => `${n} section${n === 1 ? '' : 's'}`
        const line2 = `${sec(bs)}  ·  ${sec(as)}`
        const fsz = Math.max(16 * fs, 15 * unitsPerPx), fsz2 = fsz * 0.8
        const bw = Math.max(textWidth(line1, fsz, 700), textWidth(line2, fsz2, 600)) + 24 * unitsPerPx
        const bh = fsz + fsz2 + 22 * unitsPerPx
        const gx = (toX(sd.gate.a.x) + toX(sd.gate.b.x)) / 2, gy = (toY(sd.gate.a.y) + toY(sd.gate.b.y)) / 2
        // On a phone the magnifier sits above the finger and the label above it (or below the finger near the top).
        const f = gateDrag.finger
        const R = 58 * unitsPerPx, Z = 2.5
        const lp = f ? { x: Math.min(Math.max(f.x, R + 4), W - R - 4), y: f.y - R - 34 * unitsPerPx < R + 4 ? f.y + R + 44 * unitsPerPx : f.y - R - 34 * unitsPerPx } : null
        const anchorY = lp ? lp.y - R : gy - 30 * unitsPerPx
        let ly = anchorY - bh - 8 * unitsPerPx
        if (ly < 4) ly = (lp ? Math.max(lp.y + R, f!.y) : gy) + 36 * unitsPerPx
        ly = Math.min(ly, H - bh - 4)
        const lx = Math.min(Math.max((lp ? lp.x : gx), bw / 2 + 4), W - bw / 2 - 4)
        const clipId = `plan-loupe-${uid}`
        return (
          <g pointerEvents="none">
            {lp && f && (
              <g data-plan-loupe>
                <clipPath id={clipId}><circle cx={lp.x} cy={lp.y} r={R} /></clipPath>
                <circle cx={lp.x} cy={lp.y} r={R} fill="white" />
                <g clipPath={`url(#${clipId})`}>
                  <use href={`#${drawId}`} transform={`translate(${lp.x} ${lp.y}) scale(${Z}) translate(${-f.x} ${-f.y})`} />
                </g>
                <circle cx={lp.x} cy={lp.y} r={R} fill="none" stroke="white" strokeWidth={5 * unitsPerPx} />
                <circle cx={lp.x} cy={lp.y} r={R} fill="none" stroke={INK} strokeOpacity={0.5} strokeWidth={1.5 * unitsPerPx} />
                <path d={`M${lp.x - 12 * unitsPerPx},${lp.y} h${24 * unitsPerPx} M${lp.x},${lp.y - 12 * unitsPerPx} v${24 * unitsPerPx}`} stroke={INK} strokeWidth={1.5 * unitsPerPx} />
              </g>
            )}
            <g data-gate-live={gateDrag.sideId} data-before-in={String(before)} data-after-in={String(after)} data-width-in={String(w)}
              data-before-sections={String(bs)} data-after-sections={String(as)}>
              <rect x={lx - bw / 2} y={ly} width={bw} height={bh} rx={8 * unitsPerPx} fill={INK} fillOpacity={0.92} />
              <text x={lx} y={ly + 8 * unitsPerPx + fsz * 0.85} textAnchor="middle" fontSize={fsz} fontWeight={700} fill="white" data-gate-live-text>{line1}</text>
              <text x={lx} y={ly + 12 * unitsPerPx + fsz + fsz2 * 0.85} textAnchor="middle" fontSize={fsz2} fontWeight={600} fill="#E9D5FF" data-gate-live-sections>{line2}</text>
            </g>
          </g>
        )
      })()}

      {houseEditable && houseSel && plan.houseRect && (() => {
        // The house: drag it to move it, the round arrow turns it, the corner square sizes it. Each at least 44 px.
        const hr = plan.houseRect!
        const c = houseCorners(hr)
        const rG = Math.max(16, 22 * unitsPerPx)
        const cx = toX(hr.cx), cy = toY(hr.cy)
        // The turn grip out past one corner, the size grip on the opposite one.
        const out = (p: { x: number; y: number }, by: number) => { const dx = toX(p.x) - cx, dy = toY(p.y) - cy, l = Math.hypot(dx, dy) || 1; return { x: toX(p.x) + (dx / l) * by, y: toY(p.y) + (dy / l) * by } }
        const rot = out(c[2], rG + 6), size = out(c[0], rG + 6)
        return (
          <g data-plan-house-tools>
            <g style={{ cursor: 'move', touchAction: 'none' }} onPointerDown={e => startHouseEdit(e, 'houseMove')} onClick={e => e.stopPropagation()} data-plan-house-move>
              <circle cx={cx} cy={cy} r={rG} fill={INK} fillOpacity={0.8} stroke="white" strokeWidth={2} />
              <path d={`M${cx - rG * 0.55},${cy} h${rG * 1.1} M${cx},${cy - rG * 0.55} v${rG * 1.1}`} stroke="white" strokeWidth={2.5} pointerEvents="none" />
            </g>
            <g style={{ cursor: 'grab', touchAction: 'none' }} onPointerDown={e => startHouseEdit(e, 'houseRot')} onClick={e => e.stopPropagation()} data-plan-house-rotate>
              <circle cx={rot.x} cy={rot.y} r={rG} fill="white" fillOpacity={0.9} stroke={INK} strokeWidth={2} />
              <path d={`M${rot.x - rG * 0.45},${rot.y + rG * 0.1} A${rG * 0.45},${rG * 0.45} 0 1 1 ${rot.x + rG * 0.1},${rot.y + rG * 0.45}`} fill="none" stroke={INK} strokeWidth={2.2} pointerEvents="none" />
              <path d={`M${rot.x + rG * 0.1},${rot.y + rG * 0.45} l${rG * 0.3},-${rG * 0.05} M${rot.x + rG * 0.1},${rot.y + rG * 0.45} l${rG * 0.05},-${rG * 0.3}`} stroke={INK} strokeWidth={2.2} pointerEvents="none" />
            </g>
            <g style={{ cursor: 'nwse-resize', touchAction: 'none' }} onPointerDown={e => startHouseEdit(e, 'houseSize')} onClick={e => e.stopPropagation()} data-plan-house-size>
              <circle cx={size.x} cy={size.y} r={rG} fill="white" fillOpacity={0.01} />
              <rect x={size.x - rG * 0.45} y={size.y - rG * 0.45} width={rG * 0.9} height={rG * 0.9} fill="white" stroke={INK} strokeWidth={2} pointerEvents="none" />
            </g>
          </g>
        )
      })()}

      {pointLive}

      {live && (() => {
        // Just above the house, near the finger (the top of the drawing can be under a sticky header on a phone).
        const top = houseC ? Math.min(...plan.house!.map(p => toY(p.y))) : 60
        const w = live.length * 8.6 * fs + 20, h = 30 * fs
        const x = Math.min(Math.max(W / 2, w / 2 + 4), W - w / 2 - 4)
        const y = Math.max(4, top - h - 34 * fs)
        return (
          <g data-plan-live-label pointerEvents="none">
            <rect x={x - w / 2} y={y} width={w} height={h} rx={8} fill={INK} fillOpacity={0.9} />
            <text x={x} y={y + 20 * fs} textAnchor="middle" fontSize={16 * fs} fontWeight={700} fill="white">{live}</text>
          </g>
        )
      })()}

      {plan.street && !aerial && (
        <g>
          <line x1={24} y1={H - 22} x2={W - 24} y2={H - 22} stroke={GRAY} strokeWidth={2} strokeDasharray="14 8" />
          <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={11} fontWeight={700} letterSpacing={3} fill={GRAY}>STREET SIDE</text>
        </g>
      )}
      <text x={12} y={18} fontSize={10.5} fill={GRAY} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>Not to scale for permitting</text>
    </svg>
  )
}

/** Each leaf to scale: the open leaf, its swing arc, on the side it swings to (into the yard or out). */
function GateSwing({ gate, sc }: { gate: PlanGate; sc: Pick<PlanScreen, 'toX' | 'toY'> }) {
  const leaves = screenLeaves(gate, sc)
  return (
    <g data-plan-gate={gate.type} data-gate-swing={gate.leaves.map(l => l.swing).join(',')} data-gate-hinge={gate.hinge ?? 'both'}>
      {leaves.map((l, k) => (
        <g key={k}>
          <line x1={l.hx} y1={l.hy} x2={l.ox} y2={l.oy} stroke={INK} strokeWidth={1.8} />
          <path d={`M${l.cx.toFixed(1)},${l.cy.toFixed(1)} A${l.r.toFixed(1)},${l.r.toFixed(1)} 0 0 ${l.sweep} ${l.ox.toFixed(1)},${l.oy.toFixed(1)}`} fill="none" stroke={INK} strokeWidth={1.3} strokeDasharray="4 3" />
        </g>
      ))}
    </g>
  )
}
