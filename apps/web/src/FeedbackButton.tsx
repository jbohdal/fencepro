/**
 * The "Send feedback" button in the top bar (every signed-in page, phone and
 * desktop, every login) and its small form. One tap takes a picture of the
 * screen, then the form opens with it: draw on it to point at something
 * ("Mark it", with Undo), or remove it; write one line about what is wrong;
 * Send. The screen's name, the record that is open (from the page address),
 * the login's role, the phone or computer and the app's version go with it.
 * See feedback.ts for how it is sent.
 */

import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus, X, Loader2, Pencil, Undo2 } from 'lucide-react'
import { captureScreen, sendFeedback, whereText } from './feedback'
import { BackClose, useNav } from './nav'
import { toast } from './toast'

type Point = [number, number]
type Stroke = Point[]
type Stage = { kind: 'idle' } | { kind: 'capturing' } | { kind: 'form'; shot: string | null; failed: boolean; path: string; screen: string }

const INK = '#ef4444'
const inkWidth = (w: number) => Math.max(3, Math.round(w * 0.008))

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  ctx.strokeStyle = INK
  ctx.lineWidth = inkWidth(w)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    if (!s.length) continue
    ctx.beginPath()
    ctx.moveTo(s[0][0] * w, s[0][1] * h)
    if (s.length === 1) ctx.lineTo(s[0][0] * w + 0.1, s[0][1] * h + 0.1)
    for (const [x, y] of s.slice(1)) ctx.lineTo(x * w, y * h)
    ctx.stroke()
  }
}

/** The picture with the marks drawn into it, as a JPEG data URL. */
async function withMarks(src: string, strokes: Stroke[]): Promise<string> {
  if (!strokes.length) return src
  const img = new Image()
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(img, 0, 0)
  drawStrokes(ctx, strokes, c.width, c.height)
  const out = c.toDataURL('image/jpeg', 0.8)
  return out.startsWith('data:image/jpeg') ? out : src
}

/** The picture, with a layer on top to draw on while "Mark it" is on. */
function MarkedShot({ src, strokes, onStrokes, marking, disabled }: { src: string; strokes: Stroke[]; onStrokes: (s: Stroke[]) => void; marking: boolean; disabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const drawing = useRef<Stroke | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  // The layer follows the picture's size (it grows while marking).
  useEffect(() => {
    const img = image.current
    if (!img || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (img.clientWidth && img.clientHeight) setSize({ w: img.clientWidth, h: img.clientHeight }) })
    ro.observe(img)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c || !size) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    drawStrokes(ctx, drawing.current ? [...strokes, drawing.current] : strokes, c.width, c.height)
  })

  const at = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  const redraw = () => setSize(s => (s ? { ...s } : s))

  return (
    <div className="relative w-fit max-w-full">
      <img ref={image} src={src} alt="Picture of the screen" draggable={false}
        onLoad={e => setSize({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })}
        className={`${marking ? 'max-h-[55dvh]' : 'max-h-44'} max-w-full rounded-lg border border-gray-200 select-none`} />
      {size && (
        <canvas ref={canvas} data-feedback-canvas
          style={{ width: size.w, height: size.h, touchAction: marking ? 'none' : 'auto' }}
          className={`absolute inset-0 rounded-lg ${marking && !disabled ? 'cursor-crosshair' : 'pointer-events-none'}`}
          onPointerDown={e => { if (!marking || disabled) return; e.currentTarget.setPointerCapture(e.pointerId); drawing.current = [at(e)]; redraw() }}
          onPointerMove={e => { if (!drawing.current) return; drawing.current.push(at(e)); redraw() }}
          onPointerUp={() => { if (!drawing.current) return; const s = drawing.current; drawing.current = null; onStrokes([...strokes, s]) }}
          onPointerCancel={() => { drawing.current = null; redraw() }}
        />
      )}
    </div>
  )
}

/** The windows a record opens in (their address params): a pipeline card, a quote, a job, a change order, a service request. */
const WINDOW_PARAMS = ['card', 'quote', 'qv', 'job', 'co', 'ticket']

/**
 * While a record's window is open it covers the top bar (on a phone the card window is the whole screen), so
 * the top bar's button cannot be reached: this one floats above the window, bottom left, so feedback sent from
 * there names the card, quote or job and its picture shows the window (walkthrough review, Oct 26 2026).
 */
export function FeedbackOverWindow({ screen = '' }: { screen?: string }) {
  const { params } = useNav()
  if (!WINDOW_PARAMS.some(k => params.has(k))) return null
  return <FeedbackButton screen={screen} floating />
}

