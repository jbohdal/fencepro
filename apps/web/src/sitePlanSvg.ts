/**
 * The office site plan as a picture (SVG text), north up, at true scale: every
 * side with its feet, the posts (numbered in walking order for the crew), the
 * gates with their width and swing, the house, the job's property line (bold)
 * and the neighbors' (thin), the "Start here" post, a scale bar and a north
 * arrow. Pure: the crew's install packet, the customer's portal and the permit
 * sheet PDF (server lib/sitePlanSheet.ts) all draw a plan through here.
 *
 * Only plain shapes and horizontal text (no transform, no clip, no font
 * files), so the server's small SVG to PDF drawer (permits.ts drawSvg) draws
 * exactly what a browser shows.
 */

import { toFeet, postOf, builtFt, type SitePlanData, type SiteSide, type SiteGate, type LatLng, type CrewPost } from './sitePlanData'

export const SITE_COLORS = { FENCE: '#5E28A1', GATE: '#1C1030', HOUSE_FILL: '#E5E7EB', HOUSE_LINE: '#6B7280', LOT: '#111827', NEIGHBOR: '#9CA3AF', LABEL: '#1C1030', START: '#15803D', MUTED: '#6B7280' }

export interface PlanFrame {
  W: number
  H: number
  /** Drawing units (pixels or points) per foot. */
  scale: number
  /** A place on the map → its spot in the drawing. */
  at: (p: LatLng) => { x: number; y: number }
  /** Feet east/north of the plan's origin → the drawing. */
  ft: (p: { x: number; y: number }) => { x: number; y: number }
}

export interface FrameOpts {
  /** Room kept clear at each edge (drawing units). */
  pad?: number
  /** A fixed scale (drawing units per foot), e.g. a permit sheet's 1 in = 20 ft; otherwise the plan fills the frame. */
  scale?: number
  /** Room at the bottom for the scale bar and legend (drawing units). */
  bottom?: number
  /** 'fence': only the fence and the house decide the frame (the crew's sheet); the property lines are cut at its edge. */
  fit?: 'all' | 'fence'
}

/** Feet east/north of the plan's origin that the drawing must show: the fence, the house, and the lot when it is not much bigger. */
export function planExtent(plan: SitePlanData, fit: 'all' | 'fence' = 'all'): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = (list: LatLng[]) => list.map(p => toFeet(plan.origin, p))
  const core = [...pts(plan.posts), ...plan.house.flatMap(pts)]
  if (!core.length) core.push({ x: 0, y: 0 })
  const box = (ps: Array<{ x: number; y: number }>) => ({ minX: Math.min(...ps.map(p => p.x)), maxX: Math.max(...ps.map(p => p.x)), minY: Math.min(...ps.map(p => p.y)), maxY: Math.max(...ps.map(p => p.y)) })
  let b = box(core)
  const lot = plan.parcel?.rings[0]
  if (fit === 'fence') { const m = Math.max(6, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04); b = { minX: b.minX - m, maxX: b.maxX + m, minY: b.minY - m, maxY: b.maxY + m } }
  else if (lot && lot.length >= 3) {
    const l = box(pts(lot))
    const coreSpan = Math.max(b.maxX - b.minX, b.maxY - b.minY, 40)
    const lotSpan = Math.max(l.maxX - l.minX, l.maxY - l.minY)
    // A lot up to about three times the fence shows whole; a big farm lot would shrink the fence to nothing.
    if (lotSpan <= coreSpan * 3) b = { minX: Math.min(b.minX, l.minX), maxX: Math.max(b.maxX, l.maxX), minY: Math.min(b.minY, l.minY), maxY: Math.max(b.maxY, l.maxY) }
    else { const m = coreSpan * 0.35; b = { minX: b.minX - m, maxX: b.maxX + m, minY: b.minY - m, maxY: b.maxY + m } }
  }
  // At least 30 ft across, so a short straight fence is not drawn huge.
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
  const hx = Math.max(15, (b.maxX - b.minX) / 2), hy = Math.max(15, (b.maxY - b.minY) / 2)
  return { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy }
}

