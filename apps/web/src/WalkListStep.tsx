/**
 * The quote builder's Yard step as a walk list (Jonathan, Nov 5 2026;
 * walkList.ts): the salesperson walks the fence line with the measuring wheel
 * and the phone builds the fence one step at a time. One thumb: the feet box
 * and the big buttons are at the bottom; the total feet stay at the top; the
 * list of steps (tap one to fix it), a big Undo and a rough sketch ("not to
 * scale", nothing to drag) sit above. The quote is priced from the walk the
 * same way it was from the drawing (walkToYard → deriveLayout).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyWalk, feetText, fenceIn, lineDone, sketchSvgBody, stepLines, teesOf, totalIn, walkId, walkProblems,
  type Turn, type WalkLine, type WalkList, type WalkStep, type WalkWhat,
} from './walkList'
import { listenOnce } from './voiceClient'
import { readLength, words as voiceWords } from './voiceParser'
import DrawOnPhoto from './DrawOnPhoto'
import type { GateType } from './yardLayout'

const BIG = '!min-h-[56px] rounded-xl text-lg font-semibold px-3 border-2 active:scale-[0.99]'
const DARK = `${BIG} bg-gray-900 border-gray-900 text-white`
const LIGHT = `${BIG} bg-white border-gray-900 text-gray-900`
const ORANGE = `${BIG} bg-orange-600 border-orange-700 text-white`
const GATE_WIDTHS = [4, 5, 6, 8, 10, 12]

/** "48", "48.5", "48 6" (feet inches), "48'6\"" → inches; null when blank or not a length. */
function inchesOf(t: string): number | null {
  const s = t.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'")
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i)
  if (!m) return null
  const inch = m[2] ? parseFloat(m[2]) : 0
  if (inch >= 12) return null
  return Math.round((parseFloat(m[1]) * 12 + inch) * 8) / 8
}
const feetBox = (inches: number) => (inches > 0 ? String(Math.round((inches / 12) * 100) / 100) : '')

type Ask = null | { kind: 'turn' } | { kind: 'gate' }

