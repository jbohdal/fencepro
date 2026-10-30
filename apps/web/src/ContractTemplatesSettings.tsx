/**
 * Contract Templates settings — edit the 7 sections that appear on every quote.
 */

import { useState } from 'react'
import {
  getContractSections, saveContractSections, resetContractSection,
  type ContractSection,
} from './contractStore'
import { toast } from './toast'
import { useSettingsPageSave } from './settingsPageSave'

export default function ContractTemplatesSettings() {
  const [sections, setSections] = useState<ContractSection[]>(() => getContractSections())
  const [showPreview, setShowPreview] = useState(false)
  const [dirty, setDirty] = useState(false)

  function update(key: string, patch: Partial<ContractSection>) {
    setSections(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s))
    setDirty(true)
  }

  function handleSave() {
    try {
      saveContractSections(sections)
      setDirty(false)
      toast.success('Contract sections saved', 'New quotes use these terms.')
    } catch (err: any) {
      toast.error('Could not save', err?.message)
    }
  }

  // Saved with the Settings bar (Unsaved changes · Save · Discard).
  useSettingsPageSave(dirty, handleSave, () => { setSections(getContractSections()); setDirty(false) })

  function handleReset(key: string) {
    const title = sections.find(s => s.key === key)?.title || 'this section'
    if (!confirm(`Reset "${title}" to default text?`)) return
    const def = resetContractSection(key)
    if (def) setSections(getContractSections())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h3 data-settings-dup-title className="text-lg font-bold text-gray-900">Contract Templates</h3>
          <p className="text-sm text-gray-500 mt-0.5" data-contract-terms-where>The sections ticked "Show on quotes" show on the customer's proposal link, under the price and before they sign, and print on the signed contract PDF word for word, and on the printable quote templates. A proposal keeps the terms it was sent with, and a signed contract never changes: your changes apply to quotes saved from now on.</p>
          <p className="text-sm text-gray-600 mt-1" data-contract-warranty-moved>Proposals, signed contracts and warranty certificates take each option's warranty from Settings → Warranties (Lifetime for vinyl no dig, and so on). The Warranty section here shows only on the printable quote templates, and only for a quote without per option warranties.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowPreview(p => !p)} className="text-xs border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
            {showPreview ? 'Hide Preview' : 'Preview Contract'}
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 lg:p-8">
          <p className="text-lg font-bold text-gray-900 mb-1">Contract Preview</p>
          <p className="text-sm text-gray-600 mb-6" data-contract-preview-deposit>On each proposal and contract, "A 50% deposit is required to schedule the project." says that proposal's own deposit (Settings → Proposals). With 0% or blank it reads "No deposit is required to schedule the project. The full price is due upon completion."</p>
          {sections.filter(s => s.visible).map(s => (
            <div key={s.key} className="mb-5">
              <p className="font-bold text-gray-900 mb-1">{s.title}</p>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: s.body }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map(s => (
            <div key={s.key} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 mb-2">
                <input value={s.title} onChange={e => update(s.key, { title: e.target.value })}
                  className="flex-1 text-sm font-semibold border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400" />
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" checked={s.visible} onChange={e => update(s.key, { visible: e.target.checked })} />
                  Show on quotes
                </label>
                <button onClick={() => handleReset(s.key)} className="text-xs text-gray-500 hover:text-orange-600">Reset</button>
              </div>
              <textarea value={s.body} onChange={e => update(s.key, { body: e.target.value })}
                rows={4}
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
