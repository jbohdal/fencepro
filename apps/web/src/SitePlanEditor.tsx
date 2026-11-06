/**
 * The office site plan editor (Jonathan, Nov 5 2026): the job's fence drawn
 * exactly, on the job's aerial photo at true scale, after the sale. Owner and
 * office edit; the Salesman reads her own; the installer never opens it.
 *
 * The plan (sitePlanData.ts) is read from and saved to the server
 * (sitePlanApi.ts); every save is a revision. Moves are pure (sitePlanEdit.ts).
 * A quote's price changes only through the quote builder (planQuoteChange.ts):
 * "Use the drawn length", a count to match the plan, and a change order from
 * the plan all open the builder, and the plan records the answer once the
 * server has the quote or the change order.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, X } from 'lucide-react'
import { autoTile, tileXY, AERIAL_MAX_ZOOM } from './aerialTiles'
import { mercatorFtPerPx } from './sitePlanPhoto'
import {
  toFeet, fromFeet, drawnFt, planFlags, openFlags, propertyLineWarnings, postOf, withPending, applyChange, planId, DEFAULT_FLAG_SETTINGS,
  type LatLng, type SitePlanData, type SiteSide, type SiteGate, type PlanFlag, type FlagAnswer, type PendingChange,
} from './sitePlanData'
import {
  historyOf, historyPush, historyReplace, historyUndo, historyRedo, movePost, setSideLength, snapSquare, snapEdges, snapToEdges,
  movePlan, turnPlan, planCenter, addSide, removeSide, addGate, removeGate, editGate, gatePlace, houseRect, moveHouseCorner,
  placeSurvey, scaleSurvey, moveSurvey, turnSurvey, surveyToFeet, feetToSurvey, sideFeetEdit, gateEdit, sideLabel, postFeet,
  fenceNowYard, type History, type Pt, type GateInput,
} from './sitePlanEdit'
import { getSitePlan, saveSitePlan, markSitePlanDone, reopenSitePlan, fetchParcel, uploadSurvey, makePermitSheet, serverUrl, type SitePlanRecord } from './sitePlanApi'
import { openPlanChange, type PlanQuoteChange } from './planQuoteChange'
import type { WalkList } from './walkList'
import type { YardLayout } from './yardLayout'
import { whenSaved } from './outbox'
import { refreshQuotes } from './quoteStore'
import { refreshJobs } from './jobStore'
import { currentUser } from './crmAuth'
import { useBackLayer, useLeaveWarning } from './nav'
import { toast } from './toast'
import { openCrewPacket } from './installPacket'
import type { ChangeOrder } from './ChangeOrders'

const LEAVE = 'Leave the site plan without saving?\n\nThe changes since the last save will be lost.'
const PURPLE = '#6d28d9', RED = '#dc2626', ORANGE = '#f97316'
const ft1 = (n: number) => `${Math.round(n * 10) / 10} ft`
const myName = () => { const u = currentUser(); return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || 'Office' }
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

type Tool = 'select' | 'addSide' | 'houseRect' | 'housePoints' | 'surveyScale' | 'surveyMove'
type Sel = { kind: 'post'; id: string } | { kind: 'side'; id: string } | { kind: 'house'; i: number } | null
type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean }
  | { kind: 'post'; id: string; moved: boolean; sx: number; sy: number }
  | { kind: 'all'; last: Pt; moved: boolean }
  | { kind: 'turn'; center: Pt; a0: number; plan0: SitePlanData; moved: boolean }
  | { kind: 'house'; i: number; last: Pt; moved: boolean }
  | { kind: 'houseCorner'; i: number; c: number; moved: boolean }
  | { kind: 'survey'; last: Pt; moved: boolean }
  | { kind: 'rect'; a: Pt; b: Pt }
  | { kind: 'click'; sx: number; sy: number; at: Pt; postId?: string }

export default function SitePlanEditor({ jobId, record, plan: startPlan, fresh, onClose }: {
  jobId: string
  record: SitePlanRecord
  plan: SitePlanData
  /** Made from the quote just now: not saved yet. */
  fresh: boolean
  onClose: () => void
}) {
  const [rec, setRec] = useState(record)
  const [hist, setHist] = useState<History<SitePlanData>>(() => historyOf(startPlan))
  const plan = hist.now
  const [savedJson, setSavedJson] = useState(() => (fresh ? '' : JSON.stringify(startPlan)))
  // The crew notes box is put on the plan when it is left; until then it counts as unsaved too.
  const [notes, setNotes] = useState(startPlan.notes)
  useEffect(() => { setNotes(plan.notes) }, [plan.notes])
  const dirty = JSON.stringify(plan) !== savedJson || notes !== plan.notes
  const canEdit = rec.canEdit
  const settings = { ...DEFAULT_FLAG_SETTINGS, ...rec.settings }
  // The plan is checked against the job's fence now (the signed quote with its approved and signed change orders), never
  // the quote as first signed: a gate a signed change order added is the fence, not a question.
  const quoteYard = useMemo(() => fenceNowYard(rec), [rec.current?.yard, rec.quote?.layout])  // eslint-disable-line react-hooks/exhaustive-deps
  const flags = useMemo(() => planFlags(plan, quoteYard, settings), [plan, quoteYard, settings.tolFt, settings.tolPct])  // eslint-disable-line react-hooks/exhaustive-deps
  const open = openFlags(plan, flags)
  const openKeys = new Set(open.map(f => f.key))
  const lineWarnings = useMemo(() => propertyLineWarnings(plan, rec.settings.setbackFt || 0), [plan, rec.settings.setbackFt])
  const edges = useMemo(() => snapEdges(plan), [plan])

  // ── Window, leave warning ──
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const close = useCallback(() => { if (!dirtyRef.current || window.confirm(LEAVE)) onClose() }, [onClose])
  useBackLayer(onClose, { key: 'site-plan', guard: () => !dirtyRef.current || window.confirm(LEAVE) })
  useLeaveWarning(() => dirtyRef.current)

  // ── The view: feet at the middle, pixels per foot ──
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 640 }))
    ro.observe(el)
    setSize({ w: el.clientWidth || 900, h: el.clientHeight || 640 })
    return () => ro.disconnect()
  }, [])
  const [view, setView] = useState({ cx: 0, cy: 0, k: 3 })
  const [linesShown, setLinesShown] = useState(true)
  const fit = useCallback(() => {
    // The fence (its posts, so its gates too) and the house, with room around: never the whole parcel.
    const pts = [...withPending(plan).posts, ...plan.house.flat()].map(p => toFeet(plan.origin, p))
    if (!pts.length) { setView({ cx: 0, cy: 0, k: 3 }); return }
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const w = Math.max(40, Math.max(...xs) - Math.min(...xs)), h = Math.max(40, Math.max(...ys) - Math.min(...ys))
    const pad = Math.min(140, size.w * 0.15, size.h * 0.15) * 2
    const k = Math.min(30, Math.max(0.4, Math.min((size.w - pad) / w, (size.h - pad) / h)))
    setView({ cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, k })
  }, [plan, size.w, size.h])
  const fitted = useRef(false)
  useEffect(() => { if (!fitted.current && size.w > 100) { fitted.current = true; fit() } }, [fit, size.w])
  const toScreen = (f: Pt): Pt => ({ x: size.w / 2 + (f.x - view.cx) * view.k, y: size.h / 2 - (f.y - view.cy) * view.k })
  const toWorld = (sx: number, sy: number): Pt => ({ x: view.cx + (sx - size.w / 2) / view.k, y: view.cy - (sy - size.h / 2) / view.k })
  const at = (ll: LatLng) => toScreen(toFeet(plan.origin, ll))
  const zoomBy = (f: number, sx = size.w / 2, sy = size.h / 2) => setView(v => {
    const k = Math.min(40, Math.max(0.3, v.k * f))
    const wx = v.cx + (sx - size.w / 2) / v.k, wy = v.cy - (sy - size.h / 2) / v.k
    return { k, cx: wx - (sx - size.w / 2) / k, cy: wy + (sy - size.h / 2) / k }
  })
  // The wheel zooms about the pointer (a passive listener cannot stop the page scrolling).
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const h = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top) }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  })

  // ── The aerial photo: map tiles at true scale (zoom 19 at most, enlarged past it) ──
  const tiles = useMemo(() => {
    const z0 = Math.log2(mercatorFtPerPx(plan.origin.lat, 0) * view.k)
    const z = Math.max(14, Math.min(AERIAL_MAX_ZOOM, Math.ceil(z0)))
    const fpp = mercatorFtPerPx(plan.origin.lat, z), tileFt = 256 * fpp
    const o = tileXY(plan.origin.lat, plan.origin.lng, z)
    const tl = { x: view.cx - size.w / 2 / view.k, y: view.cy + size.h / 2 / view.k }, br = { x: view.cx + size.w / 2 / view.k, y: view.cy - size.h / 2 / view.k }
    const x0 = Math.floor(o.x + tl.x / tileFt), x1 = Math.floor(o.x + br.x / tileFt)
    const y0 = Math.floor(o.y - tl.y / tileFt), y1 = Math.floor(o.y - br.y / tileFt)
    const out: Array<{ key: string; href: string; x: number; y: number; s: number }> = []
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 160) return out
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      out.push({ key: `${z}/${tx}/${ty}`, href: autoTile(z, tx, ty), x: (tx - o.x) * tileFt, y: -(ty - o.y) * tileFt, s: tileFt })
    }
    return out
  }, [plan.origin.lat, plan.origin.lng, view, size.w, size.h])

  // ── Changes ──
  const push = useCallback((f: (p: SitePlanData) => SitePlanData) => setHist(h => historyPush(h, f(h.now))), [])
  const [sel, setSel] = useState<Sel>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [addFrom, setAddFrom] = useState<string | Pt | null>(null)
  const [housePts, setHousePts] = useState<Pt[]>([])
  const [scalePts, setScalePts] = useState<Pt[]>([])
  const [scaleFt, setScaleFt] = useState('')
  const [snapNote, setSnapNote] = useState('')
  const drag = useRef<Drag | null>(null)
  const [rectNow, setRectNow] = useState<{ a: Pt; b: Pt } | null>(null)
  const undo = () => setHist(historyUndo)
  const redo = () => setHist(historyRedo)
  const pickTool = (t: Tool) => { setTool(t); setAddFrom(null); setHousePts([]); setScalePts([]); setScaleFt('') }

  // Selection that no longer exists (an undo took it away) is dropped.
  useEffect(() => {
    if (sel?.kind === 'post' && !postOf(plan, sel.id)) setSel(null)
    if (sel?.kind === 'side' && !plan.sides.some(s => s.id === sel.id)) setSel(null)
    if (sel?.kind === 'house' && !plan.house[sel.i]) setSel(null)
  }, [plan, sel])

  // Keys: undo/redo, nudge the selected post, Escape, Delete.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (away || typing(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (!canEdit) return; if (e.shiftKey) redo(); else undo(); return }
      if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); if (canEdit) redo(); return }
      if (e.key === 'Escape') { pickTool('select'); return }
      if (!canEdit) return
      const step = e.shiftKey ? 5 : 0.5
      const d = e.key === 'ArrowLeft' ? { x: -step, y: 0 } : e.key === 'ArrowRight' ? { x: step, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: step } : e.key === 'ArrowDown' ? { x: 0, y: -step } : null
      if (d && sel?.kind === 'post') {
        e.preventDefault()
        push(p => { const f = postFeet(p, sel.id); return f ? movePost(p, sel.id, { x: f.x + d.x, y: f.y + d.y }) : p })
      } else if (d && sel?.kind === 'house') {
        e.preventDefault()
        push(p => ({ ...p, house: p.house.map((r, i) => (i === sel.i ? r.map(c => { const f = toFeet(p.origin, c); return fromFeet(p.origin, { x: f.x + d.x, y: f.y + d.y }) }) : r)) }))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  // ── Pointer ──
  const svgRef = useRef<SVGSVGElement>(null)
  const local = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top } }
  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation()
    drag.current = d
    svgRef.current?.setPointerCapture(e.pointerId)
  }
  function onBackgroundDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const { sx, sy } = local(e)
    const w = toWorld(sx, sy)
    if (canEdit && tool === 'houseRect') { begin(e, { kind: 'rect', a: w, b: w }); setRectNow({ a: w, b: w }); return }
    if (canEdit && tool === 'surveyMove' && plan.survey) { begin(e, { kind: 'survey', last: w, moved: false }); return }
    if (canEdit && (tool === 'addSide' || tool === 'housePoints' || tool === 'surveyScale')) { begin(e, { kind: 'click', sx, sy, at: w }); return }
    begin(e, { kind: 'pan', sx, sy, cx: view.cx, cy: view.cy, moved: false })
  }
  function onPostDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return
    const { sx, sy } = local(e)
    if (canEdit && tool === 'addSide') { begin(e, { kind: 'click', sx, sy, at: toWorld(sx, sy), postId: id }); return }
    if (tool !== 'select') { onBackgroundDown(e); return }
    setSel({ kind: 'post', id })
    if (canEdit) begin(e, { kind: 'post', id, moved: false, sx, sy })
    else e.stopPropagation()
  }
  function onSideDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return
    if (tool !== 'select') { onBackgroundDown(e); return }
    e.stopPropagation()
    setSel({ kind: 'side', id })
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const { sx, sy } = local(e)
    const w = toWorld(sx, sy)
    if (d.kind === 'pan') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return
      d.moved = true
      setView(v => ({ ...v, cx: d.cx - (sx - d.sx) / v.k, cy: d.cy + (sy - d.sy) / v.k }))
    } else if (d.kind === 'post') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return
      let p = w, note = ''
      if (!e.shiftKey) {
        const sq = snapSquare(plan, d.id, p, 4, 14 / view.k)
        if (sq.held) { p = sq.at; note = 'Square to the side next to it' }
        const ed = snapToEdges(p, edges, Math.max(1.5, 8 / view.k))
        if (ed.held) { p = ed.at; note = 'On the property line or the house' }
      }
      setSnapNote(note)
      const first = !d.moved
      d.moved = true
      setHist(h => (first ? historyPush(h, movePost(h.now, d.id, p)) : historyReplace(h, movePost(h.now, d.id, p))))
    } else if (d.kind === 'all' || d.kind === 'house' || d.kind === 'survey') {
      const dd = { x: w.x - d.last.x, y: w.y - d.last.y }
      d.last = w
      const first = !d.moved
      d.moved = true
      const f = (p: SitePlanData): SitePlanData => d.kind === 'all' ? movePlan(p, dd)
        : d.kind === 'survey' ? (p.survey ? { ...p, survey: moveSurvey(p.origin, p.survey, dd) } : p)
          : { ...p, house: p.house.map((r, i) => (i === d.i ? r.map(c => { const q = toFeet(p.origin, c); return fromFeet(p.origin, { x: q.x + dd.x, y: q.y + dd.y }) }) : r)) }
      setHist(h => (first ? historyPush(h, f(h.now)) : historyReplace(h, f(h.now))))
    } else if (d.kind === 'houseCorner') {
      const first = !d.moved
      d.moved = true
      setHist(h => (first ? historyPush(h, moveHouseCorner(h.now, d.i, d.c, w)) : historyReplace(h, moveHouseCorner(h.now, d.i, d.c, w))))
    } else if (d.kind === 'turn') {
      const a = Math.atan2(w.y - d.center.y, w.x - d.center.x)
      let deg = (-(a - d.a0) * 180) / Math.PI
      if (!e.shiftKey) deg = Math.round(deg)
      const first = !d.moved
      d.moved = true
      const next = turnPlan(d.plan0, deg, d.center)
      setSnapNote(`Turned ${Math.round(deg * 10) / 10}°`)
      setHist(h => (first ? historyPush(h, next) : historyReplace(h, next)))
    } else if (d.kind === 'rect') {
      d.b = w
      setRectNow({ a: d.a, b: w })
    }
  }
  function onUp(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    setSnapNote('')
    if (!d) return
    try { svgRef.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    if (d.kind === 'pan' && !d.moved && tool === 'select') setSel(null)
    if (d.kind === 'rect') {
      setRectNow(null)
      if (Math.abs(d.b.x - d.a.x) > 3 && Math.abs(d.b.y - d.a.y) > 3) {
        push(p => ({ ...p, house: [...p.house, houseRect(p.origin, d.a, d.b)] }))
        setSel({ kind: 'house', i: plan.house.length })
        pickTool('select')
      }
    }
    if (d.kind === 'click') {
      const { sx, sy } = local(e)
      if (Math.hypot(sx - d.sx, sy - d.sy) > 5) return
      mapClick(d.at, d.postId)
    }
  }
  function mapClick(w: Pt, postId?: string) {
    if (tool === 'addSide') {
      const target: string | Pt = postId ?? w
      if (addFrom == null) { setAddFrom(target); return }
      const before = plan
      const next = addSide(before, addFrom, target)
      if (next === before) return
      push(() => next)
      const made = next.sides[next.sides.length - 1]
      setSel({ kind: 'side', id: made.id })
      setAddFrom(made.b)
    } else if (tool === 'housePoints') {
      if (housePts.length >= 3 && Math.hypot(w.x - housePts[0].x, w.y - housePts[0].y) * view.k < 12) { finishHouse(); return }
      setHousePts(ps => [...ps, w])
    } else if (tool === 'surveyScale' && plan.survey) {
      if (scalePts.length >= 2) return
      setScalePts(ps => [...ps, feetToSurvey(plan.origin, plan.survey!, w)])
    }
  }
  function finishHouse() {
    if (housePts.length < 3) return
    const ring = housePts.map(p => fromFeet(plan.origin, p))
    push(p => ({ ...p, house: [...p.house, ring] }))
    setSel({ kind: 'house', i: plan.house.length })
    pickTool('select')
  }

  // ── Save, revisions, done ──
  const [saveNote, setSaveNote] = useState('')
  const [busy, setBusy] = useState('')
  const [conflict, setConflict] = useState<{ plan: SitePlanData | null; revision: number; by?: string; at?: string; error: string } | null>(null)
  const [doneRefused, setDoneRefused] = useState<string[] | null>(null)
  const reload = useCallback(async () => {
    const r = await getSitePlan(jobId)
    if (r.ok) setRec(r.data)
    return r
  }, [jobId])
  async function save(given?: SitePlanData, note = saveNote): Promise<boolean> {
    let p = given ?? plan
    if (!given && notes !== plan.notes) { p = { ...plan, notes }; setHist(h => historyPush(h, p)) }
    setBusy('save')
    const r = await saveSitePlan(jobId, p, recRef.current.revision, note)
    setBusy('')
    if (r.ok) {
      setSavedJson(JSON.stringify(p))
      setSaveNote('')
      setRec(x => ({ ...x, revision: r.data.revision, updatedAt: r.data.updatedAt }))
      void reload()
      toast.success('Site plan saved', `Revision ${r.data.revision}`)
      return true
    }
    if (r.status === 409) {
      const cur = r.json?.current ?? null
      const last = [...((cur?.revisions as SitePlanRecord['revisions'] | undefined) ?? [])].sort((x, y) => y.revision - x.revision)[0]
      setConflict({ plan: cur?.plan ?? (cur?.posts ? cur : null), revision: Number(cur?.revision ?? 0), by: last?.by, at: last?.at ?? cur?.updatedAt, error: r.error })
      return false
    }
    toast.error('Not saved', r.error)
    return false
  }
  function loadTheirs() {
    if (!conflict) return
    if (conflict.plan) { setHist(historyOf(conflict.plan)); setSavedJson(JSON.stringify(conflict.plan)) }
    setRec(x => ({ ...x, revision: conflict.revision }))
    setConflict(null)
    void reload().then(r => { if (r.ok && r.data.plan) { setHist(historyOf(r.data.plan)); setSavedJson(JSON.stringify(r.data.plan)) } })
  }
  /** "Site plan needed" on the job window and the board follows the done mark at once (the quote's layout.planDone). */
  async function afterDone() {
    await refreshQuotes()
    await refreshJobs()
  }
  async function markDone() {
    setBusy('done')
    const r = await markSitePlanDone(jobId, rec.revision)
    setBusy('')
    if (r.ok) { setDoneRefused(null); await reload(); await afterDone(); toast.success('Plan marked done', 'Site plan needed is off for this job.'); return }
    if (r.status === 409 && Array.isArray(r.json?.open)) { setDoneRefused(r.json.open.map(String)); return }
    toast.error('Not marked done', r.error)
  }
  async function reopen() {
    setBusy('done')
    const r = await reopenSitePlan(jobId)
    setBusy('')
    if (r.ok) { await reload(); await afterDone(); toast.info('Plan reopened', 'Site plan needed is on again until it is marked done.'); return }
    toast.error('Not reopened', r.error)
  }
  const newest = [...rec.revisions].sort((x, y) => y.revision - x.revision)[0]
  const reopenedWhy = !rec.doneAt && newest?.note?.includes('The plan needs another look:') ? `Reopened ${when(newest.at)}: ${newest.note.slice(newest.note.indexOf('The plan needs another look:'))}` : ''
  const doneWhy = !canEdit ? 'Your login reads the plan only.' : dirty ? 'Save the plan first.' : open.length ? `Answer the ${open.length} question${open.length === 1 ? '' : 's'} under Quoted against drawn first.` : rec.revision < 1 ? 'Save the plan first.' : ''

  // ── Answers and changes through the quote builder ──
  const [away, setAway] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [waiting, setWaiting] = useState('')
  const [keepNote, setKeepNote] = useState<Record<string, string>>({})
  const answer = (key: string, a: Omit<FlagAnswer, 'by' | 'at'>) => push(p => ({ ...p, answers: { ...p.answers, [key]: { ...a, by: myName(), at: new Date().toISOString() } } }))
  const planRef = useRef(plan)
  planRef.current = plan
  const recRef = useRef(rec)
  recRef.current = rec

  /** Open the builder for a change; `done` runs once the server has the saved quote or the change order. */
  async function throughBuilder(title: string, edit: PlanQuoteChange['edit'], done: (how: { quote?: boolean; co?: ChangeOrder }) => SitePlanData | null, check?: (layout: unknown) => boolean, reason?: string) {
    const quoteId = rec.quote?.id
    if (!quoteId) { toast.error('No quote', 'This job has no quote to change.'); return }
    let saved: { quote?: { id: string }; changeOrder?: ChangeOrder } | null = null
    const change: PlanQuoteChange = {
      title, edit, reason: reason ?? `From the site plan: ${title}.`,
      onSaved: r => { saved = r },
      onClosed: () => {
        setAway(false)
        const s = saved
        if (!s) return
        if (s.changeOrder) {
          const next = done({ co: s.changeOrder })
          if (next) { setHist(h => historyPush(h, next)); void save(next, `Change order CO-${s.changeOrder.number}: ${title}`) }
          return
        }
        if (s.quote) {
          setWaiting('Saving the quote… the plan records the answer once the server has it.')
          void whenSaved(`quote:${s.quote.id}`, 60_000).then(async ok => {
            const r = ok ? await getSitePlan(jobId) : null
            setWaiting('')
            if (!r || !r.ok) { toast.error('Answer not recorded', 'The quote save has not reached the server yet. When it has, answer the question again.'); return }
            setRec(x => ({ ...x, quote: r.data.quote, current: r.data.current }))
            if (check && !check(r.data.quote?.layout)) { toast.error('Answer not recorded', 'The saved quote does not have the change. Open the quote to check it, then answer again.'); return }
            const next = done({ quote: true })
            if (next) { setHist(h => historyPush(h, next)); void save(next, `Quote saved: ${title}`) }
          })
        }
      },
    }
    setAway(true)
    const ok = await openPlanChange(quoteId, change)
    if (!ok) { setAway(false); toast.error('The quote did not load', 'Try again when you have signal.') }
  }

  function takeDrawn(f: PlanFlag) {
    const side = f.sideId ? plan.sides.find(s => s.id === f.sideId) : null
    if (f.kind === 'length' && side) {
      const drawnIn = Math.round(drawnFt(plan, side) * 12)
      const feet = Math.round((drawnIn / 12) * 100) / 100
      const title = `${side.name} to the drawn ${ft1(feet)} (quoted ${ft1(side.quotedFt ?? 0)})`
      void throughBuilder(title, sideFeetEdit(side, drawnIn), how => {
        const p = planRef.current
        const s = p.sides.find(x => x.id === side.id)
        if (!s) return null
        const note = how.co ? `Change order CO-${how.co.number}` : `Quote repriced at ${ft1(feet)}`
        return {
          ...p,
          // Unsigned: the quote now says the drawn feet. Signed: the change order carries them.
          sides: how.quote ? p.sides.map(x => (x.id === s.id ? { ...x, quotedFt: feet } : x)) : p.sides,
          answers: { ...p.answers, [f.key]: { kind: 'drawn', note, by: myName(), at: new Date().toISOString() } },
        }
      }, layout => quoteSideFeetIs(layout, side, drawnIn))
      return
    }
    // A count (sides, gates, tees, closes): the office makes the quote match the plan in the builder.
    void throughBuilder(`make the quote match the plan. ${f.text}`, null, how => {
      const p = planRef.current
      const note = how.co ? `Change order CO-${how.co.number}` : 'Quote changed to match the plan'
      return { ...p, answers: { ...p.answers, [f.key]: { kind: 'drawn', note, by: myName(), at: new Date().toISOString() } } }
    })
  }

  /**
   * A change order from the plan (signed job): a gate here, or this side longer. The builder opens on the job as it is
   * now (every change order before this one in it) with this change put on its walk list or drawing; its own Make
   * change order makes the change order. The plan's posts and gates do not change: the change waits on the plan
   * (pending, drawn dashed) until the change order is signed or approved, and goes when it is voided (the server).
   */
  function coGate(side: SiteSide, g: GateInput) {
    const shown = withPending(plan), sideNow = shown.sides.find(x => x.id === side.id) ?? side
    const where = gatePlace(shown, sideNow, g)
    if ('error' in where) { toast.error('Gate not placed', where.error); return }
    const quotedLen = sideNow.quotedFt ?? drawnFt(shown, sideNow)
    const atIn = Math.round((g.fromEnd === 'a' ? g.distFt : quotedLen - g.distFt - g.widthFt) * 12)
    const what = `add a ${ft1(g.widthFt)} ${g.type === 'double' ? 'double' : 'single'} gate in ${side.name}, ${ft1(g.distFt)} from the corner at its ${g.fromEnd === 'a' ? 'start' : 'end'}`
    const gate: SiteGate = { id: planId('g'), atFt: where.atFt, widthFt: g.widthFt, type: g.type, swing: g.swing, hinge: g.type === 'double' ? null : g.hinge ?? 'left' }
    void throughBuilder(what, gateEdit(side, atIn, { widthIn: g.widthFt * 12, type: g.type, swing: g.swing, hinge: g.hinge }), how => {
      if (!how.co) return null
      return withChangeOrder(planRef.current, how.co, { id: planId('c'), coId: how.co.id, coNumber: how.co.number ?? null, kind: 'gate', sideId: side.id, gate, by: myName(), at: new Date().toISOString() })
    }, undefined, `From the site plan: ${what}.`)
  }
  function coLonger(side: SiteSide, feet: number) {
    const shown = withPending(plan), sideNow = shown.sides.find(x => x.id === side.id) ?? side
    const now = sideNow.quotedFt ?? drawnFt(shown, sideNow)
    if (!(feet > now)) { toast.error('Not longer', `Type more than ${ft1(now)}.`); return }
    const what = `make ${side.name} longer, ${ft1(now)} to ${ft1(feet)}`
    void throughBuilder(what, sideFeetEdit(side, Math.round(feet * 12)), how => {
      if (!how.co) return null
      return withChangeOrder(planRef.current, how.co, { id: planId('c'), coId: how.co.id, coNumber: how.co.number ?? null, kind: 'longer', sideId: side.id, newFt: feet, by: myName(), at: new Date().toISOString() })
    }, undefined, `From the site plan: ${what}.`)
  }

  // ── Property lines ──
  const [parcelNote, setParcelNote] = useState('')
  async function showLines() {
    setBusy('lines')
    const r = await fetchParcel(plan.origin, rec.job.county)
    setBusy('')
    setLinesShown(true)
    if (!r.ok) { setParcelNote(r.error); return }
    const { parcel, neighbors, source, note } = r.data
    if (!parcel) { setParcelNote(note || `No property lines for ${rec.job.county ? `${rec.job.county} County` : 'this address'}. The plan works without them.`); push(p => ({ ...p, neighbors: neighbors ?? [] })); return }
    setParcelNote(note || '')
    push(p => ({ ...p, parcel: { ...parcel, source: parcel.source || source, fetchedAt: parcel.fetchedAt || new Date().toISOString() }, neighbors: neighbors ?? [] }))
  }

  // ── Survey ──
  const fileRef = useRef<HTMLInputElement>(null)
  async function onSurveyFile(file: File | undefined) {
    if (!file) return
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)) { toast.error('Not a survey file', 'Upload a PDF, a JPEG or a PNG.'); return }
    setBusy('survey')
    const r = await uploadSurvey(jobId, file)
    setBusy('')
    if (!r.ok) { toast.error('Survey not uploaded', r.error); return }
    push(p => ({ ...p, survey: placeSurvey(p.origin, r.data, planCenter(p), 200) }))
    pickTool('surveyScale')
    toast.info('Survey uploaded', 'Set its scale: click two points on it that you know the feet between, then type the feet.')
  }
  function applyScale() {
    const n = Number(scaleFt)
    if (!plan.survey || scalePts.length < 2 || !(n > 0)) return
    const s = scaleSurvey(plan.origin, plan.survey, scalePts[0], scalePts[1], n)
    if (!s) { toast.error('Scale not set', 'Click two points farther apart on the survey.'); return }
    push(p => ({ ...p, survey: s }))
    pickTool('surveyMove')
  }

  // ── Sheets ──
  const [sheetSize, setSheetSize] = useState<'letter' | 'tabloid'>('letter')
  async function permitSheet(size: 'letter' | 'tabloid', aerial: boolean) {
    const w = window.open('', '_blank')
    setBusy('sheet')
    const r = await makePermitSheet(jobId, size, aerial)
    setBusy('')
    if (!r.ok) { w?.close(); toast.error('Permit sheet not made', r.error); return }
    // A new address each time: the browser never shows a sheet it kept from before (another size).
    const u = r.data.url || `/api/site-plans/${encodeURIComponent(jobId)}/permit-sheet.pdf`
    const url = serverUrl(`${u}${u.includes('?') ? '&' : '?'}v=${Date.now()}`)
    if (w) w.location.href = url
    else window.location.assign(url)
  }
  async function installerSheet() {
    const w = window.open('', '_blank')
    setBusy('packet')
    const url = await openCrewPacket(jobId)
    setBusy('')
    if (!url) { w?.close(); toast.error('Crew packet not made', 'Try again. If it keeps failing, make it from the job\'s packet section.'); return }
    if (w) w.location.href = url
    else window.location.assign(url)
  }


  // ── Drawing ──
  // Pending change orders, as the plan will be once each goes through: a gate's opening, a side's new end.
  const pendingShapes = useMemo(() => {
    const out: Array<{ id: string; line: [Pt, Pt] | null; label: Pt; text: string }> = []
    const shown = withPending(plan)
    // Each change order after the one before it on the same side: its own stretch, its own label line.
    const reach = new Map<string, number>(), count = new Map<string, number>()
    for (const c of plan.pending ?? []) {
      const side = shown.sides.find(x => x.id === c.sideId)
      const a = side && postOf(shown, side.a), b = side && postOf(shown, side.b)
      if (!side || !a || !b) continue
      const fa = toFeet(plan.origin, a), fb = toFeet(plan.origin, b), len = Math.hypot(fb.x - fa.x, fb.y - fa.y) || 1
      const along = (ft: number) => toScreen({ x: fa.x + ((fb.x - fa.x) * ft) / len, y: fa.y + ((fb.y - fa.y) * ft) / len })
      const name = c.coNumber ? `CO-${c.coNumber}` : 'Change order'
      const nth = count.get(c.sideId) ?? 0
      count.set(c.sideId, nth + 1)
      const dy = 20 + nth * 16
      if (c.kind === 'gate' && c.gate) {
        const p0 = along(c.gate.atFt), p1 = along(c.gate.atFt + c.gate.widthFt)
        out.push({ id: c.id, line: [p0, p1], label: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 + dy }, text: `${name}: ${ft1(c.gate.widthFt)} gate, not signed yet` })
      } else if (c.kind === 'longer' && c.newFt) {
        const base = plan.sides.find(x => x.id === c.sideId)
        const from = reach.get(c.sideId) ?? (base ? drawnFt(plan, base) : 0)
        reach.set(c.sideId, Math.max(from, c.newFt))
        const p0 = along(Math.min(from, c.newFt)), p1 = along(c.newFt)
        out.push({ id: c.id, line: [p0, p1], label: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 + dy }, text: `${name}: ${side.name} to ${ft1(c.newFt)}, not signed yet` })
      }
    }
    return out
  }, [plan, view, size.w, size.h])  // eslint-disable-line react-hooks/exhaustive-deps

  const center = planCenter(plan)
  const inside = center
  const selSide = sel?.kind === 'side' ? plan.sides.find(s => s.id === sel.id) ?? null : null
  const selPost = sel?.kind === 'post' ? postOf(plan, sel.id) ?? null : null
  const flaggedSides = new Set(open.filter(f => f.sideId).map(f => f.sideId!))
  const ringPath = (ring: LatLng[]) => ring.map((c, i) => { const s = at(c); return `${i ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}` }).join(' ') + ' Z'
  const bounds = (() => {
    const pts = [...plan.posts, ...plan.house.flat()].map(at)
    if (!pts.length) return null
    return { minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)), minY: Math.min(...pts.map(p => p.y)), maxY: Math.max(...pts.map(p => p.y)) }
  })()
  const scaleBar = (() => {
    const want = 120 / view.k
    const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500].find(n => n >= want) ?? 1000
    return { ft: nice, px: nice * view.k }
  })()
  const surveyMatrix = (() => {
    const s = plan.survey
    if (!s) return null
    const o = toScreen(surveyToFeet(plan.origin, s, { x: 0, y: 0 })), ux = toScreen(surveyToFeet(plan.origin, s, { x: 1, y: 0 })), uy = toScreen(surveyToFeet(plan.origin, s, { x: 0, y: 1 }))
    return `matrix(${ux.x - o.x} ${ux.y - o.y} ${uy.x - o.x} ${uy.y - o.y} ${o.x} ${o.y})`
  })()

  const content = (
    <div className={`fixed inset-0 z-[60] bg-white flex flex-col ${away ? 'hidden' : ''}`} data-site-plan-editor={jobId} role="dialog" aria-label="Site plan">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="min-w-0 flex-1 mr-2">
          <h2 className="text-base font-bold text-gray-900 leading-tight break-words"><span className="hidden xl:inline">Site plan · </span>{rec.job.customerName}</h2>
          <p className="text-xs text-gray-600 leading-tight break-words" title={rec.job.address}>{street(rec.job.address)}{rec.revision > 0 ? ` · Revision ${rec.revision}` : ' · Not saved yet'}{rec.doneAt ? ` · Done ${when(rec.doneAt)}${rec.doneBy ? ` by ${rec.doneBy}` : ''}` : ''}{dirty ? ' · Unsaved changes' : ''}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0" role="toolbar" aria-label="Tools">
            <ToolButton on={tool === 'select'} onClick={() => pickTool('select')} label="Select and move" short="Select" data="select" />
            <ToolButton on={tool === 'addSide'} onClick={() => pickTool('addSide')} label="Draw a side" short="Side" data="add-side" />
            <ToolButton on={tool === 'houseRect'} onClick={() => pickTool('houseRect')} label="House: drag a box" short="House box" data="house-rect" />
            <ToolButton on={tool === 'housePoints'} onClick={() => pickTool('housePoints')} label="House: click corners" short="House corners" data="house-points" />
            <button type="button" className="w-11 h-11 grid place-items-center rounded-lg border border-gray-300 bg-white disabled:opacity-30" disabled={!hist.past.length} onClick={undo} aria-label="Undo" title="Undo (Ctrl+Z)" data-site-plan-undo><Undo2 size={18} /></button>
            <button type="button" className="w-11 h-11 grid place-items-center rounded-lg border border-gray-300 bg-white disabled:opacity-30" disabled={!hist.future.length} onClick={redo} aria-label="Redo" title="Redo (Ctrl+Y)" data-site-plan-redo><Redo2 size={18} /></button>
          </div>
        )}
        {canEdit && (
          <>
            <input className="border border-gray-300 rounded-lg px-2 min-h-[44px] text-sm w-40 xl:w-56" placeholder="Note for this save (optional)" value={saveNote} onChange={e => setSaveNote(e.target.value)} data-site-plan-save-note />
            <button type="button" className="btn btn-primary min-h-[44px]" disabled={!dirty || busy === 'save'} onClick={() => void save()} data-site-plan-save>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          </>
        )}
        <button type="button" className="w-11 h-11 grid place-items-center rounded-lg border border-gray-300 bg-white" onClick={close} aria-label="Close the site plan" data-site-plan-close><X size={20} /></button>
      </div>

      {conflict && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-300 text-sm text-amber-950 flex flex-wrap items-center gap-3" data-site-plan-conflict>
          <span className="flex-1 min-w-[16rem]">Someone else saved this plan since you opened it{conflict.by ? ` (${conflict.by}${conflict.at ? `, ${when(conflict.at)}` : ''})` : ''}. Your changes were not saved.</span>
          <button type="button" className="btn btn-primary min-h-[44px]" onClick={loadTheirs} data-site-plan-load-theirs>Load theirs (drop mine)</button>
          <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => setConflict(null)} data-site-plan-keep-mine>Keep mine on screen</button>
        </div>
      )}
      {waiting && <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-sm text-blue-900" data-site-plan-waiting>{waiting}</div>}
      {/* A signed or approved change order put its change on a done plan and it no longer agrees: the server reopened it and says why. */}
      {reopenedWhy && <div className="px-4 py-2 bg-amber-50 border-b border-amber-300 text-sm text-amber-950" data-site-plan-reopened>{reopenedWhy}</div>}

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* The map */}
        <div ref={boxRef} className="relative flex-1 min-w-0 bg-gray-200 overflow-hidden select-none touch-none" data-site-plan-map>
          <svg ref={svgRef} width={size.w} height={size.h} className={`block ${tool === 'select' ? 'cursor-grab' : 'cursor-crosshair'}`}
            onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {tiles.map(t => { const s = toScreen({ x: t.x, y: t.y }); return <image key={t.key} href={t.href} x={s.x - 0.3} y={s.y - 0.3} width={t.s * view.k + 0.6} height={t.s * view.k + 0.6} preserveAspectRatio="none" /> })}
            {plan.survey && surveyMatrix && (
              <g opacity={plan.survey.opacity} data-site-plan-survey>
                <image href={serverUrl(plan.survey.url)} width={plan.survey.w} height={plan.survey.h} transform={surveyMatrix} preserveAspectRatio="none" />
              </g>
            )}
            {linesShown && (plan.neighbors ?? []).map((poly, i) => poly.map((ring, j) => <path key={`n${i}-${j}`} d={ringPath(ring)} fill="none" stroke="#fde68a" strokeWidth={1} strokeDasharray="4 3" />))}
            {linesShown && plan.parcel?.rings.map((ring, i) => <path key={`p${i}`} d={ringPath(ring)} fill="none" stroke="#facc15" strokeWidth={3} data-site-plan-parcel />)}
            {plan.house.map((ring, i) => (
              <path key={`h${i}`} d={ringPath(ring)} fill="rgba(107,114,128,0.45)" stroke={sel?.kind === 'house' && sel.i === i ? ORANGE : '#374151'} strokeWidth={2}
                onPointerDown={e => { if (tool !== 'select') { onBackgroundDown(e); return } setSel({ kind: 'house', i }); if (canEdit) begin(e, { kind: 'house', i, last: toWorld(local(e).sx, local(e).sy), moved: false }); else e.stopPropagation() }} data-site-plan-house={i} />
            ))}
            {sel?.kind === 'house' && canEdit && plan.house[sel.i]?.map((c, k) => { const s = at(c); return <rect key={k} x={s.x - 6} y={s.y - 6} width={12} height={12} fill="white" stroke={ORANGE} strokeWidth={2} className="cursor-move" onPointerDown={e => begin(e, { kind: 'houseCorner', i: sel.i, c: k, moved: false })} /> })}
            {/* Sides */}
            {plan.sides.map(side => {
              const a = postOf(plan, side.a), b = postOf(plan, side.b)
              if (!a || !b) return null
              const sa = at(a), sb = at(b)
              const color = flaggedSides.has(side.id) ? RED : PURPLE
              const selected = selSide?.id === side.id
              const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 }
              let ang = (Math.atan2(sb.y - sa.y, sb.x - sa.x) * 180) / Math.PI
              if (ang > 90) ang -= 180
              if (ang < -90) ang += 180
              return (
                <g key={side.id} data-site-plan-side={side.id}>
                  <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} stroke="transparent" strokeWidth={18} onPointerDown={e => onSideDown(e, side.id)} className="cursor-pointer" />
                  <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} stroke={selected ? ORANGE : color} strokeWidth={selected ? 7 : 5} strokeLinecap="round" pointerEvents="none" />
                  {side.gates.map(g => <GateMark key={g.id} plan={plan} side={side} gate={g} inside={inside} toScreen={toScreen} />)}
                  <text x={mid.x} y={mid.y - 9} transform={`rotate(${ang} ${mid.x} ${mid.y})`} textAnchor="middle" fontSize={12} fontWeight={700} fill="#111827" stroke="white" strokeWidth={4} paintOrder="stroke" pointerEvents="none" data-site-plan-side-label={side.id}>{side.name}: {sideLabel(plan, side)}</text>
                </g>
              )
            })}
            {/* Change orders not signed yet: dashed, labelled (drawn from withPending, never part of the plan). */}
            {pendingShapes.map(ps => (
              <g key={ps.id} pointerEvents="none" data-site-plan-pending={ps.id}>
                {ps.line && <line x1={ps.line[0].x} y1={ps.line[0].y} x2={ps.line[1].x} y2={ps.line[1].y} stroke="#b45309" strokeWidth={5} strokeDasharray="8 6" strokeLinecap="round" />}
                <text x={ps.label.x} y={ps.label.y} textAnchor="middle" fontSize={12} fontWeight={700} fill="#92400e" stroke="white" strokeWidth={4} paintOrder="stroke">{ps.text}</text>
              </g>
            ))}
            {/* Posts */}
            {plan.posts.map(p => {
              const s = at(p)
              const on = selPost?.id === p.id || addFrom === p.id
              return (
                <g key={p.id}>
                  <circle cx={s.x} cy={s.y} r={on ? 8 : 6} fill={on ? ORANGE : 'white'} stroke="#111827" strokeWidth={2} className={canEdit ? 'cursor-move' : 'cursor-pointer'} onPointerDown={e => onPostDown(e, p.id)} data-site-plan-post={p.id} />
                  {plan.startPostId === p.id && <text x={s.x + 10} y={s.y + 20} fontSize={12} fontWeight={700} fill="#065f46" stroke="white" strokeWidth={4} paintOrder="stroke" pointerEvents="none">Start here</text>}
                </g>
              )
            })}
            {/* Drawing in progress */}
            {tool === 'addSide' && addFrom != null && (() => { const s = typeof addFrom === 'string' ? (postOf(plan, addFrom) ? at(postOf(plan, addFrom)!) : null) : toScreen(addFrom); return s ? <circle cx={s.x} cy={s.y} r={9} fill="none" stroke={ORANGE} strokeWidth={3} pointerEvents="none" /> : null })()}
            {rectNow && (() => { const a = toScreen(rectNow.a), b = toScreen(rectNow.b); return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="rgba(107,114,128,0.35)" stroke="#374151" strokeDasharray="5 4" pointerEvents="none" /> })()}
            {housePts.length > 0 && <polyline points={housePts.map(p => { const s = toScreen(p); return `${s.x},${s.y}` }).join(' ')} fill="none" stroke="#374151" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />}
            {housePts.map((p, i) => { const s = toScreen(p); return <circle key={i} cx={s.x} cy={s.y} r={5} fill="#374151" pointerEvents="none" /> })}
            {tool === 'surveyScale' && plan.survey && scalePts.map((p, i) => { const s = toScreen(surveyToFeet(plan.origin, plan.survey!, p)); return <circle key={i} cx={s.x} cy={s.y} r={6} fill={ORANGE} stroke="white" strokeWidth={2} pointerEvents="none" /> })}
            {/* Move all and turn handles */}
            {canEdit && tool === 'select' && bounds && (() => {
              // Both handles sit above the plan, clear of its posts and side labels (a small plan's middle is often a label).
              const c = toScreen(center)
              const t = { x: c.x + 22, y: bounds.minY - 44 }
              const m = { x: c.x - 22, y: bounds.minY - 44 }
              return (
                <g>
                  <g className="cursor-move" onPointerDown={e => begin(e, { kind: 'all', last: toWorld(local(e).sx, local(e).sy), moved: false })} data-site-plan-move-all>
                    <rect x={m.x - 15} y={m.y - 15} width={30} height={30} rx={6} fill="white" stroke="#111827" strokeWidth={2} />
                    <path d={`M${m.x - 9},${m.y} H${m.x + 9} M${m.x},${m.y - 9} V${m.y + 9}`} stroke="#111827" strokeWidth={2} />
                    <title>Move all: drag to line the plan up with the photo</title>
                  </g>
                  <g className="cursor-grab" onPointerDown={e => { const w = toWorld(local(e).sx, local(e).sy); begin(e, { kind: 'turn', center, a0: Math.atan2(w.y - center.y, w.x - center.x), plan0: plan, moved: false }) }} data-site-plan-turn>
                    <circle cx={t.x} cy={t.y} r={13} fill="white" stroke="#111827" strokeWidth={2} />
                    <path d={`M${t.x - 6},${t.y + 3} A7,7 0 1 1 ${t.x + 5},${t.y + 5}`} fill="none" stroke="#111827" strokeWidth={2} />
                    <title>Turn: drag around the plan (hold Shift for less than a degree)</title>
                  </g>
                </g>
              )
            })()}
          </svg>
          {/* Map notes */}
          <div className="absolute right-3 bottom-3 flex flex-col items-end gap-1 pointer-events-none">
            {linesShown && (plan.parcel || parcelNote) && (
              <p className="bg-white/90 rounded px-2 py-1 text-xs text-gray-800 max-w-sm" data-site-plan-lines-note>
                {plan.parcel ? <>Approximate property lines from county records, not a survey.{plan.parcel.source ? ` From ${plan.parcel.source}.` : ''}{plan.parcel.id ? ` Parcel ${plan.parcel.id}.` : ''}</> : parcelNote}
              </p>
            )}
            <div className="bg-white/90 rounded px-2 py-1 text-xs text-gray-800 flex items-center gap-2" data-site-plan-scale>
              <span className="inline-block border-b-2 border-l-2 border-r-2 border-gray-900 h-2" style={{ width: scaleBar.px }} />{scaleBar.ft} ft
            </div>
          </div>
          {snapNote && <p className="absolute left-1/2 -translate-x-1/2 top-3 bg-gray-900 text-white text-xs rounded px-2 py-1 pointer-events-none">{snapNote}</p>}
          {tool !== 'select' && canEdit && (
            <div className="absolute left-1/2 -translate-x-1/2 top-3 bg-white rounded-lg shadow px-3 py-2 text-sm text-gray-900 flex items-center gap-2" data-site-plan-tool-help>
              {tool === 'addSide' && <span>{addFrom == null ? 'Click a post, or the map, where the side starts.' : 'Click where the side ends (a post or the map). Escape to stop.'}</span>}
              {tool === 'houseRect' && <span>Drag a box over the house.</span>}
              {tool === 'housePoints' && <><span>Click each corner of the house; click the first corner to finish.</span><button type="button" className="btn btn-secondary btn-sm" disabled={housePts.length < 3} onClick={finishHouse}>Finish house</button></>}
              {tool === 'surveyScale' && <span>{scalePts.length < 2 ? `Click ${scalePts.length ? 'the second' : 'the first'} of two points on the survey you know the feet between.` : 'Type the feet between them in the panel, then Set scale.'}</span>}
              {tool === 'surveyMove' && <span>Drag the survey to line it up with the photo.</span>}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickTool('select')}>Done</button>
            </div>
          )}
          <div className="absolute right-3 top-3 flex flex-col gap-1">
            <button type="button" className="w-10 h-10 grid place-items-center rounded-lg bg-white shadow" onClick={() => zoomBy(1.4)} aria-label="Zoom in"><ZoomIn size={18} /></button>
            <button type="button" className="w-10 h-10 grid place-items-center rounded-lg bg-white shadow" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out"><ZoomOut size={18} /></button>
            <button type="button" className="w-10 h-10 grid place-items-center rounded-lg bg-white shadow" onClick={fit} aria-label="Show the whole plan"><Maximize2 size={18} /></button>
          </div>
        </div>

        {/* The panel */}
        {/* On a phone the panel is a sheet under the map, folded down to its handle until it is opened. */}
        <button type="button" className="md:hidden flex items-center justify-between px-4 min-h-[44px] border-t border-gray-200 bg-gray-50 text-sm font-semibold text-gray-900" onClick={() => setSheetOpen(o => !o)} aria-expanded={sheetOpen} data-site-plan-sheet-toggle>
          <span>{sheetOpen ? 'Hide the details' : `Details${open.length ? ` · ${open.length} to answer` : ''}`}</span><span aria-hidden>{sheetOpen ? '▾' : '▴'}</span>
        </button>
        <aside className={`${sheetOpen ? 'block' : 'hidden'} md:block w-full md:w-[360px] shrink-0 max-h-[45vh] md:max-h-none border-t md:border-t-0 md:border-l border-gray-200 overflow-y-auto p-3 space-y-4 text-sm`} data-site-plan-panel>
          {!canEdit && <p className="rounded-lg bg-gray-100 px-3 py-2 text-gray-700">Read only. The office draws and changes the plan.</p>}

          {selSide && <SidePanel key={selSide.id} plan={plan} side={selSide} canEdit={canEdit} signed={!!rec.quote?.signed}
            onLength={n => push(p => setSideLength(p, selSide.id, n))}
            onAddGate={g => { const r = addGate(plan, selSide.id, g); if ('error' in r) { toast.error('Gate not added', r.error); return } push(() => r) }}
            onRemoveGate={id => push(p => removeGate(p, selSide.id, id))}
            onEditGate={(id, patch) => push(p => editGate(p, selSide.id, id, patch))}
            onRemove={() => { if (window.confirm(`Take ${selSide.name} off the plan?`)) { push(p => removeSide(p, selSide.id)); setSel(null) } }}
            onCoGate={g => coGate(selSide, g)} onCoLonger={n => coLonger(selSide, n)} />}

          {selPost && (
            <Section title="Post">
              <p className="text-gray-600">{canEdit ? 'Drag it, or nudge it with the arrow keys: 0.5 ft (Shift: 5 ft). Hold Shift while dragging to place it freely, without snapping square or onto a line.' : 'A post on the plan.'}</p>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary min-h-[44px]" disabled={plan.startPostId === selPost.id} onClick={() => push(p => ({ ...p, startPostId: selPost.id }))} data-site-plan-start-here>{plan.startPostId === selPost.id ? 'The crew starts here' : 'Start here'}</button>
                  <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => { pickTool('addSide'); setAddFrom(selPost.id) }} data-site-plan-side-from-post>Draw a side from here</button>
                </div>
              )}
            </Section>
          )}

          {sel?.kind === 'house' && plan.house[sel.i] && (
            <Section title="House">
              <p className="text-gray-600">{canEdit ? 'Drag it to move it, or drag a corner. Arrow keys nudge it.' : 'The house, as drawn by the office.'}</p>
              {canEdit && <button type="button" className="btn btn-secondary min-h-[44px] text-red-700" onClick={() => { push(p => ({ ...p, house: p.house.filter((_, i) => i !== sel.i) })); setSel(null) }} data-site-plan-house-delete>Delete the house</button>}
            </Section>
          )}

          {canEdit && (
            <Section title="Line the plan up with the photo">
              <p className="text-gray-600">Drag the square handle above the plan to move it all, and the round one beside it to turn it. Then adjust the corners.</p>
              <TurnBox onTurn={deg => push(p => turnPlan(p, deg))} />
            </Section>
          )}

          <Section title={`Quoted against drawn${open.length ? ` (${open.length} to answer)` : ''}`}>
            {!flags.length && <p className="text-gray-700" data-site-plan-no-flags>The plan matches the quote (within {settings.tolFt} ft or {settings.tolPct}%).</p>}
            <ul className="space-y-3" data-site-plan-flags>
              {flags.map(f => {
                const isOpen = openKeys.has(f.key)
                const a = isOpen ? null : plan.answers[f.key]
                const co = a?.note.match(/^Change order CO-(\d+)/)?.[1]
                return (
                  <li key={f.key} className={`rounded-lg border p-2 ${a ? 'border-gray-200' : 'border-red-300 bg-red-50'}`} data-site-plan-flag={f.key}>
                    <p className="text-gray-900">{f.text}</p>
                    {a ? (
                      <p className="mt-1 text-gray-700" data-site-plan-flag-answered>
                        {co && rec.quote?.signed ? <span className="font-semibold text-amber-800" data-site-plan-flag-waiting>Waiting on CO-{co}. </span> : null}
                        {a.kind === 'keep' ? 'Kept the wheel number' : f.kind === 'length' ? 'Used the drawn length' : 'Quote changed to match the plan'}: {a.note} ({a.by}, {when(a.at)})
                        {canEdit && <> <button type="button" className="ml-1 underline text-orange-700 whitespace-nowrap" onClick={() => push(p => { const answers = { ...p.answers }; delete answers[f.key]; return { ...p, answers } })} data-site-plan-answer-again>Answer again</button></>}
                      </p>
                    ) : canEdit && f.kind === 'length' ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-col gap-2">
                          <input className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 min-h-[44px]" placeholder="Why (needed to keep it)" value={keepNote[f.key] ?? ''} onChange={e => setKeepNote(n => ({ ...n, [f.key]: e.target.value }))} data-site-plan-keep-note={f.key} />
                          <button type="button" className="btn btn-secondary min-h-[44px] whitespace-nowrap" disabled={!(keepNote[f.key] ?? '').trim()} onClick={() => { answer(f.key, { kind: 'keep', note: keepNote[f.key].trim() }); setKeepNote(n => ({ ...n, [f.key]: '' })) }} data-site-plan-keep={f.key}>Keep the wheel number</button>
                        </div>
                        <button type="button" className="btn btn-primary min-h-[44px] w-full" disabled={!rec.quote || !!waiting} onClick={() => takeDrawn(f)} data-site-plan-use-drawn={f.key}>
                          Use the drawn length{rec.quote?.signed ? ' (change order)' : ''}
                        </button>
                      </div>
                    ) : canEdit ? (
                      <div className="mt-2 space-y-2" data-site-plan-count-ways={f.key}>
                        <p className="text-gray-800" data-site-plan-match-quote={f.key}><span className="font-semibold">Make the plan match the quote:</span> {countHelp(f.key)} This goes away by itself once they match.</p>
                        <button type="button" className="btn btn-primary min-h-[44px] w-full" disabled={!rec.quote || !!waiting} onClick={() => takeDrawn(f)} data-site-plan-use-plan={f.key}>
                          {rec.quote?.signed ? 'Use the plan (change order)' : 'Use the plan (reprice the quote)'}
                        </button>
                      </div>
                    ) : <p className="mt-1 text-red-800">Not answered yet.</p>}
                  </li>
                )
              })}
            </ul>
            {/* Answered questions the plan no longer raises (the quote now has the drawn feet): kept as a record. */}
            {(() => {
              const now = new Set(flags.map(f => f.key))
              const past = Object.entries(plan.answers).filter(([key]) => !now.has(key))
              if (!past.length) return null
              const what = (key: string) => key.startsWith('len:') ? (plan.sides.find(x => x.id === key.slice(4))?.name ?? 'A side') : key === 'gates' || key === 'gateWidths' ? 'Gates' : key === 'sides' ? 'Number of sides' : key === 'tees' ? 'Tees' : key === 'closed' ? 'Closes or not' : key
              return (
                <ul className="space-y-1 text-gray-700" data-site-plan-flags-done>
                  {past.map(([key, a]) => <li key={key}>{what(key)}: {a.kind === 'keep' ? 'kept the wheel number' : 'quote changed'}. {a.note} ({a.by}, {when(a.at)})</li>)}
                </ul>
              )
            })()}
          </Section>

          {(plan.pending ?? []).length > 0 && (
            <Section title="Change orders not signed yet">
              <ul className="space-y-1 text-gray-800" data-site-plan-pending-list>
                {(plan.pending ?? []).map(c => {
                  const side = plan.sides.find(x => x.id === c.sideId)
                  return <li key={c.id}>CO-{c.coNumber ?? '?'}: {c.kind === 'gate' && c.gate ? `${ft1(c.gate.widthFt)} ${c.gate.type === 'double' ? 'double' : 'single'} gate on ${side?.name ?? 'a side'}` : `${side?.name ?? 'A side'} to ${ft1(c.newFt ?? 0)}`}, not signed yet. It goes on the plan once the change order is signed or approved.</li>
                })}
              </ul>
            </Section>
          )}

          <Section title="Property lines">
            {canEdit && <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary min-h-[44px]" disabled={busy === 'lines'} onClick={() => void showLines()} data-site-plan-show-lines>{busy === 'lines' ? 'Looking up…' : plan.parcel ? 'Look up the property lines again' : 'Show property lines'}</button>
              {(plan.parcel || plan.neighbors?.length) && <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => setLinesShown(s => !s)}>{linesShown ? 'Hide them' : 'Show them'}</button>}
            </div>}
            {!canEdit && !plan.parcel && <p className="text-gray-600">None looked up.</p>}
            {parcelNote && !plan.parcel && <p className="text-gray-700" data-site-plan-no-parcel>{parcelNote}</p>}
            {plan.parcel && <p className="text-gray-700">Approximate property lines from county records, not a survey.</p>}
            {lineWarnings.length > 0 && <ul className="list-disc pl-5 text-red-800" data-site-plan-line-warnings>{lineWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </Section>

          {(canEdit || plan.survey) && (
            <Section title="Survey">
              {canEdit && <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={e => { void onSurveyFile(e.target.files?.[0]); e.target.value = '' }} data-site-plan-survey-file />
                <button type="button" className="btn btn-secondary min-h-[44px]" disabled={busy === 'survey'} onClick={() => fileRef.current?.click()} data-site-plan-survey-upload>{busy === 'survey' ? 'Uploading…' : plan.survey ? 'Upload another survey' : 'Upload a survey (PDF or photo)'}</button>
              </>}
              {plan.survey && (
                <div className="space-y-2">
                  {canEdit && <div className="flex flex-wrap gap-2">
                    <button type="button" className={`btn min-h-[44px] ${tool === 'surveyScale' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pickTool('surveyScale')} data-site-plan-survey-scale>Set its scale</button>
                    <button type="button" className={`btn min-h-[44px] ${tool === 'surveyMove' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pickTool('surveyMove')} data-site-plan-survey-move>Move it</button>
                  </div>}
                  {canEdit && tool === 'surveyScale' && scalePts.length >= 2 && (
                    <div className="flex gap-2 items-end">
                      <label className="text-gray-700">Feet between the two points
                        <input className="block border border-gray-300 rounded-lg px-2 min-h-[44px] w-28" inputMode="decimal" value={scaleFt} onChange={e => setScaleFt(e.target.value)} autoFocus data-site-plan-survey-feet />
                      </label>
                      <button type="button" className="btn btn-primary min-h-[44px]" disabled={!(Number(scaleFt) > 0)} onClick={applyScale} data-site-plan-survey-apply>Set scale</button>
                    </div>
                  )}
                  {canEdit && <TurnBox label="Turn the survey" onTurn={deg => push(p => (p.survey ? { ...p, survey: turnSurvey(p.origin, p.survey, deg) } : p))} />}
                  <label className="block text-gray-700">See through
                    <input type="range" min={0.1} max={1} step={0.05} value={plan.survey.opacity} disabled={!canEdit}
                      onChange={e => { const v = Number(e.target.value); setHist(h => historyReplace(h, { ...h.now, survey: h.now.survey ? { ...h.now.survey, opacity: v } : null })) }}
                      onPointerDown={() => setHist(h => historyPush(h, { ...h.now }))} className="w-full" data-site-plan-survey-opacity />
                  </label>
                  {plan.survey.ft > 0 && <p className="text-xs text-gray-500">Scale set from {ft1(plan.survey.ft)} between two points.</p>}
                  {canEdit && <button type="button" className="btn btn-secondary min-h-[44px] text-red-700" onClick={() => { if (window.confirm('Take the survey off the plan?')) push(p => ({ ...p, survey: null })) }} data-site-plan-survey-remove>Remove the survey</button>}
                </div>
              )}
            </Section>
          )}

          <Section title="Notes for the crew">
            {canEdit ? (
              <textarea className="w-full border border-gray-300 rounded-lg p-2 min-h-[80px]" value={notes} onChange={e => setNotes(e.target.value)}
                onBlur={() => { if (notes !== plan.notes) push(p => ({ ...p, notes })) }} placeholder="Gate code, where to start, what to watch for" data-site-plan-notes />
            ) : <p className="text-gray-800 whitespace-pre-wrap">{plan.notes || 'None.'}</p>}
          </Section>

          <Section title="Sheets">
            {canEdit ? (
              <>
                <div className="flex flex-wrap gap-2 items-center">
                  <select className="border border-gray-300 rounded-lg px-2 min-h-[44px]" value={sheetSize} disabled={busy === 'sheet'} onChange={e => setSheetSize(e.target.value as 'letter' | 'tabloid')} aria-label="Sheet size" data-site-plan-sheet-size>
                    <option value="letter">Letter, sideways</option>
                    <option value="tabloid">11 x 17</option>
                  </select>
                  <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" checked={!!plan.permitAerial} disabled={busy === 'sheet'} onChange={e => { const v = e.target.checked; push(p => ({ ...p, permitAerial: v })) }} data-site-plan-sheet-aerial /> Aerial on the sheet</label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary min-h-[44px]" disabled={dirty || rec.revision < 1 || busy === 'sheet'} onClick={() => void permitSheet(sheetSize, !!plan.permitAerial)} data-site-plan-permit-sheet>{busy === 'sheet' ? 'Making it…' : 'Permit sheet (PDF)'}</button>
                  <button type="button" className="btn btn-secondary min-h-[44px]" disabled={dirty || rec.revision < 1 || busy === 'packet'} onClick={() => void installerSheet()} data-site-plan-installer-sheet>{busy === 'packet' ? 'Opening…' : 'Installer sheet'}</button>
                </div>
                {(dirty || rec.revision < 1) && <p className="text-xs text-gray-500">Save the plan first: the sheets are made from the saved plan.</p>}
              </>
            ) : <p className="text-gray-600">The office makes the permit and installer sheets.</p>}
          </Section>

          <Section title="Plan done">
            {rec.doneAt ? (
              <div className="space-y-2">
                <p className="text-green-800" data-site-plan-done>Marked done {when(rec.doneAt)}{rec.doneBy ? ` by ${rec.doneBy}` : ''}.</p>
                {canEdit && <button type="button" className="btn btn-secondary min-h-[44px]" disabled={busy === 'done'} onClick={() => void reopen()} data-site-plan-reopen>Reopen the plan</button>}
              </div>
            ) : (
              <div className="space-y-2">
                <button type="button" className="btn btn-primary min-h-[44px] w-full" disabled={!!doneWhy || busy === 'done'} onClick={() => void markDone()} title={doneWhy} data-site-plan-mark-done>Mark plan done</button>
                {doneWhy && <p className="text-gray-700" data-site-plan-done-why>{doneWhy}</p>}
                {doneRefused && <ul className="list-disc pl-5 text-red-800" data-site-plan-done-refused>{doneRefused.map((t, i) => <li key={i}>{t}</li>)}</ul>}
              </div>
            )}
          </Section>

          <Section title="Revisions">
            {!rec.revisions.length ? <p className="text-gray-600">Not saved yet.</p> : (
              <ol className="space-y-1" data-site-plan-revisions>
                {[...rec.revisions].sort((x, y) => y.revision - x.revision).map(r => <li key={r.revision} className="text-gray-800"><span className="font-semibold">{r.revision}.</span> {r.by}, {when(r.at)}{r.note ? `: ${r.note}` : ''}</li>)}
              </ol>
            )}
          </Section>
        </aside>
      </div>
    </div>
  )
  return createPortal(content, document.body)
}

/** Does the quote's saved layout have this side at these inches (its walk steps or its drawing's side)? */
function quoteSideFeetIs(layout: unknown, side: SiteSide, inches: number): boolean {
  const l = layout as { walk?: WalkList | null; yard?: YardLayout | null } | null
  if (side.walkStepIds.length && l?.walk) {
    const steps = l.walk.lines.flatMap(x => x.steps).filter(s => side.walkStepIds.includes(s.id))
    if (steps.length !== side.walkStepIds.length) return false
    const total = steps.reduce((t, s) => t + Math.max(0, s.feetIn || 0) + (s.what === 'gate' ? Math.max(0, s.gate?.widthIn ?? 0) : 0), 0)
    return Math.abs(total - inches) < 1
  }
  const ys = side.yardSideId ? l?.yard?.sides.find(s => s.id === side.yardSideId) : null
  return !!ys && Math.abs(ys.lengthIn - inches) < 1
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  )
}

