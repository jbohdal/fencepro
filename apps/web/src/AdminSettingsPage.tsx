import { useState, useEffect } from 'react'
import {
  getConfig, saveConfig, resetConfig, getDefaultConfig,
  type AppConfig, type FenceStyle, type CompanyInfo, type PricingConfig, type MarginThresholds,
  type RailOptimizerConfig,
} from './configStore'
import OperationsStagesSettings from './OperationsStagesSettings'
import EmailTemplatesSettings from './EmailTemplatesSettings'
import ContractTemplatesSettings from './ContractTemplatesSettings'
import PortalQuoteSettings from './PortalQuoteSettings'
import { toast } from './toast'

type AdminTab = 'company' | 'pricing' | 'styles' | 'leads' | 'tags' | 'pipeline' | 'ops_stages' | 'email_templates' | 'contract_templates' | 'portal_quote' | 'optimizer'

export const SETTINGS_UPDATED_EVENT = 'fencepro:settings:updated'

const STYLE_CATEGORIES = ['Vinyl', 'Chainlink', 'Commercial', 'Aluminum', 'Other'] as const

const uid = () => Math.random().toString(36).slice(2, 9)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

// ── Company Tab ──────────────────────────────────────────────────────────────

function CompanyTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const co = config.company

  function set(field: keyof CompanyInfo, value: string) {
    onChange({ ...config, company: { ...co, [field]: value } })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Company Details</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Company Name</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Phone</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(352) 555-0100" value={co.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email</label>
              <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="info@company.com" value={co.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Street Address</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">City</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.city} onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">State</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ZIP</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={co.zip} onChange={e => set('zip', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Legal Name (for contracts)</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Acme Fence Company, LLC" value={co.legalName ?? ''} onChange={e => set('legalName', e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Branding</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Logo URL</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="https://yourdomain.com/logo.png" value={co.logoUrl ?? ''} onChange={e => set('logoUrl', e.target.value)} />
            {co.logoUrl && <img src={co.logoUrl} alt="Logo preview" className="mt-2 h-10 object-contain rounded border border-gray-200 p-1" />}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Primary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-10 h-9 border border-gray-300 rounded cursor-pointer" value={co.primaryColor ?? '#f97316'} onChange={e => set('primaryColor', e.target.value)} />
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="#f97316" value={co.primaryColor ?? ''} onChange={e => set('primaryColor', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Secondary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-10 h-9 border border-gray-300 rounded cursor-pointer" value={co.secondaryColor ?? '#ea580c'} onChange={e => set('secondaryColor', e.target.value)} />
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="#ea580c" value={co.secondaryColor ?? ''} onChange={e => set('secondaryColor', e.target.value)} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Customer Support Contact</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Support Email</label>
            <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="support@company.com" value={co.supportEmail ?? ''} onChange={e => set('supportEmail', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Support Phone</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(555) 123-4567" value={co.supportPhone ?? ''} onChange={e => set('supportPhone', e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">Shown to customers in the portal footer and public-facing pages. Defaults to the main phone/email above if not set.</p>
      </div>
    </div>
  )
}

// ── Pricing Tab ──────────────────────────────────────────────────────────────

function PricingTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const p = config.pricing
  const m = config.margins

  function setP(field: keyof PricingConfig, value: number) {
    onChange({ ...config, pricing: { ...p, [field]: value } })
  }

  function setM(field: keyof MarginThresholds, value: number) {
    onChange({ ...config, margins: { ...m, [field]: value } })
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Labor</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Man-Hour Rate</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="500" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.manHourRate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 500) setP('manHourRate', Math.round(v * 100) / 100) }} />
              <span className="text-gray-400 text-sm ml-2 whitespace-nowrap">/ hr</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Commission</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Salesman Commission</label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(p.commissionSalesman * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setP('commissionSalesman', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Non-Salesman Commission</label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(p.commissionNonSalesman * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setP('commissionNonSalesman', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Tear-Out Costs</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Per Fence Section</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="200" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.tearOutFence} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setP('tearOutFence', Math.round(v * 100) / 100) }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Per Gate</label>
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">$</span>
              <input type="number" step="0.50" min="0" max="200" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={p.tearOutGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 200) setP('tearOutGate', Math.round(v * 100) / 100) }} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Margin Thresholds</h3>
        <p className="text-xs text-gray-400 mb-3">Controls color coding on quotes and dashboard</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block flex items-center gap-2">
              Good <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
            </label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(m.good * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setM('good', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%+</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block flex items-center gap-2">
              Warning <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
            </label>
            <div className="flex items-center">
              <input type="number" step="0.5" min="0" max="100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={Math.round(m.warning * 1000) / 10} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 100) setM('warning', Math.round(v * 10) / 1000) }} />
              <span className="text-gray-400 text-sm ml-2">%+</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">Below {fmtPct(m.warning)} shows as <span className="text-red-500 font-medium">danger</span></p>
      </div>
    </div>
  )
}

// ── Fence Styles Tab ─────────────────────────────────────────────────────────

function StylesTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const [filter, setFilter] = useState<string>('All')
  const [editingId, setEditingId] = useState<string | null>(null)
  const styles = config.fenceStyles

  const filtered = styles.filter(s => filter === 'All' || s.category === filter)

  function update(id: string, patch: Partial<FenceStyle>) {
    onChange({
      ...config,
      fenceStyles: styles.map(s => s.id === id ? { ...s, ...patch } : s),
    })
  }

  function addStyle() {
    const newStyle: FenceStyle = {
      id: uid(),
      name: 'New Style',
      category: 'Vinyl',
      margin: 0.64,
      sectionsPerMH: 1.0,
      panelWidth: 6,
      mhPerWalkGate: 2.4,
      mhPerDblGate: 4.8,
      isActive: true,
    }
    onChange({ ...config, fenceStyles: [...styles, newStyle] })
    setEditingId(newStyle.id)
  }

  function removeStyle(id: string) {
    if (!confirm('Delete this fence style?')) return
    onChange({ ...config, fenceStyles: styles.filter(s => s.id !== id) })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['All', ...STYLE_CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setFilter(cat)} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filter === cat ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
              {cat}
            </button>
          ))}
        </div>
        <button onClick={addStyle} className="text-sm text-orange-500 border border-orange-300 rounded-lg px-3 py-2 hover:bg-orange-50">+ Add Style</button>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Category</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Margin</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Sec/MH</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Panel</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Walk Gate</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Dbl Gate</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">Active</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(style => (
              <tr key={style.id} className={`group hover:bg-gray-50 ${!style.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5">
                  {editingId === style.id ? (
                    <input autoFocus className="w-full border border-orange-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.name} onChange={e => update(style.id, { name: e.target.value })} onBlur={() => setEditingId(null)} />
                  ) : (
                    <span className="cursor-pointer hover:text-orange-600 font-medium" onClick={() => setEditingId(style.id)}>{style.name}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <select className="border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.category} onChange={e => update(style.id, { category: e.target.value as FenceStyle['category'] })}>
                    {STYLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <input type="number" step="0.01" min="0.01" max="0.99" className="w-16 text-right border border-gray-200 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.margin} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v < 1) update(style.id, { margin: Math.round(v * 1000) / 1000 }) }} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <input type="number" step="0.1" min="0.1" max="20" className="w-16 text-right border border-gray-200 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.sectionsPerMH} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) update(style.id, { sectionsPerMH: Math.round(v * 10) / 10 }) }} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <input type="number" step="1" min="1" className="w-14 text-right border border-gray-200 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.panelWidth} onChange={e => update(style.id, { panelWidth: parseInt(e.target.value) || 6 })} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <input type="number" step="0.1" min="0" max="20" className="w-16 text-right border border-gray-200 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.mhPerWalkGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) update(style.id, { mhPerWalkGate: Math.round(v * 10) / 10 }) }} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <input type="number" step="0.1" min="0" max="20" className="w-16 text-right border border-gray-200 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" value={style.mhPerDblGate} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) update(style.id, { mhPerDblGate: Math.round(v * 10) / 10 }) }} />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button onClick={() => update(style.id, { isActive: !style.isActive })} className={`w-8 h-5 rounded-full transition-colors relative ${style.isActive ? 'bg-orange-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${style.isActive ? 'left-3.5' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-2 py-2.5">
                  <button onClick={() => removeStyle(style.id)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">&times;</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">No styles in this category</div>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">{filtered.length} of {styles.length} styles shown</p>
    </div>
  )
}

// ── Editable List (Lead Sources, Tags, Pipeline) ─────────────────────────────

function EditableListTab({
  title, description, items, onChange, placeholder,
}: {
  title: string
  description: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
}) {
  const [newItem, setNewItem] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  function add() {
    const trimmed = newItem.trim()
    if (!trimmed || items.includes(trimmed)) return
    onChange([...items, trimmed])
    setNewItem('')
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function rename(idx: number, value: string) {
    onChange(items.map((item, i) => i === idx ? value : item))
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    const next = [...items]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    onChange(next)
  }

  function moveDown(idx: number) {
    if (idx === items.length - 1) return
    const next = [...items]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    onChange(next)
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{description}</p>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder={placeholder}
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!newItem.trim()} className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2 rounded-lg">Add</button>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 last:border-b-0 group hover:bg-gray-50">
            <div className="flex flex-col gap-0.5 mr-1">
              <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 text-xs leading-none">&uarr;</button>
              <button onClick={() => moveDown(idx)} disabled={idx === items.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30 text-xs leading-none">&darr;</button>
            </div>
            <span className="text-xs text-gray-300 font-mono w-6">{idx + 1}</span>
            {editingIdx === idx ? (
              <input
                autoFocus
                className="flex-1 border border-orange-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={item}
                onChange={e => rename(idx, e.target.value)}
                onBlur={() => setEditingIdx(null)}
                onKeyDown={e => e.key === 'Enter' && setEditingIdx(null)}
              />
            ) : (
              <span className="flex-1 text-sm text-gray-800 cursor-pointer hover:text-orange-600" onClick={() => setEditingIdx(idx)}>{item}</span>
            )}
            <button onClick={() => remove(idx)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-lg leading-none">&times;</button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No items yet</div>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">{items.length} items</p>
    </div>
  )
}

// ── Quote Optimizer Tab ──────────────────────────────────────────────────────

const DEFAULT_OPTIMIZER: RailOptimizerConfig = {
  enabled: true,
  shortRunCutoffFt: 6,
  costPreferenceThreshold: 0.02,
  showDetailsInBuilder: true,
  allowOverrides: true,
}

function OptimizerTab({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const opt = config.railOptimizer ?? DEFAULT_OPTIMIZER

  function set<K extends keyof RailOptimizerConfig>(field: K, value: RailOptimizerConfig[K]) {
    onChange({ ...config, railOptimizer: { ...opt, [field]: value } })
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Smart Rail Optimization</h3>
        <p className="text-sm text-gray-500 mb-6">
          For vinyl jobs, recommends 6ft or 8ft rails per run to minimize material cost and maximize productivity.
          Recommendation only — does not yet drive the pull-sheet quantities (Milestone B will land that).
        </p>

        <div className="space-y-5">
          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Enable smart rail optimization</p>
              <p className="text-xs text-gray-500 mt-0.5">When off, the optimizer recommendation is hidden and 6ft is the default.</p>
            </div>
            <input type="checkbox" checked={opt.enabled} onChange={e => set('enabled', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Short-run cutoff (feet)</label>
            <p className="text-xs text-gray-500 mb-2">Runs at or below this footage are always 6ft. Useful for short runs beside gates or houses.</p>
            <input
              type="number" min={1} max={12}
              value={opt.shortRunCutoffFt}
              onChange={e => set('shortRunCutoffFt', Math.max(1, Math.min(12, Number(e.target.value) || 0)))}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-xs text-gray-400 mt-1">Range: 1–12 ft. Default: 6 ft.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cost preference threshold (%)</label>
            <p className="text-xs text-gray-500 mb-2">When 8ft cost is within this % of 6ft cost, prefer 8ft for the productivity gain (fewer sections).</p>
            <input
              type="number" min={0} max={10} step={0.5}
              value={(opt.costPreferenceThreshold * 100).toFixed(1)}
              onChange={e => set('costPreferenceThreshold', Math.max(0, Math.min(10, Number(e.target.value) || 0)) / 100)}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-xs text-gray-400 mt-1">Range: 0–10 %. Default: 2 %.</p>
          </div>

          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Show optimization details in quote builder</p>
              <p className="text-xs text-gray-500 mt-0.5">Per-run recommendation table with savings and reasoning.</p>
            </div>
            <input type="checkbox" checked={opt.showDetailsInBuilder} onChange={e => set('showDetailsInBuilder', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>

          <label className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">Allow estimator overrides</p>
              <p className="text-xs text-gray-500 mt-0.5">When on, the estimator can manually choose 6ft or 8ft per run.</p>
            </div>
            <input type="checkbox" checked={opt.allowOverrides} onChange={e => set('allowOverrides', e.target.checked)} className="w-5 h-5 accent-orange-500" />
          </label>
        </div>
      </div>
    </div>
  )
}

// ── Main Admin Settings Page ─────────────────────────────────────────────────

const TABS: { key: AdminTab; label: string }[] = [
  { key: 'company',         label: 'Company' },
  { key: 'pricing',         label: 'Pricing' },
  { key: 'styles',          label: 'Fence Styles' },
  { key: 'optimizer',       label: 'Quote Optimizer' },
  { key: 'leads',           label: 'Lead Sources' },
  { key: 'tags',            label: 'Tags' },
  { key: 'pipeline',        label: 'Pipeline Stages' },
  { key: 'ops_stages',         label: 'Operations Stages' },
  { key: 'email_templates',    label: 'Email Templates' },
  { key: 'contract_templates', label: 'Contract Templates' },
  { key: 'portal_quote',       label: 'Portal & Quotes' },
]

export default function AdminSettingsPage() {
  const [tab, setTab] = useState<AdminTab>('company')
  const [config, setConfig] = useState<AppConfig>(getConfig)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setConfig(getConfig())
  }, [])

  function handleChange(next: AppConfig) {
    setConfig(next)
    setDirty(true)
  }

  function handleSave() {
    try {
      saveConfig(config)
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 2000)
      try { window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: config })) } catch {}
      toast.success('Settings saved', 'Live pages will update immediately.')
    } catch (err: any) {
      toast.error('Could not save settings', err?.message || 'Unknown error.')
    }
  }

  function handleReset() {
    if (!confirm('Reset all settings to factory defaults? This cannot be undone.')) return
    resetConfig()
    setConfig(getDefaultConfig())
    setDirty(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-400 mt-1">Configure pricing, fence styles, and business rules</p>
          </div>
          <div className="flex gap-2 items-center">
            {dirty && <span className="text-xs text-orange-500 font-medium">Unsaved changes</span>}
            <button onClick={handleReset} className="text-xs text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">Reset to defaults</button>
            <button onClick={handleSave} className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${saved ? 'bg-green-500 text-white' : dirty ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {saved ? 'Saved' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit mb-8">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          {tab === 'company' && <CompanyTab config={config} onChange={handleChange} />}
          {tab === 'pricing' && <PricingTab config={config} onChange={handleChange} />}
          {tab === 'styles' && <StylesTab config={config} onChange={handleChange} />}
          {tab === 'leads' && (
            <EditableListTab
              title="Lead Sources"
              description="Where customers hear about you. Used in customer forms and quote builder."
              items={config.leadSources}
              onChange={items => handleChange({ ...config, leadSources: items })}
              placeholder="e.g. Billboard, Trade Show..."
            />
          )}
          {tab === 'tags' && (
            <EditableListTab
              title="Customer Tags"
              description="Categorize customers. Used on customer profiles for filtering and segmentation."
              items={config.customerTags}
              onChange={items => handleChange({ ...config, customerTags: items })}
              placeholder="e.g. Priority, Government..."
            />
          )}
          {tab === 'pipeline' && (
            <EditableListTab
              title="Pipeline Stages"
              description="Sales pipeline stages from first contact through close. Order matters — drag to reorder."
              items={config.pipelineStages}
              onChange={items => handleChange({ ...config, pipelineStages: items })}
              placeholder="e.g. Follow-up Call..."
            />
          )}
          {tab === 'optimizer' && <OptimizerTab config={config} onChange={handleChange} />}
          {tab === 'ops_stages' && <OperationsStagesSettings />}
          {tab === 'email_templates' && <EmailTemplatesSettings />}
          {tab === 'contract_templates' && <ContractTemplatesSettings />}
          {tab === 'portal_quote' && <PortalQuoteSettings />}
        </div>
      </div>
    </div>
  )
}
