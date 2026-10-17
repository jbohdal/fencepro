/**
 * The site plan, drawn as SVG from a yard layout: fence in brand purple with
 * footage and sections on every side, corner posts as squares, end and gate
 * posts as filled dots, line posts as open dots at the real section spacing,
 * gate swings as dashed arcs, skips as gray dashed lines, the house as a gray
 * box and the street marked. Optionally on top of an aerial photo, where the
 * corners can be dragged onto the yard. On the plain drawing the corner posts
 * can be dragged for odd yards; the labels keep the typed lengths.
 */

import { useMemo, useRef, useState } from 'react'
import { buildPlan, planVertices, type Plan } from './sitePlanGeometry'
import type { LayoutResult, PlanPoint, YardLayout } from './yardLayout'

const PURPLE = '#5E28A1'
const GRAY = '#746C80'
const LIGHT = '#CBC4D6'
const INK = '#1C1030'

export interface AerialBackdrop {
  href: string
  /** Feet per pixel of the photo, and its size in pixels (square). */
  ftPerPx: number
  sizePx: number
}

/** A photo pin on the plan: where it was taken and which way it faced (degrees, 0 = up the page). */
export interface PlanPin { id: string; x: number; y: number; angle?: number | null; count?: number; highlight?: boolean }

export default function SitePlan({ layout, result, runSections, widthFt = 8, onSideTap, aerial, onPointsChange, title, pins, onPinTap, onPlanTap }: {
  layout: YardLayout
  result?: LayoutResult
  runSections?: number[]
  widthFt?: number
  onSideTap?: (sideId: string) => void
  /** Drawn to the photo's real scale, centered on it; corners can be dragged. */
  aerial?: AerialBackdrop | null
  onPointsChange?: (points: PlanPoint[]) => void
  title?: string
  pins?: PlanPin[]
  onPinTap?: (id: string) => void
  /** Tapping the plan (not a side) gives the spot in plan feet: "where were you standing?" */
  onPlanTap?: (pt: PlanPoint) => void
}) {
  const plan = useMemo(() => buildPlan(layout, result, runSections, widthFt), [layout, result, runSections, widthFt])
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ index: number | 'all'; start: PlanPoint; points: PlanPoint[]; moved: boolean } | null>(null)
  // While a corner is dragged the drawing keeps its scale, so the corner stays under the finger.
  const [heldBounds, setHeldBounds] = useState<Plan['bounds'] | null>(null)

  // Feet → screen.
  const pad = 64
  let W: number, H: number, toX: (x: number) => number, toY: (y: number) => number, ftPerPx: number
  let fromX: (sx: number) => number, fromY: (sy: number) => number
  if (aerial) {
    W = H = aerial.sizePx
    ftPerPx = aerial.ftPerPx
    toX = x => W / 2 + x / ftPerPx
    toY = y => H / 2 - y / ftPerPx
    fromX = sx => (sx - W / 2) * ftPerPx
    fromY = sy => (H / 2 - sy) * ftPerPx
  } else {
    const b = heldBounds ?? plan.bounds
    const bw = Math.max(b.maxX - b.minX, 10), bh = Math.max(b.maxY - b.minY, 10)
    W = 640
    // Room at the sides for the labels beside the side runs ("Left side · 15 sec").
    const padX = 120
    const s = Math.min((W - 2 * padX) / bw, 420 / bh)
    H = Math.max(240, bh * s + 2 * pad + (plan.street ? 28 : 0))
    ftPerPx = 1 / s
    const offX = (W - bw * s) / 2, offY = pad
    toX = x => offX + (x - b.minX) * s
    toY = y => offY + (b.maxY - y) * s
    fromX = sx => (sx - offX) / s + b.minX
    fromY = sy => b.maxY - (sy - offY) / s
  }
  const P = (p: PlanPoint) => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`

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
  function startDrag(e: React.PointerEvent, index: number | 'all') {
    if (!onPointsChange) return
    e.stopPropagation()
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* a pointer the browser no longer tracks */ }
    if (!aerial) setHeldBounds(plan.bounds)
    drag.current = { index, start: svgPoint(e), points: planVertices(layout).map(p => ({ ...p })), moved: false }
  }
  function moveDrag(e: React.PointerEvent) {
    const d = drag.current
    if (!d || !onPointsChange) return
    const now = svgPoint(e)
    const dx = now.x - d.start.x, dy = now.y - d.start.y
    // A tap on a corner is not a drag.
    if (!d.moved && Math.hypot(dx, dy) / ftPerPx < 4) return
    d.moved = true
    onPointsChange(d.points.map((p, i) => (d.index === 'all' || d.index === i ? { x: p.x + dx, y: p.y + dy } : p)))
  }
  const endDrag = () => {
    // Swallow the click that follows a drag so it is not a tap on a side.
    if (drag.current?.moved) setTimeout(() => { drag.current = null }, 0)
    else drag.current = null
    setHeldBounds(null)
  }

  const center = plan.vertices.reduce((t, p) => ({ x: t.x + p.x / plan.vertices.length, y: t.y + p.y / plan.vertices.length }), { x: 0, y: 0 })

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none touch-none bg-white rounded-xl border border-gray-200"
      role="img" aria-label={title ?? 'Site plan'} data-site-plan onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      onClick={onPlanTap ? planTap : undefined} style={onPlanTap ? { cursor: 'crosshair' } : undefined}>
      {aerial && <image href={aerial.href} x={0} y={0} width={W} height={H} preserveAspectRatio="none" opacity={0.9} />}

      {plan.house && !aerial && (
        <g>
          <polygon points={plan.house.map(P).join(' ')} fill={LIGHT} stroke={GRAY} strokeWidth={1.5} opacity={aerial ? 0.75 : 1} />
          <text x={plan.house.reduce((t, p) => t + toX(p.x), 0) / plan.house.length} y={plan.house.reduce((t, p) => t + toY(p.y), 0) / plan.house.length + (plan.houseNotToScale ? -2 : 5)}
            textAnchor="middle" fontSize={14} fontWeight={600} fill={INK}>House</text>
          {plan.houseNotToScale && (
            <text x={plan.house.reduce((t, p) => t + toX(p.x), 0) / plan.house.length} y={plan.house.reduce((t, p) => t + toY(p.y), 0) / plan.house.length + 13}
              textAnchor="middle" fontSize={11} fill={GRAY} data-house-not-to-scale>house not to scale</text>
          )}
        </g>
      )}

      {plan.sides.map(sd => (
        <g key={sd.sideId}>
          {sd.placeholder && <line x1={toX(sd.a.x)} y1={toY(sd.a.y)} x2={toX(sd.b.x)} y2={toY(sd.b.y)} stroke={LIGHT} strokeWidth={3} strokeDasharray="8 6" />}
          {sd.fence.map((f, k) => <line key={k} x1={toX(f.a.x)} y1={toY(f.a.y)} x2={toX(f.b.x)} y2={toY(f.b.y)} stroke={PURPLE} strokeWidth={4} strokeLinecap="round" />)}
          {sd.skip && (
            <g>
              <line x1={toX(sd.skip.a.x)} y1={toY(sd.skip.a.y)} x2={toX(sd.skip.b.x)} y2={toY(sd.skip.b.y)} stroke={GRAY} strokeWidth={3} strokeDasharray="7 6" />
              <text x={(toX(sd.skip.a.x) + toX(sd.skip.b.x)) / 2 - sd.out.x * 0 } y={(toY(sd.skip.a.y) + toY(sd.skip.b.y)) / 2 + sd.out.y * 18 + (sd.out.y === 0 ? 0 : 4)}
                textAnchor="middle" fontSize={11} fill={GRAY} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>
                {sd.skip.kind === 'existing' ? 'existing fence, not included' : 'no fence here'}
              </text>
            </g>
          )}
          {sd.gate && <GateSwing gate={sd.gate} toX={toX} toY={toY} />}
          {/* Label outside the yard: footage, then name and sections. */}
          {(() => {
            const mx = (toX(sd.a.x) + toX(sd.b.x)) / 2, my = (toY(sd.a.y) + toY(sd.b.y)) / 2
            // Beside a side that runs up and down, above or below one that runs across.
            const sideways = Math.abs(sd.out.x) > Math.abs(sd.out.y)
            const anchor = sideways ? (sd.out.x < 0 ? 'end' : 'start') : 'middle'
            const lx = mx + (sideways ? Math.sign(sd.out.x) * 12 : 0)
            const ly = sideways ? my - 2 : my + (sd.out.y > 0 ? -22 : 22)
            return (
              <g>
                <text x={lx} y={ly} textAnchor={anchor} fontSize={14} fontWeight={700} fill={sd.placeholder ? GRAY : INK}
                  style={{ paintOrder: 'stroke', ...(onSideTap ? { cursor: 'pointer' } : {}) }} stroke="white" strokeWidth={4}
                  onClick={onSideTap ? e => { e.stopPropagation(); onSideTap(sd.sideId) } : undefined}>{sd.label}</text>
                {onSideTap && (
                  <rect x={anchor === 'end' ? lx - 130 : anchor === 'middle' ? lx - 65 : lx - 4} y={ly - 22} width={134} height={48} fill="transparent"
                    style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onSideTap(sd.sideId) }} data-plan-label={sd.name} />
                )}
                {sd.sublabel && <text x={lx} y={ly + 15} textAnchor={anchor} fontSize={11} fill={GRAY} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>{sd.sublabel}</text>}
              </g>
            )
          })()}
          {onSideTap && (
            <line x1={toX(sd.a.x)} y1={toY(sd.a.y)} x2={toX(sd.b.x)} y2={toY(sd.b.y)} stroke="transparent" strokeWidth={30}
              style={{ cursor: 'pointer' }} onClick={() => onSideTap(sd.sideId)} data-plan-side={sd.name} />
          )}
        </g>
      ))}

      {plan.posts.map((p, i) => {
        const x = toX(p.x), y = toY(p.y)
        if (p.kind === 'corner') return <rect key={i} x={x - 6} y={y - 6} width={12} height={12} fill={PURPLE} stroke="white" strokeWidth={1.5} />
        if (p.kind === 'line') return <circle key={i} cx={x} cy={y} r={3.2} fill="white" stroke={PURPLE} strokeWidth={1.8} />
        return <circle key={i} cx={x} cy={y} r={5.5} fill={p.kind === 'gate' ? INK : PURPLE} stroke="white" strokeWidth={1.5} />
      })}

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

      {aerial && (
        <g aria-label="North">
          <path d={`M${W - 28},${44} l8,-22 l8,22 l-8,-6 z`} fill={INK} stroke="white" strokeWidth={1.5} />
          <text x={W - 20} y={60} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>N</text>
        </g>
      )}

      {aerial && onPointsChange && (
        <g>
          {plan.vertices.map((p, i) => (
            <circle key={i} cx={toX(p.x)} cy={toY(p.y)} r={13} fill="white" fillOpacity={0.55} stroke={PURPLE} strokeWidth={2.5}
              style={{ cursor: 'grab' }} onPointerDown={e => startDrag(e, i)} data-plan-corner={i} />
          ))}
          <g onPointerDown={e => startDrag(e, 'all')} style={{ cursor: 'move' }} data-plan-move>
            <circle cx={toX(center.x)} cy={toY(center.y)} r={16} fill={PURPLE} fillOpacity={0.85} />
            <path d={`M${toX(center.x) - 8},${toY(center.y)} h16 M${toX(center.x)},${toY(center.y) - 8} v16`} stroke="white" strokeWidth={2.5} />
          </g>
        </g>
      )}

      {!aerial && onPointsChange && plan.corners.map(i => plan.vertices[i] && (
        <circle key={`drag-${i}`} cx={toX(plan.vertices[i].x)} cy={toY(plan.vertices[i].y)} r={14} fill="transparent" stroke={PURPLE} strokeOpacity={0.35} strokeWidth={1.5}
          strokeDasharray="3 3" style={{ cursor: 'grab' }} onPointerDown={e => startDrag(e, i)} onClick={e => e.stopPropagation()} data-plan-corner={i} />
      ))}

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

function GateSwing({ gate, toX, toY }: { gate: NonNullable<ReturnType<typeof buildPlan>['sides'][number]['gate']>; toX: (x: number) => number; toY: (y: number) => number }) {
  const ax = toX(gate.a.x), ay = toY(gate.a.y), bx = toX(gate.b.x), by = toY(gate.b.y)
  const len = Math.hypot(bx - ax, by - ay)
  const d = { x: (bx - ax) / (len || 1), y: (by - ay) / (len || 1) }
  const o = { x: gate.swing.x, y: -gate.swing.y } // into the yard, on screen
  // Drawn at least big enough to read; the label says the real width.
  const r = Math.max(len, gate.type === 'double' ? 36 : 22)
  const leaf = (hx: number, hy: number, dir: { x: number; y: number }, r: number) => {
    const ex = hx + dir.x * r, ey = hy + dir.y * r
    const ox = hx + o.x * r, oy = hy + o.y * r
    const sweep = dir.x * o.y - dir.y * o.x > 0 ? 1 : 0
    return (
      <g>
        <line x1={hx} y1={hy} x2={ox} y2={oy} stroke={INK} strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={`M${ex},${ey} A${r},${r} 0 0 ${sweep} ${ox},${oy}`} fill="none" stroke={INK} strokeWidth={1.5} strokeDasharray="5 4" />
      </g>
    )
  }
  const mx = (ax + bx) / 2, my = (ay + by) / 2
  const label = (
    <text x={mx + o.x * (r * (gate.type === 'double' ? 0.5 : 1) + 12)} y={my + o.y * (r * (gate.type === 'double' ? 0.5 : 1) + 12) + 4} textAnchor="middle"
      fontSize={11} fontWeight={600} fill={INK} style={{ paintOrder: 'stroke' }} stroke="white" strokeWidth={3}>{gate.label}</text>
  )
  return gate.type === 'double'
    ? <g data-plan-gate="double">{leaf(ax, ay, d, r / 2)}{leaf(bx, by, { x: -d.x, y: -d.y }, r / 2)}{label}</g>
    : <g data-plan-gate="walk">{leaf(ax, ay, d, r)}{label}</g>
}