/** Where the plan's feet land in a W x H drawing, north up. */
export function planFrame(plan: SitePlanData, W: number, H: number, o: FrameOpts = {}): PlanFrame {
  const pad = o.pad ?? Math.max(28, Math.min(W, H) * 0.08)
  const bottom = o.bottom ?? 0
  const e = planExtent(plan, o.fit)
  const spanX = e.maxX - e.minX, spanY = e.maxY - e.minY
  const scale = o.scale ?? Math.min((W - 2 * pad) / spanX, (H - 2 * pad - bottom) / spanY)
  const cx = (e.minX + e.maxX) / 2, cy = (e.minY + e.maxY) / 2
  const midX = W / 2, midY = (H - bottom) / 2
  const ft = (p: { x: number; y: number }) => ({ x: midX + (p.x - cx) * scale, y: midY - (p.y - cy) * scale })
  return { W, H, scale, ft, at: p => ft(toFeet(plan.origin, p)) }
}

export interface SitePlanSvgOpts {
  width: number
  height: number
  /** The crew's posts (sitePlanData crewPosts), drawn numbered in walking order. */
  crewPosts?: CrewPost[] | null
  /** Mark the start post "Start here" (the crew's sheet). */
  showStart?: boolean
  /** Draw the neighbors' property lines (thin). */
  neighbors?: boolean
  /** Draw the job's property line (bold). Default true. */
  propertyLine?: boolean
  /** A legend line under the plan. Default true. */
  legend?: boolean
  /** A white background (off when an aerial photo goes under the plan). Default true. */
  background?: boolean
  /** A fixed scale, drawing units per foot (the permit sheet); otherwise the plan fills the picture. */
  scale?: number
  /** Base text size (drawing units). */
  fontSize?: number
  /** Each side's name under its feet. */
  sideNames?: boolean
  /** 'fence': the frame is the fence and the house (the crew's sheet), not the whole lot. */
  fit?: 'all' | 'fence'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r1 = (n: number) => Math.round(n * 10) / 10
const n2 = (n: number) => (Math.round(n * 100) / 100).toString()
/** 120 → "120 ft", 37.46 → "37.5 ft". */
export const feetLabel = (ft: number) => `${r1(ft)} ft`

/** The side's direction (unit, feet east/north) and its two posts in feet. */
function sideFt(plan: SitePlanData, side: SiteSide) {
  const a = postOf(plan, side.a), b = postOf(plan, side.b)
  if (!a || !b) return null
  const A = toFeet(plan.origin, a), B = toFeet(plan.origin, b)
  const len = Math.hypot(B.x - A.x, B.y - A.y)
  if (len < 1e-6) return null
  return { A, B, len, u: { x: (B.x - A.x) / len, y: (B.y - A.y) / len } }
}

/**
 * Which way is into the yard from a side (unit, feet east/north): toward the
 * middle of a fence that closes or bends, else toward the house, else the
 * left of the side as drawn.
 */
export function insideOf(plan: SitePlanData, side: SiteSide): { x: number; y: number } {
  const s = sideFt(plan, side)
  if (!s) return { x: 0, y: 1 }
  const left = { x: -s.u.y, y: s.u.x }
  const toward = (p: { x: number; y: number } | null) => {
    if (!p) return 0
    const d = (p.x - s.A.x) * left.x + (p.y - s.A.y) * left.y
    return Math.abs(d) < 0.5 ? 0 : Math.sign(d)
  }
  const mid = (list: Array<{ x: number; y: number }>) => (list.length ? { x: list.reduce((t, p) => t + p.x, 0) / list.length, y: list.reduce((t, p) => t + p.y, 0) / list.length } : null)
  const posts = mid(plan.posts.map(p => toFeet(plan.origin, p)))
  const house = mid(plan.house.flat().map(p => toFeet(plan.origin, p)))
  const sign = toward(posts) || toward(house) || 1
  return { x: left.x * sign, y: left.y * sign }
}

/** A gate's hinge post end and latch end (feet along its side from the side's first post), and its leaves. */
export function gateLeaves(plan: SitePlanData, side: SiteSide, g: SiteGate): Array<{ hingeFt: number; towardFt: number }> {
  const s = sideFt(plan, side)
  const total = builtFt(plan, side) || (s?.len ?? 0)
  const k = s && total > 0 ? s.len / total : 1
  const a = g.atFt * k, b = (g.atFt + g.widthFt) * k
  if (g.type === 'double') { const m = (a + b) / 2; return [{ hingeFt: a, towardFt: m }, { hingeFt: b, towardFt: m }] }
  if (!s) return [{ hingeFt: a, towardFt: b }]
  // Looking from inside the yard toward the gate (facing out): its left and right.
  const n = insideOf(plan, side)
  const facing = { x: -n.x, y: -n.y }
  const leftOfFacing = { x: -facing.y, y: facing.x }
  const bIsLeft = s.u.x * leftOfFacing.x + s.u.y * leftOfFacing.y > 0
  const hingeAtB = g.hinge === 'left' ? bIsLeft : g.hinge === 'right' ? !bIsLeft : false
  return hingeAtB ? [{ hingeFt: b, towardFt: a }] : [{ hingeFt: a, towardFt: b }]
}

/**
 * The crew's sheet size: the fence and house fill it with a margin, at a
 * scale where two posts next to each other never touch (each numbered circle
 * is 0.72 x the text size across its radius), and at least `minWidth` wide.
 * Shown at its own size on a phone (wider ones scroll), so a 15 unit text
 * size gives post numbers about 11 px tall.
 */
export function crewSheetSize(plan: SitePlanData, posts: CrewPost[], o: { fontSize: number; minWidth?: number; maxWidth?: number }): { width: number; height: number; scale: number } {
  const fs = o.fontSize, minW = o.minWidth ?? 360, maxW = o.maxWidth ?? 1100
  const e = planExtent(plan, 'fence')
  const spanX = e.maxX - e.minX, spanY = e.maxY - e.minY
  const pad = fs * 5, bottom = fs * 3.2 + fs * 2.6
  // The closest two posts in walking order on the same side (feet), never under 2 ft.
  let gap = Infinity
  for (let i = 1; i < posts.length; i++) {
    if (posts[i].sideId !== posts[i - 1].sideId) continue
    const a = toFeet(plan.origin, posts[i - 1].at), b = toFeet(plan.origin, posts[i].at)
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    if (d > 0.05) gap = Math.min(gap, d)
  }
  const rad = Math.max(5, fs * 0.72)
  let scale = Math.max((minW - 2 * pad) / spanX, Number.isFinite(gap) ? (2 * rad + 3) / Math.max(2, gap) : 0)
  if (spanX * scale + 2 * pad > maxW) scale = (maxW - 2 * pad) / spanX
  return { width: Math.round(spanX * scale + 2 * pad), height: Math.round(spanY * scale + 2 * pad + bottom), scale }
}

/** The plan as an SVG picture. */
export function sitePlanSvg(plan: SitePlanData, o: SitePlanSvgOpts): string {
  const W = o.width, H = o.height
  const fs = o.fontSize ?? Math.max(10, Math.min(W, H) / 55)
  const legendOn = o.legend !== false
  const bottomRoom = fs * 3.2 + (legendOn ? fs * 2.6 : 0)
  const f = planFrame(plan, W, H, { scale: o.scale, bottom: bottomRoom, pad: fs * 5, fit: o.fit })
  const out: string[] = []
  const font = `font-family="Arial, Helvetica, sans-serif"`
  const text = (x: number, y: number, t: string, size = fs, extra = '') => `<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(size)}" ${font} ${extra}>${esc(t)}</text>`
  // A label on a white box, so it reads over a property line or the aerial photo.
  const boxed = (x: number, yBase: number, t: string, size: number, extra: string) => {
    const w = t.length * size * 0.56 + size * 0.4, h = size * 1.15
    return `<rect x="${n2(x - w / 2)}" y="${n2(yBase - size * 0.9)}" width="${n2(w)}" height="${n2(h)}" rx="${n2(size * 0.2)}" fill="#ffffff" fill-opacity="0.85"/>` + text(x, yBase, t, size, extra)
  }
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, stroke: string, w: number, extra = '') => `<line x1="${n2(a.x)}" y1="${n2(a.y)}" x2="${n2(b.x)}" y2="${n2(b.y)}" stroke="${stroke}" stroke-width="${n2(w)}" ${extra}/>`
  const poly = (ring: LatLng[], stroke: string, w: number, fill = 'none', extra = '') => `<polygon points="${ring.map(p => { const q = f.at(p); return `${n2(q.x)},${n2(q.y)}` }).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${n2(w)}" ${extra}/>`

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(W)} ${n2(H)}" width="${n2(W)}" height="${n2(H)}">`)
  if (o.background !== false) out.push(`<rect x="0" y="0" width="${n2(W)}" height="${n2(H)}" fill="#ffffff"/>`)

  // Property lines: the neighbors' thin, the job's bold.
  if (o.neighbors && plan.neighbors?.length) for (const parcel of plan.neighbors) for (const ring of parcel) if (ring.length >= 3) out.push(poly(ring, SITE_COLORS.NEIGHBOR, Math.max(0.6, fs / 14)))
  if (o.propertyLine !== false && plan.parcel) for (const ring of plan.parcel.rings) if (ring.length >= 3) out.push(poly(ring, SITE_COLORS.LOT, Math.max(1.6, fs / 5), 'none', 'stroke-dasharray="10 4"'))

  // The house.
  for (const ring of plan.house) {
    if (ring.length < 3) continue
    out.push(poly(ring, SITE_COLORS.HOUSE_LINE, Math.max(0.8, fs / 10), SITE_COLORS.HOUSE_FILL))
    const c = ring.map(p => f.at(p)).reduce((t, p) => ({ x: t.x + p.x / ring.length, y: t.y + p.y / ring.length }), { x: 0, y: 0 })
    out.push(text(c.x, c.y + fs * 0.35, 'House', fs, `text-anchor="middle" fill="${SITE_COLORS.MUTED}"`))
  }

  // The fence: each side in pieces between its gates, the gates with their swing.
  const fenceW = Math.max(2.2, fs / 3.6)
  const labels: string[] = []
  let anyKept = false
  const swings: string[] = []
  for (const side of plan.sides) {
    const s = sideFt(plan, side)
    if (!s) continue
    const total = builtFt(plan, side) || s.len
    const k = total > 0 ? s.len / total : 1
    const at = (d: number) => f.ft({ x: s.A.x + s.u.x * d, y: s.A.y + s.u.y * d })
    const gates = [...side.gates].sort((x, y) => x.atFt - y.atFt)
    let from = 0
    for (const g of gates) {
      const g0 = Math.max(0, g.atFt * k), g1 = Math.min(s.len, (g.atFt + g.widthFt) * k)
      if (g0 > from) out.push(line(at(from), at(g0), SITE_COLORS.FENCE, fenceW, 'stroke-linecap="round"'))
      from = Math.max(from, g1)
    }
    if (from < s.len) out.push(line(at(from), at(s.len), SITE_COLORS.FENCE, fenceW, 'stroke-linecap="round"'))
    const inside = insideOf(plan, side)
    for (const g of gates) {
      const wPx = g.widthFt * k * f.scale
      const dir = g.swing === 'out' ? -1 : 1
      for (const leaf of gateLeaves(plan, side, g)) {
        const H0 = { x: s.A.x + s.u.x * leaf.hingeFt, y: s.A.y + s.u.y * leaf.hingeFt }
        const L0 = { x: s.A.x + s.u.x * leaf.towardFt, y: s.A.y + s.u.y * leaf.towardFt }
        const r = Math.hypot(L0.x - H0.x, L0.y - H0.y)
        const O0 = { x: H0.x + inside.x * dir * r, y: H0.y + inside.y * dir * r }
        const h = f.ft(H0), l = f.ft(L0), op = f.ft(O0)
        // Clockwise on screen when turning from the latch to the open leaf is clockwise.
        const cross = (l.x - h.x) * (op.y - h.y) - (l.y - h.y) * (op.x - h.x)
        const rp = r * f.scale
        swings.push(line(h, op, SITE_COLORS.GATE, Math.max(1.2, fs / 8)))
        swings.push(`<path d="M ${n2(l.x)} ${n2(l.y)} A ${n2(rp)} ${n2(rp)} 0 0 ${cross > 0 ? 1 : 0} ${n2(op.x)} ${n2(op.y)}" fill="none" stroke="${SITE_COLORS.GATE}" stroke-width="${n2(Math.max(0.8, fs / 12))}" stroke-dasharray="4 3"/>`)
      }
      // Its words on the swing's side, past the open leaves (the side's own feet and name are on the outside).
      const mid = { x: s.A.x + s.u.x * (g.atFt + g.widthFt / 2) * k, y: s.A.y + s.u.y * (g.atFt + g.widthFt / 2) * k }
      const words = `${feetLabel(g.widthFt)} ${g.type === 'double' ? 'double' : 'single'} gate`
      const leafPx = (g.type === 'double' ? wPx / 2 : wPx)
      const hwG = words.length * fs * 0.85 * 0.3
      const awayPx = leafPx + fs * 0.6 + hwG * Math.abs(inside.x) + fs * 0.5 * Math.abs(inside.y)
      const p = f.ft({ x: mid.x + (inside.x * dir * awayPx) / f.scale, y: mid.y + (inside.y * dir * awayPx) / f.scale })
      labels.push(boxed(Math.min(Math.max(p.x, hwG + 2), W - hwG - 2), p.y + fs * 0.3, words, fs * 0.85, `text-anchor="middle" font-weight="bold" fill="${SITE_COLORS.GATE}"`))
    }
    // The side's feet (and name), outside the yard at its middle, clear of a gate there and of the posts.
    const midD = s.len / 2
    const gateAtMid = gates.some(g => g.atFt * k - 2 < midD && (g.atFt + g.widthFt) * k + 2 > midD)
    const d = gateAtMid ? Math.max(0, Math.min(s.len, (gates[0].atFt * k) / 2 || s.len * 0.2)) : midD
    // A wheel number kept ("Keep the wheel number"): the quoted feet, marked * (measured on site, drawn to the map).
    const keptWheel = side.quotedFt != null && plan.answers?.[`len:${side.id}`]?.kind === 'keep'
    if (keptWheel) anyKept = true
    const lines = [`${feetLabel(total)}${keptWheel ? '*' : ''}`, ...(o.sideNames ? [side.name] : [])]
    const hw = Math.max(...lines.map((t, i) => t.length * fs * (i ? 0.8 : 1) * 0.3)), hh = (lines.length === 2 ? fs * 2.1 : fs * 1.1) / 2
    const clear = (o.crewPosts?.length ? Math.max(5, fs * 0.72) : fenceW) + fs * 0.4
    const offPx = clear + hw * Math.abs(inside.x) + hh * Math.abs(inside.y)
    const q = f.ft({ x: s.A.x + s.u.x * d - (inside.x * offPx) / f.scale, y: s.A.y + s.u.y * d - (inside.y * offPx) / f.scale })
    const top = q.y - hh
    const qx = Math.min(Math.max(q.x, hw + 2), W - hw - 2)
    labels.push(boxed(qx, top + fs * 0.85, lines[0], fs, `text-anchor="middle" font-weight="bold" fill="${SITE_COLORS.LABEL}"`))
    if (lines[1]) labels.push(boxed(qx, top + fs * 1.85, lines[1], fs * 0.8, `text-anchor="middle" fill="${SITE_COLORS.MUTED}"`))
  }

  // Posts: numbered for the crew, else the corners and ends.
  if (o.crewPosts?.length) {
    const rad = Math.max(5, fs * 0.72)
    for (const p of o.crewPosts) {
      const q = f.at(p.at)
      const solid = p.kind !== 'line'
      out.push(`<circle cx="${n2(q.x)}" cy="${n2(q.y)}" r="${n2(rad)}" fill="${solid ? SITE_COLORS.FENCE : '#ffffff'}" stroke="${SITE_COLORS.FENCE}" stroke-width="${n2(Math.max(1, fs / 10))}"/>`)
      out.push(text(q.x, q.y + rad * 0.38, String(p.n), rad * (p.n > 99 ? 0.8 : 1), `text-anchor="middle" font-weight="bold" fill="${solid ? '#ffffff' : SITE_COLORS.FENCE}"`))
    }
  } else {
    const uses = new Map<string, number>()
    for (const s of plan.sides) for (const id of [s.a, s.b]) uses.set(id, (uses.get(id) ?? 0) + 1)
    const sz = Math.max(3.5, fs * 0.4)
    for (const p of plan.posts) {
      if (!uses.has(p.id)) continue
      const q = f.at(p)
      out.push((uses.get(p.id) ?? 0) >= 2
        ? `<rect x="${n2(q.x - sz)}" y="${n2(q.y - sz)}" width="${n2(sz * 2)}" height="${n2(sz * 2)}" fill="${SITE_COLORS.FENCE}"/>`
        : `<circle cx="${n2(q.x)}" cy="${n2(q.y)}" r="${n2(sz)}" fill="${SITE_COLORS.FENCE}"/>`)
    }
  }
  out.push(...swings, ...labels)

  // Start here.
  const start = o.showStart && plan.startPostId ? postOf(plan, plan.startPostId) : null
  if (start) {
    const q = f.at(start)
    const r = Math.max(8, fs * 1.15)
    out.push(`<circle cx="${n2(q.x)}" cy="${n2(q.y)}" r="${n2(r)}" fill="none" stroke="${SITE_COLORS.START}" stroke-width="${n2(Math.max(2, fs / 5))}"/>`)
    // The tag past the end of the fence at an end post (clear of the side's own label), else away from the fence's middle.
    const own = plan.sides.filter(s => s.a === start.id || s.b === start.id)
    const other = own.length === 1 ? postOf(plan, own[0].a === start.id ? own[0].b : own[0].a) : null
    const mid = other ? f.at(other) : plan.posts.reduce((t, p) => { const a = f.at(p); return { x: t.x + a.x / plan.posts.length, y: t.y + a.y / plan.posts.length } }, { x: 0, y: 0 })
    let dx = q.x - mid.x, dy = q.y - mid.y
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl; dy /= dl
    const tw = fs * 6.2, th = fs * 1.5
    const reach = r + fs * 0.5 + (tw / 2) * Math.abs(dx) + (th / 2) * Math.abs(dy)
    const cx = q.x + dx * reach, cy = q.y + dy * reach
    const bx0 = Math.min(Math.max(2, cx - tw / 2), W - tw - 2), by0 = Math.min(Math.max(2, cy - th / 2), H - th - 2)
    out.push(`<rect x="${n2(bx0)}" y="${n2(by0)}" width="${n2(tw)}" height="${n2(th)}" rx="${n2(fs * 0.3)}" fill="${SITE_COLORS.START}"/>`)
    out.push(text(bx0 + tw / 2, by0 + th * 0.72, 'Start here', fs * 0.95, `text-anchor="middle" font-weight="bold" fill="#ffffff"`))
  }

  // North arrow (top right).
  const nx = W - fs * 2.6, ny = fs * 1.4
  out.push(`<polygon points="${n2(nx)},${n2(ny)} ${n2(nx - fs * 0.7)},${n2(ny + fs * 2.2)} ${n2(nx)},${n2(ny + fs * 1.6)} ${n2(nx + fs * 0.7)},${n2(ny + fs * 2.2)}" fill="${SITE_COLORS.LABEL}"/>`)
  out.push(text(nx, ny + fs * 3.4, 'N', fs * 1.1, `text-anchor="middle" font-weight="bold" fill="${SITE_COLORS.LABEL}"`))

  // Scale bar (bottom left): a round number of feet about a fifth of the width.
  const want = (W * 0.2) / f.scale
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(v => v >= want * 0.7) ?? 1000
  const barW = nice * f.scale
  const by = H - bottomRoom + fs * 1.6, bx = fs * 1.5
  out.push(`<rect x="${n2(bx - fs * 0.5)}" y="${n2(by - fs * 1.4)}" width="${n2(barW + fs * 2.6)}" height="${n2(fs * 2.2)}" fill="#ffffff" fill-opacity="0.9"/>`)
  out.push(`<rect x="${n2(bx)}" y="${n2(by)}" width="${n2(barW / 2)}" height="${n2(fs * 0.45)}" fill="${SITE_COLORS.LABEL}"/>`)
  out.push(`<rect x="${n2(bx + barW / 2)}" y="${n2(by)}" width="${n2(barW / 2)}" height="${n2(fs * 0.45)}" fill="#ffffff" stroke="${SITE_COLORS.LABEL}" stroke-width="${n2(Math.max(0.8, fs / 12))}"/>`)
  out.push(text(bx, by - fs * 0.35, '0', fs * 0.85, `fill="${SITE_COLORS.LABEL}"`))
  out.push(text(bx + barW, by - fs * 0.35, `${nice} ft`, fs * 0.85, `text-anchor="middle" fill="${SITE_COLORS.LABEL}"`))

  if (legendOn) {
    const items: string[] = [anyKept ? 'Purple: new fence, feet as built (* feet as quoted)' : 'Purple: new fence, feet as built', 'Dashed arcs: gate swing']
    if (anyKept) items.push('* Measured on site with a wheel; drawn to the map')
    if (o.crewPosts?.length) items.push('Numbered circles: posts in walking order (filled: corner, end, gate or tee; open: line)')
    else items.push('Squares: corner posts. Dots: end posts')
    if (o.propertyLine !== false && plan.parcel) items.push('Bold dashed: property line (approximate, from county records)')
    if (o.neighbors && plan.neighbors?.length) items.push('Thin gray: neighbors')
    // Two lines at most, wrapped by an average letter width.
    const perLine = Math.max(30, Math.floor((W - 2 * bx) / (fs * 0.8 * 0.52)))
    const rows: string[] = []
    for (const it of items) {
      const last = rows[rows.length - 1]
      if (last && last.length + 3 + it.length <= perLine) rows[rows.length - 1] = `${last} · ${it}`
      else rows.push(it)
    }
    const shown = rows.length > 2 ? [rows[0], rows.slice(1).join(' · ')] : rows
    // On a white box, so it reads over the aerial photo.
    const longest = Math.max(...shown.map(t => t.length)) * fs * 0.8 * 0.52
    out.push(`<rect x="${n2(bx - fs * 0.4)}" y="${n2(H - fs * 0.6 - (shown.length - 1) * fs * 1.05 - fs * 1.0)}" width="${n2(Math.min(W - bx, longest + fs * 0.8))}" height="${n2(shown.length * fs * 1.05 + fs * 0.6)}" fill="#ffffff" fill-opacity="0.9"/>`)
    shown.forEach((t, i) => out.push(text(bx, H - fs * 0.6 - (shown.length - 1 - i) * fs * 1.05, t, fs * 0.8, `fill="${SITE_COLORS.MUTED}"`)))
  }
  out.push('</svg>')
  return out.join('')
}
