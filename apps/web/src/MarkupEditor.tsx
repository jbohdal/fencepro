/**
 * Mark up a photo (or a frame grabbed from a video) with a finger: arrows,
 * straight lines, circles, boxes, freehand, text, and a measurement label
 * ("4 ft gate"), in brand purple, red, yellow or white. Undo and redo; pinch
 * to zoom and pan with two fingers. The original is never changed: Save
 * makes a marked up copy at full resolution.
 */

import { useEffect, useRef, useState } from 'react'
import { Undo2, Redo2, X } from 'lucide-react'

type Tool = 'arrow' | 'line' | 'circle' | 'box' | 'pen' | 'text' | 'measure'
interface Pt { x: number; y: number }
interface Shape { tool: Tool; color: string; pts: Pt[]; text?: string }

const COLORS: Array<[string, string]> = [['#5E28A1', 'Purple'], ['#DC2626', 'Red'], ['#FACC15', 'Yellow'], ['#FFFFFF', 'White']]
const TOOLS: Array<[Tool, string]> = [['arrow', 'Arrow'], ['line', 'Line'], ['circle', 'Circle'], ['box', 'Box'], ['pen', 'Draw'], ['text', 'Text'], ['measure', 'Measure']]

export default function MarkupEditor({ src, onSave, onClose }: { src: string; onSave: (blob: Blob) => Promise<void> | void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [redo, setRedo] = useState<Shape[]>([])
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[1][0])
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const [saving, setSaving] = useState(false)
  const drawing = useRef<Shape | null>(null)
  const pointers = useRef(new Map<number, Pt>())
  const pinch = useRef<{ d: number; mid: Pt; view: typeof view } | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => setImg(i)
    i.src = src
  }, [src])

  // Fit the photo in the screen; view.scale zooms on top of that.
  function fit() {
    const c = canvasRef.current!, w = wrapRef.current!
    const W = w.clientWidth, H = w.clientHeight
    const k = img ? Math.min(W / img.naturalWidth, H / img.naturalHeight) : 1
    return { W, H, k, ox: (W - (img?.naturalWidth ?? 0) * k) / 2, oy: (H - (img?.naturalHeight ?? 0) * k) / 2, c }
  }
  const lw = () => Math.max(3, (img?.naturalWidth ?? 1000) / 220)

  function paint(ctx: CanvasRenderingContext2D, list: Shape[]) {
    for (const s of list) {
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color
      ctx.lineWidth = lw(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      // A thin dark edge keeps white and yellow readable on a bright photo.
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = lw()
      const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]
      if (!a) continue
      if (s.tool === 'pen') { ctx.beginPath(); s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke() }
      if (s.tool === 'line' || s.tool === 'arrow' || s.tool === 'measure') {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        if (s.tool !== 'line') head(ctx, a, b)
        if (s.tool === 'measure') { head(ctx, b, a); if (s.text) label(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s.text, s.color) }
      }
      if (s.tool === 'box') { ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)) }
      if (s.tool === 'circle') { ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); ctx.stroke() }
      if (s.tool === 'text' && s.text) label(ctx, a, s.text, s.color)
      ctx.shadowBlur = 0
    }
  }
  function head(ctx: CanvasRenderingContext2D, from: Pt, to: Pt) {
    const ang = Math.atan2(to.y - from.y, to.x - from.x), len = lw() * 4.5
    ctx.beginPath()
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x - len * Math.cos(ang - 0.45), to.y - len * Math.sin(ang - 0.45))
    ctx.lineTo(to.x - len * Math.cos(ang + 0.45), to.y - len * Math.sin(ang + 0.45))
    ctx.closePath(); ctx.fill()
  }
  function label(ctx: CanvasRenderingContext2D, at: Pt, text: string, c: string) {
    const size = Math.max(18, (img?.naturalWidth ?? 1000) / 28)
    ctx.font = `700 ${size}px -apple-system, Segoe UI, Roboto, sans-serif`
    const w = ctx.measureText(text).width, pad = size * 0.35
    ctx.shadowBlur = 0
    ctx.fillStyle = c === '#FFFFFF' || c === '#FACC15' ? 'rgba(28,16,48,0.85)' : 'rgba(255,255,255,0.92)'
    ctx.fillRect(at.x - w / 2 - pad, at.y - size / 2 - pad, w + pad * 2, size + pad * 2)
    ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, at.x, at.y)
  }

  // Draw the screen.
  useEffect(() => {
    const c = canvasRef.current, w = wrapRef.current
    if (!c || !w || !img) return
    const dpr = window.devicePixelRatio || 1
    c.width = w.clientWidth * dpr; c.height = w.clientHeight * dpr
    const ctx = c.getContext('2d')!
    const f = fit()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#120A20'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.setTransform(dpr * f.k * view.scale, 0, 0, dpr * f.k * view.scale, dpr * (f.ox * view.scale + view.tx), dpr * (f.oy * view.scale + view.ty))
    ctx.drawImage(img, 0, 0)
    paint(ctx, drawing.current ? [...shapes, drawing.current] : shapes)
  })

  function toImage(e: { clientX: number; clientY: number }): Pt {
    const r = canvasRef.current!.getBoundingClientRect()
    const f = fit()
    return { x: (e.clientX - r.left - (f.ox * view.scale + view.tx)) / (f.k * view.scale), y: (e.clientY - r.top - (f.oy * view.scale + view.ty)) / (f.k * view.scale) }
  }
  function down(e: React.PointerEvent) {
    e.preventDefault()
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* not every pointer can be captured */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      // Two fingers: zoom and pan, and drop the shape just started.
      drawing.current = null
      const [p1, p2] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, view }
      force(n => n + 1)
      return
    }
    const p = toImage(e)
    drawing.current = { tool, color, pts: [p, p] }
    force(n => n + 1)
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()]
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const v0 = pinch.current.view
      const scale = Math.min(6, Math.max(1, v0.scale * d / pinch.current.d))
      setView({ scale, tx: v0.tx + (mid.x - pinch.current.mid.x), ty: v0.ty + (mid.y - pinch.current.mid.y) })
      return
    }
    const s = drawing.current
    if (!s) return
    const p = toImage(e)
    if (s.tool === 'pen') s.pts.push(p); else s.pts[1] = p
    force(n => n + 1)
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const s = drawing.current
    drawing.current = null
    if (!s) { force(n => n + 1); return }
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]
    const tiny = Math.hypot(b.x - a.x, b.y - a.y) < lw() * 2
    if (s.tool === 'text') {
      const t = window.prompt('Text')?.trim()
      if (t) add({ ...s, pts: [a], text: t })
    } else if (s.tool === 'measure') {
      if (tiny) { force(n => n + 1); return }
      const t = window.prompt('Label, for example "4 ft gate"')?.trim()
      add({ ...s, text: t || undefined })
    } else if (!tiny || s.tool === 'pen') add(s)
    else force(n => n + 1)
  }
  function add(s: Shape) { setShapes(l => [...l, s]); setRedo([]) }

  async function save() {
    if (!img) return
    setSaving(true)
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    paint(ctx, shapes)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.9))
    if (blob) await onSave(blob)
    setSaving(false)
  }

  const btn = (on: boolean) => `h-11 px-3 rounded-lg text-sm font-semibold whitespace-nowrap ${on ? 'bg-white text-gray-900' : 'text-white/90 bg-white/10'}`
  return (
    <div className="fixed inset-0 z-[90] bg-[#120A20] flex flex-col" data-markup-editor data-shapes={shapes.length} data-loaded={img ? 'yes' : 'no'}>
      <div className="flex items-center gap-2 px-3 py-2 pt-[max(8px,env(safe-area-inset-top))]">
        <button type="button" className="w-11 h-11 grid place-items-center text-white" aria-label="Close without saving" onClick={onClose}><X size={24} /></button>
        <button type="button" className="w-11 h-11 grid place-items-center text-white disabled:opacity-40" aria-label="Undo" disabled={!shapes.length}
          onClick={() => { setRedo(r => [...r, shapes[shapes.length - 1]]); setShapes(l => l.slice(0, -1)) }} data-markup-undo><Undo2 size={22} /></button>
        <button type="button" className="w-11 h-11 grid place-items-center text-white disabled:opacity-40" aria-label="Redo" disabled={!redo.length}
          onClick={() => { setShapes(l => [...l, redo[redo.length - 1]]); setRedo(r => r.slice(0, -1)) }} data-markup-redo><Redo2 size={22} /></button>
        {view.scale > 1 && <button type="button" className={btn(false)} onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}>Fit</button>}
        <span className="flex-1" />
        <button type="button" className="h-11 px-5 rounded-lg bg-white text-gray-900 font-bold disabled:opacity-50" disabled={saving || !img} onClick={save} data-markup-save>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <div ref={wrapRef} className="flex-1 relative overflow-hidden touch-none">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-markup-canvas />
        {!img && <p className="absolute inset-0 grid place-items-center text-white/80">Loading the photo…</p>}
      </div>
      <div className="px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))] space-y-2">
        <div className="flex gap-2 overflow-x-auto">
          {TOOLS.map(([t, name]) => <button key={t} type="button" className={btn(tool === t)} onClick={() => setTool(t)} data-markup-tool={t}>{name}</button>)}
        </div>
        <div className="flex gap-3 items-center">
          {COLORS.map(([c, name]) => (
            <button key={c} type="button" aria-label={name} onClick={() => setColor(c)} data-markup-color={name}
              className={`w-11 h-11 rounded-full border-4 ${color === c ? 'border-white' : 'border-white/20'}`} style={{ background: c }} />
          ))}
          <span className="text-xs text-white/70 ml-auto">Two fingers to zoom</span>
        </div>
      </div>
    </div>
  )
}
