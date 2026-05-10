/**
 * Email Templates settings — edit subject + body per system template,
 * with merge-tag insertion and live preview.
 */

import { useState, useMemo, useRef } from 'react'
import {
  getEmailTemplates, saveEmailTemplate, resetEmailTemplate, renderTemplate,
  ALL_MERGE_TAGS, type EmailTemplate, type TemplateKey,
} from './emailTemplatesStore'
import { toast } from './toast'

const PREVIEW_DATA: Record<string, string> = {
  customer_name: 'Maria Gonzales',
  customer_first_name: 'Maria',
  quote_number: 'Q-1042',
  quote_total: '$12,450.00',
  quote_link: 'https://app.fencepro.com/quote/abc123',
  fence_style: "6' White Vinyl Privacy",
  scheduled_date: 'May 14, 2026',
  company_name: 'GD Fence Pro',
  company_phone: '(352) 555-0100',
  rep_name: 'Jonathan',
  invoice_number: 'INV-2054',
  invoice_total: '$6,225.00',
  payment_amount: '$6,225.00',
  due_date: 'Apr 30, 2026',
}

export default function EmailTemplatesSettings() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(() => getEmailTemplates())
  const [activeKey, setActiveKey] = useState<TemplateKey>(templates[0].key)
  const [preview, setPreview] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const active = templates.find(t => t.key === activeKey)!
  const rendered = useMemo(() => renderTemplate(active, PREVIEW_DATA), [active])

  function update(patch: Partial<EmailTemplate>) {
    setTemplates(prev => prev.map(t => t.key === activeKey ? { ...t, ...patch } : t))
  }

  function handleSave() {
    try {
      saveEmailTemplate(active)
      toast.success('Template saved')
    } catch (err: any) {
      toast.error('Could not save', err?.message)
    }
  }

  function handleReset() {
    if (!confirm(`Reset "${active.name}" to the default template?`)) return
    const def = resetEmailTemplate(activeKey)
    setTemplates(prev => prev.map(t => t.key === activeKey ? def : t))
    toast.success('Template reset to default')
  }

  function insertTag(tag: string) {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart ?? active.body.length
    const end = el.selectionEnd ?? active.body.length
    const next = active.body.slice(0, start) + tag + active.body.slice(end)
    update({ body: next })
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + tag.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Template list */}
      <div className="lg:col-span-3">
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-2 space-y-1">
          {templates.map(t => (
            <button key={t.key} onClick={() => { setActiveKey(t.key); setPreview(false) }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeKey === t.key ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-600 hover:bg-white'}`}>
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="lg:col-span-9 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{active.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Used when this email fires — manually or via automation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setPreview(p => !p)} className="text-xs border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
              {preview ? 'Hide Preview' : 'Preview'}
            </button>
            <button onClick={handleReset} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">Reset to default</button>
            <button onClick={handleSave} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">Save</button>
          </div>
        </div>

        {preview ? (
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-500">Subject</p>
              <p className="font-semibold text-gray-900">{rendered.subject}</p>
            </div>
            <div className="p-5 prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: rendered.body }} />
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Subject</label>
              <input value={active.subject} onChange={e => update({ subject: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Body (HTML)</label>
              <textarea ref={bodyRef} value={active.body} onChange={e => update({ body: e.target.value })}
                rows={14}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Insert Merge Tag</p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_MERGE_TAGS.map(tag => (
                  <button key={tag} onClick={() => insertTag(tag)}
                    className="text-xs bg-gray-100 hover:bg-orange-100 hover:text-orange-700 text-gray-600 rounded-full px-2.5 py-1 font-mono">
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
