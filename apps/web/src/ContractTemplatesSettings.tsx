/**
 * Contract Templates settings — edit the 7 sections that appear on every quote.
 */

import { useState } from 'react'
import {
  getContractSections, saveContractSections, resetContractSection,
  type ContractSection,
} from './contractStore'
import { toast } from './toast'

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

  function handleReset(key: string) {
    const title = sections.find(s => s.key === key)?.title || 'this section'
    if (!confirm(`Reset "${title}" to default text?`)) return
    const def = resetContractSection(key)
    if (def) setSections(getContractSections())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Contract Templates</h3>
          <p className="text-sm text-gray-500 mt-0.5">The terms below appear on every quote. Existing quotes keep their saved text; changes apply to new quotes going forward.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPreview(p => !p)} className="text-xs border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
            {showPreview ? 'Hide Preview' : 'Preview Contract'}
          </button>
          <button onClick={handleSave} disabled={!dirty}
            className={`text-sm font-semibold px-4 py-2 rounded-lg ${dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
            {dirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      {showPreview ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8">
          <p className="text-lg font-bold text-gray-900 mb-6">Contract Preview</p>
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
              <div className="flex items-center gap-3 mb-2">
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

      {dirty && (
        <div className="flex justify-end">
          <button onClick={handleSave}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            Save Changes
          </button>
        </div>
      )}
    </div>
  )
}
