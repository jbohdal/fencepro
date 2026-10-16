/**
 * Layout first quoting: pick a yard shape, then fill in each side. Every side
 * shows the runs it makes, their sections and the post spacing. The quote
 * builder prices exactly the runs and posts this produces (see yardLayout.ts).
 */

import { useEffect, useState } from 'react'
import { Pencil, Trash2, Plus, Image as ImageIcon, Mic } from 'lucide-react'
import FtInPad from './FtInPad'
import SitePlan, { type PlanPin } from './SitePlan'
import { aerialUrl, aerialFtPerPx, centeredVertices, AERIAL_PX, buildPlan, layoutSignature, returnHouseEnd } from './sitePlanGeometry'
import { lookupPosition } from './appointmentsStore'
import {
  layoutForShape, newSideId, joinedFromPrev, joinsNext, neighborName, formatFtIn, postSpacing,
  FINISH_LABEL, FINISH_NEAR, GATE_LABEL, GATE_WIDTH_IN, SHAPE_LABEL,
  type YardLayout, type YardShape, type YardSide, type EndFinish, type GateType, type LayoutResult,
} from './yardLayout'

const SHAPES: Array<{ shape: YardShape; hint: string; path: string }> = [
  { shape: 'backyard', hint: 'Returns, sides and back', path: 'M14 30 H6 V6 H42 V30 H34' },
  { shape: 'perimeter', hint: 'All the way around', path: 'M6 6 H42 V30 H6 Z' },
  { shape: 'front', hint: 'From the house to the street', path: 'M6 6 V30 H42 V6' },
  { shape: 'straight', hint: 'One run', path: 'M6 18 H42' },
  { shape: 'custom', hint: 'Add sides one by one', path: 'M6 30 L16 10 L32 14 L42 28' },
]

type PadTarget = { sideId: string; field: 'length' | 'gateWidth' | 'gateDistance' | 'skipLength' | 'skipDistance' | 'meetDistance' }