function ToolButton({ on, onClick, label, short, data }: { on: boolean; onClick: () => void; label: string; short: string; data: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label} title={label} className={`px-3 min-h-[44px] rounded-lg text-sm font-semibold border whitespace-nowrap ${on ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-800 border-gray-300'}`} data-site-plan-tool={data}>
      <span className="xl:hidden">{short}</span><span className="hidden xl:inline">{label}</span>
    </button>
  )
}

/** The street part of an address ("20351 SW 80th Pl"), for the top bar; the whole address is its tooltip. */
const street = (address: string) => (address || '').split(',')[0].trim() || address

function TurnBox({ onTurn, label = 'Turn the plan' }: { onTurn: (deg: number) => void; label?: string }) {
  const [deg, setDeg] = useState('')
  const n = Number(deg)
  return (
    <div className="flex flex-wrap items-end gap-2" data-site-plan-turn-box>
      <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => onTurn(-1)} aria-label={`${label} 1 degree to the left`}>↺ 1°</button>
      <button type="button" className="btn btn-secondary min-h-[44px]" onClick={() => onTurn(1)} aria-label={`${label} 1 degree to the right`}>↻ 1°</button>
      <label className="text-gray-700">{label}, degrees (+ to the right)
        <span className="flex gap-2 mt-1">
          <input className="border border-gray-300 rounded-lg px-2 min-h-[44px] w-20" inputMode="decimal" value={deg} onChange={e => setDeg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && Number.isFinite(n) && n !== 0) { onTurn(n); setDeg('') } }} />
          <button type="button" className="btn btn-secondary min-h-[44px]" disabled={!Number.isFinite(n) || n === 0 || !deg.trim()} onClick={() => { onTurn(n); setDeg('') }}>Turn</button>
        </span>
      </label>
    </div>
  )
}

