/**
 * The quote builder's Yard step as "Sketch and measure" (Jonathan, Nov 6
 * 2026; sketch.ts): draw a rough sketch of the fence with a finger, then type
 * the measured feet on each side, then put the gates in. The sketch never sets
 * a price; the typed feet do. It is a layer on the walk list: every change is
 * written as the walk list (sketchToWalk) the quote is priced from, and the
 * walk list is there as the "List" view for anyone who prefers it.
 *
 * Phone first: the drawing takes most of the screen; the buttons (56 px and
 * up) and the feet box are in the bottom half; the total stays at the top.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactElement } from 'react'
import {
  VIEW_H, VIEW_W, addStroke, sketchLabels, closeLine, deleteLine, fromName, gateAt, movePoint, nearestOn, orderedLines, pointNames, putGate, removeGate, removePoint,
  setFeet, setTeeAt, sideCount, sideEnds, sideNo, sketchFor, sketchProblems, sketchToWalk, skId, splitSide, toName,
  type SkGate, type SkLine, type SkPt, type Sketch, type SketchProblem,
} from './sketch'
import { feetText, fenceIn, totalIn, type WalkList } from './walkList'
import WalkListStep from './WalkListStep'
import { listenOnce } from './voiceClient'
import { readLength, words as voiceWords } from './voiceParser'
import { lookupPosition } from './appointmentsStore'
import { autoTile } from './aerialTiles'
import type { GateType } from './yardLayout'

const BIG = '!min-h-[56px] rounded-xl text-lg font-semibold px-3 border-2 active:scale-[0.99] disabled:opacity-50'
const DARK = `${BIG} bg-gray-900 border-gray-900 text-white`
const LIGHT = `${BIG} bg-white border-gray-900 text-gray-900`
const ORANGE = `${BIG} bg-orange-600 border-orange-700 text-white`
const RED = `${BIG} bg-white border-red-700 text-red-800`
const GATE_WIDTHS = [4, 5, 6, 8, 10, 12]
/** Touch areas, in drawing units (the drawing is about phone width, so about a pixel each). */
const HIT_POINT = 30, HIT_SIDE = 22, MOVE = 8

type Mode = 'draw' | 'feet' | 'gates'
type Sel =
  | { kind: 'side'; lineId: string; side: number; at: SkPt }
  | { kind: 'point'; lineId: string; i: number }
  | { kind: 'gate'; lineId: string; side: number; gateId: string | null }
  | null
/** What the feet box is asking for: a side's feet, or how far along its side a branch starts. */
type Target = { kind: 'side'; lineId: string; side: number } | { kind: 'tee'; lineId: string }

/** "48", "48.5", "48 6" (feet inches), "48'6\"" → inches; null when blank or not a length. */
export function inchesOf(t: string): number | null {
  const s = t.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'")
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i)
  if (!m) return null
  const inch = m[2] ? parseFloat(m[2]) : 0
  if (inch >= 12) return null
  return Math.round((parseFloat(m[1]) * 12 + inch) * 8) / 8
}
const feetBox = (inches: number | null | undefined) => (inches != null && inches > 0 ? String(Math.round((inches / 12) * 100) / 100) : '')
const sameTarget = (a: Target | null, b: Target | null) => !!a && !!b && a.kind === b.kind && a.lineId === b.lineId && (a.kind === 'tee' || a.side === (b as { side: number }).side)

/** Everything the feet box asks, in order: each line's branch feet (a branch), then its sides. */
function measureQueue(sk: Sketch): Target[] {
  const out: Target[] = []
  for (const l of orderedLines(sk)) {
    if (l.tee) out.push({ kind: 'tee', lineId: l.id })
    for (let k = 0; k < sideCount(l); k++) out.push({ kind: 'side', lineId: l.id, side: k })
  }
  return out
}
const targetDone = (sk: Sketch, t: Target) => {
  const l = sk.lines.find(x => x.id === t.lineId)
  if (!l) return true
  return t.kind === 'tee' ? l.tee?.atIn != null : (l.feetIn[t.side] ?? 0) > 0
}