export default function LayoutEditor({ layout, onChange, result, runSections, nearIn, hasStyle, address, widthFt, tapeFlags = [], onVoiceSide, pins, onPinTap }: {
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
}) {
  const [pad, setPad] = useState<PadTarget | null>(null)
  const [aerialOn, setAerialOn] = useState(false)
  const [aerialAddress, setAerialAddress] = useState(address ?? '')
  const [aerialMsg, setAerialMsg] = useState('')
  const [photoReady, setPhotoReady] = useState<string | null>(null)
  const aerial = layout?.plan?.aerial ?? null
  const photo = aerialOn && aerial ? aerialUrl(aerial.lat, aerial.lng, aerial.halfM) : null
  useEffect(() => { if (address && !aerialAddress) setAerialAddress(address) }, [address])  // eslint-disable-line react-hooks/exhaustive-deps
  // Preload the photo so the plan can say it is still coming.
  useEffect(() => {
    if (!photo || photoReady === photo) return
    const img = new Image()
    img.onload = () => setPhotoReady(photo)
    img.onerror = () => setAerialMsg('The aerial photo did not load. Try again in a minute.')
    img.src = photo
  }, [photo, photoReady])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [editCounts, setEditCounts] = useState(false)

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
    sides.push({ id: newSideId(), name: `Side ${sides.length + 1}`, on: true, lengthIn: 0, startFinish: joined ? 'corner' : 'free', endFinish: 'free', gate: null, skip: null, heading })
    set({ ...layout!, sides })
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
    : pad.field === 'skipLength' ? padSide.skip?.lengthIn ?? 0
    : pad.field === 'meetDistance' ? padSide.meetsHouse?.distanceIn ?? 0
    : padSide.skip?.distanceIn ?? 0
  const nextSideFor = (id: string) => {
    const i = idx(id)
    return layout.sides.slice(i + 1).find(s => s.on) ?? null
  }
  const padNext = pad?.field === 'length' && padSide ? nextSideFor(padSide.id) : null
  function padDone(inches: number, next: boolean) {
    if (!pad || !padSide) return
    if (pad.field === 'length') updateSide(padSide.id, { lengthIn: inches })
    if (pad.field === 'gateWidth' && padSide.gate) updateSide(padSide.id, { gate: { ...padSide.gate, widthIn: inches } })
    if (pad.field === 'gateDistance' && padSide.gate) updateSide(padSide.id, { gate: { ...padSide.gate, position: 'distance', distanceIn: inches } })
    if (pad.field === 'skipLength' && padSide.skip) updateSide(padSide.id, { skip: { ...padSide.skip, lengthIn: inches } })
    if (pad.field === 'skipDistance' && padSide.skip) updateSide(padSide.id, { skip: { ...padSide.skip, position: 'distance', distanceIn: inches } })
    if (pad.field === 'meetDistance') updateSide(padSide.id, { meetsHouse: { at: 'distance', distanceIn: inches } })
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
    if (aerial && aerial.address === aerialAddress.trim()) { setAerialOn(true); return }
    if (!aerialAddress.trim()) { setAerialMsg('Type the property address first.'); return }
    setAerialMsg('Finding the address…')
    const at = await lookupPosition(aerialAddress.trim()).catch(() => null)
    if (!at) { setAerialMsg('That address was not found. Check it, or add the city and ZIP.'); return }
    setAerialMsg('')
    // Enough photo around the point for the whole yard, with room to drag.
    const pts = centeredVertices(layout!)
    const reachFt = Math.max(...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))
    const halfM = Math.min(150, Math.max(40, Math.ceil(reachFt * 0.3048 * 1.5)))
    onChange({ ...layout!, plan: { points: pts, aerial: { lat: at.lat, lng: at.lng, halfM, address: aerialAddress.trim() } } })
    setAerialOn(true)
  }
  function tapSide(id: string) {
    document.querySelector(`[data-side-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPad({ sideId: id, field: 'length' })
  }

  const onPhoto = !!(photo && photoReady === photo)
  // Measurements that cannot all be true at once: a gentle note, the plan still draws.
  const planNotes = buildPlan(layout, result ?? undefined, runSections, widthFt).notes
  const selectCls = 'w-full border border-gray-300 rounded-lg px-3 h-11 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
  const counted = result?.counted

  return (
    <div className="space-y-3" data-layout-editor>
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
          aerial={onPhoto ? { href: photo!, ftPerPx: aerialFtPerPx(aerial!.halfM), sizePx: AERIAL_PX } : null}
          // Dragging only moves the drawing; on the plain plan it holds until a length changes.
          onPointsChange={pts => onChange({ ...layout, plan: { ...(layout.plan ?? {}), points: pts, pointsFor: onPhoto ? null : layoutSignature(layout) } })}
          pins={pins}
          onPinTap={onPinTap}
        />
        {photo && photoReady !== photo && !aerialMsg && (
          <p className="absolute inset-x-0 top-8 mx-auto w-fit bg-white/90 rounded-lg px-3 py-1.5 text-sm text-gray-700 shadow">Loading the aerial photo. It can take 20 seconds.</p>
        )}
      </div>
      {planNotes.map((n, k) => <p key={k} className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2" data-plan-note>{n}</p>)}
      <p className="text-xs text-gray-600 -mt-1">Tap a side on the plan to change it.{onPhoto ? ' Drag the corners onto the yard; the center button moves the whole plan.' : ' Drag a corner to match an odd yard; footage and price stay as typed.'}</p>
      <div className="flex flex-wrap items-center gap-2" data-aerial>
        {!aerialOn ? (
          <>
            <input className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 h-11 text-sm" placeholder="Property address for the aerial photo"
              value={aerialAddress} onChange={e => setAerialAddress(e.target.value)} data-aerial-address />
            <button type="button" className="btn btn-secondary" onClick={showAerial} data-aerial-show><ImageIcon size={18} aria-hidden="true" /> Show aerial photo</button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setAerialOn(false)} data-aerial-hide>Hide aerial photo</button>
        )}
        {layout.plan?.points && (
          <button type="button" className="btn btn-quiet btn-sm" data-plan-reset onClick={() => onChange({ ...layout, plan: { ...(layout.plan ?? {}), points: aerialOn ? centeredVertices(layout) : null, pointsFor: null } })}>Reset the drawing</button>
        )}
        {aerialMsg && <p className="w-full text-sm text-amber-800">{aerialMsg}</p>}
      </div>
      {aerialOn && <p className="text-xs text-gray-500 -mt-1">Aerial photo: USGS National Map (NAIP), public domain.</p>}

      {layout.sides.map((s, i) => {
        const r = result?.sides[i]
        const startJoined = joinedFromPrev(layout, i)
        const endJoined = joinsNext(layout, i)
        const prevOn = neighbor(i, -1) !== null && layout.sides[neighbor(i, -1)!].on
        const nextOn = neighbor(i, 1) !== null && layout.sides[neighbor(i, 1)!].on
        const startF = r?.finishes.start ?? s.startFinish
        const endF = r?.finishes.end ?? s.endFinish
        const runsHere = sideRuns.get(s.id) ?? []
        const finishSelect = (which: 'start' | 'end', value: EndFinish, canCorner: boolean, joined: boolean) => (
          <select className={selectCls} value={value} onChange={e => setFinish(i, which, e.target.value as EndFinish)} data-finish={which}>
            {canCorner && <option value="corner">Corner{joined || canCorner ? ` (joins ${neighborName(layout, i, which)})` : ''}</option>}
            {(['house', 'existing', 'free'] as EndFinish[]).map(f => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
          </select>
        )
        return (
          <div key={s.id} className={`rounded-2xl border bg-white p-3 sm:p-4 scroll-mt-24 ${s.on ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50'}`} data-side={s.name} data-side-id={s.id}>
            <div className="flex items-center gap-2">
              <button type="button" role="switch" aria-checked={s.on} aria-label={`${s.name} ${s.on ? 'on' : 'off'}`} onClick={() => toggleSide(i)}
                className="shrink-0 w-14 h-12 grid place-items-center rounded-lg" data-side-toggle>
                <span className={`relative block w-12 h-7 rounded-full transition-colors ${s.on ? 'bg-orange-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.on ? 'translate-x-5' : ''}`} />
                </span>
              </button>
              {renaming === s.id ? (
                <input autoFocus defaultValue={s.name} className="flex-1 min-w-0 border border-orange-300 rounded-lg px-2 h-10 text-base font-semibold"
                  onBlur={e => { updateSide(s.id, { name: e.target.value.trim() || s.name }); setRenaming(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              ) : (
                <p className={`flex-1 min-w-0 text-base font-semibold truncate ${s.on ? 'text-gray-900' : 'text-gray-500'}`}>{s.name}{!s.on && <span className="font-normal text-sm"> · off</span>}</p>
              )}
              <button type="button" className="btn btn-quiet btn-icon" aria-label={`Rename ${s.name}`} onClick={() => setRenaming(s.id)}><Pencil size={18} aria-hidden="true" /></button>
              <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove ${s.name}`} onClick={() => removeSide(i)}><Trash2 size={18} aria-hidden="true" /></button>
            </div>

            {s.on && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                <button type="button" onClick={() => setPad({ sideId: s.id, field: 'length' })} data-side-length
                  className={`flex-1 min-w-0 h-14 rounded-xl border-2 text-left px-4 flex items-center justify-between ${s.lengthIn > 0 ? 'border-gray-300' : 'border-orange-400 bg-orange-50'}`}>
                  <span className={`text-2xl font-bold tabular-nums ${s.lengthIn > 0 ? 'text-gray-900' : 'text-orange-700 text-base'}`}>{s.lengthIn > 0 ? formatFtIn(s.lengthIn) : 'Tap to enter the length'}</span>
                  <span className="text-xs text-gray-500">{s.gate ? 'measure across the gate' : 'end to end'}</span>
                </button>
                {onVoiceSide && (
                  <button type="button" className="shrink-0 w-14 h-14 rounded-xl border-2 border-orange-300 bg-white grid place-items-center text-orange-700" aria-label={`Say the ${s.name.toLowerCase()}`}
                    onClick={() => onVoiceSide(s.name)} data-side-mic><Mic size={22} aria-hidden="true" /></button>
                )}
                </div>

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

                <div>
                  <span className="text-xs text-gray-600 mb-1 block">Gate on this side?</span>
                  <div className="grid grid-cols-3 gap-1 bg-gray-100 rounded-xl p-1" data-gate-choice>
                    {([null, 'walk', 'double'] as Array<GateType | null>).map(t => (
                      <button key={t ?? 'none'} type="button"
                        onClick={() => updateSide(s.id, { gate: t ? { type: t, widthIn: s.gate?.type === t ? s.gate.widthIn : GATE_WIDTH_IN[t], position: s.gate?.position ?? 'middle', distanceIn: s.gate?.distanceIn } : null })}
                        className={`h-11 rounded-lg text-sm font-semibold ${(s.gate?.type ?? null) === t ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600'}`}>
                        {t ? GATE_LABEL[t] : 'No gate'}
                      </button>
                    ))}
                  </div>
                  {s.gate && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button type="button" onClick={() => setPad({ sideId: s.id, field: 'gateWidth' })} className="h-11 rounded-lg border border-gray-300 px-3 text-left text-sm" data-gate-width>
                        <span className="text-gray-600">Width </span><span className="font-semibold text-gray-900">{formatFtIn(s.gate.widthIn)}</span>
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
                        <option value="distance">{s.gate.position === 'distance' ? `${formatFtIn(s.gate.distanceIn ?? 0)} from the start` : 'Type a distance from the start'}</option>
                      </select>
                    </div>
                  )}
                </div>

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

                {runsHere.length > 0 && (
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
              </div>
            )}
          </div>
        )
      })}

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

      {pad && padSide && (
        <FtInPad
          key={`${pad.sideId}-${pad.field}`}
          title={pad.field === 'length' ? `${padSide.name} length` : pad.field === 'gateWidth' ? `${padSide.name} gate width` : pad.field === 'skipLength' ? `${padSide.name} skip length` : pad.field === 'meetDistance' ? `${padSide.name}: meets the house this far from its back corner` : `${padSide.name}: distance from the start`}
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
