/**
 * Settings → Warranties: the named warranties (name, how long, the words the
 * customer reads and signs), which one each kind of install gets, and a line
 * added for a material (wood: no warranty on the wood itself). Saved with the
 * rest of Settings (the Save changes bar; versioned, in the change log).
 *
 * New quotes get these when saved; a proposal already sent or signed keeps
 * the warranty it went out with (warranties.ts).
 */

import type { AppConfig } from './configStore'
import { warrantySettingsOf, INSTALL_KINDS, EXTRA_MATERIALS, newWarrantyId, type Warranty, type WarrantySettings as WS } from './warranties'

export default function WarrantySettings({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const ws = warrantySettingsOf(config)
  const set = (next: WS) => onChange({ ...config, warranties: next })
  const setW = (id: string, patch: Partial<Warranty>) => set({ ...ws, list: ws.list.map(w => (w.id === id ? { ...w, ...patch } : w)) })
  const used = (id: string) => INSTALL_KINDS.filter(k => (ws.byInstall[k.key] ?? ws.byInstall.other) === id)
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 h-11 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

  function add() {
    const name = 'New warranty'
    set({ ...ws, list: [...ws.list, { id: newWarrantyId(name, ws.list.map(w => w.id)), name, text: '', term: 'years', years: 1 }] })
  }
  function remove(w: Warranty) {
    if (used(w.id).length) return
    if (!window.confirm(`Remove "${w.name}"? Quotes already sent keep their words.`)) return
    set({ ...ws, list: ws.list.filter(x => x.id !== w.id) })
  }

  return (
    <div className="space-y-8" data-warranty-settings>
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Warranties</h3>
        <p className="text-sm text-gray-600">Each option on a proposal shows its warranty as a badge, and the customer reads the words of the option they pick. The accepted option's warranty goes on the signed contract, the warranty certificate and the job. A proposal already sent or signed keeps the words it went out with; changes here apply to quotes saved from now on.</p>
      </div>

      <div className="space-y-4">
        {ws.list.map(w => {
          const u = used(w.id)
          return (
            <div key={w.id} className="rounded-xl border border-gray-200 p-3 space-y-2" data-warranty={w.id}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <label className="block text-xs text-gray-600">Name (the badge on the option)
                  <input className={inputCls + ' mt-1'} value={w.name} maxLength={80} onChange={e => setW(w.id, { name: e.target.value })} data-warranty-name />
                </label>
                <label className="block text-xs text-gray-600">How long
                  <div className="flex gap-2 mt-1">
                    <select className="border border-gray-300 rounded-lg px-2 h-11 text-sm" value={w.term} onChange={e => setW(w.id, e.target.value === 'lifetime' ? { term: 'lifetime', years: undefined } : { term: 'years', years: w.years ?? 1 })} data-warranty-term>
                      <option value="lifetime">As long as they own the home</option>
                      <option value="years">Years from the install date</option>
                    </select>
                    {w.term === 'years' && (
                      <input type="number" min={1} max={50} className="w-20 border border-gray-300 rounded-lg px-2 h-11 text-sm" value={w.years ?? 1}
                        onChange={e => setW(w.id, { years: Math.max(1, Math.min(50, parseInt(e.target.value) || 1)) })} aria-label="Years" data-warranty-years />
                    )}
                  </div>
                </label>
              </div>
              <label className="block text-xs text-gray-600">The words (shown on the proposal and printed on the contract word for word)
                <textarea rows={5} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={w.text} onChange={e => setW(w.id, { text: e.target.value })} data-warranty-text />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-500">{u.length ? `Used for: ${u.map(k => k.label).join(', ')}` : 'Not used for any install'}</p>
                <button type="button" className="text-sm text-red-600 underline min-h-[48px] disabled:opacity-40 disabled:no-underline" disabled={u.length > 0} onClick={() => remove(w)}
                  title={u.length ? 'Choose another warranty for those installs first' : undefined}>Remove</button>
              </div>
            </div>
          )
        })}
        <button type="button" className="btn btn-secondary min-h-[48px]" onClick={add} data-warranty-add>Add a warranty</button>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Which warranty each install gets</h3>
        <p className="text-sm text-gray-600 mb-3">By the style's material and Install choice (Settings → Fence styles).</p>
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl" data-warranty-mapping>
          {INSTALL_KINDS.map(k => (
            <label key={k.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 min-h-[48px]">
              <span className="text-sm text-gray-800">{k.label}</span>
              <select className="border border-gray-300 rounded-lg px-2 h-11 text-sm max-w-full" value={ws.byInstall[k.key] ?? ws.byInstall.other ?? ''} data-warranty-for={k.key}
                onChange={e => set({ ...ws, byInstall: { ...ws.byInstall, [k.key]: e.target.value } })}>
                {ws.list.map(w => <option key={w.id} value={w.id}>{w.name || '(no name)'}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">A line added for a material</h3>
        <p className="text-sm text-gray-600 mb-3">Printed after the warranty on every option of that material. Leave blank for none.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EXTRA_MATERIALS.map(m => (
            <label key={m.key} className="block text-xs text-gray-600">{m.label}
              <input className={inputCls + ' mt-1'} value={ws.extras[m.key] ?? ''} maxLength={300} data-warranty-extra={m.key}
                onChange={e => { const extras = { ...ws.extras, [m.key]: e.target.value }; if (!e.target.value.trim()) delete extras[m.key]; set({ ...ws, extras }) }} />
            </label>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">Press Save changes in the bar at the bottom to keep these.</p>
    </div>
  )
}