export default function SketchStep({ walk, onChange, onDone, locked = false, voice = false, address = '', tape, focusProblem = 0 }: {
  walk: WalkList | null
  /** Changed by the Price step's "Not saved yet": go to the first thing to fix (a side's feet, a gate, a tee). */
  focusProblem?: number
  onChange: (w: WalkList) => void
  onDone: () => void
  locked?: boolean
  voice?: boolean
  address?: string
  tape?: Set<string>
}) {
  const sk = useMemo(() => sketchFor(walk), [walk])
  const [view, setView] = useState<'sketch' | 'list'>('sketch')
  const [mode, setMode] = useState<Mode>(() => (sk.lines.length ? 'feet' : 'draw'))
  const [sel, setSel] = useState<Sel>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [askClose, setAskClose] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [houseMode, setHouseMode] = useState(false)
  const [photoOn, setPhotoOn] = useState(false)
  const [photo, setPhoto] = useState<{ lat: number; lng: number } | null>(null)
  const [draft, setDraft] = useState<Sketch | null>(null)
  const [stroke, setStroke] = useState<SkPt[] | null>(null)
  const [houseBox, setHouseBox] = useState<{ a: SkPt; b: SkPt } | null>(null)
  const history = useRef<WalkList[]>([])
  const svgRef = useRef<SVGSVGElement | null>(null)
  const press = useRef<{ start: SkPt; moved: boolean; point: { lineId: string; i: number } | null; pts: SkPt[] } | null>(null)
  const shown = draft ?? sk
  const panelRef = useRef<HTMLDivElement | null>(null)
  const canvasWrap = useRef<HTMLDivElement | null>(null)
  // The feet box, a gate, a question: on screen above the price bar, with the drawing above it (review, Nov 6 2026).
  // Only the quote window's own scroll area moves (never the page: on a computer the window and its bar stay put).
  const opened = useRef(false)
  const fit = (alignOnly = false) => {
    const c = canvasWrap.current, p = panelRef.current
    if (!c) return
    let box: HTMLElement | null = c.parentElement
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
    if (!box) return
    const view = box.getBoundingClientRect()
    const head = c.closest('[data-sketch-step]')?.querySelector('[data-sketch-total]')?.getBoundingClientRect()
    const top = Math.max(view.top, head ? head.bottom : view.top) + 4
    const barTop = document.querySelector('[data-quote-bar]')?.getBoundingClientRect().top ?? window.innerHeight
    const bottom = Math.min(view.bottom, barTop) - 8
    const canvasTop = c.getBoundingClientRect().top
    if (alignOnly || !p) { box.scrollTop += canvasTop - top; return }
    if (mode === 'feet' && !sel && !askClose && target?.kind === 'side') {
      // Typing feet: the side asked about just under the total, the feet box as high as that leaves it.
      const n = sideNo(sk, target.lineId, target.side)
      const sideTop = svgRef.current?.querySelector(`[data-sketch-side="${n}"]`)?.getBoundingClientRect().top
      const over = p.getBoundingClientRect().bottom - bottom
      const toSide = sideTop != null ? sideTop - top - 16 : canvasTop - top
      box.scrollTop += Math.max(Math.min(over, toSide), canvasTop - top)
      return
    }
    // A gate, a question, a branch's feet: the drawing's top under the total, then the box above the bar (the box wins).
    const over = p.getBoundingClientRect().bottom - bottom
    box.scrollTop += Math.max(canvasTop - top, over)
  }
  useEffect(() => {
    // Not as the quote opens (the page stays where it was); only when the person moves on.
    if (!opened.current) { opened.current = true; return }
    if (mode === 'draw' && !sel && !askClose) return
    // Again once the feet box has taken the focus (a phone may scroll to it on its own).
    const t = setTimeout(() => fit(), 60), t2 = setTimeout(() => fit(), 380)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [mode, sel, target, askClose])  // eslint-disable-line react-hooks/exhaustive-deps
  // An empty sketch on a phone: the whole drawing area on screen the first time the step shows.
  useEffect(() => {
    const el = canvasWrap.current
    if (!el || sk.lines.length || typeof IntersectionObserver === 'undefined' || window.innerWidth >= 768) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { fit(true); io.disconnect() } }, { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [view])  // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: Sketch, keepSel = false) => {
    history.current.push(walk ?? { v: 1, lines: [] })
    if (history.current.length > 60) history.current.shift()
    onChange(sketchToWalk(next))
    if (!keepSel) setSel(null)
  }
  const undo = () => {
    const prev = history.current.pop()
    if (!prev) return
    onChange(prev); setSel(null); setAskClose(null); setMsg('')
  }

  const problems = useMemo(() => sketchProblems(sk), [sk])
  const queue = useMemo(() => measureQueue(sk), [sk])
  const names = useMemo(() => pointNames(sk), [sk])
  // The feet box starts on the first side with no feet.
  useEffect(() => {
    if (mode !== 'feet') return
    if (target && queue.some(t => sameTarget(t, target))) return
    setTarget(queue.find(t => !targetDone(sk, t)) ?? queue[0] ?? null)
  }, [mode, queue])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!photoOn || photo || !address.trim()) return
    let live = true
    lookupPosition(address.trim()).then(p => { if (live) { if (p) setPhoto({ lat: p.lat, lng: p.lng }); else { setMsg('The address was not found for the yard photo.'); setPhotoOn(false) } } })
    return () => { live = false }
  }, [photoOn, photo, address])

  // ── Pointer: draw, drag a corner, tap a side, corner or gate ──
  const toView = (e: { clientX: number; clientY: number }): SkPt => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  const hitPoint = (p: SkPt) => {
    let best: { lineId: string; i: number } | null = null, d = HIT_POINT
    for (const l of shown.lines) l.pts.forEach((q, i) => { const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < d) { d = dd; best = { lineId: l.id, i } } })
    return best as { lineId: string; i: number } | null
  }
  const gateMid = (l: SkLine, g: SkGate): SkPt | null => {
    const [a, b] = sideEnds(l, g.side)
    const L = l.feetIn[g.side]
    const at = gateAt(l, g)
    const t = L && at != null ? Math.min(1, (at + g.widthIn / 2) / L) : 0.5
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  const hitGate = (p: SkPt) => {
    for (const l of shown.lines) for (const g of l.gates) { const m = gateMid(l, g); if (m && Math.hypot(m.x - p.x, m.y - p.y) < HIT_SIDE) return { lineId: l.id, side: g.side, gateId: g.id } }
    return null
  }
  const hitSide = (p: SkPt) => {
    let best: { lineId: string; side: number } | null = null, d = HIT_SIDE
    for (const l of shown.lines) for (let k = 0; k < sideCount(l); k++) { const [a, b] = sideEnds(l, k); const r = nearestOn(p, a, b); if (r.dist < d) { d = r.dist; best = { lineId: l.id, side: k } } }
    return best as { lineId: string; side: number } | null
  }

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (locked) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toView(e)
    if (houseMode) { setHouseBox({ a: p, b: p }); press.current = { start: p, moved: false, point: null, pts: [p] }; return }
    press.current = { start: p, moved: false, point: mode === 'draw' ? hitPoint(p) : null, pts: [p] }
    setMsg('')
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const pr = press.current
    if (!pr) return
    const p = toView(e)
    if (!pr.moved && Math.hypot(p.x - pr.start.x, p.y - pr.start.y) < MOVE) return
    pr.moved = true
    if (houseMode) { setHouseBox({ a: pr.start, b: p }); return }
    if (mode !== 'draw') return
    if (pr.point) { setDraft(movePoint(sk, pr.point.lineId, pr.point.i, p)); return }
    pr.pts.push(p)
    setStroke(pr.pts.slice())
  }
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const pr = press.current
    press.current = null
    if (!pr) return
    const p = toView(e)
    if (houseMode) {
      setHouseMode(false); setHouseBox(null)
      const x = Math.min(pr.start.x, p.x), y = Math.min(pr.start.y, p.y), w = Math.abs(p.x - pr.start.x), h = Math.abs(p.y - pr.start.y)
      if (w > 20 && h > 20) commit({ ...sk, house: { x, y, w, h } })
      else setMsg('Drag a box for the house.')
      return
    }
    if (pr.moved && mode === 'draw') {
      if (pr.point && draft) { const d = draft; setDraft(null); commit(d); return }
      setStroke(null)
      const r = addStroke(sk, [...pr.pts, p])
      if (!r.lineId) { setMsg('Draw a longer line.'); return }
      commit(r.sketch)
      if (r.askClose) setAskClose(r.lineId)
      return
    }
    setDraft(null); setStroke(null)
    tap(pr.start)
  }
  const tap = (p: SkPt) => {
    const g = hitGate(p)
    if (g) { setSel({ kind: 'gate', ...g }); return }
    const pt = hitPoint(p)
    if (pt) {
      const l = sk.lines.find(x => x.id === pt.lineId)
      if (l?.tee && pt.i === 0 && mode !== 'draw') { setMode('feet'); setTarget({ kind: 'tee', lineId: l.id }); return }
      if (mode === 'draw') { setSel({ kind: 'point', ...pt }); return }
    }
    const s = hitSide(p)
    if (!s) { setSel(null); return }
    if (mode === 'feet') { setTarget({ kind: 'side', ...s }); setSel(null); return }
    if (mode === 'gates') { setSel({ kind: 'gate', ...s, gateId: null }); return }
    setSel({ kind: 'side', ...s, at: p })
  }

  // ── The picture on screen ──
  const hot = (lineId: string, side: number) =>
    (sel?.kind === 'side' && sel.lineId === lineId && sel.side === side) || (sel?.kind === 'gate' && sel.lineId === lineId && sel.side === side) ||
    (mode === 'feet' && target?.kind === 'side' && target.lineId === lineId && target.side === side)
  const tiles = useMemo(() => {
    if (!photoOn || !photo) return []
    const z = 19, n = 2 ** z
    const tx = ((photo.lng + 180) / 360) * n
    const r = (photo.lat * Math.PI) / 180
    const ty = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
    const out: Array<{ x: number; y: number; href: string }> = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const ix = Math.floor(tx) + dx, iy = Math.floor(ty) + dy
      out.push({ x: VIEW_W / 2 + (ix - tx) * 256, y: VIEW_H / 2 + (iy - ty) * 256, href: autoTile(z, ix, iy) })
    }
    return out
  }, [photoOn, photo])

  const sidesSvg: ReactElement[] = []
  const cx = VIEW_W / 2, cy = VIEW_H / 2
  for (const l of shown.lines) {
    for (let k = 0; k < sideCount(l); k++) {
      const [a, b] = sideEnds(l, k)
      const L = l.feetIn[k]
      const isHot = hot(l.id, k)
      const n = sideNo(shown, l.id, k)
      sidesSvg.push(<line key={`s${l.id}${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isHot ? '#ea580c' : L ? '#111827' : '#dc2626'} strokeWidth={isHot ? 9 : 6} strokeLinecap="round" strokeDasharray={L || isHot ? undefined : '10 6'} data-sketch-side={n} />)
      const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
      let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) { nx = -nx; ny = -ny }
      for (const g of l.gates.filter(x => x.side === k)) {
        const at = gateAt(l, g)
        const t0 = L && at != null ? at / L : 0.5 - (L ? g.widthIn / L / 2 : 0.07)
        const t1 = L && at != null ? (at + g.widthIn) / L : t0 + (L ? g.widthIn / L : 0.14)
        const p0 = { x: a.x + (b.x - a.x) * Math.max(0, t0), y: a.y + (b.y - a.y) * Math.max(0, t0) }
        const p1 = { x: a.x + (b.x - a.x) * Math.min(1, t1), y: a.y + (b.y - a.y) * Math.min(1, t1) }
        const isSel = sel?.kind === 'gate' && sel.gateId === g.id
        sidesSvg.push(<g key={`g${g.id}`} data-sketch-gate={g.id}>
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#fff" strokeWidth={12} />
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#ea580c" strokeWidth={isSel ? 7 : 5} strokeDasharray="5 4" />
          <rect x={p0.x - 5} y={p0.y - 5} width={10} height={10} fill="#ea580c" /><rect x={p1.x - 5} y={p1.y - 5} width={10} height={10} fill="#ea580c" />
        </g>)
      }
    }
    l.pts.forEach((q, i) => {
      const name = names.get(`${l.id}:${i}`) ?? ''
      const isSel = sel?.kind === 'point' && sel.lineId === l.id && sel.i === i
      const isTee = i === 0 && !!l.tee
      const teeHot = isTee && mode === 'feet' && target?.kind === 'tee' && target.lineId === l.id
      const short = name.startsWith('Corner ') ? name.slice(7) : name.startsWith('End post') ? 'E' : 'T'
      sidesSvg.push(<g key={`p${l.id}${i}`} data-sketch-point={name}>
        <circle cx={q.x} cy={q.y} r={isSel || teeHot ? 15 : 12} fill={isTee ? (l.tee!.atIn == null ? '#dc2626' : '#1d4ed8') : isSel ? '#ea580c' : '#111827'} stroke="#fff" strokeWidth={3} />
        <text x={q.x} y={q.y + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">{short}</text>
      </g>)
    })
  }

  // ── The bottom of the screen ──
  const lineOf = (id: string) => sk.lines.find(l => l.id === id)
  const totals = walk ? { all: totalIn(walk), fence: fenceIn(walk) } : { all: 0, fence: 0 }
  const firstProblem: SketchProblem | undefined = problems[0]
  const showProblem = (p: SketchProblem) => {
    if (p.tee) { setMode('feet'); setTarget({ kind: 'tee', lineId: p.tee }); return }
    if (p.gateId && p.lineId != null && p.side != null) { setSel({ kind: 'gate', lineId: p.lineId, side: p.side, gateId: p.gateId }); return }
    if (p.lineId && p.side != null) { setMode('feet'); setTarget({ kind: 'side', lineId: p.lineId, side: p.side }); return }
    setMode('draw')
  }

  useEffect(() => { if (focusProblem && firstProblem) { setView('sketch'); showProblem(firstProblem) } }, [focusProblem])  // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'list') {
    return (
      <div className="space-y-3" data-sketch-step data-sketch-view="list">
        <ViewToggle view={view} setView={setView} />
        <WalkListStep walk={walk} onChange={w => { history.current.push(walk ?? { v: 1, lines: [] }); onChange({ ...w, sketch: walk?.sketch ?? null }) }} onDone={onDone} locked={locked} voice={voice} address={address} tape={tape} />
      </div>
    )
  }

  return (
    <div className="space-y-3" data-sketch-step data-sketch-view="sketch">
      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-white border-b border-gray-200" data-sketch-total>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-extrabold text-gray-900">{feetText(totals.all)} walked</span>
          <ViewToggle view={view} setView={setView} />
        </div>
        <p className="text-sm font-semibold text-gray-700" data-sketch-total-words>{feetText(totals.fence)} of fence + {feetText(totals.all - totals.fence)} of gates</p>
      </div>

      {!locked && (
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Steps" data-sketch-modes>
          {([['draw', '1 Draw'], ['feet', '2 Feet'], ['gates', '3 Gates']] as const).map(([m, t]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? DARK : LIGHT} onClick={() => { setMode(m); setSel(null); setMsg(''); setHouseMode(false) }} data-sketch-mode={m}>{t}</button>
          ))}
        </div>
      )}

      <p className="text-base font-bold text-gray-900 min-h-[1.5rem]" data-sketch-prompt>
        {locked ? 'Signed: the fence is locked. Changes go on a change order.'
          : houseMode ? 'Drag a box where the house is.'
            : mode === 'draw' ? (sk.lines.length ? 'Draw another fence line, or start on a side for a branch. Drag a corner to reshape. Tap a corner or side to fix it.' : 'Draw the fence with your finger. One line, corner to corner.')
              : mode === 'feet' ? 'Type the feet for the orange side. Tap any side to type its feet.'
                : 'Tap a side to add a gate. Tap a gate to change it.'}
      </p>

      <div ref={canvasWrap} className="relative -mx-4 bg-gray-50 border-y-2 border-gray-200" style={{ touchAction: 'none' }}>
        <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto block select-none" style={{ maxHeight: mode === 'draw' || locked ? '52vh' : '34vh', touchAction: 'none' }}
          role="img" aria-label="Sketch, not to scale" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null; setStroke(null); setDraft(null); setHouseBox(null) }} data-sketch-canvas>
          <rect width={VIEW_W} height={VIEW_H} fill="#fff" />
          {tiles.map(t => <image key={t.href} href={t.href} x={t.x} y={t.y} width={256} height={256} opacity={0.45} preserveAspectRatio="none" />)}
          {shown.house && <g data-sketch-house><rect x={shown.house.x} y={shown.house.y} width={shown.house.w} height={shown.house.h} fill="#e5e7eb" fillOpacity={0.8} stroke="#6b7280" strokeWidth={2} /><text x={shown.house.x + shown.house.w / 2} y={shown.house.y + shown.house.h / 2 + 6} textAnchor="middle" fontSize="16" fill="#374151">House</text></g>}
          {houseBox && <rect x={Math.min(houseBox.a.x, houseBox.b.x)} y={Math.min(houseBox.a.y, houseBox.b.y)} width={Math.abs(houseBox.b.x - houseBox.a.x)} height={Math.abs(houseBox.b.y - houseBox.a.y)} fill="#e5e7eb" stroke="#6b7280" strokeDasharray="6 4" strokeWidth={2} />}
          {sidesSvg}
          {sketchLabels(shown, p => p, 17, VIEW_W, VIEW_H, { gateWord: g => `${feetText(g.widthIn)} gate`, missing: n => `Side ${n}?` }).map((t, i) => (
            <text key={`lb${i}`} x={t.x} y={t.y + t.size / 3} textAnchor="middle" fontSize={t.kind === 'feet' ? 17 : 14} fontWeight="800" fill={t.missing ? '#b91c1c' : t.kind === 'gate' ? '#c2410c' : t.kind === 'tee' ? '#1d4ed8' : '#111827'} paintOrder="stroke" stroke="#fff" strokeWidth="5"
              {...(t.kind === 'feet' ? { 'data-sketch-feet': t.side } : t.kind === 'tee' ? { 'data-sketch-tee-feet': '' } : {})}>{t.text}</text>
          ))}
          {stroke && <polyline points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />}
          {!sk.lines.length && !stroke && <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" fontSize="20" fill="#9ca3af">Draw the fence here</text>}
        </svg>
      </div>
      <p className="text-xs text-gray-600 -mt-1">Sketch, not to scale. The feet you type set the price.</p>

      {!locked && <div ref={panelRef} className="space-y-3 pb-2" data-sketch-panel>
        {msg && <p className="text-base font-semibold text-red-800 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2" role="alert" data-sketch-msg>{msg}</p>}

        {askClose && lineOf(askClose) && (
          <div className="rounded-xl border-2 border-orange-400 bg-orange-50 p-3 space-y-2" data-sketch-ask-close>
            <p className="text-lg font-bold text-gray-900">Does the fence close back to the start?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={DARK} onClick={() => { commit(closeLine(sk, askClose)); setAskClose(null) }} data-sketch-close="yes">Yes, it closes</button>
              <button type="button" className={LIGHT} onClick={() => setAskClose(null)} data-sketch-close="no">No, two end posts</button>
            </div>
          </div>
        )}

        {sel?.kind === 'gate' && lineOf(sel.lineId) && (
          <GateSheet key={`${sel.lineId}${sel.side}${sel.gateId}`} sk={sk} line={lineOf(sel.lineId)!} side={sel.side} gateId={sel.gateId}
            onSave={g => { commit(putGate(sk, sel.lineId, g)); setMsg('') }}
            onRemove={id => commit(removeGate(sk, sel.lineId, id))}
            onClose={() => setSel(null)} />
        )}

        {sel?.kind === 'side' && lineOf(sel.lineId) && (() => {
          const l = lineOf(sel.lineId)!, n = sideNo(sk, l.id, sel.side), L = l.feetIn[sel.side]
          return (
            <div className="rounded-xl border-2 border-gray-900 p-3 space-y-2" data-sketch-side-sheet={n}>
              <p className="text-lg font-bold text-gray-900">Side {n}{L ? `: ${feetText(L)}` : ', no feet yet'}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={DARK} onClick={() => { setMode('feet'); setTarget({ kind: 'side', lineId: l.id, side: sel.side }); setSel(null) }} data-sketch-side-feet>Type the feet</button>
                <button type="button" className={DARK} onClick={() => setSel({ kind: 'gate', lineId: l.id, side: sel.side, gateId: null })} data-sketch-side-gate>Add gate</button>
                <button type="button" className={LIGHT} onClick={() => { commit(splitSide(sk, l.id, sel.side, sel.at)); setMsg(`Corner added. Type the feet for both parts of Side ${n}.`) }} data-sketch-side-split>Add a corner here</button>
                <button type="button" className={RED} onClick={() => { if (window.confirm('Delete this whole fence line?')) commit(deleteLine(sk, l.id)) }} data-sketch-line-delete>Delete this fence line</button>
              </div>
              <button type="button" className={`${LIGHT} w-full`} onClick={() => setSel(null)}>Close</button>
            </div>
          )
        })()}

        {sel?.kind === 'point' && lineOf(sel.lineId) && (() => {
          const l = lineOf(sel.lineId)!, name = names.get(`${l.id}:${sel.i}`) ?? 'Corner'
          const isEnd = !l.closed && (sel.i === 0 || sel.i === l.pts.length - 1)
          const isTee = sel.i === 0 && !!l.tee
          return (
            <div className="rounded-xl border-2 border-gray-900 p-3 space-y-2" data-sketch-point-sheet>
              <p className="text-lg font-bold text-gray-900">{isTee ? 'The tee (where the branch starts)' : name}</p>
              <p className="text-sm text-gray-700">Drag it to change the shape. The shape never changes the price.</p>
              {isTee
                ? <button type="button" className={`${DARK} w-full`} onClick={() => { setMode('feet'); setTarget({ kind: 'tee', lineId: l.id }); setSel(null) }} data-sketch-tee-feet>Type how far along the side it is</button>
                : <button type="button" className={`${RED} w-full`} disabled={l.closed && l.pts.length <= 3} onClick={() => commit(removePoint(sk, l.id, sel.i))} data-sketch-point-remove>{isEnd ? (sideCount(l) <= 1 ? 'Remove this fence line' : 'Remove this end and its side') : 'Remove this corner'}</button>}
              {l.closed && l.pts.length <= 3 && !isTee && <p className="text-sm text-gray-700">A fence that closes needs three corners.</p>}
              <button type="button" className={`${LIGHT} w-full`} onClick={() => setSel(null)}>Close</button>
            </div>
          )
        })()}

        {mode === 'feet' && !sel && target && (
          <FeetBox key={`${target.kind}${target.lineId}${target.kind === 'side' ? target.side : ''}`} sk={sk} target={target} voice={voice}
            onSave={(inches, next) => {
              const s2 = target.kind === 'side' ? setFeet(sk, target.lineId, target.side, inches) : setTeeAt(sk, target.lineId, inches)
              commit(s2)
              if (!next) return
              const q = measureQueue(s2)
              const at = q.findIndex(t => sameTarget(t, target))
              const after = [...q.slice(at + 1), ...q.slice(0, at + 1)].find(t => !targetDone(s2, t))
              if (after) setTarget(after)
              else { setTarget(q[at + 1] ?? null); if (!q[at + 1]) setMode('gates') }
            }} />
        )}
        {mode === 'feet' && !target && sk.lines.length > 0 && <p className="text-base text-gray-800">Every side has its feet. Tap a side to change its feet.</p>}

        {mode === 'draw' && !sel && !askClose && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={houseMode ? DARK : LIGHT} onClick={() => setHouseMode(v => !v)} aria-pressed={houseMode} data-sketch-house-add>{shown.house ? 'Move the house' : 'Add house'}</button>
            <button type="button" className={photoOn ? DARK : LIGHT} disabled={!address.trim()} onClick={() => setPhotoOn(v => !v)} aria-pressed={photoOn} data-sketch-photo>{photoOn ? 'Hide the yard photo' : 'Show the yard photo'}</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={LIGHT} onClick={undo} disabled={!history.current.length} data-sketch-undo>Undo</button>
          <button type="button" className={ORANGE} disabled={problems.length > 0} onClick={onDone} data-sketch-done>Done, show me prices</button>
        </div>
        {firstProblem && sk.lines.length > 0 && (
          <button type="button" className="w-full text-left text-base font-semibold text-red-800 bg-red-50 border-2 border-red-200 rounded-xl px-3 !min-h-[56px]" onClick={() => showProblem(firstProblem)} data-sketch-problem>
            {firstProblem.text}{problems.length > 1 ? ` (${problems.length - 1} more)` : ''}
          </button>
        )}
      </div>}
      {/* Room under the box so the window can scroll it up above the price bar, the drawing still in view. */}
      {!locked && (mode !== 'draw' || sel || askClose) && <div aria-hidden="true" style={{ height: '40vh' }} data-sketch-room />}
    </div>
  )
}

function ViewToggle({ view, setView }: { view: 'sketch' | 'list'; setView: (v: 'sketch' | 'list') => void }) {
  return (
    <div className="inline-flex rounded-xl border-2 border-gray-900 overflow-hidden shrink-0" role="group" aria-label="Sketch or list" data-sketch-toggle>
      {(['sketch', 'list'] as const).map(v => (
        <button key={v} type="button" aria-pressed={view === v} className={`min-h-[48px] px-4 text-base font-semibold ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`} onClick={() => setView(v)} data-sketch-toggle-to={v}>
          {v === 'sketch' ? 'Sketch' : 'List'}
        </button>
      ))}
    </div>
  )
}

/** The feet box: "Side 3: how many feet?" (feet, optional inches, voice), or how far along its side a branch starts. */
function FeetBox({ sk, target, voice, onSave }: { sk: Sketch; target: Target; voice: boolean; onSave: (inches: number, next: boolean) => void }) {
  const l = sk.lines.find(x => x.id === target.lineId)!
  const current = target.kind === 'side' ? l.feetIn[target.side] : l.tee?.atIn ?? null
  const [ft, setFt] = useState(() => (current != null && current > 0 ? String(Math.floor(current / 12)) : ''))
  const [inch, setInch] = useState(() => (current != null && current % 12 ? String(Math.round((current % 12) * 8) / 8) : ''))
  const [err, setErr] = useState('')
  const [listening, setListening] = useState(false)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => { setTimeout(() => ref.current?.focus({ preventScroll: true }), 50) }, [])
  const n = target.kind === 'side' ? sideNo(sk, l.id, target.side) : 0
  const gates = target.kind === 'side' ? l.gates.filter(g => g.side === target.side) : []
  const question = target.kind === 'side'
    ? `Side ${n}: how many feet?`
    : `How far from ${fromName(sk, l.tee!.lineId, l.tee!.side)} is the branch? (along Side ${sideNo(sk, l.tee!.lineId, l.tee!.side)})`
  const save = (next: boolean) => {
    const f = ft.trim() === '' ? NaN : parseFloat(ft), i = inch.trim() === '' ? 0 : parseFloat(inch)
    if (!(f >= 0) || !(i >= 0) || i >= 12) { setErr(inch && !(i < 12) ? 'Inches go from 0 to 11.' : 'Type the feet.'); ref.current?.focus(); return }
    const inches = Math.round((f * 12 + i) * 8) / 8
    if (target.kind === 'side' && !(inches > 0)) { setErr('Type the feet. A side needs more than 0 feet.'); return }
    onSave(inches, next)
  }
  async function hear() {
    if (listening) return
    setListening(true); setErr('')
    const r = await listenOnce(8000).result
    setListening(false)
    if ('error' in r) { setErr('Voice did not hear it. Type the feet instead.'); return }
    const w = voiceWords(r.text)
    for (let k = 0; k < w.length; k++) { const got = readLength(w, k); if (got) { setFt(String(Math.floor(got.inches / 12))); setInch(got.inches % 12 ? String(Math.round((got.inches % 12) * 8) / 8) : ''); return } }
    setErr(`Heard "${r.text}" but no feet in it. Type the feet instead.`)
  }
  return (
    <div className="rounded-xl border-2 border-orange-500 bg-orange-50 p-3 space-y-2" data-sketch-feet-box={target.kind === 'side' ? n : 'tee'}>
      <p className="text-lg font-bold text-gray-900" data-sketch-question>{question}</p>
      {target.kind === 'side' && <p className="text-sm text-gray-700">Corner to corner ({fromName(sk, l.id, target.side)} to {toName(sk, l.id, target.side)}), gates included.{gates.length ? ` The ${gates.map(g => feetText(g.widthIn)).join(' and ')} gate${gates.length > 1 ? 's come' : ' comes'} out of the fence feet.` : ''}</p>}
      <div className="flex gap-2">
        <label className="flex-[3]"><span className="sr-only">Feet</span>
          <input ref={ref} inputMode="decimal" enterKeyHint="next" className="w-full min-h-[64px] rounded-xl border-2 border-gray-900 px-3 text-3xl font-bold text-gray-900 bg-white" placeholder="Feet"
            value={ft} onChange={e => { setFt(e.target.value.replace(/[^\d.]/g, '')); setErr('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(true) } }} data-sketch-feet-input />
        </label>
        <label className="flex-[2]"><span className="sr-only">Inches</span>
          <input inputMode="decimal" enterKeyHint="next" className="w-full min-h-[64px] rounded-xl border-2 border-gray-400 px-3 text-2xl font-bold text-gray-900 bg-white" placeholder="in"
            value={inch} onChange={e => { setInch(e.target.value.replace(/[^\d.]/g, '')); setErr('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(true) } }} data-sketch-inches-input />
        </label>
        {voice && <button type="button" className={`${LIGHT} w-20`} onClick={() => void hear()} aria-label="Say the feet" data-sketch-voice>{listening ? '…' : 'Say'}</button>}
        <button type="button" className={`${DARK} px-4`} onClick={() => save(true)} data-sketch-feet-next>Next</button>
      </div>
      {err && <p className="text-base font-semibold text-red-800" role="alert">{err}</p>}
    </div>
  )
}

/** Add or change a gate: width, single or double, feet from the side's first corner (blank: the middle). */
function GateSheet({ sk, line, side, gateId, onSave, onRemove, onClose }: {
  sk: Sketch; line: SkLine; side: number; gateId: string | null
  onSave: (g: SkGate) => void; onRemove: (id: string) => void; onClose: () => void
}) {
  const g0 = gateId ? line.gates.find(g => g.id === gateId) ?? null : null
  const [w, setW] = useState<number | null>(g0 && GATE_WIDTHS.includes(g0.widthIn / 12) ? g0.widthIn : g0 ? null : 48)
  const [other, setOther] = useState(g0 && !GATE_WIDTHS.includes(g0.widthIn / 12) ? feetBox(g0.widthIn) : '')
  const [otherOn, setOtherOn] = useState(!!other)
  const [type, setType] = useState<GateType>(g0?.type ?? 'walk')
  const [at, setAt] = useState(g0?.atIn != null ? feetBox(g0.atIn) || '0' : '')
  const [err, setErr] = useState('')
  const n = sideNo(sk, line.id, side)
  const L = line.feetIn[side]
  const from = fromName(sk, line.id, side), to = toName(sk, line.id, side)
  const widthIn = w ?? inchesOf(other)
  const save = () => {
    if (!(widthIn && widthIn > 0)) { setErr('Pick the gate width.'); return }
    const atIn = at.trim() === '' ? null : inchesOf(at)
    if (at.trim() !== '' && atIn == null) { setErr(`Type the feet from ${from} to the gate, or leave it blank for the middle.`); return }
    if (atIn != null && L && atIn + widthIn > L + 0.01) { setErr(`The gate runs past ${to}: Side ${n} is ${feetText(L)}. Type fewer feet, or check the side's feet.`); return }
    onSave({ id: g0?.id ?? skId('g'), side, atIn, widthIn, type })
  }
  const middle = L && widthIn ? Math.max(0, Math.round(((L - widthIn) / 2) * 8) / 8) : null
  return (
    <div className="rounded-xl border-2 border-orange-500 bg-orange-50 p-3 space-y-3" data-sketch-gate-sheet={n}>
      <p className="text-lg font-bold text-gray-900">{g0 ? 'Change the gate' : 'Add gate'} on Side {n}{L ? ` (${feetText(L)})` : ''}</p>
      <p className="text-sm text-gray-700 -mt-2">The side from {from} to {to}, orange on the sketch above.</p>
      <div className="grid grid-cols-4 gap-2" data-sketch-gate-widths>
        {GATE_WIDTHS.map(x => <button key={x} type="button" className={w === x * 12 ? ORANGE : LIGHT} onClick={() => { setW(x * 12); setOther(''); setOtherOn(false); setErr('') }} data-sketch-gate-width={x}>{x} ft</button>)}
        <button type="button" className={`${otherOn ? ORANGE : LIGHT} col-span-2`} onClick={() => { setOtherOn(true); setW(null); setErr('') }} data-sketch-gate-other-on>Other</button>
      </div>
      {otherOn && <input inputMode="decimal" autoFocus className="w-full !min-h-[56px] rounded-xl border-2 border-gray-900 px-4 text-xl bg-white" placeholder="Width, feet" value={other} onChange={e => { setOther(e.target.value); setW(null); setErr('') }} data-sketch-gate-other />}
      <div className="grid grid-cols-2 gap-2">
        {(['walk', 'double'] as GateType[]).map(t => <button key={t} type="button" className={type === t ? DARK : LIGHT} aria-pressed={type === t} onClick={() => setType(t)} data-sketch-gate-kind={t}>{t === 'walk' ? 'Single' : 'Double'}</button>)}
      </div>
      <label className="block text-base font-semibold text-gray-800">Feet from {from} to the gate
        <input inputMode="decimal" className="mt-1 w-full !min-h-[56px] rounded-xl border-2 border-gray-900 px-4 text-xl bg-white" placeholder={middle != null ? `Middle (${feetText(middle)})` : 'Middle of the side'} value={at} onChange={e => { setAt(e.target.value); setErr('') }} data-sketch-gate-at />
      </label>
      {L && widthIn ? (() => {
        const a = at.trim() === '' ? middle ?? 0 : inchesOf(at) ?? 0
        const after = L - a - widthIn
        return after >= 0 ? <p className="text-sm text-gray-800" data-sketch-gate-split>{feetText(a)} of fence, the {feetText(widthIn)} gate, then {feetText(after)} of fence to {to}.</p> : null
      })() : <p className="text-sm text-gray-700">Type Side {n}'s feet to place the gate exactly; until then it sits in the middle.</p>}
      {err && <p className="text-base font-semibold text-red-800" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={LIGHT} onClick={onClose}>Cancel</button>
        <button type="button" className={ORANGE} onClick={save} data-sketch-gate-save>Save gate</button>
      </div>
      {g0 && <button type="button" className={`${RED} w-full`} onClick={() => onRemove(g0.id)} data-sketch-gate-remove>Remove this gate</button>}
    </div>
  )
}
