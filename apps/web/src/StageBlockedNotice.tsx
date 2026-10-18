/**
 * Shown when the server refused a move because the stage's requirements are
 * not met: the card is already back where it was; this says what is missing.
 */

import { useEffect, useState } from 'react'
import { STAGE_BLOCKED_EVENT, type BlockedMove } from './stageBlocked'
import { navigate } from './nav'

export default function StageBlockedNotice() {
  const [blocked, setBlocked] = useState<BlockedMove[] | null>(null)
  useEffect(() => {
    const h = (e: Event) => setBlocked((e as CustomEvent<BlockedMove[]>).detail)
    window.addEventListener(STAGE_BLOCKED_EVENT, h)
    return () => window.removeEventListener(STAGE_BLOCKED_EVENT, h)
  }, [])
  if (!blocked?.length) return null
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => setBlocked(null)} data-stage-blocked>
      <div role="alertdialog" aria-modal="true" aria-labelledby="stage-blocked-title" onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))] space-y-4">
        {blocked.map(b => (
          <div key={b.id} className="space-y-2">
            <h2 id="stage-blocked-title" className="text-lg font-bold text-gray-900">{b.name} can't move to {b.to} yet</h2>
            <p className="text-sm text-gray-600">It stays in {b.from || 'its stage'}. Still needed:</p>
            <ul className="space-y-2">
              {b.missing.map(m => (
                <li key={m.type} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-missing={m.type}>
                  <p className="text-sm font-semibold text-amber-900">{m.label}</p>
                  <p className="text-sm text-amber-800">{m.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary flex-1" onClick={() => setBlocked(null)}>OK</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setBlocked(null); navigate('/automations') }}>Stage rules</button>
        </div>
      </div>
    </div>
  )
}