export default function WalkListStep({ walk: walk0, onChange, onDone, locked = false, voice = false, address = '', tape }: {
  walk: WalkList | null
  onChange: (w: WalkList) => void
  /** Done, show me prices. */
  onDone: () => void
  /** Signed and not a change order: read only. */
  locked?: boolean
  voice?: boolean
  /** The job's address, for Look at the map. */
  address?: string
  /** Steps whose feet are close to a section's width either way (walkList tapeSteps). */
  tape?: Set<string>
}) {
  const walk = walk0 ?? emptyWalk()
  const [feet, setFeet] = useState('')
  const [ask, setAsk] = useState<Ask>(null)
  const [gateW, setGateW] = useState<number | null>(null)
  const [gateOther, setGateOther] = useState('')
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState<{ lineId: string; stepId: string } | null>(null)
  const [map, setMap] = useState(false)
  const [listening, setListening] = useState(false)
  const feetRef = useRef<HTMLInputElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // The line being walked: the last one not finished; none once every line ends (the finish screen).
  const active = [...walk.lines].reverse().find(l => !lineDone(l)) ?? null
  const finished = !active && walk.lines.some(l => l.steps.length)
  const tees = teesOf(walk)
  const branched = new Set(walk.lines.map(l => l.fromTee).filter(Boolean))
  const list = useMemo(() => stepLines(walk), [walk])
  // The side being walked: the one after the last corner or end, else the last one's.
  const lastLine = list[list.length - 1]
  const lastStep = lastLine ? walk.lines.find(l => l.id === lastLine.lineId)?.steps.find(x => x.id === lastLine.stepId) : undefined
  const sideNow = !lastLine ? 1 : lastStep && ['corner', 'end', 'start'].includes(lastStep.what) ? lastLine.side + 1 : lastLine.side
  const hostTee = active?.fromTee ? tees.find(t => t.step.id === active.fromTee) : undefined

  useEffect(() => { if (!locked && active && !edit) setTimeout(() => feetRef.current?.focus({ preventScroll: true }), 50) }, [active?.id, active?.steps.length, locked, edit])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [walk.lines.length, active?.steps.length, ask, finished])  // eslint-disable-line react-hooks/exhaustive-deps

  const put = (lines: WalkLine[]) => onChange({ v: 1, lines })
  const addStep = (what: WalkWhat, extra: Partial<WalkStep> = {}) => {
    if (!active) return
    if (active.fromTee && active.steps.length === 0 && !active.branchTurn) { setMsg('Tap Goes left or Goes right first: which way the branch goes from the tee.'); return }
    const inches = inchesOf(feet) ?? 0
    if (what !== 'gate' && !(inches > 0)) { setMsg(`Type the feet to this ${what === 'corner' ? 'corner' : what === 'tee' ? 'tee' : what === 'end' ? 'end post' : 'start post'} first.`); feetRef.current?.focus(); return }
    if (what === 'start' && !active.steps.some(s => s.what === 'corner')) { setMsg('Back to start needs at least one corner first.'); return }
    const step: WalkStep = { id: walkId(what[0]), feetIn: inches, what, ...extra }
    put(walk.lines.map(l => (l.id === active.id ? { ...l, steps: [...l.steps, step] } : l)))
    setFeet(''); setAsk(null); setGateW(null); setGateOther(''); setMsg('')
  }
  const undo = () => {
    const lines = walk.lines.map(l => ({ ...l, steps: [...l.steps] }))
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].steps.length) {
        const gone = lines[i].steps.pop()!
        // A tee taken away takes its branch with it (nothing measured from it yet, or Undo again).
        const rest = gone.what === 'tee' ? lines.filter(l => l.fromTee !== gone.id) : lines
        put(rest.length ? rest : emptyWalk().lines)
        setMsg(''); return
      }
      if (lines.length > 1) { lines.splice(i, 1); put(lines); return }
    }
  }
  const newLine = (fromTee?: string) => { put([...walk.lines, { id: walkId('l'), ...(fromTee ? { fromTee } : {}), steps: [] }]); setMsg('') }

  async function hear() {
    if (listening) return
    setListening(true); setMsg('Listening… say the feet, like "forty eight feet".')
    const r = await listenOnce(8000).result
    setListening(false)
    if ('error' in r) { setMsg('Voice did not hear it. Type the feet instead.'); return }
    const w = voiceWords(r.text)
    for (let i = 0; i < w.length; i++) { const got = readLength(w, i); if (got) { setFeet(feetBox(got.inches)); setMsg(`Heard ${feetText(got.inches)}.`); return } }
    setMsg(`Heard "${r.text}" but no feet in it. Type the feet instead.`)
  }

  const gateWidthIn = gateW ?? (inchesOf(gateOther) || null)
  const problems = walkProblems(walk)
  const editing = edit ? walk.lines.find(l => l.id === edit.lineId)?.steps.find(s => s.id === edit.stepId) ?? null : null

  return (
    <div className="space-y-4" data-walk>
      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-white border-b border-gray-200 flex items-baseline justify-between" data-walk-total>
        <span className="text-sm font-semibold text-gray-700">Total walked{totalIn(walk) > fenceIn(walk) ? <span className="block text-xs font-medium text-gray-600" data-walk-fence-feet>{feetText(fenceIn(walk))} of fence + {feetText(totalIn(walk) - fenceIn(walk))} of gates</span> : null}</span>
        <span className="text-2xl font-extrabold text-gray-900">{feetText(totalIn(walk))}</span>
      </div>

      {list.length > 0 && (
        <ol className="space-y-1.5" data-walk-list>
          {list.map(l => (
            <li key={l.stepId}>
              <button type="button" disabled={locked} onClick={() => setEdit({ lineId: l.lineId, stepId: l.stepId })}
                className={`w-full text-left rounded-xl border-2 px-3 !min-h-[56px] text-base font-medium ${l.problem ? 'border-red-600 bg-red-50 text-red-900' : 'border-gray-300 bg-white text-gray-900'}`} data-walk-step={l.stepId}>
                {l.text}
                {tape?.has(l.stepId) && <span className="block text-amber-800 text-sm font-semibold" data-tape-flag>Check this with a tape measure. A few inches either way changes the number of sections.</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
      {list.length > 0 && (
        <figure className="rounded-xl border border-gray-300 bg-white p-2" data-walk-sketch>
          <svg viewBox="0 0 340 220" className="w-full h-auto" role="img" aria-label="Rough sketch, not to scale" dangerouslySetInnerHTML={{ __html: sketchSvgBody(walk, 340, 220) }} />
        </figure>
      )}

      {!locked && <div className="space-y-3 pb-2" data-walk-entry>
        {msg && <p className="text-base font-semibold text-red-800 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2" role="alert" data-walk-msg>{msg}</p>}

        {active && !ask && (
          <>
            <p className="text-lg font-bold text-gray-900" data-walk-prompt>
              {active.steps.length === 0
                ? (hostTee ? `Stand at Tee ${hostTee.n}. Walk the branch.` : walk.lines.indexOf(active) === 0 ? 'Stand where the fence starts.' : 'Stand where this fence line starts.')
                : `Side ${sideNow}: walk to the next corner, gate or end.`}
            </p>
            {hostTee && active.steps.length === 0 && (
              <div className="space-y-1" data-walk-branch-turn>
                <p className="text-base text-gray-800">Which way does the branch go, looking along the fence the way you walked it?</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['left', 'right'] as const).map(t => (
                    <button key={t} type="button" className={active.branchTurn === t ? DARK : LIGHT} aria-pressed={active.branchTurn === t}
                      onClick={() => { put(walk.lines.map(l => (l.id === active.id ? { ...l, branchTurn: t } : l))); setMsg('') }} data-walk-branch-way={t}>Goes {t}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="sr-only">Feet</span>
                <input ref={feetRef} inputMode="decimal" enterKeyHint="next" className="w-full min-h-[64px] rounded-xl border-2 border-gray-900 px-4 text-3xl font-bold text-gray-900" placeholder="Feet"
                  value={feet} onChange={e => { setFeet(e.target.value); setMsg('') }} data-walk-feet />
              </label>
              {voice && <button type="button" className={`${LIGHT} w-20`} onClick={() => void hear()} aria-label="Say the feet" data-walk-voice>{listening ? '…' : 'Say'}</button>}
            </div>
            <p className="text-base font-semibold text-gray-700">What's here?</p>
            <div className="grid grid-cols-2 gap-2" data-walk-what>
              <button type="button" className={DARK} onClick={() => { if (!(inchesOf(feet) ?? 0)) { setMsg('Type the feet to this corner first.'); return } setAsk({ kind: 'turn' }) }} data-walk-corner>Corner</button>
              <button type="button" className={DARK} onClick={() => setAsk({ kind: 'gate' })} data-walk-gate>Gate</button>
              <button type="button" className={LIGHT} onClick={() => addStep('tee')} data-walk-tee>Tee<span className="block text-xs font-normal">a fence branches off here</span></button>
              <button type="button" className={LIGHT} onClick={() => addStep('end')} data-walk-end>End post</button>
              {!active.fromTee && <button type="button" className={`${LIGHT} col-span-2`} onClick={() => addStep('start')} data-walk-start>Back to start</button>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={LIGHT} onClick={undo} disabled={!list.length} data-walk-undo>Undo</button>
              <button type="button" className={LIGHT} onClick={() => setMap(true)} data-walk-map>Look at the map</button>
            </div>
          </>
        )}

        {active && ask?.kind === 'turn' && (
          <>
            <p className="text-lg font-bold text-gray-900">Corner at {feetText(inchesOf(feet) ?? 0)}. Which way does the fence turn?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={DARK} onClick={() => addStep('corner', { turn: 'left' as Turn })} data-walk-left>Turns left</button>
              <button type="button" className={DARK} onClick={() => addStep('corner', { turn: 'right' as Turn })} data-walk-right>Turns right</button>
            </div>
            <button type="button" className={`${LIGHT} w-full`} onClick={() => setAsk(null)}>Back</button>
          </>
        )}

        {active && ask?.kind === 'gate' && (
          <>
            <p className="text-lg font-bold text-gray-900">Gate{(inchesOf(feet) ?? 0) > 0 ? ` after ${feetText(inchesOf(feet)!)}` : ' here'}. How wide?</p>
            <div className="grid grid-cols-3 gap-2" data-walk-gate-widths>
              {GATE_WIDTHS.map(w => (
                <button key={w} type="button" className={gateW === w * 12 ? ORANGE : LIGHT} onClick={() => { setGateW(w * 12); setGateOther('') }} data-walk-gate-width={w}>{w} ft</button>
              ))}
            </div>
            <input inputMode="decimal" className="w-full !min-h-[56px] rounded-xl border-2 border-gray-900 px-4 text-xl" placeholder="Other width, feet" value={gateOther} onChange={e => { setGateOther(e.target.value); setGateW(null) }} data-walk-gate-other />
            <div className="grid grid-cols-2 gap-2">
              {(['walk', 'double'] as GateType[]).map(t => (
                <button key={t} type="button" className={DARK} disabled={!gateWidthIn} onClick={() => addStep('gate', { gate: { widthIn: gateWidthIn!, type: t } })} data-walk-gate-kind={t}>{t === 'walk' ? 'Single' : 'Double'}</button>
              ))}
            </div>
            {!gateWidthIn && <p className="text-sm text-gray-700">Pick the width, then Single or Double. The walk goes on past the gate.</p>}
            <button type="button" className={`${LIGHT} w-full`} onClick={() => setAsk(null)}>Back</button>
          </>
        )}

        {finished && (
          <div className="space-y-2" data-walk-finish>
            <p className="text-lg font-bold text-gray-900">The fence is walked.</p>
            {tees.filter(t => !branched.has(t.step.id)).map(t => (
              <button key={t.step.id} type="button" className={`${LIGHT} w-full`} onClick={() => newLine(t.step.id)} data-walk-branch={t.n}>Add a branch from Tee {t.n}</button>
            ))}
            <button type="button" className={`${LIGHT} w-full`} onClick={() => newLine()} data-walk-another>Start another fence line</button>
            <button type="button" className={`${ORANGE} w-full`} disabled={problems.length > 0} onClick={onDone} data-walk-done>Done, show me prices</button>
            {problems.map(p => <p key={p} className="text-base font-semibold text-red-800" data-walk-problem>{p}</p>)}
            <button type="button" className={`${LIGHT} w-full`} onClick={undo} data-walk-undo>Undo</button>
          </div>
        )}
        {/* Scrolled to after each step, clear of the price bar at the bottom of the screen. */}
        <div ref={bottomRef} style={{ scrollMarginBottom: 240 }} />
      </div>}

      {edit && editing && (
        <StepEditor step={editing} isLast={walk.lines.find(l => l.id === edit.lineId)?.steps.slice(-1)[0]?.id === edit.stepId}
          onClose={() => setEdit(null)}
          onSave={next => { put(walk.lines.map(l => (l.id !== edit.lineId ? l : { ...l, steps: l.steps.map(s => (s.id === edit.stepId ? next : s)) }))); setEdit(null) }}
          onSplit={parts => { put(walk.lines.map(l => (l.id !== edit.lineId ? l : { ...l, steps: l.steps.flatMap(s => (s.id === edit.stepId ? parts : [s])) }))); setEdit(null) }}
          onDelete={() => {
            const gone = editing
            put(walk.lines.map(l => (l.id !== edit.lineId ? l : { ...l, steps: l.steps.filter(s => s.id !== edit.stepId) })).filter(l => !(gone.what === 'tee' && l.fromTee === gone.id)))
            setEdit(null)
          }} />
      )}
      {map && (
        <DrawOnPhoto address={address} onClose={() => setMap(false)} onUse={y => {
          const inches = y.sides.filter(s => s.on).reduce((t, s) => t + (s.lengthIn || 0), 0)
          if (inches > 0) { setFeet(feetBox(inches)); setMsg(`From the map: ${feetText(inches)}. Check it, then tap what's there.`) }
          setMap(false)
        }} />
      )}
    </div>
  )
}

/** Fix one step: its feet, what is there, the turn, the gate. */
function StepEditor({ step, isLast, onSave, onSplit, onDelete, onClose }: { step: WalkStep; isLast: boolean; onSave: (s: WalkStep) => void; onSplit: (parts: WalkStep[]) => void; onDelete: () => void; onClose: () => void }) {
  const [feet, setFeet] = useState(feetBox(step.feetIn))
  const [what, setWhat] = useState<WalkWhat>(step.what)
  const [turn, setTurn] = useState<Turn>(step.turn ?? 'left')
  const [gw, setGw] = useState(step.gate ? feetBox(step.gate.widthIn) : '4')
  const [gt, setGt] = useState<GateType>(step.gate?.type ?? 'walk')
  const [err, setErr] = useState('')
  // A gate put into this stretch (a change order on a walked job): the feet before it, its width and kind.
  const [addGate, setAddGate] = useState(false)
  const [gAt, setGAt] = useState('')
  const [gNewW, setGNewW] = useState('4')
  const [gNewT, setGNewT] = useState<GateType>('walk')
  const save = () => {
    if (addGate) {
      const at = inchesOf(gAt), width = inchesOf(gNewW) ?? 0
      if (at == null) { setErr('Type the feet from the corner, gate or post before the new gate.'); return }
      if (!(width > 0)) { setErr('Type the gate width.'); return }
      const rest = step.feetIn - at - width
      if (!(rest > 0)) { setErr(`The gate does not fit: this stretch is ${feetText(step.feetIn)}. Type fewer feet before it, or a narrower gate.`); return }
      onSplit([{ id: walkId('g'), feetIn: at, what: 'gate', gate: { widthIn: width, type: gNewT } }, { ...step, feetIn: rest }])
      return
    }
    const inches = inchesOf(feet) ?? 0
    if (what !== 'gate' && !(inches > 0)) { setErr('Type the feet.'); return }
    const width = inchesOf(gw) ?? 0
    if (what === 'gate' && !(width > 0)) { setErr('Type the gate width.'); return }
    onSave({ id: step.id, feetIn: inches, what, ...(what === 'corner' ? { turn } : {}), ...(what === 'gate' ? { gate: { widthIn: width, type: gt } } : {}) })
  }
  const choices: Array<[WalkWhat, string]> = [['corner', 'Corner'], ['gate', 'Gate'], ['tee', 'Tee'], ['end', 'End post'], ['start', 'Back to start']]
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Fix this step" data-walk-edit>
      <div className="bg-white w-full max-w-lg rounded-t-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <p className="text-lg font-bold text-gray-900">Fix this step</p>
        <label className="block text-base font-semibold text-gray-700">Feet
          <input inputMode="decimal" autoFocus className="mt-1 w-full min-h-[60px] rounded-xl border-2 border-gray-900 px-4 text-2xl font-bold" value={feet} onChange={e => setFeet(e.target.value)} data-walk-edit-feet />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {choices.filter(([k]) => k === step.what || isLast || (k !== 'end' && k !== 'start' && step.what !== 'end' && step.what !== 'start')).map(([k, t]) => (
            <button key={k} type="button" className={what === k ? DARK : LIGHT} onClick={() => setWhat(k)} data-walk-edit-what={k}>{t}</button>
          ))}
        </div>
        {what === 'corner' && <div className="grid grid-cols-2 gap-2">{(['left', 'right'] as Turn[]).map(t => <button key={t} type="button" className={turn === t ? DARK : LIGHT} onClick={() => setTurn(t)}>Turns {t}</button>)}</div>}
        {what === 'gate' && <>
          <label className="block text-base font-semibold text-gray-700">Gate width, feet
            <input inputMode="decimal" className="mt-1 w-full !min-h-[56px] rounded-xl border-2 border-gray-900 px-4 text-xl" value={gw} onChange={e => setGw(e.target.value)} data-walk-edit-gate-width />
          </label>
          <div className="grid grid-cols-2 gap-2">{(['walk', 'double'] as GateType[]).map(t => <button key={t} type="button" className={gt === t ? DARK : LIGHT} onClick={() => setGt(t)}>{t === 'walk' ? 'Single' : 'Double'}</button>)}</div>
        </>}
        {step.feetIn > 0 && (
          <button type="button" className={`${addGate ? DARK : LIGHT} w-full`} aria-pressed={addGate} onClick={() => { setAddGate(v => !v); setErr('') }} data-walk-edit-add-gate>Put a gate in this stretch</button>
        )}
        {addGate && <div className="space-y-2 rounded-xl border-2 border-gray-300 p-3">
          <label className="block text-base font-semibold text-gray-700">Feet from the corner, gate or post before it
            <input inputMode="decimal" className="mt-1 w-full !min-h-[56px] rounded-xl border-2 border-gray-900 px-4 text-xl" value={gAt} onChange={e => setGAt(e.target.value)} data-walk-edit-gate-at />
          </label>
          <label className="block text-base font-semibold text-gray-700">Gate width, feet
            <input inputMode="decimal" className="mt-1 w-full !min-h-[56px] rounded-xl border-2 border-gray-900 px-4 text-xl" value={gNewW} onChange={e => setGNewW(e.target.value)} data-walk-edit-new-gate-width />
          </label>
          <div className="grid grid-cols-2 gap-2">{(['walk', 'double'] as GateType[]).map(t => <button key={t} type="button" className={gNewT === t ? DARK : LIGHT} onClick={() => setGNewT(t)} data-walk-edit-new-gate-kind={t}>{t === 'walk' ? 'Single' : 'Double'}</button>)}</div>
          <p className="text-sm text-gray-700">The stretch keeps its {feetText(step.feetIn)}: the gate and the fence after it fill the rest.</p>
        </div>}
        {err && <p className="text-base font-semibold text-red-800" role="alert">{err}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={LIGHT} onClick={onClose}>Cancel</button>
          <button type="button" className={ORANGE} onClick={save} data-walk-edit-save>Save</button>
        </div>
        <button type="button" className={`${LIGHT} w-full text-red-800 border-red-700`} onClick={() => { if (window.confirm(step.what === 'tee' ? 'Take this step away? A branch from this tee goes with it.' : 'Take this step away?')) onDelete() }} data-walk-edit-delete>Take this step away</button>
      </div>
    </div>
  )
}
