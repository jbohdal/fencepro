/**
 * Voice on the quote screen. Typing stays the default: the Voice switch is
 * off until the salesman turns it on (remembered per user).
 *
 * With it on, "Walk me through it" asks for each side out loud ("Left
 * return?"), listens, applies what the phrase parser understood, reads it
 * back and moves on, until he says "done" or taps Stop. Odd answers are
 * asked about, never taken as is; anything not understood is shown and said
 * back. Where live listening cannot work, it records instead: the clip waits
 * on the phone until there is signal and is transcribed on the Mac.
 *
 * The small mic on each side's footage takes one quick entry for that side.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Mic, Square, Circle } from 'lucide-react'
import {
  parseUtterance, questionsFor, answerQuestion, applySideIntent, applySideOff, describeSide,
  type VoiceIntent, type VoiceQuestion,
} from './voiceParser'
import {
  voiceSupport, listenOnce, speak, startRecording, keepClip, waitingClips, uploadWaitingClips, listClips, markClipApplied, deleteClip,
  FALL_BACK_ERRORS, OUTBOX_EVENT, type ServerClip,
} from './voiceClient'
import { effectiveFinishes, type YardLayout } from './yardLayout'
import type { FenceStyle } from './configStore'

export interface VoiceHandle { quick: (sideName: string) => void }

interface Props {
  on: boolean
  onToggle: (on: boolean) => void
  layout: YardLayout | null
  setLayout: (fn: (l: YardLayout | null) => YardLayout | null) => void
  widthFt: number | null
  styles: FenceStyle[]
  currentStyle: FenceStyle | undefined
  onStyle: (styleId: string) => void
  totals: () => { footage: number; sections: number; price: number }
  onNote: (text: string) => void
  /** Opens the camera. */
  onPhoto?: () => void
  quoteKey: string
  readBack: boolean
  rate: number
}

type Mode = 'idle' | 'walking' | 'quick' | 'recording'

const VINYL = /^(WV|TV)-(ND|DS) ([68])'x([68])' Privacy$/

