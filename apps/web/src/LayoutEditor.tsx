/**
 * Layout first quoting: pick a yard shape, then fill in each side. Every side
 * shows the runs it makes, their sections and the post spacing. The quote
 * builder prices exactly the runs and posts this produces (see yardLayout.ts).
 */

import { useEffect, useState } from 'react'
import { Pencil, Trash2, Plus, Image as ImageIcon, Mic, Check, ChevronDown, ChevronUp, RotateCcw, RotateCw } from 'lucide-react'
import FtInPad from './FtInPad'
import SitePlan, { type PlanPin } from './SitePlan'
import { centeredVertices, buildPlan, layoutSignature, returnHouseEnd, setHouseMeets, clearHouseMeets, canMoveHouse } from './sitePlanGeometry'
import { bakePhoto, loadImage } from './aerialBake'
import { photoBackdrop, photoView, withPhotoView, lineUpRotation, normDeg, stepDeg, turnAbout, FRAME_PX } from './sitePlanPhoto'
import { lookupPosition } from './appointmentsStore'
import AddressAutocomplete from './AddressAutocomplete'
import { slideGate, slideGateFromEnd, resizeGate, sameGateSpot, gateDistances, gateWhereText, sideEndName, ftText, STEP_FOOT, STEP_HALF_FOOT } from './gateSlide'
import {
  layoutForShape, newSideId, joinedFromPrev, joinsNext, neighborName, formatFtIn, postSpacing,
  FINISH_LABEL, FINISH_NEAR, GATE_LABEL, GATE_WIDTH_IN, SHAPE_LABEL,
  type YardLayout, type YardShape, type YardSide, type EndFinish, type GateType, type LayoutResult, type GateSwing, type GateHinge,
} from './yardLayout'

const SHAPES: Array<{ shape: YardShape; hint: string; path: string }> = [
  { shape: 'backyard', hint: 'Returns, sides and back', path: 'M14 30 H6 V6 H42 V30 H34' },
  { shape: 'perimeter', hint: 'All the way around', path: 'M6 6 H42 V30 H6 Z' },
  { shape: 'front', hint: 'From the house to the street', path: 'M6 6 V30 H42 V6' },
  { shape: 'straight', hint: 'One run', path: 'M6 18 H42' },
  { shape: 'custom', hint: 'Add sides one by one', path: 'M6 30 L16 10 L32 14 L42 28' },
]

type PadTarget = { sideId: string; field: 'length' | 'gateWidth' | 'gateDistance' | 'gateBefore' | 'gateAfter' | 'skipLength' | 'skipDistance' | 'meetDistance' }

/** Quick gate sizes, feet (the same as the website quote's). Any other width is typed. */
const GATE_SIZES_FT: Record<GateType, number[]> = { walk: [4, 5, 6], double: [8, 10, 12] }

/** What a signed quote says when its gate is pressed. */
export const GATE_LOCKED_TEXT = 'Signed: make a change order'

/** How a side's ends finish, in one line ("Corner at both ends"). */
export function endsLine(start: EndFinish, end: EndFinish): string {
  const label = (f: EndFinish) => (f === 'free' ? 'Stops' : FINISH_LABEL[f])
  if (start === end) return `${label(start)} at both ends`
  return `${label(start)} at the start, ${label(end).toLowerCase()} at the end`
}

/** The next side to fill in after `id`: the next one that is on and has no length, going round. */
export function nextEmptySide(layout: YardLayout, id: string | null): YardSide | null {
  const i = id ? layout.sides.findIndex(s => s.id === id) : -1
  const order = [...layout.sides.slice(i + 1), ...layout.sides.slice(0, Math.max(0, i))]
  return order.find(s => s.on && !(s.lengthIn > 0)) ?? null
}