export default function FeedbackButton({ screen = '', floating = false }: { screen?: string; floating?: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [marking, setMarking] = useState(false)

  async function start() {
    if (stage.kind !== 'idle') return
    const path = window.location.pathname + window.location.search
    setStage({ kind: 'capturing' })
    // Let the button show it is working before the page is drawn.
    await new Promise(r => setTimeout(r, 30))
    const shot = await captureScreen()
    setStrokes([]); setMarking(false)
    setStage({ kind: 'form', shot, failed: !shot, path, screen })
  }

  function close() { setStage({ kind: 'idle' }); setText(''); setSending(false); setStrokes([]); setMarking(false) }

  async function send() {
    if (stage.kind !== 'form' || sending) return
    if (!text.trim() && !stage.shot) return
    setSending(true)
    try {
      const shot = stage.shot ? await withMarks(stage.shot, strokes).catch(() => stage.shot) : null
      const r = await sendFeedback({ text, screenshot: shot, path: stage.path, screenTitle: stage.screen })
      if (r.sent) toast.success('Feedback sent', 'Thanks. Jonathan will see it.')
      else toast.info('Feedback saved on this phone', 'It will send by itself when there is signal.')
      close()
    } catch {
      setSending(false)
      toast.error('Feedback not saved', 'Try again in a moment.')
    }
  }

  const busy = stage.kind === 'capturing'
  return (
    <>
      <button type="button" onClick={start} disabled={busy || stage.kind === 'form'} data-feedback-button={floating ? 'window' : 'top'} data-feedback-skip
        aria-label="Send feedback" title="Send feedback"
        className={floating
          ? 'fixed z-[175] left-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:left-4 md:bottom-4 flex items-center justify-center gap-1.5 h-11 px-3 rounded-full bg-white text-gray-700 border border-gray-300 shadow-lg hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold'
          : 'flex items-center justify-center gap-1.5 w-11 h-11 md:w-auto md:h-9 md:px-2.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-60 text-sm'}>
        {busy ? <Loader2 size={20} className="animate-spin md:w-4 md:h-4" aria-hidden="true" /> : <MessageSquarePlus size={20} className="md:w-4 md:h-4" aria-hidden="true" />}
        <span className={floating ? '' : 'hidden xl:inline'}>{busy ? 'Taking picture...' : 'Feedback'}</span>
      </button>

      {stage.kind === 'form' && (
        <div className="fixed inset-0 z-[180] bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" data-feedback-skip onClick={e => { if (e.target === e.currentTarget && !sending) close() }}>
          <BackClose name="feedback" onClose={close} />
          <div role="dialog" aria-modal="true" aria-labelledby="feedback-title" data-feedback-form
            className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 id="feedback-title" className="text-base font-bold text-gray-900">Send feedback</h2>
              <button type="button" onClick={close} disabled={sending} aria-label="Close" className="w-11 h-11 -mr-2 grid place-items-center text-gray-500 hover:text-gray-900"><X size={20} aria-hidden="true" /></button>
            </div>

            {stage.shot ? (
              <div className="mb-3" data-feedback-thumb>
                <MarkedShot src={stage.shot} strokes={strokes} onStrokes={setStrokes} marking={marking} disabled={sending} />
                <div className="flex flex-wrap gap-2 mt-2">
                  <button type="button" onClick={() => setMarking(m => !m)} disabled={sending} aria-pressed={marking} data-feedback-mark
                    className={`btn btn-sm min-h-[44px] ${marking ? 'btn-primary' : 'btn-secondary'}`}>
                    <Pencil size={14} aria-hidden="true" /> {marking ? 'Done marking' : 'Mark it'}
                  </button>
                  {strokes.length > 0 && (
                    <button type="button" onClick={() => setStrokes(s => s.slice(0, -1))} disabled={sending} data-feedback-undo className="btn btn-secondary btn-sm min-h-[44px]">
                      <Undo2 size={14} aria-hidden="true" /> Undo
                    </button>
                  )}
                  <button type="button" onClick={() => { setStage({ ...stage, shot: null, failed: false }); setStrokes([]); setMarking(false) }} disabled={sending}
                    className="btn btn-secondary btn-sm min-h-[44px]" aria-label="Remove the picture" data-feedback-remove-shot>
                    <X size={14} aria-hidden="true" /> Remove picture
                  </button>
                </div>
                {marking && <p className="text-xs text-gray-500 mt-1">Draw on the picture with your finger or the mouse to point at what is wrong.</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-500 mb-3" data-feedback-noshot>
                {stage.failed ? 'The picture of the screen could not be made. Your feedback will be sent without it.' : 'No picture of the screen will be sent.'}
              </p>
            )}

            <label htmlFor="feedback-text" className="block text-sm font-medium text-gray-700 mb-1">One line: what's wrong or what should change?</label>
            <input id="feedback-text" type="text" value={text} onChange={e => setText(e.target.value)} maxLength={1000} autoFocus={!marking} disabled={sending}
              enterKeyHint="send" autoComplete="off" data-feedback-note
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send() } }}
              className="w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <p className="text-[11px] text-gray-400 mt-1" data-feedback-where>Sent with it: your name, this screen ({whereText(stage.screen, stage.path)}), the time, this phone or computer and the app version.</p>

            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={close} disabled={sending} className="btn btn-secondary min-h-[44px]">Cancel</button>
              <button type="button" onClick={send} disabled={sending || (!text.trim() && !stage.shot)} data-feedback-send className="btn btn-primary min-h-[44px]">
                {sending ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Sending...</> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