const VoicePanel = forwardRef<VoiceHandle, Props>(function VoicePanel(p, ref) {
  const support = useRef(voiceSupport()).current
  // Latest props, for the long running walk.
  const pr = useRef(p)
  pr.current = p
  const [mode, setMode] = useState<Mode>('idle')
  const [status, setStatus] = useState('')
  const [heard, setHeard] = useState('')
  const [notUnderstood, setNotUnderstood] = useState('')
  const [question, setQuestion] = useState<VoiceQuestion | null>(null)
  const [liveBroken, setLiveBrokenState] = useState(!support.recognition)
  // Read inside long running loops, so kept in a ref as well.
  const broken = useRef(!support.recognition)
  const setLiveBroken = (v: boolean) => { broken.current = v; setLiveBrokenState(v) }
  const [recordHint, setRecordHint] = useState<string | undefined>(undefined)
  const [waiting, setWaiting] = useState(0)
  const [clips, setClips] = useState<ServerClip[]>([])

  const layoutRef = useRef(p.layout)
  useEffect(() => { layoutRef.current = p.layout }, [p.layout])
  const undo = useRef<Array<YardLayout | null>>([])
  const stopFlag = useRef(false)
  const listening = useRef<{ stop: () => void } | null>(null)
  const recorder = useRef<{ stop: () => Promise<Blob>; mime: string } | null>(null)
  const answerRef = useRef<((len: number | null) => void) | null>(null)

  const say = useCallback((text: string) => speak(text, p.rate), [p.rate])
  const sayBack = useCallback((text: string) => (p.readBack ? speak(text, p.rate) : Promise.resolve()), [p.readBack, p.rate])

  // Clips for this quote: waiting on the phone, and on the Mac.
  const refreshClips = useCallback(async () => {
    setWaiting((await waitingClips(p.quoteKey)).length)
    setClips(await listClips(p.quoteKey))
  }, [p.quoteKey])
  useEffect(() => {
    if (!p.on) return
    refreshClips()
    const onBox = () => { refreshClips() }
    window.addEventListener(OUTBOX_EVENT, onBox)
    const t = setInterval(refreshClips, 20_000)
    return () => { window.removeEventListener(OUTBOX_EVENT, onBox); clearInterval(t) }
  }, [p.on, refreshClips])

  function change(next: (l: YardLayout | null) => YardLayout | null) {
    undo.current.push(layoutRef.current)
    p.setLayout(l => { const n = next(l); layoutRef.current = n; return n })
  }

  /** Hear one phrase; null when nothing came back. Switches to recording when live listening cannot work. */
  async function hear(): Promise<string | null> {
    const l = listenOnce()
    listening.current = l
    const r = await l.result
    listening.current = null
    if ('text' in r) { setHeard(r.text); return r.text }
    if (FALL_BACK_ERRORS.has(r.error)) {
      setLiveBroken(true)
      setStatus(r.error === 'network' ? 'No signal for live voice. Record instead; it is transcribed when signal is back.' : 'Live voice is not available here. Record instead; it is transcribed on the Mac.')
    }
    return null
  }

  /** Ask a question out loud and on screen; the answer can be said or tapped. */
  async function ask(q: VoiceQuestion): Promise<number | null> {
    setQuestion(q)
    const tapped = new Promise<number | null>(resolve => { answerRef.current = resolve })
    const spoken = (async () => {
      await say(q.text)
      for (let tries = 0; tries < 2 && !stopFlag.current; tries++) {
        const t = await hear()
        if (t === null) { if (broken.current) return null; continue }
        const a = answerQuestion(q, t)
        if (a) return a.lengthIn
        setNotUnderstood(t)
        await say(`I did not understand ${t}. ${q.text}`)
      }
      return null
    })()
    // Without live voice the answer can only be tapped, so wait for the tap.
    const ans = broken.current ? (spoken.catch(() => null), await tapped) : await Promise.race([tapped, spoken])
    listening.current?.stop()
    answerRef.current = null
    setQuestion(null)
    return ans
  }

  function styleFor(it: Extract<VoiceIntent, { kind: 'style' }>): FenceStyle | null {
    const cur = pr.current.currentStyle?.name.match(VINYL)
    const color = it.color ? (it.color === 'white' ? 'WV' : 'TV') : cur?.[1] ?? 'WV'
    const install = it.install ? (it.install === 'no-dig' ? 'ND' : 'DS') : cur?.[2] ?? 'ND'
    const height = it.heightFt ?? (cur ? Number(cur[3]) : 6)
    const width = it.widthFt ?? (cur ? Number(cur[4]) : 8)
    return pr.current.styles.find(s => s.isActive !== false && s.name === `${color}-${install} ${height}'x${width}' Privacy`) ?? null
  }

  /** Apply one phrase. Returns 'done', 'stop', or whether the side got its length. */
  async function handle(text: string, currentSide?: string): Promise<'done' | 'stop' | 'next' | 'again'> {
    const lay = layoutRef.current
    const r = parseUtterance(text, { sideNames: lay?.sides.map(s => s.name) ?? [], currentSide })
    // Keep the last thing not understood on screen until a phrase changes something.
    if (r.unknown.length) setNotUnderstood(r.unknown.join(' · '))
    else if (r.intents.some(i => i.kind === 'side' || i.kind === 'side-off' || i.kind === 'style' || i.kind === 'number')) setNotUnderstood('')
    if (r.unknown.length && r.intents.length === 0) { await say(`I did not understand: ${r.unknown.join(', ')}. Say it again.`); return 'again' }
    let filled = false
    for (const it of r.intents) {
      if (stopFlag.current) return 'stop'
      if (it.kind === 'done') return 'done'
      if (it.kind === 'stop') return 'stop'
      if (it.kind === 'undo') {
        if (undo.current.length) { const prev = undo.current.pop()!; p.setLayout(() => prev); layoutRef.current = prev; await say('Undone.') }
        else await say('Nothing to undo.')
        continue
      }
      if (it.kind === 'readback') {
        const l = layoutRef.current
        await say(l ? l.sides.map((s, i) => describeSide(s, effectiveFinishes(l, i))).join('. ') : 'No sides yet.')
        continue
      }
      if (it.kind === 'total') {
        const t = pr.current.totals()
        await say(t.footage > 0 ? `${Math.round(t.footage)} feet, ${t.sections} sections, ${Math.round(t.price).toLocaleString('en-US')} dollars.` : 'Nothing entered yet.')
        continue
      }
      if (it.kind === 'note') { pr.current.onNote(it.text); await sayBack('Note added.'); continue }
      if (it.kind === 'photo') {
        if (pr.current.onPhoto) { stopFlag.current = true; pr.current.onPhoto(); return 'stop' }
        await say('The camera is not available here.'); continue
      }
      if (it.kind === 'style') {
        const s = styleFor(it)
        if (s) { pr.current.onStyle(s.id); await sayBack(`Style: ${s.name}.`) } else await say('There is no style like that in Settings.')
        continue
      }
      if (it.kind === 'side-off') { change(l => (l ? applySideOff(l, it.side) : l)); await sayBack(`No ${it.side.toLowerCase()}.`); if (it.side === currentSide) filled = true; continue }
      if (it.kind === 'side') {
        let intent = it
        const q = layoutRef.current ? questionsFor(intent, layoutRef.current, pr.current.widthFt) : null
        if (q) {
          const len = await ask(q)
          if (len === null) { await say('I left it.'); continue }
          intent = { ...intent, lengthIn: len }
          const again = layoutRef.current ? questionsFor(intent, layoutRef.current, pr.current.widthFt) : null
          if (again && again.choices.length === 0) { await say('I left it.'); continue }
        }
        change(l => (l ? applySideIntent(l, intent) : l))
        const l = layoutRef.current
        const i = l ? l.sides.findIndex(s => s.name === intent.side) : -1
        if (l && i >= 0) await sayBack(describeSide(l.sides[i], effectiveFinishes(l, i)))
        if (intent.side === currentSide && (intent.lengthIn !== undefined || (l && i >= 0 && l.sides[i].lengthIn > 0))) filled = true
        continue
      }
      if (it.kind === 'number' && currentSide) { change(l => (l ? applySideIntent(l, { kind: 'side', side: currentSide, lengthIn: it.lengthIn }) : l)); filled = true; continue }
    }
    if (r.unknown.length) await say(`I did not understand: ${r.unknown.join(', ')}.`)
    return filled ? 'next' : 'again'
  }

  async function walk() {
    if (!layoutRef.current) { setStatus('Pick a yard shape first.'); return }
    stopFlag.current = false
    setMode('walking')
    try {
      const todo = layoutRef.current.sides.filter(s => s.on && !(s.lengthIn > 0)).map(s => s.name)
      const order = todo.length ? todo : layoutRef.current.sides.filter(s => s.on).map(s => s.name)
      for (let k = 0; k < order.length && !stopFlag.current; k++) {
        const side = order[k]
        if (!layoutRef.current?.sides.find(s => s.name === side)?.on) continue
        setStatus(`Asking: ${side}`)
        await say(`${side}?`)
        let misses = 0
        for (;;) {
          if (stopFlag.current) return
          const t = await hear()
          if (t === null) { if (broken.current || stopFlag.current) return; if (++misses >= 2) break; await say(`${side}?`); continue }
          const res = await handle(t, side)
          if (res === 'done' || res === 'stop') return
          if (res === 'next') break
        }
      }
      if (stopFlag.current) return
      setStatus('All sides asked. Say done, read it back, or change something.')
      await say('That is every side. Say done, read it back, or change something.')
      for (;;) {
        if (stopFlag.current) return
        const t = await hear()
        if (t === null) { if (broken.current) return; continue }
        const res = await handle(t)
        if (res === 'done' || res === 'stop') { await sayBack('Done.'); return }
      }
    } finally {
      setMode('idle'); setStatus(s => (s.startsWith('Asking') ? '' : s))
    }
  }

  function stopAll() {
    stopFlag.current = true
    listening.current?.stop()
    answerRef.current?.(null)
    window.speechSynthesis?.cancel()
    setMode('idle')
  }

  async function quick(sideName: string) {
    if (mode !== 'idle') return
    if (broken.current) { await startRec(sideName); return }
    stopFlag.current = false
    setMode('quick'); setStatus(`Listening for ${sideName}…`)
    try {
      const t = await hear()
      if (t !== null) await handle(t, sideName)
      else if (broken.current) await startRec(sideName)
    } finally { setMode(m => (m === 'quick' ? 'idle' : m)); setStatus('') }
  }
  useImperativeHandle(ref, () => ({ quick: (name: string) => { void quick(name) } }))

  async function startRec(hint?: string) {
    try {
      recorder.current = await startRecording()
      setRecordHint(hint); setMode('recording')
      setStatus(hint ? `Recording ${hint}. Say the length, gate and finishes, then tap Stop.` : 'Recording. Say each side, then tap Stop.')
    } catch {
      setStatus('The microphone is not available. Allow it in the phone settings for this site.')
    }
  }
  async function stopRec() {
    const r = recorder.current
    recorder.current = null
    setMode('idle')
    if (!r) return
    const blob = await r.stop()
    if (blob.size < 1000) { setStatus('That recording was empty.'); return }
    await keepClip(p.quoteKey, blob, r.mime, recordHint)
    setStatus(navigator.onLine ? 'Saved. It is sent to the Mac and transcribed in a minute or so.' : 'Saved on the phone. It uploads and is transcribed when there is signal.')
    refreshClips()
  }

  async function applyClip(c: ServerClip) {
    if (!c.transcript) return
    stopFlag.current = false
    setHeard(c.transcript)
    await handle(c.transcript, c.hint ?? undefined)
    await markClipApplied(c.id)
    refreshClips()
  }

  const busy = mode !== 'idle'
  const pendingClips = clips.filter(c => !c.appliedAt)

  return (
    <div className={`rounded-2xl border p-3 sm:p-4 ${p.on ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200 bg-white'}`} data-voice-panel>
      <div className="flex items-center gap-3">
        <button type="button" role="switch" aria-checked={p.on} aria-label="Voice" onClick={() => { if (p.on) stopAll(); p.onToggle(!p.on) }}
          className="shrink-0 w-14 h-12 grid place-items-center rounded-lg" data-voice-switch>
          <span className={`relative block w-12 h-7 rounded-full transition-colors ${p.on ? 'bg-orange-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${p.on ? 'translate-x-5' : ''}`} />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Voice</p>
          <p className="text-xs text-gray-600">{p.on ? (liveBroken ? 'Records, and the Mac types it out' : 'Talk through the yard; typing still works') : 'Off. Typing is the default.'}</p>
        </div>
      </div>

      {p.on && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {!liveBroken && mode !== 'walking' && <button type="button" className="btn btn-primary" disabled={busy || !p.layout} onClick={walk} data-voice-walk><Mic size={18} aria-hidden="true" /> Walk me through it</button>}
            {liveBroken && mode !== 'recording' && <button type="button" className="btn btn-primary" disabled={busy || !p.layout} onClick={() => startRec()} data-voice-record><Circle size={16} aria-hidden="true" /> Record</button>}
            {mode === 'recording' && <button type="button" className="btn btn-danger" onClick={stopRec} data-voice-stop-rec><Square size={16} aria-hidden="true" /> Stop and save</button>}
            {(mode === 'walking' || mode === 'quick') && <button type="button" className="btn btn-danger" onClick={stopAll} data-voice-stop><Square size={16} aria-hidden="true" /> Stop</button>}
          </div>
          {!p.layout && <p className="text-xs text-gray-600">Pick a yard shape first, then the app asks for each side.</p>}
          {status && <p className="text-sm text-gray-800" data-voice-status>{status}</p>}
          {heard && <p className="text-sm text-gray-700" data-voice-heard>Heard: “{heard}”</p>}
          {notUnderstood && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-2 py-1" data-voice-unknown>Did not understand: “{notUnderstood}”</p>}
          {question && (
            <div className="rounded-lg border border-orange-300 bg-white p-2" data-voice-question>
              <p className="text-sm font-semibold text-gray-900">{question.text}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {question.choices.map(c => <button key={c.say} type="button" className="btn btn-secondary btn-sm" onClick={() => answerRef.current?.(c.lengthIn)}>{c.say === 'yes' ? 'Keep it' : c.say}</button>)}
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => answerRef.current?.(null)}>Leave it</button>
              </div>
            </div>
          )}
          {(waiting > 0 || pendingClips.length > 0) && (
            <div className="rounded-lg bg-white border border-gray-200 p-2 space-y-1" data-voice-clips>
              {waiting > 0 && <p className="text-xs text-gray-700">{waiting} recording{waiting === 1 ? '' : 's'} waiting for signal on this phone.</p>}
              {pendingClips.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-xs" data-voice-clip={c.status}>
                  <span className="flex-1 min-w-0 truncate">{c.status === 'done' ? `“${c.transcript}”` : c.status === 'failed' ? 'Could not be transcribed.' : 'Being transcribed on the Mac…'}</span>
                  {c.status === 'done' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => applyClip(c)} data-voice-apply>Apply</button>}
                  <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { await deleteClip(c.id); refreshClips() }}>Dismiss</button>
                </div>
              ))}
              {waiting > 0 && <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { await uploadWaitingClips(); refreshClips() }}>Send now</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default VoicePanel