export default function LayoutEditor({ layout, onChange, result, runSections, nearIn, hasStyle, address, widthFt, tapeFlags = [], onVoiceSide, pins, onPinTap, openSideId, onOpenSide, locked = false }: {
  layout: YardLayout | null
  onChange: (l: YardLayout | null) => void
  result: LayoutResult | null
  /** Sections for each run in result.runs, same order (from the quote math). */
  runSections: number[]
  /** How far a gate "near" an end sits from it, in inches. */
  nearIn: number
  hasStyle: boolean
  /** The property, for the aerial photo. */
  address?: string
  widthFt: number
  /** Runs (same order as result.runs) that need a tape measure check. */
  tapeFlags?: boolean[]
  /** With Voice on: one quick spoken entry for a side. */
  onVoiceSide?: (sideName: string) => void
  /** Photo pins on the plan; tapping one opens its photos. */
  pins?: PlanPin[]
  onPinTap?: (id: string) => void
  /** The one side shown open (the quote builder's Next side moves it); without these the editor keeps its own. */
  openSideId?: string | null
  onOpenSide?: (id: string | null) => void
  /** A signed quote: its gates cannot be moved here (a change order does that). */
  locked?: boolean
}) {
  const [pad, setPad] = useState<PadTarget | null>(null)
  const [openLocal, setOpenLocal] = useState<string | null>(null)
  const openId = openSideId !== undefined ? openSideId : openLocal
  const setOpen = (id: string | null) => { if (onOpenSide) onOpenSide(id); else setOpenLocal(id) }
  // "More options" for the open side (ends, house, gate size, gaps, rename, off, remove).
  const [moreFor, setMoreFor] = useState<string | null>(null)
  // An opened side scrolls into view, so its buttons never need a scroll to reach.
  useEffect(() => {
    if (!openId) return
    const t = setTimeout(() => document.querySelector(`[data-side-id="${openId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
    return () => clearTimeout(t)
  }, [openId])
  // A quote saved with the photo on opens with it on.
  const [aerialOn, setAerialOn] = useState(() => !!layout?.plan?.aerial?.shown)
  const [aerialAddress, setAerialAddress] = useState(address ?? '')
  const [aerialMsg, setAerialMsg] = useState('')
  const [photoReady, setPhotoReady] = useState<string | null>(null)
  const aerial = layout?.plan?.aerial ?? null
  const backdrop = aerialOn ? photoBackdrop(layout) : null
  const photo = backdrop?.href ?? null
  // Line up: two taps along one wall of the house on the photo (drawing units).
  const [lineUp, setLineUp] = useState(false)
  const [lineTaps, setLineTaps] = useState<Array<{ x: number; y: number }>>([])
  useEffect(() => { if (address && !aerialAddress) setAerialAddress(address) }, [address])  // eslint-disable-line react-hooks/exhaustive-deps
  // Preload the photo so the plan can say it is still coming.
  useEffect(() => {
    if (!photo || photoReady === photo) return
    // Every tile of it (each is tried twice; the photo service sometimes drops one).
    let live = true
    const urls = backdrop?.tiles?.map(t => t.href) ?? [photo]
    Promise.all(urls.map(u => loadImage(u, 45_000).then(i => i ?? loadImage(`${u}&again=1`, 45_000)))).then(imgs => {
      if (!live) return
      if (imgs.some(Boolean)) setPhotoReady(photo)
      else setAerialMsg('The aerial photo did not load. Try again in a minute.')
    })
    return () => { live = false }
  }, [photo, photoReady])  // eslint-disable-line react-hooks/exhaustive-deps
  // Turn and cut the photo for the proposal and crew packet ahead of the save, once it settles.
  useEffect(() => {
    if (!backdrop || photoReady !== backdrop.href) return
    const t = setTimeout(() => { void bakePhoto(backdrop) }, 1200)
    return () => clearTimeout(t)
  }, [backdrop?.href, backdrop?.rotDeg, photoReady])  // eslint-disable-line react-hooks/exhaustive-deps
  const [renaming, setRenaming] = useState<string | null>(null)
  // Corner handles only while the drawing is being adjusted (or lined up on the aerial photo).
  const [adjusting, setAdjusting] = useState(false)
  const [editCounts, setEditCounts] = useState(false)
  // The aerial photo's address box opens only when asked for, to keep the yard step short.
  const [aerialForm, setAerialForm] = useState(false)
  // "Drag the house..." shows while adjusting until the house is first dragged in this quote (screen state only).
  const [houseHintDone, setHouseHintDone] = useState(false)
  // Dragged gates snap to whole feet, or half feet with this on (screen state only).
  const [halfFeet, setHalfFeet] = useState(false)

  if (!layout) {
    return (
      <div data-layout-shapes>
        <p className="text-sm text-gray-600 mb-3">Pick the shape of the yard. You can turn sides off, add, rename or remove them next.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SHAPES.map(s => (
            <button key={s.shape} type="button" onClick={() => onChange(layoutForShape(s.shape))} data-shape={s.shape}
              className="rounded-2xl border-2 border-gray-200 hover:border-orange-500 bg-white p-4 text-left min-h-[112px] flex flex-col gap-2 active:bg-orange-50">
              <svg viewBox="0 0 48 36" className="w-14 h-10" aria-hidden="true">
                {(s.shape === 'backyard' || s.shape === 'front') && <rect x="14" y={s.shape === 'front' ? 0 : 26} width="20" height="10" rx="1" className="fill-gray-300" />}
                <path d={s.path} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-orange-500" />
              </svg>
              <span className="text-base font-semibold text-gray-900">{SHAPE_LABEL[s.shape]}</span>
              <span className="text-xs text-gray-600 -mt-1.5">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const set = (next: YardLayout) => onChange(next)
  const updateSide = (id: string, patch: Partial<YardSide>) =>
    set({ ...layout, sides: layout.sides.map(s => (s.id === id ? { ...s, ...patch } : s)) })
  const idx = (id: string) => layout.sides.findIndex(s => s.id === id)

  /** A new gate width (or type): in the middle it stays in the middle; anywhere else its middle stays where it was (gateSlide.ts). */
  function setGateWidth(sideId: string, type: GateType, widthIn: number) {
    const i = idx(sideId), s = layout!.sides[i]
    if (!s?.gate) return
    if (s.gate.position === 'middle') { updateSide(sideId, { gate: { ...s.gate, type, widthIn } }); return }
    const typed = { ...layout!, sides: layout!.sides.map((x, k) => (k === i ? { ...x, gate: { ...x.gate!, type } } : x)) }
    set(resizeGate(typed, i, widthIn, { nearIn, snap: false }))
  }
  /** A gate dragged along its side: snapped to whole (or half) feet, kept on the side, off the skip; footage never changes. */
  function slideTo(sideId: string, startIn: number) {
    if (locked) return
    const i = idx(sideId)
    const next = slideGate(layout!, i, startIn, { nearIn, stepIn: halfFeet ? STEP_HALF_FOOT : STEP_FOOT })
    if (next !== layout && !sameGateSpot(layout!, next, i, nearIn)) set(next)
  }
  const neighbor = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j >= 0 && j < layout.sides.length) return j
    return layout.closed && layout.sides.length > 1 ? (j < 0 ? layout.sides.length - 1 : 0) : null
  }

  function setFinish(i: number, which: 'start' | 'end', f: EndFinish) {
    const sides = layout!.sides.map(s => ({ ...s }))
    const s = sides[i]
    const j = neighbor(i, which === 'start' ? -1 : 1)
    if (which === 'start') {
      if (f === 'corner' && j !== null) { sides[j].endFinish = 'corner'; s.startFinish = 'corner' }
      else { if (j !== null && joinedFromPrev(layout!, i)) sides[j].endFinish = 'free'; s.startFinish = f }
    } else {
      if (f === 'corner' && j !== null) { s.endFinish = 'corner'; sides[j].startFinish = 'corner' }
      else { if (j !== null && joinsNext(layout!, i)) sides[j].startFinish = 'free'; s.endFinish = f }
    }
    set({ ...layout!, sides })
  }

  function toggleSide(i: number) {
    const sides = layout!.sides.map(s => ({ ...s }))
    const s = sides[i], p = neighbor(i, -1), n = neighbor(i, 1)
    if (s.on) {
      // The neighbors stop where this side was; a side next to a return that
      // met the house now meets the house itself.
      if (n !== null && s.endFinish === 'corner' && sides[n].on) sides[n].startFinish = s.startFinish === 'house' ? 'house' : 'free'
      if (p !== null && sides[p].endFinish === 'corner' && sides[p].on) sides[p].endFinish = s.endFinish === 'house' ? 'house' : 'free'
      s.on = false
    } else {
      s.on = true
      if (p !== null && sides[p].on) { sides[p].endFinish = 'corner'; s.startFinish = 'corner' }
      if (n !== null && sides[n].on) { s.endFinish = 'corner'; sides[n].startFinish = 'corner' }
    }
    set({ ...layout!, sides })
  }

  function addSide() {
    const last = layout!.sides[layout!.sides.length - 1]
    const sides = layout!.sides.map(s => ({ ...s }))
    const joined = !!last && last.on
    if (joined) sides[sides.length - 1].endFinish = 'corner'
    // A new side turns a quarter to the right of the last one on the plan.
    const heading = last ? (((last.heading ?? 0) - 90) % 360 + 360) % 360 : 0
    const added: YardSide = { id: newSideId(), name: `Side ${sides.length + 1}`, on: true, lengthIn: 0, startFinish: joined ? 'corner' : 'free', endFinish: 'free', gate: null, skip: null, heading }
    sides.push(added)
    set({ ...layout!, sides })
    setOpen(added.id)
  }

  function removeSide(i: number) {
    if (!window.confirm(`Remove ${layout!.sides[i].name}?`)) return
    set({ ...layout!, sides: layout!.sides.filter((_, k) => k !== i) })
  }

  function changeShape() {
    const typed = layout!.sides.some(s => s.lengthIn > 0)
    if (typed && !window.confirm('Start over with a new yard shape? The sides entered so far will be cleared.')) return
    onChange(null)
  }

  // Pad wiring
  const padSide = pad ? layout.sides.find(s => s.id === pad.sideId) : null
  const padValue = !padSide || !pad ? 0
    : pad.field === 'length' ? padSide.lengthIn
    : pad.field === 'gateWidth' ? padSide.gate?.widthIn ?? 0
    : pad.field === 'gateDistance' ? padSide.gate?.distanceIn ?? 0
    : pad.field === 'gateBefore' || pad.field === 'gateAfter' ? (() => {
      const i = idx(padSide.id), at = result?.sides[i]?.gateAtIn
      if (!padSide.gate || at == null) return 0
      const d = gateDistances(padSide.lengthIn, at, padSide.gate.widthIn)
      return pad.field === 'gateBefore' ? d.beforeIn : d.afterIn
    })()
    : pad.field === 'skipLength' ? padSide.skip?.lengthIn ?? 0
    : pad.field === 'meetDistance' ? padSide.meetsHouse?.distanceIn ?? 0
    : padSide.skip?.distanceIn ?? 0
  // Next: the following side, then round to any side still without a length, so none is skipped.
  const nextSideFor = (id: string) => {
    const i = idx(id)
    return layout.sides.slice(i + 1).find(s => s.on)
      ?? layout.sides.slice(0, i).find(s => s.on && !(s.lengthIn > 0))
      ?? null
  }
  const padNext = pad?.field === 'length' && padSide ? nextSideFor(padSide.id) : null
  function padDone(inches: number, next: boolean) {
    if (!pad || !padSide) return
    if (pad.field === 'length') updateSide(padSide.id, { lengthIn: inches })
    if (pad.field === 'gateWidth' && padSide.gate) setGateWidth(padSide.id, padSide.gate.type, inches)
    if (pad.field === 'gateDistance' && padSide.gate) updateSide(padSide.id, { gate: { ...padSide.gate, position: 'distance', distanceIn: inches } })
    // Typed exactly ("the gate starts 12' 4\" from the corner"), kept on the side and off the skip.
    if (pad.field === 'gateBefore' && padSide.gate && !locked) set(slideGate(layout!, idx(padSide.id), inches, { nearIn, exact: true }))
    if (pad.field === 'gateAfter' && padSide.gate && !locked) set(slideGateFromEnd(layout!, idx(padSide.id), inches, { nearIn }))
    if (pad.field === 'skipLength' && padSide.skip) updateSide(padSide.id, { skip: { ...padSide.skip, lengthIn: inches } })
    if (pad.field === 'skipDistance' && padSide.skip) updateSide(padSide.id, { skip: { ...padSide.skip, position: 'distance', distanceIn: inches } })
    if (pad.field === 'meetDistance') updateSide(padSide.id, { meetsHouse: { at: 'distance', distanceIn: inches } })
    if (next && padNext) setOpen(padNext.id)
    setPad(next && padNext ? { sideId: padNext.id, field: 'length' } : null)
  }

  // Runs of each side, with their sections, from the quote math.
  let runCursor = 0
  const sideRuns = new Map<string, Array<{ inches: number; ft: number; sections: number; tape: boolean }>>()
  for (const r of result?.runs ?? []) {
    const list = sideRuns.get(r.sideId) ?? []
    list.push({ inches: r.inches, ft: r.ft, sections: runSections[runCursor] ?? 0, tape: !!tapeFlags[runCursor] })
    sideRuns.set(r.sideId, list)
    runCursor += 1
  }

  async function showAerial() {
    setAerialMsg('')
    if (aerial && aerial.address === aerialAddress.trim()) { setShown(true); return }
    if (!aerialAddress.trim()) { setAerialMsg('Type the property address first.'); return }
    setAerialMsg('Finding the address…')
    const at = await lookupPosition(aerialAddress.trim()).catch(() => null)
    if (!at) { setAerialMsg('That address was not found. Check it, or add the city and ZIP.'); return }
    setAerialMsg('')
    // Enough photo around the point for the whole yard, with room to drag.
    const pts = centeredVertices(layout!)
    const reachFt = Math.max(...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))
    const halfM = Math.min(150, Math.max(40, Math.ceil(reachFt * 0.3048 * 1.5)))
    // The plan at the photo's real scale, square and level, in the middle of the photo, the photo north up.
    onChange({ ...layout!, plan: { ...(layout!.plan ?? {}), aerial: { lat: at.lat, lng: at.lng, halfM, address: aerialAddress.trim(), rotDeg: 0, planAt: { x: 0, y: 0 }, shown: true } } })
    setAerialOn(true)
  }
  function setShown(on: boolean) {
    setAerialOn(on)
    setLineUp(false); setLineTaps([])
    if (layout?.plan?.aerial && !!layout.plan.aerial.shown !== on) onChange({ ...layout, plan: { ...layout.plan, aerial: { ...layout.plan.aerial, shown: on } } })
  }
  const rot = photoView(layout).rotDeg
  function turnTo(deg: number) {
    setLineTaps([])
    onChange(withPhotoView(layout!, { rotDeg: normDeg(deg) }))
  }
  function lineUpTap(pt: { x: number; y: number }) {
    if (lineTaps.length !== 1) { setLineTaps([pt]); return }
    const next = lineUpRotation(rot, lineTaps[0], pt)
    const d = normDeg(next - rot)
    // The two marks turn with the photo, so they stay on the wall that is now level.
    setLineTaps([lineTaps[0], pt].map(p => turnAbout(p, d, FRAME_PX / 2, FRAME_PX / 2)))
    setLineUp(false)
    onChange(withPhotoView(layout!, { rotDeg: next }))
  }
  function tapSide(id: string) {
    setOpen(id)
  }

  const onPhoto = !!(photo && photoReady === photo)
  // Measurements that cannot all be true at once: a gentle note, the plan still draws.
  const planNow = buildPlan(layout, result ?? undefined, runSections, widthFt)
  const planNotes = planNow.notes
  const houseMovable = !onPhoto && canMoveHouse(layout)
  const meetsSet = layout.sides.some(s => s.meetsHouse)
  // Tapping a gate while adjusting: a walk gate goes in/left, in/right, out/left,
  // out/right; a double gate flips both leaves in/out. Drawing and crew notes only.
  function cycleGate(sideId: string) {
    const s = layout!.sides.find(x => x.id === sideId)
    const g = planNow.sides.find(x => x.sideId === sideId)?.gate
    if (!s?.gate || !g) return
    if (s.gate.type === 'double') {
      const both: GateSwing = g.leafSwing.left === 'in' && g.leafSwing.right === 'in' ? 'out' : 'in'
      updateSide(sideId, { gate: { ...s.gate, swing: both, leafSwing: null } })
      return
    }
    const order: Array<[GateSwing, GateHinge]> = [['in', 'left'], ['in', 'right'], ['out', 'left'], ['out', 'right']]
    const k = order.findIndex(([w, h]) => w === g.leafSwing.left && h === g.hinge)
    const [swing, hinge] = order[(k + 1) % order.length]
    updateSide(sideId, { gate: { ...s.gate, swing, hinge } })
  }
  const selectCls = 'w-full border border-gray-300 rounded-lg px-3 h-11 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
  const counted = result?.counted

  return (
    // On a wide screen: the plan on the left (it stays in view), the sides on the right.
    <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start" data-layout-editor>
      <div className="space-y-3 lg:sticky lg:top-0" data-layout-plan-col>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-700"><span className="font-semibold">{SHAPE_LABEL[layout.shape]}</span>{result ? ` · ${formatFtIn(result.totalIn)} of yard` : ''}</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={changeShape} className="btn btn-quiet btn-sm">Change shape</button>
        </div>
      </div>

      <div className="relative" data-plan-wrap>
        <SitePlan
          layout={layout}
          result={result ?? undefined}
          runSections={runSections}
          widthFt={widthFt}
          onSideTap={tapSide}
          aerial={onPhoto ? backdrop : null}
          // Dragging only moves the drawing; on the plain plan it holds until a length changes.
          onPointsChange={!onPhoto && adjusting ? pts => onChange({ ...layout, plan: { ...(layout.plan ?? {}), points: pts, pointsFor: layoutSignature(layout) } }) : undefined}
          // On the photo the plan stays square and level at the photo's scale: it only moves, and the photo turns.
          onPlanMove={onPhoto && !lineUp ? at => onChange(withPhotoView(layout, { planAt: at })) : undefined}
          onRotate={onPhoto && !lineUp ? turnTo : undefined}
          onLineUpTap={onPhoto && lineUp ? lineUpTap : undefined}
          lineUpTaps={onPhoto ? lineTaps : undefined}
          pins={pins}
          onPinTap={onPinTap}
          onHouseMeetsChange={adjusting && houseMovable ? m => onChange(setHouseMeets(layout, m)) : undefined}
          onHouseDragEnd={() => setHouseHintDone(true)}
          onGateTap={adjusting && !onPhoto ? cycleGate : undefined}
          onGateSlide={locked ? undefined : slideTo}
          gateLocked={locked ? GATE_LOCKED_TEXT : null}
          onGateDistanceTap={locked ? undefined : (id, which) => { setOpen(id); setPad({ sideId: id, field: which === 'before' ? 'gateBefore' : 'gateAfter' }) }}
        />
        {photo && photoReady !== photo && !aerialMsg && (
          <p className="absolute inset-x-0 top-8 mx-auto w-fit bg-white/90 rounded-lg px-3 py-1.5 text-sm text-gray-700 shadow">Loading the aerial photo. It can take 20 seconds.</p>
        )}
      </div>
      {planNotes.map((n, k) => <p key={k} className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2" data-plan-note>{n}</p>)}
      {adjusting && houseMovable && !houseHintDone && (
        <p className="text-sm font-semibold text-orange-900 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2" data-plan-house-hint>
          Drag the house to where the fence meets it. The round handles at the house move one return alone.
        </p>
      )}
      {onPhoto && (
        <div className="rounded-xl border border-gray-200 bg-white p-2 space-y-2" data-photo-turn>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">Turn the photo</span>
            <span className="text-sm tabular-nums text-gray-700 min-w-[3.5ch]" data-photo-angle>{Math.round(rot)}°</span>
            <span className="flex-1" />
            <button type="button" className={`btn ${lineUp ? 'btn-primary' : 'btn-secondary'} btn-sm`} data-photo-lineup
              onClick={() => { setLineTaps([]); setLineUp(l => !l) }}>{lineUp ? 'Cancel' : 'Line up'}</button>
            <button type="button" className="btn btn-quiet btn-sm" data-photo-reset-turn disabled={rot === 0} onClick={() => { setLineUp(false); turnTo(0) }}>Reset</button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-secondary btn-icon shrink-0" aria-label="Turn the photo 1 degree left" data-photo-rot-minus onClick={() => turnTo(stepDeg(rot - 1))}><RotateCcw size={18} aria-hidden="true" /></button>
            <input type="range" min={-180} max={180} step={1} value={Math.round(rot)} aria-label="Turn the photo (degrees)"
              className="flex-1 min-w-0 h-11 accent-orange-600" data-photo-rotate onChange={e => turnTo(stepDeg(Number(e.target.value)))} />
            <button type="button" className="btn btn-secondary btn-icon shrink-0" aria-label="Turn the photo 1 degree right" data-photo-rot-plus onClick={() => turnTo(stepDeg(rot + 1))}><RotateCw size={18} aria-hidden="true" /></button>
          </div>
          {lineUp && (
            <p className="text-sm font-semibold text-orange-900 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2" data-photo-lineup-hint>
              {lineTaps.length === 0 ? 'Tap one corner of the house on the photo.' : 'Now tap the next corner along the same wall.'}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-gray-600 -mt-1">Tap a side on the plan to change it.{onPhoto ? ' The plan is drawn to the photo\'s real scale. Turn the photo to match the house (Line up, the slider, or twist two fingers), then drag the center button to move the plan onto the yard. Footage and price stay as typed.' : adjusting ? ` Drag a corner to match an odd yard${houseMovable ? ', or the house to where the returns meet it' : ''}. Tap a gate to change its swing. Footage and price stay as typed.` : ''}</p>
      <div className="flex flex-wrap items-center gap-2" data-aerial>
        {!onPhoto && (
          <button type="button" className={`btn ${adjusting ? 'btn-primary' : 'btn-quiet'} btn-sm`} onClick={() => setAdjusting(a => !a)} data-plan-adjust>
            {adjusting ? 'Done adjusting' : 'Adjust the drawing'}
          </button>
        )}
        {layout.sides.some(s => s.on && s.gate) && !locked && (
          <button type="button" role="switch" aria-checked={halfFeet} className={`btn ${halfFeet ? 'btn-primary' : 'btn-quiet'} btn-sm`} onClick={() => setHalfFeet(h => !h)} data-gate-half-feet>
            {halfFeet ? 'Gates snap to half feet' : 'Half feet'}
          </button>
        )}
        {!aerialOn ? (
          aerialForm || aerialMsg ? (
            <>
              <AddressAutocomplete wrapClassName="flex-1 min-w-[200px]" className="w-full border border-gray-300 rounded-lg px-3 h-11 text-sm" placeholder="Property address for the aerial photo"
                value={aerialAddress} onChange={setAerialAddress} inputAttrs={{ 'data-aerial-address': true }} />
              <button type="button" className="btn btn-secondary" onClick={showAerial} data-aerial-show><ImageIcon size={18} aria-hidden="true" /> Show aerial photo</button>
            </>
          ) : (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAerialForm(true)} data-aerial-open><ImageIcon size={16} aria-hidden="true" /> Aerial photo</button>
          )
        ) : (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShown(false)} data-aerial-hide>Hide aerial photo</button>
        )}
        {(layout.plan?.points || meetsSet || (onPhoto && photoView(layout).planAt && (photoView(layout).planAt!.x !== 0 || photoView(layout).planAt!.y !== 0))) && (
          <button type="button" className="btn btn-quiet btn-sm" data-plan-reset onClick={() => {
            // Back as typed: corners where the measurements put them, returns at the house's back corners.
            const l = clearHouseMeets(layout)
            const back = { ...l, plan: { ...(l.plan ?? {}), points: null, pointsFor: null } }
            // On the photo: the plan back in the middle of it (the photo keeps its turn).
            onChange(aerialOn ? withPhotoView(back, { planAt: { x: 0, y: 0 } }) : back)
          }}>Reset the drawing</button>
        )}
        {aerialMsg && <p className="w-full text-sm text-amber-800">{aerialMsg}</p>}
      </div>
      {aerialOn && <p className="text-xs text-gray-500 -mt-1">Aerial photo: USGS National Map (NAIP), public domain.</p>}
      </div>

      <div className="space-y-3" data-layout-sides-col>
      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden" data-side-list>
      {layout.sides.map((s, i) => {
        const r = result?.sides[i]
        const startJoined = joinedFromPrev(layout, i)
        const endJoined = joinsNext(layout, i)
        const prevOn = neighbor(i, -1) !== null && layout.sides[neighbor(i, -1)!].on
        const nextOn = neighbor(i, 1) !== null && layout.sides[neighbor(i, 1)!].on
        const startF = r?.finishes.start ?? s.startFinish
        const endF = r?.finishes.end ?? s.endFinish
        const runsHere = sideRuns.get(s.id) ?? []
        const open = openId === s.id
        const more = moreFor === s.id
        const done = s.on && s.lengthIn > 0
        const finishSelect = (which: 'start' | 'end', value: EndFinish, canCorner: boolean, joined: boolean) => (
          <select className={selectCls} value={value} onChange={e => setFinish(i, which, e.target.value as EndFinish)} data-finish={which}>
            {canCorner && <option value="corner">Corner{joined || canCorner ? ` (joins ${neighborName(layout, i, which)})` : ''}</option>}
            {(['house', 'existing', 'free'] as EndFinish[]).map(f => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
          </select>
        )
        return (
          <div key={s.id} className={`scroll-mt-24 scroll-mb-40 ${open ? 'bg-orange-50/40' : ''}`} data-side={s.name} data-side-id={s.id} data-side-open={open ? 'true' : undefined}>
            <button type="button" onClick={() => setOpen(open ? null : s.id)} aria-expanded={open} data-side-row={s.name}
              className="w-full min-h-[52px] flex items-center gap-3 px-3 text-left">
              <span className={`shrink-0 w-6 h-6 rounded-full grid place-items-center ${done ? 'bg-green-600 text-white' : s.on ? 'border-2 border-gray-300' : 'border-2 border-dashed border-gray-300'}`} aria-hidden="true">
                {done && <Check size={14} strokeWidth={3} />}
              </span>
              <span className={`flex-1 min-w-0 truncate text-base font-semibold ${s.on ? 'text-gray-900' : 'text-gray-500'}`}>{s.name}{!s.on && <span className="font-normal text-sm"> · off</span>}</span>
              {s.on && s.gate && <span className="shrink-0 text-xs font-semibold text-orange-800 bg-orange-100 rounded-full px-2 py-0.5" data-side-gate>{GATE_LABEL[s.gate.type]}</span>}
              <span className={`shrink-0 tabular-nums text-sm ${done ? 'text-gray-900 font-semibold' : 'text-gray-400'}`} data-side-len>{done ? formatFtIn(s.lengthIn) : s.on ? 'no length' : ''}</span>
            </button>

            {open && !s.on && (
              <div className="px-3 pb-3 flex items-center gap-2">
                <p className="flex-1 text-sm text-gray-600">This side is off: no fence here.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleSide(i)} data-side-toggle>Turn on</button>
              </div>
            )}

            {open && s.on && (
              <div className="px-3 pb-3 space-y-3" data-side-body>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPad({ sideId: s.id, field: 'length' })} data-side-length
                    className={`flex-1 min-w-0 h-14 rounded-xl border-2 text-left px-4 flex items-center justify-between ${s.lengthIn > 0 ? 'border-gray-300 bg-white' : 'border-orange-400 bg-orange-50'}`}>
                    <span className={`text-2xl font-bold tabular-nums ${s.lengthIn > 0 ? 'text-gray-900' : 'text-orange-700 text-base'}`}>{s.lengthIn > 0 ? formatFtIn(s.lengthIn) : 'Tap to enter the length'}</span>
                    <span className="text-xs text-gray-500">{s.gate ? 'across the gate' : 'end to end'}</span>
                  </button>
                  {onVoiceSide && (
                    <button type="button" className="shrink-0 w-14 h-14 rounded-xl border-2 border-orange-300 bg-white grid place-items-center text-orange-700" aria-label={`Say the ${s.name.toLowerCase()}`}
                      onClick={() => onVoiceSide(s.name)} data-side-mic><Mic size={22} aria-hidden="true" /></button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1 bg-gray-100 rounded-xl p-1" data-gate-choice>
                  {([null, 'walk', 'double'] as Array<GateType | null>).map(t => (
                    <button key={t ?? 'none'} type="button"
                      onClick={() => (t && s.gate && s.gate.type !== t
                        ? setGateWidth(s.id, t, GATE_WIDTH_IN[t])
                        : updateSide(s.id, { gate: t ? { type: t, widthIn: s.gate?.type === t ? s.gate.widthIn : GATE_WIDTH_IN[t], position: s.gate?.position ?? 'middle', distanceIn: s.gate?.distanceIn } : null }))}
                      className={`h-11 rounded-lg text-sm font-semibold ${(s.gate?.type ?? null) === t ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600'}`}>
                      {t ? GATE_LABEL[t] : 'No gate'}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm text-gray-700" data-side-ends>{endsLine(startF, endF)}{s.gate ? ` · ${formatFtIn(s.gate.widthIn)} gate ${s.gate.position === 'middle' ? 'in the middle' : s.gate.position === 'distance' ? (r?.gateAtIn != null ? `${ftText(r.gateAtIn)} from ${sideEndName(layout, i, 'start')}, ${ftText(Math.max(0, s.lengthIn - r.gateAtIn - s.gate.widthIn))} to ${sideEndName(layout, i, 'end')}` : `${formatFtIn(s.gate.distanceIn ?? 0)} from the start`) : FINISH_NEAR[s.gate.position === 'start' ? startF : endF]}` : ''}</p>
                  <button type="button" className="btn btn-quiet btn-sm shrink-0" onClick={() => setMoreFor(more ? null : s.id)} aria-expanded={more} data-side-more>
                    More options {more ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                  </button>
                </div>

                {s.gate && r?.gateAtIn != null && (() => {
                  const d = gateDistances(s.lengthIn, r.gateAtIn, s.gate.widthIn)
                  const btn = 'min-h-[48px] rounded-xl border-2 px-3 py-1.5 text-left disabled:opacity-70 disabled:cursor-not-allowed'
                  return (
                    <div className="rounded-xl border border-gray-200 bg-white p-2 space-y-2" data-gate-distances data-before-in={String(d.beforeIn)} data-after-in={String(d.afterIn)}>
                      <p className="text-sm font-semibold text-gray-900 tabular-nums" data-gate-where>{gateWhereText(layout, i, nearIn)}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className={`${btn} border-gray-300 bg-white`} disabled={locked} data-gate-before
                          onClick={() => setPad({ sideId: s.id, field: 'gateBefore' })} aria-label={`Distance from ${sideEndName(layout, i, 'start')} to the gate`}>
                          <span className="block text-lg font-bold tabular-nums text-gray-900">{ftText(d.beforeIn)}</span>
                          <span className="block text-xs text-gray-600">from {sideEndName(layout, i, 'start')}</span>
                        </button>
                        <button type="button" className={`${btn} border-gray-300 bg-white`} disabled={locked} data-gate-after
                          onClick={() => setPad({ sideId: s.id, field: 'gateAfter' })} aria-label={`Distance from the gate to ${sideEndName(layout, i, 'end')}`}>
                          <span className="block text-lg font-bold tabular-nums text-gray-900">{ftText(d.afterIn)}</span>
                          <span className="block text-xs text-gray-600">to {sideEndName(layout, i, 'end')}</span>
                        </button>
                      </div>
                      <p className={`text-xs ${locked ? 'font-semibold text-amber-800' : 'text-gray-600'}`} data-gate-move-hint>
                        {locked ? `${GATE_LOCKED_TEXT} to move the gate.` : 'Drag the gate on the drawing, or tap a distance to type it exactly.'}
                      </p>
                    </div>
                  )
                })()}

                {runsHere.length > 0 && (hasStyle || runsHere.length > 1 || runsHere.some(r => r.tape)) && (
                  <div className="text-sm text-gray-700 space-y-0.5" data-side-runs>
                    {runsHere.map((run, k) => (
                      <p key={k} className="tabular-nums">
                        {runsHere.length > 1 ? `Piece ${k + 1}: ` : ''}{formatFtIn(run.inches)}
                        {hasStyle && run.sections > 0 ? <> = <span className="font-semibold">{run.sections} sections</span>, posts {postSpacing(run.ft, run.sections)} apart</> : ''}
                        {run.tape && <span className="block text-amber-800 text-xs font-semibold" data-tape-flag>Check this run with a tape measure. A few inches either way changes the section count.</span>}
                      </p>
                    ))}
                  </div>
                )}
                {r?.notes.map((n, k) => <p key={k} className="text-sm text-amber-800 bg-amber-50 rounded-lg px-2 py-1">{cap(n)}</p>)}

                {more && (
                  <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3" data-side-options>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-xs text-gray-600 mb-1 block">Start</span>
                        {finishSelect('start', startF, prevOn, startJoined)}
                      </label>
                      <label className="block">
                        <span className="text-xs text-gray-600 mb-1 block">End</span>
                        {finishSelect('end', endF, nextOn, endJoined)}
                      </label>
                    </div>

                    {returnHouseEnd(layout, i) && (
                      <label className="block">
                        <span className="text-xs text-gray-600 mb-1 block">Meets the house at</span>
                        <select className={selectCls} value={s.meetsHouse?.at ?? 'back'} data-meets-house
                          onChange={e => {
                            const v = e.target.value as 'back' | 'front' | 'distance'
                            if (v === 'distance') setPad({ sideId: s.id, field: 'meetDistance' })
                            else updateSide(s.id, { meetsHouse: v === 'back' ? null : { at: v } })
                          }}>
                          <option value="back">The back corner of the house</option>
                          <option value="front">The front corner of the house</option>
                          <option value="distance">{s.meetsHouse?.at === 'distance' ? `${formatFtIn(s.meetsHouse.distanceIn ?? 0)} from the back corner` : 'Type a distance from the back corner'}</option>
                        </select>
                      </label>
                    )}

                    {s.gate && (
                      <div className="flex flex-wrap items-center gap-2" data-gate-sizes>
                        <span className="text-xs text-gray-600">Gate size</span>
                        {GATE_SIZES_FT[s.gate.type].map(w => (
                          <button key={w} type="button" className={`btn btn-sm ${s.gate!.widthIn === w * 12 ? 'btn-primary' : 'btn-secondary'}`} disabled={w * 12 > s.lengthIn && s.lengthIn > 0}
                            onClick={() => setGateWidth(s.id, s.gate!.type, w * 12)} data-gate-size={w}>{w} ft</button>
                        ))}
                      </div>
                    )}
                    {s.gate && (
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setPad({ sideId: s.id, field: 'gateWidth' })} className="h-11 rounded-lg border border-gray-300 px-3 text-left text-sm" data-gate-width>
                          <span className="text-gray-600">Gate width </span><span className="font-semibold text-gray-900">{formatFtIn(s.gate.widthIn)}</span>
                        </button>
                        <select className={selectCls} value={s.gate.position} data-gate-position
                          onChange={e => {
                            const v = e.target.value as typeof s.gate.position
                            if (v === 'distance') setPad({ sideId: s.id, field: 'gateDistance' })
                            else updateSide(s.id, { gate: { ...s.gate!, position: v } })
                          }}>
                          <option value="middle">In the middle</option>
                          <option value="start">{cap(FINISH_NEAR[startF])}</option>
                          <option value="end">{cap(FINISH_NEAR[endF])}</option>
                          <option value="distance">{s.gate.position === 'distance' ? `${formatFtIn(s.gate.distanceIn ?? 0)} from ${sideEndName(layout, i, 'start')}` : `Type a distance from ${sideEndName(layout, i, 'start')}`}</option>
                        </select>
                      </div>
                    )}
                    {s.gate && (() => {
                      const pg = planNow.sides.find(x => x.sideId === s.id)?.gate
                      if (!pg) return null
                      const gate = s.gate
                      const swingSel = (value: GateSwing, onSet: (v: GateSwing) => void, attr: string) => (
                        <select className={selectCls} value={value} onChange={e => onSet(e.target.value as GateSwing)} {...{ [attr]: true }}>
                          <option value="in">Swings in (into the yard)</option>
                          <option value="out">Swings out (outside the fence)</option>
                        </select>
                      )
                      return (
                        <div className="space-y-2" data-gate-swing-options>
                          {gate.type === 'walk' ? (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block"><span className="text-xs text-gray-600 mb-1 block">Swing</span>
                                {swingSel(pg.leafSwing.left, v => updateSide(s.id, { gate: { ...gate, swing: v } }), 'data-gate-swing')}</label>
                              <label className="block"><span className="text-xs text-gray-600 mb-1 block">Hinge (seen from inside the yard)</span>
                                <select className={selectCls} value={pg.hinge ?? 'left'} data-gate-hinge
                                  onChange={e => updateSide(s.id, { gate: { ...gate, hinge: e.target.value as GateHinge } })}>
                                  <option value="left">Hinges left</option>
                                  <option value="right">Hinges right</option>
                                </select></label>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <label className="block"><span className="text-xs text-gray-600 mb-1 block">Both leaves</span>
                                <select className={selectCls} value={pg.leafSwing.left === pg.leafSwing.right ? pg.leafSwing.left : 'mixed'} data-gate-swing
                                  onChange={e => e.target.value !== 'mixed' && updateSide(s.id, { gate: { ...gate, swing: e.target.value as GateSwing, leafSwing: null } })}>
                                  <option value="in">Swing in (into the yard)</option>
                                  <option value="out">Swing out (outside the fence)</option>
                                  {pg.leafSwing.left !== pg.leafSwing.right && <option value="mixed">Set each leaf</option>}
                                </select></label>
                              <label className="block"><span className="text-xs text-gray-600 mb-1 block">Left leaf (seen from inside)</span>
                                {swingSel(pg.leafSwing.left, v => updateSide(s.id, { gate: { ...gate, leafSwing: { left: v, right: pg.leafSwing.right } } }), 'data-gate-leaf-left')}</label>
                              <label className="block"><span className="text-xs text-gray-600 mb-1 block">Right leaf (seen from inside)</span>
                                {swingSel(pg.leafSwing.right, v => updateSide(s.id, { gate: { ...gate, leafSwing: { left: pg.leafSwing.left, right: v } } }), 'data-gate-leaf-right')}</label>
                            </div>
                          )}
                          <p className="text-xs text-gray-600" data-gate-swing-text>{cap(pg.swingText)}{pg.hingeDefaulted ? ' (the end nearest the house, or the side\'s start)' : ''}. Drawing and crew notes only; the price does not change.</p>
                        </div>
                      )
                    })()}

                    {s.skip ? (
                      <div className="rounded-xl bg-gray-50 border border-gray-200 p-2 space-y-2" data-skip>
                        <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-lg p-1">
                          {(['existing', 'none'] as const).map(k => (
                            <button key={k} type="button" onClick={() => updateSide(s.id, { skip: { ...s.skip!, kind: k } })}
                              className={`h-10 rounded-md text-sm font-semibold ${s.skip!.kind === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                              {k === 'existing' ? 'Existing fence here' : 'No fence here'}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                          <button type="button" onClick={() => setPad({ sideId: s.id, field: 'skipLength' })} className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-left text-sm" data-skip-length>
                            <span className="text-gray-600">Length </span><span className="font-semibold text-gray-900">{s.skip.lengthIn > 0 ? formatFtIn(s.skip.lengthIn) : 'tap'}</span>
                          </button>
                          <select className={selectCls} value={s.skip.position}
                            onChange={e => e.target.value === 'distance' ? setPad({ sideId: s.id, field: 'skipDistance' }) : updateSide(s.id, { skip: { ...s.skip!, position: 'middle' } })}>
                            <option value="middle">In the middle</option>
                            <option value="distance">{s.skip.position === 'distance' ? `${formatFtIn(s.skip.distanceIn ?? 0)} from the start` : 'Type a distance from the start'}</option>
                          </select>
                          <button type="button" className="btn btn-quiet btn-icon" aria-label="Remove the skip" onClick={() => updateSide(s.id, { skip: null })}><Trash2 size={18} aria-hidden="true" /></button>
                        </div>
                        <p className="text-xs text-gray-600">Not charged. Each piece of new fence gets its own end post here.</p>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-quiet btn-sm" data-add-skip
                        onClick={() => { updateSide(s.id, { skip: { kind: 'existing', lengthIn: 0, position: 'middle' } }); setPad({ sideId: s.id, field: 'skipLength' }) }}>
                        <Plus size={16} aria-hidden="true" /> Existing fence or a gap on this side
                      </button>
                    )}

                    {renaming === s.id && (
                      <input autoFocus defaultValue={s.name} aria-label="Side name" className="w-full border border-orange-300 rounded-lg px-3 h-11 text-base font-semibold"
                        onBlur={e => { updateSide(s.id, { name: e.target.value.trim() || s.name }); setRenaming(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(s.id)}><Pencil size={16} aria-hidden="true" /> Rename</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleSide(i)} data-side-toggle aria-label={`${s.name} on`}>Turn this side off</button>
                      <button type="button" className="btn btn-quiet btn-sm text-red-700" onClick={() => removeSide(i)} aria-label={`Remove ${s.name}`}><Trash2 size={16} aria-hidden="true" /> Delete side</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      </div>

      <button type="button" onClick={addSide} className="btn btn-secondary w-full" data-add-side><Plus size={18} aria-hidden="true" /> Add a side</button>

      {counted && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4" data-post-counts>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Posts</p>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditCounts(e => !e)}>{editCounts ? 'Done' : 'Change'}</button>
          </div>
          <p className="text-sm text-gray-700 mt-1 tabular-nums">
            {result!.corners} corner · {result!.ends} end{counted.gatePosts > 0 && layout.endsOverride == null ? ` (${counted.gatePosts} at gates)` : ''}
            {(layout.cornersOverride != null || layout.endsOverride != null) && <span className="text-amber-700"> · changed by hand</span>}
          </p>
          {editCounts && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              {([['Corner posts', 'cornersOverride', result!.corners], ['End and gate posts', 'endsOverride', result!.ends]] as const).map(([label, key, val]) => (
                <div key={key}>
                  <span className="text-xs text-gray-600 mb-1 block">{label}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" className="btn btn-secondary btn-icon" aria-label={`Fewer ${label.toLowerCase()}`} onClick={() => set({ ...layout, [key]: Math.max(0, val - 1) })}>−</button>
                    <span className="w-10 text-center text-lg font-semibold tabular-nums">{val}</span>
                    <button type="button" className="btn btn-secondary btn-icon" aria-label={`More ${label.toLowerCase()}`} onClick={() => set({ ...layout, [key]: val + 1 })}>+</button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-quiet btn-sm col-span-2 justify-self-start"
                onClick={() => set({ ...layout, cornersOverride: null, endsOverride: null })}>Use the counted posts ({counted.corners} corner, {counted.endPosts + counted.gatePosts} end)</button>
            </div>
          )}
        </div>
      )}
      </div>

      {pad && padSide && (
        <FtInPad
          key={`${pad.sideId}-${pad.field}`}
          title={pad.field === 'length' ? `${padSide.name} length` : pad.field === 'gateWidth' ? `${padSide.name} gate width` : pad.field === 'skipLength' ? `${padSide.name} skip length` : pad.field === 'meetDistance' ? `${padSide.name}: meets the house this far from its back corner` : pad.field === 'gateBefore' ? `${padSide.name}: gate starts this far from ${sideEndName(layout, idx(padSide.id), 'start')}` : pad.field === 'gateAfter' ? `${padSide.name}: gate ends this far from ${sideEndName(layout, idx(padSide.id), 'end')}` : `${padSide.name}: distance from the start`}
          valueIn={padValue}
          onDone={padDone}
          onClose={() => setPad(null)}
          nextLabel={padNext ? `Next: ${padNext.name}` : undefined}
        />
      )}
    </div>
  )
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
