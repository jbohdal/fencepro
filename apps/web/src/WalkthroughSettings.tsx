/**
 * Settings → Final walkthrough: the checklist for each fence category
 * (vinyl, chain link, aluminum). Add, remove, rename and reorder items. A job
 * gets its category from its fence style (WV-/TV- vinyl, "CL -" chain link,
 * "Alum" aluminum; others use vinyl's). Saved with the other settings
 * (config.walkthroughTemplates on the server). A walkthrough already started
 * keeps the list it started with.
 */

import { useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react'
import type { AppConfig } from './configStore'
import { getContractSections } from './contractStore'
import { templatesFrom, defaultTemplates, WALK_CATEGORIES, CATEGORY_LABEL, type WalkCategory, type WalkTemplates, type TemplateItem } from '../../portal/src/server/lib/walkthroughRules'

type WithWalk = AppConfig & { walkthroughTemplates?: WalkTemplates; walkthroughWarranty?: string }

const newItemId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export default function WalkthroughSettings({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const cfg = config as WithWalk
  const templates = templatesFrom(cfg.walkthroughTemplates)
  const [cat, setCat] = useState<WalkCategory>('vinyl')
  const [adding, setAdding] = useState('')
  const list = templates[cat]
  const set = (next: TemplateItem[]) => onChange({ ...cfg, walkthroughTemplates: { ...templates, [cat]: next } } as AppConfig)
  const move = (i: number, d: -1 | 1) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); set(n) }
  const add = () => { const label = adding.trim(); if (!label) return; set([...list, { id: newItemId(), label }]); setAdding('') }
  const warranty = getContractSections().find(s => s.key === 'warranty')
  const fromContract = !!(warranty && warranty.visible !== false && warranty.body.trim())

  return (
    <div className="space-y-6" data-walkthrough-settings>
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Final walkthrough checklist</h3>
        <p className="text-sm text-gray-600">One list for each fence category. A job uses its fence style's list: WV- and TV- styles vinyl, "CL -" chain link, "Alum" aluminum; any other style uses vinyl's. Each item is marked Pass or Needs fixing on the job; Needs fixing goes on the punch list.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {WALK_CATEGORIES.map(c => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)} data-wt-template-cat={c}
            className={`px-4 min-h-[48px] rounded-lg text-sm font-semibold border ${cat === c ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-200'}`}>
            {CATEGORY_LABEL[c]} ({templates[c].length})
          </button>
        ))}
      </div>
      <ol className="space-y-2" data-wt-template-list={cat}>
        {list.map((item, i) => (
          <li key={item.id} className="flex items-center gap-2" data-wt-template-item={item.id}>
            <span className="w-6 text-right text-xs text-gray-400 tabular-nums">{i + 1}</span>
            <input className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 text-base min-h-[48px]" value={item.label} aria-label={`Item ${i + 1}`}
              onChange={e => set(list.map(x => x.id === item.id ? { ...x, label: e.target.value } : x))} />
            <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 disabled:opacity-30" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)} data-wt-template-up={item.id}><ArrowUp size={16} /></button>
            <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 disabled:opacity-30" disabled={i === list.length - 1} aria-label="Move down" onClick={() => move(i, 1)} data-wt-template-down={item.id}><ArrowDown size={16} /></button>
            <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-red-200 text-red-600" aria-label="Remove" onClick={() => set(list.filter(x => x.id !== item.id))} data-wt-template-remove={item.id}><Trash2 size={16} /></button>
          </li>
        ))}
      </ol>
      {list.length === 0 && <p className="text-sm text-amber-800">No items: walkthroughs for {CATEGORY_LABEL[cat].toLowerCase()} would have nothing to check. Add at least one.</p>}
      <div className="flex gap-2">
        <input className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 text-base min-h-[48px]" placeholder="New item, e.g. Gate stops installed" value={adding}
          onChange={e => setAdding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} data-wt-template-new />
        <button type="button" className="btn btn-primary min-h-[48px]" onClick={add} disabled={!adding.trim()} data-wt-template-add><Plus size={16} aria-hidden="true" /> Add</button>
      </div>
      <button type="button" className="text-sm text-gray-600 underline min-h-[48px]" onClick={() => { if (window.confirm(`Put the ${CATEGORY_LABEL[cat].toLowerCase()} list back to the starter list?`)) set(defaultTemplates()[cat]) }}>Back to the starter list</button>

      <div className="border-t border-gray-200 pt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Warranty on the Certificate of Completion</h3>
        {fromContract ? (
          <p className="text-sm text-gray-600" data-wt-warranty-source="contract">The certificate uses the warranty in Contract Templates → Warranty (the same one proposals show). Change it there. The text below is used only if that warranty is turned off or empty.</p>
        ) : (
          <p className="text-sm text-gray-600" data-wt-warranty-source="own">Contract Templates has no warranty turned on, so the certificate uses this text.</p>
        )}
        <textarea rows={4} className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={cfg.walkthroughWarranty ?? ''}
          onChange={e => onChange({ ...cfg, walkthroughWarranty: e.target.value } as AppConfig)} placeholder="Workmanship is warranted for 1 year from the completion date…" data-wt-warranty />
      </div>
      <p className="text-xs text-gray-500">Press Save Changes at the top to keep these.</p>
    </div>
  )
}