/** A gate on its side: its opening, its leaves and their swing (in toward the yard's middle, or out). */
function GateMark({ plan, side, gate, inside, toScreen }: { plan: SitePlanData; side: SiteSide; gate: SiteGate; inside: Pt; toScreen: (f: Pt) => Pt }) {
  const a = postFeet(plan, side.a), b = postFeet(plan, side.b)
  if (!a || !b) return null
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  const p0 = { x: a.x + d.x * gate.atFt, y: a.y + d.y * gate.atFt }, p1 = { x: p0.x + d.x * gate.widthFt, y: p0.y + d.y * gate.widthFt }
  // "In": toward the yard's middle.
  let n = { x: -d.y, y: d.x }
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
  if ((inside.x - mid.x) * n.x + (inside.y - mid.y) * n.y < 0) n = { x: -n.x, y: -n.y }
  const sw = gate.swing === 'out' ? { x: -n.x, y: -n.y } : n
  // Looking out from inside the yard, left is the side the hinge is on (single gate).
  const facing = { x: -n.x, y: -n.y }, left = { x: -facing.y, y: facing.x }
  const leaves: Array<{ hinge: Pt; w: number; closed: Pt }> = []
  if (gate.type === 'double') {
    leaves.push({ hinge: p0, w: gate.widthFt / 2, closed: mid }, { hinge: p1, w: gate.widthFt / 2, closed: mid })
  } else {
    const p0Left = (p0.x - mid.x) * left.x + (p0.y - mid.y) * left.y > 0
    const hinge = (gate.hinge ?? 'left') === 'left' ? (p0Left ? p0 : p1) : (p0Left ? p1 : p0)
    leaves.push({ hinge, w: gate.widthFt, closed: hinge === p0 ? p1 : p0 })
  }
  const s0 = toScreen(p0), s1 = toScreen(p1)
  return (
    <g pointerEvents="none" data-site-plan-gate={gate.id}>
      <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke="white" strokeWidth={6} />
      {leaves.map((l, i) => {
        const open = { x: l.hinge.x + sw.x * l.w, y: l.hinge.y + sw.y * l.w }
        const h = toScreen(l.hinge), o = toScreen(open), c = toScreen(l.closed)
        const r = Math.hypot(o.x - h.x, o.y - h.y)
        // Clockwise on screen from the closed leaf to the open one, or the other way: the short way round.
        const cross = (c.x - h.x) * (o.y - h.y) - (c.y - h.y) * (o.x - h.x)
        return (
          <g key={i}>
            <line x1={h.x} y1={h.y} x2={o.x} y2={o.y} stroke="#0f766e" strokeWidth={2.5} />
            <path d={`M${c.x},${c.y} A${r},${r} 0 0 ${cross > 0 ? 1 : 0} ${o.x},${o.y}`} fill="none" stroke="#0f766e" strokeWidth={1.5} strokeDasharray="4 3" />
          </g>
        )
      })}
    </g>
  )
}

