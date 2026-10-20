/**
 * Draw the fence on the aerial photo (the website quote, step 2). The USGS
 * NAIP photo (the same free photo as the quote drawing and Site Plans) opens
 * on the house with the county's lot lines; one finger pans, two pinch zoom.
 *
 *   tap                a point (the fence starts there, then each corner)
 *   press and hold     a magnifier under the finger; the point goes where it is let go
 *   tap the last point again, or Done    the run is finished
 *   drag a point       moves it (with the magnifier); tap a point: delete it, or say it ends at the house
 *   tap a length       type the length measured ("I measured 82 ft")
 *   Add a gate         then tap the side where it goes, and its size
 *
 * Straight and square (on by default) snaps a new side to straight on or a 90
 * degree corner from the side before (the first side squares to the lot
 * lines), and a point near another point lands on it (a corner). Lengths are
 * true ground distance (widgetDraw.ts), shown live to the nearest foot.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { createFreeMap, naipLayer, USGS_TILES, type FreeMap } from '../freeMap'
import { USGS_BACKUP_MAX_ZOOM } from '../sitePlanGeometry'
import {
  fitRun, groundFt, nearHouse, ringHeadings, runSides, sideCount, sideEnds, sideLength, snapAngle, snapToPoint, totalFt,
  gateStartInOf, DOUBLE_GATE_FT, WALK_GATE_FT, type LatLng, type WidgetDrawing, type WidgetGate, type WidgetRun,
} from '../widgetDraw'
import { snapStart, gateDistances, gateDistanceText, startFromEnd } from '../gateSlide'

type Mode = 'draw' | 'idle' | 'gate'
type Sheet =
  | { kind: 'point'; run: string; idx: number }
  | { kind: 'length'; run: string; side: number }
  | { kind: 'gate'; run: string; side: number; at: number }
  | { kind: 'startOver' }
  | null

interface Snapshot { drawing: WidgetDrawing; active: string | null; mode: Mode }

const ORANGE = '#f97316'
const HOLD_MS = 280
const MOVE_PX = 8
const SNAP_PX = 22
let runSeq = 0
const newRunId = () => `r${Date.now().toString(36)}${++runSeq}`

export default function DrawMap({ at, drawing, onChange, snap, onSnap, parcel, houseAt, onActiveChange }: {
  at: LatLng
  drawing: WidgetDrawing
  onChange: (d: WidgetDrawing) => void
  snap: boolean
  onSnap: (on: boolean) => void
  /** The county's lot lines, when known (drawn faintly). */
  parcel: LatLng[] | null
  /** The property's center point when it is the county's (for "Ends at the house"). */
  houseAt: LatLng | null
  /** Tells the page whether a run is still being drawn (Next waits for Done). */
  onActiveChange?: (drawing: boolean) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const fm = useRef<FreeMap | null>(null)
  const [, setTick] = useState(0)
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(() => (drawing.runs.some(r => r.pts.length >= 2) ? 'idle' : 'draw'))
  const [sheet, setSheet] = useState<Sheet>(null)
  const [hint, setHint] = useState('')
  const [loupe, setLoupe] = useState<{ x: number; y: number; p: LatLng } | null>(null)
  const undo = useRef<Snapshot[]>([])
  const [undoCount, setUndoCount] = useState(0)

  // Latest values for the map's event handlers.
  const st = useRef({ drawing, active, mode, snap, sheet, parcel, houseAt })
  st.current = { drawing, active, mode, snap, sheet, parcel, houseAt }
  useEffect(() => { onActiveChange?.(mode === 'draw' && !!active && (drawing.runs.find(r => r.id === active)?.pts.length ?? 0) > 0) }, [mode, active, drawing])  // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback(() => {
    undo.current.push({ drawing: st.current.drawing, active: st.current.active, mode: st.current.mode })
    if (undo.current.length > 80) undo.current.shift()
    setUndoCount(undo.current.length)
  }, [])
  const commit = useCallback((d: WidgetDrawing, next?: { active?: string | null; mode?: Mode }) => {
    push()
    onChange(d)
    if (next?.active !== undefined) setActive(next.active)
    if (next?.mode) setMode(next.mode)
  }, [onChange, push])

  // ── The map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current) return
    const f = createFreeMap(mapEl.current, { center: [at.lat, at.lng], zoom: 19, base: 'aerial', doubleClickZoom: false })
    fm.current = f
    f.map.options.boxZoom = false
    const tick = () => setTick(t => t + 1)
    f.map.on('move zoom resize viewreset zoomend moveend', tick)
    setReady(true)
    return () => { f.destroy(); fm.current = null }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // A new address: the photo moves to it.
  useEffect(() => { fm.current?.map.setView([at.lat, at.lng], 19, { animate: false }) }, [at.lat, at.lng])

  // The county's lot lines, faint.
  useEffect(() => {
    const map = fm.current?.map
    if (!map || !parcel || parcel.length < 3) return
    const poly = L.polygon(parcel.map(p => [p.lat, p.lng] as [number, number]), { color: '#ffffff', weight: 2, opacity: 0.75, dashArray: '6 6', fill: false, interactive: false })
    poly.addTo(map)
    return () => { poly.remove() }
  }, [parcel, ready])

  const toScreen = (p: LatLng) => { const m = fm.current?.map; if (!m) return { x: 0, y: 0 }; const c = m.latLngToContainerPoint([p.lat, p.lng]); return { x: c.x, y: c.y } }
  const toLatLng = (x: number, y: number): LatLng => { const ll = fm.current!.map.containerPointToLatLng([x, y]); return { lat: ll.lat, lng: ll.lng } }
  const ftPerPx = () => {
    const m = fm.current?.map
    if (!m) return 1
    return (156543.03392 * Math.cos((m.getCenter().lat * Math.PI) / 180)) / 2 ** m.getZoom() / 0.3048
  }
  const local = (clientX: number, clientY: number) => { const r = mapEl.current!.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top } }

  // ── Snapping a new or moved point ──────────────────────────────────────────
  /** Where a point goes: on another point when close, else straight / square to the side before (when on). */
  function placeAt(raw: LatLng, ctx: { runId: string | null; idx: number | null }): LatLng {
    const d = st.current.drawing
    const run = ctx.runId ? d.runs.find(r => r.id === ctx.runId) ?? null : null
    const targets: LatLng[] = []
    for (const r of d.runs) {
      r.pts.forEach((p, k) => {
        if (r !== run) { targets.push(p); return }
        // On its own run: only the first point (to close it), never itself or its neighbors.
        if (ctx.idx === null && k === 0 && r.pts.length >= 3) targets.push(p)
      })
    }
    const onPoint = snapToPoint(raw, targets, SNAP_PX * ftPerPx())
    if (onPoint) return onPoint
    if (!st.current.snap || !run) return raw
    // New point at the end of the run being drawn, or a point being moved: square to its neighbor before.
    const i = ctx.idx === null ? run.pts.length : ctx.idx
    const prev = i > 0 ? run.pts[i - 1] : null
    if (!prev) return raw
    const prevPrev = i > 1 ? run.pts[i - 2] : null
    const refs = prevPrev ? [] : [
      ...ringHeadings(st.current.parcel ?? []),
      ...d.runs.filter(r => r !== run).flatMap(r => ringHeadings(r.pts, 3)),
    ]
    return snapAngle(prev, raw, { prevPrev, refHeadings: refs }).pt
  }

  // ── Adding points ──────────────────────────────────────────────────────────
  function addPoint(p: LatLng) {
    const d = st.current.drawing
    let run = st.current.active ? d.runs.find(r => r.id === st.current.active) ?? null : null
    let runs = d.runs
    if (!run) {
      run = { id: newRunId(), pts: [], start: 'free', end: 'free', typedFt: [], gates: [] }
      runs = [...runs, run]
    }
    // Back on its own first point: closed, all the way around.
    if (run.pts.length >= 3 && groundFt(run.pts[0], p) < 0.5) { finish({ ...run, closed: true }, runs); return }
    if (run.pts.length && groundFt(run.pts[run.pts.length - 1], p) < 1) { setHint('That point is already there. Tap the next corner, or Done.'); return }
    const next = fitRun({ ...run, pts: [...run.pts, p] })
    setHint(next.pts.length === 1 ? 'Now tap the next corner. Double tap or Done to finish.' : '')
    commit({ ...d, runs: runs.map(r => (r.id === run!.id ? next : r)) }, { active: next.id, mode: 'draw' })
  }

  /** The run being drawn is done: ends near the house are marked "at the house". */
  function finish(run?: WidgetRun, runsIn?: WidgetRun[]) {
    const d = st.current.drawing
    const r0 = run ?? (st.current.active ? d.runs.find(r => r.id === st.current.active) : null)
    let runs = runsIn ?? d.runs
    if (!r0) { setMode('idle'); setActive(null); return }
    if (r0.pts.length < 2) {
      runs = runs.filter(r => r.id !== r0.id)
      commit({ ...d, runs }, { active: null, mode: 'idle' })
      return
    }
    const r = fitRun(r0)
    const others = runs.filter(x => x.id !== r.id).flatMap(x => x.pts)
    const free = (p: LatLng) => !others.some(o => groundFt(o, p) < 0.5)
    const { houseAt: house, parcel: lot } = st.current
    const startHouse = !r.closed && free(r.pts[0]) && nearHouse(r.pts[0], house, lot)
    const endHouse = !r.closed && free(r.pts[r.pts.length - 1]) && nearHouse(r.pts[r.pts.length - 1], house, lot)
    const done = { ...r, start: startHouse ? 'house' as const : r.start, end: endHouse ? 'house' as const : r.end }
    setHint(startHouse || endHouse ? 'Ends next to the house are marked "at the house". Tap an end point to change it.' : '')
    commit({ ...d, runs: runs.map(x => (x.id === done.id ? done : x)) }, { active: null, mode: 'idle' })
  }

  // ── Taps, holds and drags on the photo ─────────────────────────────────────
  const gesture = useRef<{ id: number; x: number; y: number; t: number; timer: number | null; placing: boolean; pointers: Set<number>; suppressUntil: number; lastTap: { t: number; x: number; y: number } | null }>({ id: -1, x: 0, y: 0, t: 0, timer: null, placing: false, pointers: new Set(), suppressUntil: 0, lastTap: null })

  useEffect(() => {
    const el = mapEl.current
    const map = fm.current?.map
    if (!el || !map) return
    const g = gesture.current
    const cancelHold = () => { if (g.timer !== null) { clearTimeout(g.timer); g.timer = null } }
    const down = (e: PointerEvent) => {
      g.pointers.add(e.pointerId)
      if (g.pointers.size > 1) { cancelHold(); if (g.placing) endPlacing(null); return }
      if (st.current.mode !== 'draw' || st.current.sheet) return
      const p = local(e.clientX, e.clientY)
      g.id = e.pointerId; g.x = p.x; g.y = p.y; g.t = Date.now()
      cancelHold()
      g.timer = window.setTimeout(() => {
        g.timer = null
        if (g.pointers.size !== 1) return
        g.placing = true
        map.dragging.disable()
        const ll = placeAt(toLatLng(g.x, g.y), { runId: st.current.active, idx: null })
        setLoupe({ x: g.x, y: g.y, p: ll })
      }, HOLD_MS)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== g.id) return
      const p = local(e.clientX, e.clientY)
      if (g.placing) {
        const ll = placeAt(toLatLng(p.x, p.y), { runId: st.current.active, idx: null })
        setLoupe({ x: p.x, y: p.y, p: ll })
        return
      }
      if (Math.hypot(p.x - g.x, p.y - g.y) > MOVE_PX) cancelHold()
    }
    const endPlacing = (p: LatLng | null) => {
      g.placing = false
      map.dragging.enable()
      setLoupe(null)
      g.suppressUntil = Date.now() + 450
      if (p) addPoint(p)
    }
    const up = (e: PointerEvent) => {
      g.pointers.delete(e.pointerId)
      if (e.pointerId !== g.id) return
      cancelHold()
      if (g.placing) {
        const p = local(e.clientX, e.clientY)
        endPlacing(placeAt(toLatLng(p.x, p.y), { runId: st.current.active, idx: null }))
      }
    }
    const cancel = (e: PointerEvent) => { g.pointers.delete(e.pointerId); cancelHold(); if (g.placing) endPlacing(null) }
    // A quick tap (Leaflet's click: no pan in between).
    const click = (e: L.LeafletMouseEvent) => {
      if (Date.now() < g.suppressUntil || st.current.sheet) return
      const m = st.current.mode
      if (m === 'gate') { setHint('Tap on a fence side, where the gate goes.'); return }
      if (m !== 'draw') { if (st.current.drawing.runs.some(r => r.pts.length >= 2)) setHint('Tap Add another run to draw more fence, or drag a point to move it.'); return }
      const pt = e.containerPoint
      const run = st.current.active ? st.current.drawing.runs.find(r => r.id === st.current.active) : null
      // A second quick tap in the same spot, on the point just placed: the run is done.
      const last = run?.pts[run.pts.length - 1]
      if (last && g.lastTap && Date.now() - g.lastTap.t < 400 && Math.hypot(g.lastTap.x - pt.x, g.lastTap.y - pt.y) < 16) {
        const s = toScreen(last)
        if (Math.hypot(s.x - pt.x, s.y - pt.y) < 24) { g.lastTap = null; finish(); return }
      }
      g.lastTap = { t: Date.now(), x: pt.x, y: pt.y }
      addPoint(placeAt({ lat: e.latlng.lat, lng: e.latlng.lng }, { runId: st.current.active, idx: null }))
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    map.on('click', click)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      map.off('click', click)
      cancelHold()
    }
  }, [ready])  // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging a point (or tapping it).
  const drag = useRef<{ run: string; idx: number; x: number; y: number; t: number; moved: boolean; id: number } | null>(null)
  function pointDown(e: React.PointerEvent, run: WidgetRun, idx: number) {
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const p = local(e.clientX, e.clientY)
    drag.current = { run: run.id, idx, x: p.x, y: p.y, t: Date.now(), moved: false, id: e.pointerId }
  }
  function pointMove(e: React.PointerEvent) {
    const dg = drag.current
    if (!dg || e.pointerId !== dg.id) return
    const p = local(e.clientX, e.clientY)
    if (!dg.moved && Math.hypot(p.x - dg.x, p.y - dg.y) < 6) return
    if (!dg.moved) { dg.moved = true; push() }
    const ll = placeAt(toLatLng(p.x, p.y), { runId: dg.run, idx: dg.idx })
    const d = st.current.drawing
    onChange({ ...d, runs: d.runs.map(r => (r.id === dg.run ? { ...r, pts: r.pts.map((q, k) => (k === dg.idx ? ll : q)) } : r)) })
    setLoupe({ x: p.x, y: p.y, p: ll })
  }
  function pointUp(e: React.PointerEvent, run: WidgetRun, idx: number) {
    const dg = drag.current
    drag.current = null
    setLoupe(null)
    if (!dg || dg.moved) return
    e.stopPropagation()
    // A tap on a point. While drawing: the run's first point closes it; another run's point joins it.
    if (st.current.mode === 'draw') {
      const act = st.current.active ? st.current.drawing.runs.find(r => r.id === st.current.active) : null
      if (act && act.id === run.id && idx === act.pts.length - 1 && act.pts.length >= 2) { finish(); return }
      if (act && act.id === run.id && idx === 0 && act.pts.length >= 3) { addPoint(run.pts[0]); return }
      if (!act || act.id !== run.id) { addPoint(run.pts[idx]); return }
    }
    setSheet({ kind: 'point', run: run.id, idx })
  }

  // Sliding a gate along its side (gateSlide.ts: stays on the side, whole feet), with the magnifier and the live distances.
  const gateDrag = useRef<{ run: string; side: number; x: number; y: number; moved: boolean; id: number } | null>(null)
  const [gateLive, setGateLive] = useState<string | null>(null)
  function gateDown(e: React.PointerEvent, run: WidgetRun, i: number) {
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const p = local(e.clientX, e.clientY)
    gateDrag.current = { run: run.id, side: i, x: p.x, y: p.y, moved: false, id: e.pointerId }
  }
  function gateMove(e: React.PointerEvent) {
    const dg = gateDrag.current
    if (!dg || e.pointerId !== dg.id) return
    const p = local(e.clientX, e.clientY)
    if (!dg.moved && Math.hypot(p.x - dg.x, p.y - dg.y) < 6) return
    if (!dg.moved) { dg.moved = true; push() }
    const d = st.current.drawing
    const run = d.runs.find(r => r.id === dg.run)
    const g = run?.gates[dg.side]
    if (!run || !g) return
    const [a, b] = sideEnds(run, dg.side).map(toScreen)
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
    const Lin = sideLength(run, dg.side).ft * 12, w = g.widthFt * 12
    const start = snapStart(t * Lin - w / 2, Lin, w)
    if (start === null) return
    onChange({ ...d, runs: d.runs.map(r => (r.id === run.id ? { ...r, gates: r.gates.map((x, k) => (k === dg.side && x ? { ...x, startFt: start / 12 } : x)) } : r)) })
    const dist = gateDistances(Lin, start, w)
    setGateLive(gateDistanceText(dist.beforeIn, w, dist.afterIn))
    setLoupe({ x: p.x, y: p.y, p: toLatLng(p.x, p.y) })
  }
  function gateUp(e: React.PointerEvent, run: WidgetRun, i: number) {
    const dg = gateDrag.current
    gateDrag.current = null
    setLoupe(null); setGateLive(null)
    if (!dg || dg.moved) return
    e.stopPropagation()
    setSheet({ kind: 'gate', run: run.id, side: i, at: 0.5 })
  }

  // ── Changing points, sides and gates ───────────────────────────────────────
  const runOf = (id: string) => drawing.runs.find(r => r.id === id)
  function setRun(id: string, f: (r: WidgetRun) => WidgetRun | null) {
    const runs = drawing.runs.flatMap(r => { if (r.id !== id) return [r]; const n = f(r); return n ? [n] : [] })
    commit({ ...drawing, runs }, active === id && !runs.some(r => r.id === id) ? { active: null } : undefined)
  }
  function deletePoint(id: string, idx: number) {
    setRun(id, r => {
      const n = sideCount(r)
      const pts = r.pts.filter((_, k) => k !== idx)
      const closed = !!r.closed && pts.length >= 3
      // The two sides that met at the point become one (its typed length and gate go); the rest keep theirs.
      const keep = (arr: Array<any>) => {
        const out: any[] = []
        for (let i = 0; i < n; i++) {
          if (r.closed) { if (i === idx || i === (idx - 1 + n) % n) continue; out.push(arr[i] ?? null) }
          else if (i !== idx && i !== idx - 1) out.push(arr[i] ?? null)
        }
        if (r.closed) { if (closed) out.splice(Math.max(0, idx - 1), 0, null); return out }
        if (idx > 0 && idx < r.pts.length - 1) out.splice(idx - 1, 0, null)
        return out
      }
      const next = fitRun({ ...r, pts, closed, typedFt: keep(r.typedFt), gates: keep(r.gates) })
      if (next.pts.length === 0 || (next.pts.length < 2 && r.id !== active)) return null
      return next
    })
    setSheet(null)
  }
  function setEnd(id: string, which: 'start' | 'end', v: 'free' | 'house') { setRun(id, r => ({ ...r, [which]: v })); setSheet(null) }
  function setTyped(id: string, side: number, ft: number | null) { setRun(id, r => { const t = [...fitRun(r).typedFt]; t[side] = ft; return { ...r, typedFt: t } }); setSheet(null) }
  function setGate(id: string, side: number, g: WidgetGate | null) {
    setRun(id, r => { const gs = [...fitRun(r).gates]; gs[side] = g; return { ...r, gates: gs } })
    setSheet(null); setMode('idle')
  }
  function undoOnce() {
    const s = undo.current.pop()
    setUndoCount(undo.current.length)
    if (!s) return
    onChange(s.drawing); setActive(s.active); setMode(s.mode); setSheet(null); setHint('')
  }
  function startOver() {
    commit({ ...drawing, runs: [] }, { active: null, mode: 'draw' })
    setSheet(null); setHint('Tap where your fence starts, then tap each corner.')
  }
  /** A tap in gate mode: the nearest side within reach, and where along it. */
  function gateTap(e: React.MouseEvent) {
    const p = local(e.clientX, e.clientY)
    let best: { run: WidgetRun; i: number; t: number; d: number } | null = null
    for (const run of drawing.runs) {
      for (let i = 0; i < sideCount(run); i++) {
        const [a, b] = sideEnds(run, i).map(toScreen)
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
        if (!best || d < best.d) best = { run, i, t, d }
      }
    }
    if (!best || best.d > 36) { setHint('Tap right on a fence side, where the gate goes.'); return }
    setSheet({ kind: 'gate', run: best.run.id, side: best.i, at: Math.round(best.t * 1000) / 1000 })
  }


  // ── What is drawn ──────────────────────────────────────────────────────────
  const total = totalFt(drawing)
  const activeRun = active ? runOf(active) ?? null : null
  const finished = drawing.runs.filter(r => r.pts.length >= 2)
  const view = fm.current?.map
  const viewAttr = view ? `${view.getCenter().lat.toFixed(7)},${view.getCenter().lng.toFixed(7)},${view.getZoom()}` : ''

  const help = mode === 'gate' ? 'Tap on a fence side where the gate goes.'
    : mode === 'draw' ? (activeRun && activeRun.pts.length ? (activeRun.pts.length === 1 ? 'Now tap the next corner.' : 'Tap each corner. Double tap the last one, or Done, to finish.') : 'Tap where your fence starts, then tap each corner.')
      : finished.length ? 'Drag a point to move it. Tap a length to type what you measured.' : ''

  return (
    <div className="space-y-2" data-w-draw>
      {/* Two lines kept for the help, so the photo never moves under the finger when it changes. */}
      <p className="text-base font-semibold text-gray-900 min-h-[3rem] leading-6 line-clamp-2" data-w-draw-help>{hint || help}</p>
      <div ref={wrapRef} className="relative rounded-xl overflow-hidden border border-gray-300 select-none" style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        data-w-map data-w-view={viewAttr} data-w-mode={mode}>
        <div ref={mapEl} className="w-full h-[58vh] min-h-[320px] max-h-[560px] bg-gray-200" />
        {ready && view && (
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', zIndex: 450, touchAction: 'none' }} aria-hidden={false} data-w-overlay>
            {/* Gate mode: a tap anywhere goes to the nearest side (short sides and corners included). */}
            {mode === 'gate' && <rect x={0} y={0} width="100%" height="100%" fill="#000000" fillOpacity={0.01} style={{ pointerEvents: 'auto' }}
              onPointerDown={e => e.stopPropagation()} onClick={gateTap} data-w-gate-catcher />}
            {drawing.runs.map(run => {
              const n = sideCount(run)
              const sides = runSides(fitRun(run))
              return (
                <g key={run.id} data-w-run={run.id}>
                  {Array.from({ length: n }, (_, i) => {
                    const [a, b] = sideEnds(run, i).map(toScreen)
                    const s = sides[i]
                    const g = run.gates[i]
                    const L = s.ft
                    // The gate splits the side, as in the quote builder.
                    const gw = g ? Math.min(g.widthFt, L) : 0
                    const g0 = g ? (gateStartInOf(run, i) ?? 0) / 12 : 0
                    const lerp = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
                    const ga = g ? lerp(g0 / L) : null, gb = g ? lerp((g0 + gw) / L) : null
                    // A short side's label sits beside it (away from the yard), so the line and its points stay tappable.
                    const len = Math.hypot(b.x - a.x, b.y - a.y)
                    const cen = run.pts.map(toScreen).reduce((t, q, _, all) => ({ x: t.x + q.x / all.length, y: t.y + q.y / all.length }), { x: 0, y: 0 })
                    const nx = len ? -(b.y - a.y) / len : 0, ny = len ? (b.x - a.x) / len : 0
                    const m0 = lerp(0.5)
                    const outSign = (cen.x - m0.x) * nx + (cen.y - m0.y) * ny > 0 ? -1 : 1
                    const off = len < 130 ? 30 : 0
                    const beside = (q: { x: number; y: number }) => ({ x: q.x + nx * outSign * off, y: q.y + ny * outSign * off })
                    const mid = beside(m0)
                    const pieces = g ? [[0, g0], [g0 + gw, L]].filter(([x, y]) => y - x > 0.4) : []
                    return (
                      <g key={i} data-w-side={`${run.id}:${i}`} data-pieces={pieces.map(([x, y]) => Math.round(y - x)).join(',')}>
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#111827" strokeOpacity={0.45} strokeWidth={8} strokeLinecap="round" />
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ORANGE} strokeWidth={4} strokeLinecap="round" />
                        {ga && gb && (
                          <g data-w-gate-mark={g!.type} data-start-ft={g0} style={{ pointerEvents: mode === 'idle' ? 'auto' : 'none', cursor: 'ew-resize', touchAction: 'none' }}
                            onPointerDown={e => gateDown(e, run, i)} onPointerMove={gateMove} onPointerUp={e => gateUp(e, run, i)} onPointerCancel={() => { gateDrag.current = null; setLoupe(null); setGateLive(null) }}>
                            <line x1={ga.x} y1={ga.y} x2={gb.x} y2={gb.y} stroke="#000000" strokeOpacity={0.01} strokeWidth={40} strokeLinecap="round" />
                            <line x1={ga.x} y1={ga.y} x2={gb.x} y2={gb.y} stroke="#ffffff" strokeWidth={6} />
                            <line x1={ga.x} y1={ga.y} x2={gb.x} y2={gb.y} stroke="#1d4ed8" strokeWidth={2} strokeDasharray="4 3" />
                            <circle cx={ga.x} cy={ga.y} r={4} fill="#1d4ed8" /><circle cx={gb.x} cy={gb.y} r={4} fill="#1d4ed8" />
                          </g>
                        )}
                        {g && ga && gb && len >= 130 ? (
                          <>
                            {pieces.map(([x, y], k) => {
                              const c = beside(lerp(((x + y) / 2) / L))
                              return <Pill key={k} x={c.x} y={c.y} text={`${Math.round(y - x)} ft`} onTap={() => setSheet(mode === 'gate' ? { kind: 'gate', run: run.id, side: i, at: 0.5 } : { kind: 'length', run: run.id, side: i })} attr={{ 'data-w-piece': `${run.id}:${i}:${k}` }} />
                            })}
                            <Pill x={(ga.x + gb.x) / 2 + nx * outSign * 34} y={(ga.y + gb.y) / 2 + ny * outSign * 34} text={`${g.widthFt}' ${g.type === 'double' ? 'double' : 'walk'} gate`} tone="gate" onTap={() => setSheet({ kind: 'gate', run: run.id, side: i, at: 0.5 })} attr={{ 'data-w-gate-label': `${run.id}:${i}` }} />
                          </>
                        ) : (<>
                          {g && ga && gb && (() => { const q = { x: (ga.x + gb.x) / 2 + nx * outSign * 64, y: (ga.y + gb.y) / 2 + ny * outSign * 64 }; return <Pill x={q.x} y={q.y} text={`${g.widthFt}' gate`} tone="gate" onTap={() => setSheet({ kind: 'gate', run: run.id, side: i, at: 0.5 })} attr={{ 'data-w-gate-label': `${run.id}:${i}` }} /> })()}
                          <Pill x={mid.x} y={mid.y} text={`${s.ft} ft${s.typed ? ' · typed' : ''}`} tone={s.typed ? 'typed' : undefined}
                            onTap={() => setSheet(mode === 'gate' ? { kind: 'gate', run: run.id, side: i, at: 0.5 } : { kind: 'length', run: run.id, side: i })} attr={{ 'data-w-side-label': `${run.id}:${i}`, 'data-ft': String(s.ft), 'data-measured-ft': String(s.measuredFt) }} />
                        </>)}
                      </g>
                    )
                  })}
                  {run.pts.map((p, k) => {
                    const s = toScreen(p)
                    const end = !run.closed && (k === 0 || k === run.pts.length - 1)
                    const house = end && ((k === 0 && run.start === 'house') || (k === run.pts.length - 1 && run.end === 'house'))
                    const isActive = run.id === active
                    return (
                      <g key={k} transform={`translate(${s.x} ${s.y})`} style={{ pointerEvents: mode === 'gate' ? 'none' : 'auto', cursor: 'grab', touchAction: 'none' }}
                        onPointerDown={e => pointDown(e, run, k)} onPointerMove={pointMove} onPointerUp={e => pointUp(e, run, k)} onPointerCancel={() => { drag.current = null; setLoupe(null) }}
                        data-w-point={`${run.id}:${k}`} data-lat={p.lat.toFixed(8)} data-lng={p.lng.toFixed(8)} data-end={end ? (house ? 'house' : 'free') : undefined}>
                        <circle r={22} fill="transparent" />
                        <circle r={house ? 11 : 9} fill={house ? '#374151' : '#ffffff'} stroke={isActive && k === run.pts.length - 1 ? '#1d4ed8' : ORANGE} strokeWidth={4} />
                        {house && <path d="M-5 1 L0 -4 L5 1 L5 5 L-5 5 Z" fill="#ffffff" />}
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        )}
        {gateLive && <div className="absolute left-1/2 -translate-x-1/2 top-2 rounded-full bg-blue-700 text-white text-sm font-bold px-3 py-1.5 shadow-lg tabular-nums" style={{ zIndex: 660, pointerEvents: 'none' }} data-w-gate-live>{gateLive}</div>}
        {loupe && view && <Loupe at={loupe} zoom={view.getZoom()} drawing={drawing} boxW={wrapRef.current?.clientWidth ?? 360} />}
        {sheet && (
          <div className="absolute inset-x-2 bottom-2 rounded-2xl bg-white shadow-xl border border-gray-200 p-3 space-y-2" style={{ zIndex: 700 }} data-w-sheet={sheet.kind}>
            <SheetBody key={JSON.stringify(sheet)} sheet={sheet} drawing={drawing} onClose={() => setSheet(null)} deletePoint={deletePoint} setEnd={setEnd} setTyped={setTyped} setGate={setGate} onStartOver={startOver} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-gray-900 tabular-nums" data-w-total={total}>Total: {total.toLocaleString('en-US')} ft</span>
        <label className="flex items-center gap-2 min-h-[44px] text-gray-800" data-w-snap-label>
          <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={snap} onChange={e => onSnap(e.target.checked)} data-w-snap />
          Straight and square
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="btn btn-secondary min-h-[48px]" disabled={undoCount === 0} onClick={undoOnce} data-w-undo>Undo</button>
        {mode === 'draw' && activeRun ? (
          <button type="button" className="btn btn-primary min-h-[48px]" onClick={() => finish()} data-w-done>Done</button>
        ) : (
          <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => { setActive(null); setMode('draw'); setSheet(null); setHint('Tap where this run starts, then each corner.') }} data-w-add-run>{finished.length ? 'Add another run' : 'Draw'}</button>
        )}
        <button type="button" className={`btn ${mode === 'gate' ? 'btn-primary' : 'btn-secondary'} min-h-[48px]`} disabled={finished.length === 0}
          onClick={() => { if (mode === 'draw' && activeRun) finish(); setMode(m => (m === 'gate' ? 'idle' : 'gate')); setSheet(null); setHint('') }} data-w-add-gate>{mode === 'gate' ? 'Cancel gate' : 'Add a gate'}</button>
      </div>
      {drawing.runs.length > 0 && (
        <button type="button" className="text-sm text-gray-600 underline min-h-[44px]" onClick={() => setSheet({ kind: 'startOver' })} data-w-start-over>Start over</button>
      )}
    </div>
  )
}

/** A label on the drawing: big enough to tap. */
function Pill({ x, y, text, tone, onTap, attr }: { x: number; y: number; text: string; tone?: 'typed' | 'gate'; onTap: () => void; attr?: Record<string, string> }) {
  const w = Math.max(48, text.length * 7.4 + 18), h = 30
  const bg = tone === 'gate' ? '#1d4ed8' : tone === 'typed' ? '#065f46' : '#111827'
  return (
    <g transform={`translate(${x - w / 2} ${y - h / 2})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      onPointerDown={e => e.stopPropagation()} onPointerUp={e => { e.stopPropagation(); onTap() }} role="button" {...attr}>
      <rect width={w} height={h} rx={15} fill={bg} fillOpacity={0.88} />
      <text x={w / 2} y={20} textAnchor="middle" fontSize={14} fontWeight={700} fill="#ffffff">{text}</text>
    </g>
  )
}

/** The sheet over the bottom of the photo: a point, a length, a gate, or Start over. */
function SheetBody({ sheet, drawing, onClose, deletePoint, setEnd, setTyped, setGate, onStartOver }: {
  sheet: NonNullable<Sheet>; drawing: WidgetDrawing; onClose: () => void
  deletePoint: (run: string, idx: number) => void
  setEnd: (run: string, which: 'start' | 'end', v: 'free' | 'house') => void
  setTyped: (run: string, side: number, ft: number | null) => void
  setGate: (run: string, side: number, g: WidgetGate | null) => void
  onStartOver: () => void
}) {
  const [text, setText] = useState('')
  const cancel = <button type="button" className="btn btn-quiet w-full min-h-[44px]" onClick={onClose} data-w-sheet-close>Cancel</button>
  if (sheet.kind === 'startOver') {
    return (
      <>
        <p className="text-base font-semibold text-gray-900">Start over? The drawing will be cleared.</p>
        <button type="button" className="btn btn-primary w-full min-h-[48px]" onClick={onStartOver} data-w-start-over-yes>Start over</button>
        {cancel}
      </>
    )
  }
  const run = drawing.runs.find(r => r.id === sheet.run)
  if (!run) return cancel
  if (sheet.kind === 'point') {
    const end = !run.closed && run.pts.length >= 2 && (sheet.idx === 0 || sheet.idx === run.pts.length - 1)
    const which = sheet.idx === 0 ? 'start' : 'end'
    const cur = end ? run[which] : null
    return (
      <>
        <p className="text-base font-semibold text-gray-900">{end ? 'End of the fence' : 'Corner'}</p>
        {end && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`btn min-h-[48px] ${cur === 'house' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEnd(run.id, which, 'house')} data-w-end-house>Ends at the house</button>
            <button type="button" className={`btn min-h-[48px] ${cur === 'free' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEnd(run.id, which, 'free')} data-w-end-free>Stops here</button>
          </div>
        )}
        <button type="button" className="btn btn-secondary w-full min-h-[48px] text-red-700" onClick={() => deletePoint(run.id, sheet.idx)} data-w-delete-point>Delete this point</button>
        {cancel}
      </>
    )
  }
  if (sheet.kind === 'length') {
    const s = sideLength(fitRun(run), sheet.side)
    const v = Number(text.replace(/[^\d.]/g, ''))
    const ok = text.trim() !== '' && v >= 1 && v <= 2000
    return (
      <>
        <p className="text-base font-semibold text-gray-900">This side: {s.ft} ft</p>
        <p className="text-sm text-gray-600">The photo measures {s.measuredFt} ft. Measured it yourself? Type it here.</p>
        <div className="flex gap-2">
          <input className="flex-1 min-w-0 border border-gray-300 rounded-xl px-4 h-12 text-base" inputMode="decimal" placeholder={`${s.ft}`} value={text} autoFocus
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok) setTyped(run.id, sheet.side, Math.round(v * 10) / 10) }} aria-label="Length in feet" data-w-len-input />
          <span className="self-center text-base text-gray-700">ft</span>
        </div>
        <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={!ok} onClick={() => setTyped(run.id, sheet.side, Math.round(v * 10) / 10)} data-w-len-save>Use {ok ? `${Math.round(v * 10) / 10} ft` : 'this length'}</button>
        {s.typed && <button type="button" className="btn btn-secondary w-full min-h-[44px]" onClick={() => setTyped(run.id, sheet.side, null)} data-w-len-measured>Use the photo's {s.measuredFt} ft</button>}
        {cancel}
      </>
    )
  }
  // A gate on this side.
  const s = sideLength(fitRun(run), sheet.side)
  const has = fitRun(run).gates[sheet.side]
  const Lin = s.ft * 12
  const fr = fitRun(run)
  const nowIn = has ? gateStartInOf(fr, sheet.side) : null
  /** A new gate where the side was tapped; a new size keeps the gate's middle where it was (gateSlide.ts). */
  const pickGate = (type: 'walk' | 'double', widthFt: number) => {
    const w = widthFt * 12
    const mid = has && nowIn !== null ? nowIn + has.widthFt * 6 : sheet.at * Lin
    const start = snapStart(mid - w / 2, Lin, w)
    if (start !== null) setGate(run.id, sheet.side, { type, widthFt, startFt: start / 12 })
  }
  const dist = has && nowIn !== null ? gateDistances(Lin, nowIn, has.widthFt * 12) : null
  const typeDistance = (fromEnd: boolean) => {
    const v = Number(text.replace(/[^\d.]/g, ''))
    if (!has || !(v >= 0)) return
    const w = has.widthFt * 12
    const start = snapStart(fromEnd ? startFromEnd(Lin, w, v * 12) : v * 12, Lin, w, [], 6)
    if (start !== null) setGate(run.id, sheet.side, { ...has, startFt: start / 12 })
  }
  return (
    <>
      <p className="text-base font-semibold text-gray-900">Gate on this side ({s.ft} ft)</p>
      <p className="text-sm font-semibold text-gray-700">Walk gate</p>
      <div className="grid grid-cols-3 gap-2">
        {WALK_GATE_FT.map(w => <button key={w} type="button" disabled={w >= s.ft} className={`btn min-h-[48px] ${has?.type === 'walk' && has.widthFt === w ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pickGate('walk', w)} data-w-gate-size={`walk-${w}`}>{w} ft</button>)}
      </div>
      <p className="text-sm font-semibold text-gray-700">Double gate (driveway)</p>
      <div className="grid grid-cols-3 gap-2">
        {DOUBLE_GATE_FT.map(w => <button key={w} type="button" disabled={w >= s.ft} className={`btn min-h-[48px] ${has?.type === 'double' && has.widthFt === w ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pickGate('double', w)} data-w-gate-size={`double-${w}`}>{w} ft</button>)}
      </div>
      {has && dist && (
        <div className="space-y-2 border-t border-gray-100 pt-2" data-w-gate-where>
          <p className="text-sm font-semibold text-gray-900 tabular-nums" data-w-gate-distances>{gateDistanceText(dist.beforeIn, has.widthFt * 12, dist.afterIn)}</p>
          <p className="text-sm text-gray-600">Drag the gate along the fence, or type where it starts.</p>
          <div className="flex gap-2 items-center">
            <input className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 h-12 text-base" inputMode="decimal" placeholder={`${Math.round(dist.beforeIn / 12)}`} value={text} onChange={e => setText(e.target.value)} aria-label="Feet to the gate" data-w-gate-dist-input />
            <span className="text-sm text-gray-700">ft</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary min-h-[48px] text-sm" disabled={!text.trim()} onClick={() => typeDistance(false)} data-w-gate-from-start>From the start</button>
            <button type="button" className="btn btn-secondary min-h-[48px] text-sm" disabled={!text.trim()} onClick={() => typeDistance(true)} data-w-gate-from-end>From the far end</button>
          </div>
        </div>
      )}
      {has && <button type="button" className="btn btn-secondary w-full min-h-[44px] text-red-700" onClick={() => setGate(run.id, sheet.side, null)} data-w-gate-remove>Remove the gate</button>}
      {cancel}
    </>
  )
}

/** The magnifier: the photo under the finger, closer, with the drawing and a cross where the point goes. */
function Loupe({ at, zoom, drawing, boxW }: { at: { x: number; y: number; p: LatLng }; zoom: number; drawing: WidgetDrawing; boxW: number }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const [, setTick] = useState(0)
  const SIZE = 132
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomAnimation: false, fadeAnimation: false, maxZoom: 22 })
    L.tileLayer(USGS_TILES, { maxNativeZoom: USGS_BACKUP_MAX_ZOOM, maxZoom: 22 }).addTo(m)
    const sharp = naipLayer()
    sharp.options.maxZoom = 22
    sharp.addTo(m)
    m.setView([at.p.lat, at.p.lng], Math.min(21, zoom + 2), { animate: false })
    map.current = m
    m.on('move zoom', () => setTick(t => t + 1))
    return () => { m.remove(); map.current = null }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { map.current?.setView([at.p.lat, at.p.lng], Math.min(21, zoom + 2), { animate: false }); setTick(t => t + 1) }, [at.p.lat, at.p.lng, zoom])
  // Above the finger (below it near the top), never off the photo.
  const left = Math.max(4, Math.min(boxW - SIZE - 4, at.x - SIZE / 2))
  const top = at.y - SIZE - 48 > 4 ? at.y - SIZE - 48 : at.y + 48
  const m = map.current
  const sc = (p: LatLng) => { if (!m) return { x: 0, y: 0 }; const c = m.latLngToContainerPoint([p.lat, p.lng]); return { x: c.x, y: c.y } }
  return (
    <div className="absolute rounded-full overflow-hidden border-4 border-white shadow-2xl bg-gray-200" style={{ left, top, width: SIZE, height: SIZE, zIndex: 650, pointerEvents: 'none' }} data-w-loupe>
      <div ref={el} style={{ width: SIZE, height: SIZE }} />
      <svg className="absolute inset-0" width={SIZE} height={SIZE} style={{ zIndex: 500 }}>
        {m && drawing.runs.map(r => Array.from({ length: sideCount(r) }, (_, i) => {
          const [a, b] = sideEnds(r, i).map(sc)
          return <line key={`${r.id}${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ORANGE} strokeWidth={3} />
        }))}
        <line x1={SIZE / 2 - 14} y1={SIZE / 2} x2={SIZE / 2 + 14} y2={SIZE / 2} stroke="#ffffff" strokeWidth={2} />
        <line x1={SIZE / 2} y1={SIZE / 2 - 14} x2={SIZE / 2} y2={SIZE / 2 + 14} stroke="#ffffff" strokeWidth={2} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={5} fill="none" stroke={ORANGE} strokeWidth={2} />
      </svg>
    </div>
  )
}
