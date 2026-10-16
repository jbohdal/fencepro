/**
 * A plain caption for a pinned photo, from what the app already knows (no
 * AI): which side it was taken from and roughly how far along, which way the
 * camera faced in plan terms, the nearest gate, corner, house wall, skip or
 * existing fence with its distance and direction, then the category, date,
 * time and who took it. Without a pin or a facing direction it says only
 * what is known; it never guesses.
 *
 * Plan coordinates are feet, y up; an angle is degrees clockwise from "up
 * the page" (the back of a backyard).
 */

import { buildPlan } from './sitePlanGeometry'
import { deriveLayout, type YardLayout, type PlanPoint } from './yardLayout'

export interface CaptionInput {
  layout?: YardLayout | null
  pin?: { x: number; y: number; angle?: number | null } | null
  category?: string
  takenAt?: string | Date
  takenBy?: string | null
}

const round5 = (ft: number) => Math.max(1, Math.round(ft / 5) * 5)
const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function closestOnSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): { pt: PlanPoint; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { pt: { x: a.x + dx * t, y: a.y + dy * t }, t }
}

/** "back left corner" from "Left side" and "Back"; "left return corner"; else "corner of the X and the Y". */
export function cornerName(a: string, b: string): string {
  const al = a.toLowerCase(), bl = b.toLowerCase()
  const ret = [al, bl].find(n => n.includes('return'))
  if (ret) return `${ret} corner`
  const dir = (n: string) => (n.match(/\b(front|back|left|right)\b/) ?? [])[1]
  const da = dir(al), db = dir(bl)
  const fb = [da, db].find(d => d === 'front' || d === 'back')
  const lr = [da, db].find(d => d === 'left' || d === 'right')
  if (fb && lr) return `${fb} ${lr} corner`
  return `corner of the ${al} and the ${bl}`
}

/** Where something is relative to which way the camera faced. */
function relative(from: PlanPoint, angle: number, to: PlanPoint): string {
  const bearing = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI
  const d = ((bearing - angle + 540) % 360) - 180
  if (Math.abs(d) <= 30) return 'ahead'
  if (Math.abs(d) >= 150) return 'behind'
  return d > 0 ? 'to the right' : 'to the left'
}

export function autoCaption(input: CaptionInput): string {
  const parts: string[] = []
  const { layout, pin } = input
  if (layout && pin) {
    const result = deriveLayout(layout)
    const plan = buildPlan(layout, result)
    const at: PlanPoint = { x: pin.x, y: pin.y }
    const angle = typeof pin.angle === 'number' && Number.isFinite(pin.angle) ? pin.angle : null

    // Which side, and how far along it.
    let best: { side: typeof plan.sides[number]; d: number; t: number } | null = null
    for (const sd of plan.sides) {
      const c = closestOnSegment(at, sd.a, sd.b)
      const d = dist(at, c.pt)
      if (!best || d < best.d) best = { side: sd, d, t: c.t }
    }
    const v = plan.vertices
    const idx = (id: string) => layout.sides.findIndex(s => s.id === id)
    // Corners, named by the two sides that meet there.
    const corners: Array<{ name: string; pt: PlanPoint }> = []
    layout.sides.forEach((s, i) => {
      const r = result.sides[i]
      if (r?.finishes.end === 'corner') {
        const j = (i + 1) % layout.sides.length
        corners.push({ name: cornerName(s.name, layout.sides[j].name), pt: v[(i + 1) % v.length] })
      }
    })
    if (best) {
      const i = idx(best.side.sideId)
      const s = layout.sides[i]
      const L = s.lengthIn / 12
      const r = result.sides[i]
      const startWord = r.finishes.start === 'house' ? 'the house' : r.finishes.start === 'corner' ? `the ${corners.find(c => dist(c.pt, best!.side.a) < 0.5)?.name ?? 'corner'}` : r.finishes.start === 'existing' ? 'the existing fence' : 'its end'
      if (best.d <= 25) parts.push(`${s.name}, about ${round5(best.t * L)} ft from ${startWord}`)
      else parts.push(`In the yard, about ${round5(best.d)} ft from the ${s.name.toLowerCase()}`)
    }

    // Which way it faced: the corner or side it points at.
    if (angle !== null) {
      const targets: Array<{ name: string; pt: PlanPoint }> = [
        ...corners.map(c => ({ name: `the ${c.name}`, pt: c.pt })),
        ...plan.sides.map(sd => ({ name: `the ${sd.name.toLowerCase()}`, pt: { x: (sd.a.x + sd.b.x) / 2, y: (sd.a.y + sd.b.y) / 2 } })),
      ].filter(tg => dist(tg.pt, at) > 3)
      let face: { name: string; off: number } | null = null
      for (const tg of targets) {
        const bearing = (Math.atan2(tg.pt.x - at.x, tg.pt.y - at.y) * 180) / Math.PI
        const off = Math.abs(((bearing - angle + 540) % 360) - 180)
        if (off <= 35 && (!face || off < face.off)) face = { name: tg.name, off }
      }
      if (face) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''}${parts.length ? ', ' : ''}looking toward ${face.name}`
    }

    // The nearest gate, corner, house wall, skip or existing fence.
    const feats: Array<{ name: string; pt: PlanPoint }> = [...corners.map(c => ({ name: c.name, pt: c.pt }))]
    for (const sd of plan.sides) {
      if (sd.gate) feats.push({ name: sd.gate.type === 'double' ? 'double gate' : 'walk gate', pt: { x: (sd.gate.a.x + sd.gate.b.x) / 2, y: (sd.gate.a.y + sd.gate.b.y) / 2 } })
      if (sd.skip) feats.push({ name: sd.skip.kind === 'existing' ? 'existing fence' : 'gap in the fence', pt: closestOnSegment(at, sd.skip.a, sd.skip.b).pt })
    }
    if (plan.house) {
      const h = plan.house
      let near: PlanPoint | null = null
      for (let k = 0; k < h.length; k++) { const c = closestOnSegment(at, h[k], h[(k + 1) % h.length]).pt; if (!near || dist(at, c) < dist(at, near)) near = c }
      if (near) feats.push({ name: 'house wall', pt: near })
    }
    const nearest = feats.map(f => ({ ...f, d: dist(at, f.pt) })).filter(f => f.d >= 1).sort((a, b) => a.d - b.d)[0]
    if (nearest && nearest.d <= 60) {
      const where = angle !== null ? ` ${relative(at, angle, nearest.pt)}` : ' away'
      parts.push(`${nearest.name.charAt(0).toUpperCase()}${nearest.name.slice(1)} ${Math.round(nearest.d)} ft${where}`)
    }
  }
  const when = input.takenAt ? new Date(input.takenAt) : null
  const stamp = [input.category, when && when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), input.takenBy].filter(Boolean).join(', ')
  if (stamp) parts.push(stamp)
  return parts.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('. ') + (parts.length ? '.' : '')
}