function SidePanel({ plan, side, canEdit, signed, onLength, onAddGate, onRemoveGate, onEditGate, onRemove, onCoGate, onCoLonger }: {
  plan: SitePlanData; side: SiteSide; canEdit: boolean; signed: boolean
  onLength: (ft: number) => void
  onAddGate: (g: GateInput) => void
  onRemoveGate: (id: string) => void
  onEditGate: (id: string, patch: Partial<Pick<SiteGate, 'swing' | 'hinge'>>) => void
  onRemove: () => void
  onCoGate: (g: GateInput) => void
  onCoLonger: (ft: number) => void
}) {
  const drawn = drawnFt(plan, side)
  const [len, setLen] = useState(String(Math.round(drawn * 10) / 10))
  useEffect(() => { setLen(String(Math.round(drawn * 10) / 10)) }, [drawn])
  const [g, setG] = useState({ fromEnd: 'a' as 'a' | 'b', dist: '', width: '4', type: 'walk' as 'walk' | 'double', swing: 'in' as 'in' | 'out', hinge: 'left' as 'left' | 'right' })
  const [longer, setLonger] = useState('')
  const gateIn = (): GateInput | null => {
    const distFt = Number(g.dist), widthFt = Number(g.width)
    if (!g.dist.trim() || !(distFt >= 0) || !(widthFt > 0)) return null
    return { fromEnd: g.fromEnd, distFt, widthFt, type: g.type, swing: g.swing, hinge: g.type === 'double' ? null : g.hinge }
  }
  const commitLen = () => { const n = Number(len); if (n > 0 && Math.abs(n - drawn) >= 0.05) onLength(n) }
  return (
    <section className="space-y-3 rounded-lg border border-orange-300 p-3" data-site-plan-side-panel={side.id}>
      <h3 className="font-semibold text-gray-900">{side.name}</h3>
      <p className="text-gray-700">{side.quotedFt != null ? `Quoted ${ft1(side.quotedFt)}, drawn ${ft1(drawn)}.` : `Drawn ${ft1(drawn)} (not on the quote).`}</p>
      {canEdit && (
        <label className="block text-gray-700">Length, feet
          <span className="flex gap-2 mt-1">
            <input className="border border-gray-300 rounded-lg px-2 min-h-[44px] w-28" inputMode="decimal" value={len} onChange={e => setLen(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitLen() }} onBlur={commitLen} data-site-plan-side-length />
            <span className="text-xs text-gray-500 self-center">Typing a length moves the side's end post along the side.</span>
          </span>
        </label>
      )}
      <div>
        <p className="font-semibold text-gray-800">Gates</p>
        {!side.gates.length && <p className="text-gray-600">None.</p>}
        <ul className="space-y-2">
          {side.gates.map(x => (
            <li key={x.id} className="rounded border border-gray-200 p-2" data-site-plan-gate-row={x.id}>
              <p className="text-gray-800">{ft1(x.widthFt)} {x.type === 'double' ? 'double' : 'single'} gate, {ft1(x.atFt)} from the side's start, {ft1(Math.max(0, drawn - x.atFt - x.widthFt))} from its end</p>
              {canEdit && (
                <div className="flex flex-wrap gap-2 mt-1">
                  <select className="border border-gray-300 rounded px-1 min-h-[40px]" value={x.swing} onChange={e => onEditGate(x.id, { swing: e.target.value as 'in' | 'out' })} aria-label="Swing"><option value="in">Swings in</option><option value="out">Swings out</option></select>
                  {x.type !== 'double' && <select className="border border-gray-300 rounded px-1 min-h-[40px]" value={x.hinge ?? 'left'} onChange={e => onEditGate(x.id, { hinge: e.target.value as 'left' | 'right' })} aria-label="Hinge"><option value="left">Hinge left</option><option value="right">Hinge right</option></select>}
                  <button type="button" className="text-red-700 underline min-h-[40px]" onClick={() => onRemoveGate(x.id)} data-site-plan-gate-remove={x.id}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {canEdit && (
        <div className="space-y-2 rounded border border-gray-200 p-2" data-site-plan-gate-form>
          <p className="font-semibold text-gray-800">{signed ? 'A gate (on the plan, or by change order)' : 'Add gate'}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-gray-700">Feet from
              <select className="block w-full border border-gray-300 rounded px-1 min-h-[40px]" value={g.fromEnd} onChange={e => setG({ ...g, fromEnd: e.target.value as 'a' | 'b' })} data-site-plan-gate-from>
                <option value="a">the side's start</option><option value="b">the side's end</option>
              </select>
            </label>
            <label className="text-gray-700">Feet
              <input className="block w-full border border-gray-300 rounded px-2 min-h-[40px]" inputMode="decimal" value={g.dist} onChange={e => setG({ ...g, dist: e.target.value })} data-site-plan-gate-dist />
            </label>
            <label className="text-gray-700">Width, feet
              <input className="block w-full border border-gray-300 rounded px-2 min-h-[40px]" inputMode="decimal" value={g.width} onChange={e => setG({ ...g, width: e.target.value })} data-site-plan-gate-width />
            </label>
            <label className="text-gray-700">Kind
              <select className="block w-full border border-gray-300 rounded px-1 min-h-[40px]" value={g.type} onChange={e => setG({ ...g, type: e.target.value as 'walk' | 'double', width: e.target.value === 'double' && g.width === '4' ? '8' : g.width })} data-site-plan-gate-type>
                <option value="walk">Single</option><option value="double">Double</option>
              </select>
            </label>
            <label className="text-gray-700">Swing
              <select className="block w-full border border-gray-300 rounded px-1 min-h-[40px]" value={g.swing} onChange={e => setG({ ...g, swing: e.target.value as 'in' | 'out' })}><option value="in">In</option><option value="out">Out</option></select>
            </label>
            {g.type !== 'double' && <label className="text-gray-700">Hinge
              <select className="block w-full border border-gray-300 rounded px-1 min-h-[40px]" value={g.hinge} onChange={e => setG({ ...g, hinge: e.target.value as 'left' | 'right' })}><option value="left">Left</option><option value="right">Right</option></select>
            </label>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary min-h-[44px]" disabled={!gateIn()} onClick={() => { const x = gateIn(); if (x) { onAddGate(x); setG({ ...g, dist: '' }) } }} data-site-plan-gate-add>Add gate{signed ? ' on the plan only' : ''}</button>
            {signed && <button type="button" className="btn btn-primary min-h-[44px]" disabled={!gateIn()} onClick={() => { const x = gateIn(); if (x) onCoGate(x) }} data-site-plan-co-gate>Add a gate here (change order)</button>}
          </div>
          {!signed && <p className="text-xs text-gray-500">A gate the quote does not have shows under Quoted against drawn until it is answered.</p>}
        </div>
      )}
      {canEdit && signed && (
        <div className="space-y-2 rounded border border-gray-200 p-2" data-site-plan-co-longer>
          <p className="font-semibold text-gray-800">Make this side longer (change order)</p>
          <div className="flex gap-2 items-end">
            <label className="text-gray-700">New feet
              <input className="block border border-gray-300 rounded px-2 min-h-[40px] w-28" inputMode="decimal" value={longer} onChange={e => setLonger(e.target.value)} data-site-plan-co-longer-feet />
            </label>
            <button type="button" className="btn btn-primary min-h-[44px]" disabled={!(Number(longer) > 0)} onClick={() => onCoLonger(Number(longer))} data-site-plan-co-longer-go>Make change order</button>
          </div>
        </div>
      )}
      {canEdit && <button type="button" className="text-red-700 underline min-h-[44px]" onClick={onRemove} data-site-plan-side-remove>Take this side off the plan</button>}
    </section>
  )
}

/**
 * The plan with a change order's change: waiting on it (pending; the posts and gates stay as they are) while the change
 * order is not signed or approved, or on the plan at once when it was made approved (approved verbally as it was
 * made: the server takes no pending change for an approved change order).
 */
function withChangeOrder(plan: SitePlanData, co: Pick<ChangeOrder, 'status'>, c: PendingChange): SitePlanData {
  if (co.status === 'approved') return applyChange(plan, c)
  return { ...plan, pending: [...(plan.pending ?? []), c] }
}

/** What to change on the plan so its makeup matches the quote's. */
function countHelp(key: string): string {
  if (key === 'gates') return 'add or take off gates on the plan (click a side, then Add gate or Remove).'
  if (key === 'gateWidths') return 'change the gates\' widths on the plan (remove a gate and add it again at the quoted width).'
  if (key === 'sides') return 'draw the missing side (Draw a side) or take an extra one off (click it, then Take this side off the plan).'
  if (key === 'tees') return 'draw the branch from its side, or take it off.'
  if (key === 'closed') return 'join the fence back to its first post, or take the closing side off.'
  return 'change the plan until it matches.'
}
