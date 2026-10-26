/**
 * Big number pad for a length in feet and inches (80' 4"). A bottom sheet on
 * the phone, a small dialog on a computer, where the keyboard works too:
 * digits, Backspace, ' or space to move to inches, Enter for done.
 */

import { useEffect, useState } from 'react'
import { Delete } from 'lucide-react'
import { useBackLayer } from './nav'

// Inside the website widget the pad must not touch the page's history (it sits in someone else's page).
const noLayer = (_onClose: () => void, _opts?: unknown) => {}

export default function FtInPad({ title, valueIn, onDone, onClose, nextLabel, action, history = true }: {
  title: string
  valueIn: number
  /** Called with the length in inches. `next` is true when Next was tapped. */
  onDone: (inches: number, next: boolean) => void
  onClose: () => void
  /** Shown on the Next button, e.g. "Next: Back". Hidden when absent. */
  nextLabel?: string
  /** In place of Next: one button that keeps the length and goes on (a change order: "Make change order"), no Done first. */
  action?: { label: string; onTap: (inches: number) => void }
  /** false: Back does not close it (the website widget). */
  history?: boolean
}) {
  // Fixed for the life of the pad, so the same hook runs every render.
  ;(history ? useBackLayer : noLayer)(onClose, { key: 'ft-in-pad' })
  const startFt = valueIn > 0 ? Math.floor(valueIn / 12) : 0
  const startIn = valueIn > 0 ? Math.round((valueIn - startFt * 12) * 8) / 8 : 0
  const [ft, setFt] = useState(valueIn > 0 ? String(startFt) : '')
  const [inch, setInch] = useState(startIn ? String(startIn) : '')
  const [field, setField] = useState<'ft' | 'in'>('ft')
  // Typing replaces a length that was already there.
  const [fresh, setFresh] = useState(valueIn > 0)

  const total = (parseInt(ft || '0', 10) || 0) * 12 + (parseFloat(inch || '0') || 0)

  function digit(d: string) {
    if (field === 'ft') {
      setFt(f => (fresh ? d : (f === '0' ? d : f + d).slice(0, 4)))
      if (fresh) setInch('')
    } else {
      setInch(i => {
        const next = fresh ? d : i === '0' ? d : i + d
        return Number(next) < 12 ? next : i
      })
    }
    setFresh(false)
  }
  function back() {
    setFresh(false)
    if (field === 'in') {
      if (inch) setInch(i => i.slice(0, -1))
      else setField('ft')
    } else setFt(f => f.slice(0, -1))
  }
  function finish(next: boolean) { onDone(total, next) }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); digit(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); back() }
      else if (e.key === "'" || e.key === ' ' || e.key === '"') { e.preventDefault(); setField(f => (f === 'ft' ? 'in' : 'ft')); setFresh(false) }
      else if (e.key === 'Enter') { e.preventDefault(); finish(!!nextLabel) }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const seg = (which: 'ft' | 'in', text: string, unit: string) => (
    <button type="button" onClick={() => { setField(which); setFresh(false) }}
      className={`rounded-xl px-3 py-2 tabular-nums ${field === which ? 'bg-orange-50 ring-2 ring-orange-500' : ''}`}
      aria-label={which === 'ft' ? 'Feet' : 'Inches'} data-pad-field={which}>
      <span className="text-4xl font-bold text-gray-900">{text || '0'}</span>
      <span className="text-2xl text-gray-500 ml-0.5">{unit}</span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full md:w-[380px] rounded-t-2xl md:rounded-2xl shadow-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
        onClick={e => e.stopPropagation()} role="dialog" aria-label={`Length of ${title}`} data-ftin-pad>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700">{title}</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>Cancel</button>
        </div>
        <div className="flex items-baseline justify-center gap-2 py-2">
          {seg('ft', ft, "'")}
          {seg('in', inch, '"')}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button key={d} type="button" onClick={() => digit(d)} className="h-14 rounded-xl bg-gray-100 text-2xl font-semibold text-gray-900 active:bg-gray-200" data-pad-key={d}>{d}</button>
          ))}
          <button type="button" onClick={() => { setField(f => (f === 'ft' ? 'in' : 'ft')); setFresh(false) }}
            className="h-14 rounded-xl bg-gray-100 text-base font-semibold text-gray-800 active:bg-gray-200" data-pad-key="unit">
            {field === 'ft' ? 'Inches' : 'Feet'}
          </button>
          <button type="button" onClick={() => digit('0')} className="h-14 rounded-xl bg-gray-100 text-2xl font-semibold text-gray-900 active:bg-gray-200" data-pad-key="0">0</button>
          <button type="button" onClick={back} className="h-14 rounded-xl bg-gray-100 grid place-items-center text-gray-800 active:bg-gray-200" aria-label="Delete" data-pad-key="back">
            <Delete size={24} aria-hidden="true" />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => finish(false)} className={`btn ${nextLabel || action ? 'btn-secondary' : 'btn-primary'} btn-lg flex-1`} data-pad-done>Done</button>
          {action
            ? <button type="button" onClick={() => action.onTap(total)} className="btn btn-primary btn-lg flex-1" data-pad-action>{action.label}</button>
            : nextLabel && <button type="button" onClick={() => finish(true)} className="btn btn-primary btn-lg flex-1" data-pad-next>{nextLabel}</button>}
        </div>
      </div>
    </div>
  )
}
