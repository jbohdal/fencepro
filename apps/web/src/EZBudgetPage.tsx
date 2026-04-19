/**
 * EZ Budget — Admin Console
 *
 * Tabs: Dashboard, Services & Pricing, Quote Inbox, Settings
 * All data fetched from /api/ez-budget/ endpoints
 */

import { useState, useEffect, useCallback } from 'react'

const API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/ez-budget'
const headers: Record<string, string> = (() => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = localStorage.getItem('crm_access_token')
  if (token) h['Authorization'] = `Bearer ${token}`
  else h['X-API-Key'] = 'dev-sync-key'
  return h
})()

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, { headers, ...opts })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'API error')
  return data.data
}

function cents(n: number) {
  return '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
}

type Tab = 'dashboard' | 'services' | 'quotes' | 'settings'

// ════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════

export default function EZBudgetPage() {
  const [tab, setTab] = useState<Tab>('dashboard')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'services', label: 'Services & Pricing' },
    { key: 'quotes', label: 'Quote Inbox' },
    { key: 'settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                tab === t.key
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'services' && <ServicesTab />}
        {tab === 'quotes' && <QuotesTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// DASHBOARD TAB
// ════════════════════════════════════════

interface DashboardData {
  totalServices: number
  activeServices: number
  totalQuotes: number
  quotesByStatus: { status: string; count: number }[]
  recentQuotes: { id: string; quoteNumber: string; customerName: string; customerEmail: string; totalCents: number; status: string; lineItemCount: number; createdAt: string }[]
  totalRevenueCents: number
}

function DashboardTab() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/dashboard').then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-gray-400 text-center py-12">Loading dashboard...</p>
  if (!data) return <p className="text-red-500 text-center py-12">Failed to load dashboard</p>

  const statusMap = Object.fromEntries(data.quotesByStatus.map(s => [s.status, s.count]))
  const conversionRate = data.totalQuotes > 0
    ? ((statusMap.accepted || 0) / data.totalQuotes * 100).toFixed(1)
    : '0'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Quotes" value={data.totalQuotes} />
        <KpiCard label="Accepted" value={`${statusMap.accepted || 0} (${conversionRate}%)`} accent />
        <KpiCard label="Active Services" value={data.activeServices} />
        <KpiCard label="Revenue" value={cents(data.totalRevenueCents)} accent />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-4">Quotes by Status</h3>
        <div className="flex flex-wrap gap-2">
          {['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].map(s => (
            <span key={s} className={`px-3 py-1.5 rounded-full text-xs font-medium ${statusColor(s)}`}>
              {s}: {statusMap[s] || 0}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-4">Recent Quotes</h3>
        {data.recentQuotes.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No quotes yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-left">
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">Total</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.recentQuotes.map(q => (
                <tr key={q.id} className="border-b border-gray-50">
                  <td className="py-2.5 font-medium text-gray-900">{q.customerName || 'Unknown'}</td>
                  <td className="py-2.5">{cents(q.totalCents)}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(q.status)}`}>{q.status}</span>
                  </td>
                  <td className="py-2.5 text-right text-gray-500">{new Date(q.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// SERVICES TAB
// ════════════════════════════════════════

function ServicesTab() {
  const [services, setServices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', category: '', unitLabel: 'per section', basePriceCents: 0, imageUrl: '', active: true, sortOrder: 0, metadata: '{}' })

  const load = useCallback(() => {
    api('/services').then(setServices).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setEditing('new')
    setForm({ name: '', description: '', category: '', unitLabel: 'per section', basePriceCents: 0, imageUrl: '', active: true, sortOrder: 0, metadata: '{}' })
  }

  function startEdit(s: any) {
    setEditing(s.id)
    setForm({ name: s.name, description: s.description || '', category: s.category || '', unitLabel: s.unitLabel, basePriceCents: s.basePriceCents, imageUrl: s.imageUrl || '', active: s.active, sortOrder: s.sortOrder, metadata: JSON.stringify(s.metadata || {}, null, 2) })
  }

  async function save() {
    let meta = {}
    try { meta = JSON.parse(form.metadata) } catch { /* keep empty */ }
    const body = { ...form, basePriceCents: Math.round(form.basePriceCents), metadata: meta }
    try {
      if (editing === 'new') await api('/services', { method: 'POST', body: JSON.stringify(body) })
      else await api(`/services/${editing}`, { method: 'PATCH', body: JSON.stringify(body) })
      setEditing(null)
      load()
    } catch (err: any) { alert(err.message) }
  }

  async function del(id: string) {
    if (!confirm('Delete this service?')) return
    await api(`/services/${id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  const categories = [...new Set(services.map(s => s.category || 'Uncategorized'))]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Service Catalog</h2>
        <button onClick={startNew} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Add Service</button>
      </div>

      {editing && (
        <div className="bg-white rounded-2xl border border-orange-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900">{editing === 'new' ? 'New Service' : 'Edit Service'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Name" value={form.name} set={v => setForm({ ...form, name: v })} />
            <Inp label="Category" value={form.category} set={v => setForm({ ...form, category: v })} ph="e.g. Vinyl, Aluminum" />
            <Inp label="Unit Label" value={form.unitLabel} set={v => setForm({ ...form, unitLabel: v })} />
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base Price ($)</label>
              <input type="number" step="0.01" value={form.basePriceCents / 100}
                onChange={e => setForm({ ...form, basePriceCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <Inp label="Image URL" value={form.imageUrl} set={v => setForm({ ...form, imageUrl: v })} />
            <Inp label="Sort Order" value={String(form.sortOrder)} set={v => setForm({ ...form, sortOrder: parseInt(v) || 0 })} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Metadata (JSON) — heights, posts, rails, labor rates</label>
            <textarea value={form.metadata} onChange={e => setForm({ ...form, metadata: e.target.value })} rows={4} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active</label>
          <div className="flex gap-2">
            <button onClick={save} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Save</button>
            <button onClick={() => setEditing(null)} className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-gray-400 text-center py-8">Loading...</p> : services.length === 0 ? (
        <Empty title="No services yet" desc="Add your first service to start building quotes." action="+ Add Service" onAction={startNew} />
      ) : categories.map(cat => (
        <div key={cat} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">{cat}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {services.filter(s => (s.category || 'Uncategorized') === cat).map(s => (
              <div key={s.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition group">
                <div className="flex items-center gap-4">
                  {s.imageUrl && <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0"><img src={s.imageUrl} alt="" className="w-full h-full object-cover" /></div>}
                  <div>
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">{cents(s.basePriceCents)} {s.unitLabel}{!s.active && <span className="ml-2 text-red-400">(inactive)</span>}</p>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => startEdit(s)} className="text-xs text-gray-500 hover:text-orange-600 px-2 py-1">Edit</button>
                  <button onClick={() => del(s.id)} className="text-xs text-gray-500 hover:text-red-600 px-2 py-1">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════
// QUOTES TAB
// ════════════════════════════════════════

function QuotesTab() {
  const [quotes, setQuotes] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (statusFilter) p.set('status', statusFilter)
    api(`/quotes?${p}`).then(d => { setQuotes(d.items); setTotal(d.total) }).catch(console.error).finally(() => setLoading(false))
  }, [page, statusFilter])

  useEffect(() => { load() }, [load])

  async function updateStatus(id: string, status: string) {
    await api(`/quotes/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    load()
    if (selected?.id === id) setSelected({ ...selected, status })
  }

  async function viewDetail(id: string) { setSelected(await api(`/quotes/${id}`)) }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5">
        {['', 'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${statusFilter === s ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s || 'All'}
          </button>
        ))}
        <span className="text-xs text-gray-400 self-center ml-2">{total} total</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {loading ? <p className="text-gray-400 text-center py-8">Loading...</p> : quotes.length === 0 ? (
            <Empty title="No quotes" desc="Quotes appear here when customers submit them through the widget." />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="divide-y divide-gray-50">
                {quotes.map(q => (
                  <button key={q.id} onClick={() => viewDetail(q.id)}
                    className={`w-full text-left px-6 py-4 hover:bg-gray-50 transition ${selected?.id === q.id ? 'bg-orange-50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{q.customerName || 'Unknown'}</p>
                        <p className="text-xs text-gray-400">{q.customerEmail || ''}{q.customerPhone ? ` • ${q.customerPhone}` : ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">{cents(q.totalCents)}</p>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(q.status)}`}>{q.status}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">#{q.quoteNumber?.slice(0, 8)} • {new Date(q.createdAt).toLocaleDateString()} • {q.lineItemCount} items</p>
                  </button>
                ))}
              </div>
              {total > 25 && (
                <div className="px-6 py-3 border-t border-gray-100 flex justify-between">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="text-sm text-gray-500 disabled:opacity-30">Prev</button>
                  <span className="text-xs text-gray-400">Page {page}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={quotes.length < 25} className="text-sm text-gray-500 disabled:opacity-30">Next</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-6 space-y-4">
              <div className="flex justify-between"><h3 className="font-semibold text-gray-900">Quote Detail</h3><button onClick={() => setSelected(null)} className="text-xs text-gray-400">Close</button></div>
              <div className="text-sm space-y-1.5">
                <p><span className="text-gray-500">Customer:</span> {selected.customerName}</p>
                {selected.customerEmail && <p><span className="text-gray-500">Email:</span> {selected.customerEmail}</p>}
                {selected.customerPhone && <p><span className="text-gray-500">Phone:</span> {selected.customerPhone}</p>}
                {selected.customerAddress && <p><span className="text-gray-500">Address:</span> {selected.customerAddress}</p>}
                {selected.material && <p><span className="text-gray-500">Material:</span> {selected.material}</p>}
                {selected.style && <p><span className="text-gray-500">Style:</span> {selected.style}</p>}
                {selected.height && <p><span className="text-gray-500">Height:</span> {selected.height}</p>}
                {selected.linearFeet && <p><span className="text-gray-500">Footage:</span> {selected.linearFeet.toFixed(0)} ft</p>}
              </div>
              {selected.lineItems?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Line Items</p>
                  {selected.lineItems.map((li: any) => (
                    <div key={li.id} className="flex justify-between text-sm"><span className="text-gray-600">{li.label} x{li.quantity}</span><span className="font-medium">{cents(li.totalCents)}</span></div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm pt-2 mt-2 border-t border-gray-100"><span>Total</span><span>{cents(selected.totalCents)}</span></div>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Status</p>
                <div className="grid grid-cols-3 gap-1">
                  {['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].map(s => (
                    <button key={s} onClick={() => updateStatus(selected.id, s)} disabled={selected.status === s}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium transition ${selected.status === s ? 'bg-gray-100 text-gray-400' : 'border border-gray-200 hover:bg-gray-50'}`}>{s}</button>
                  ))}
                </div>
              </div>
              {selected.requestOnSite && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center text-sm font-medium text-amber-700">On-site estimate requested</div>}
              {selected.photos?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Photos</p>
                  <div className="grid grid-cols-3 gap-1">{selected.photos.map((u: string, i: number) => <img key={i} src={u} alt="" className="w-full aspect-square object-cover rounded-lg" />)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center"><p className="text-gray-400 text-sm">Select a quote to view details</p></div>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// SETTINGS TAB
// ════════════════════════════════════════

function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { api('/settings').then(d => setSettings(d.settings || {})).catch(console.error).finally(() => setLoading(false)) }, [])

  async function save(key: string, value: unknown) {
    try { await api('/settings', { method: 'POST', body: JSON.stringify({ key, value }) }); setSettings(p => ({ ...p, [key]: value })) } catch (e: any) { alert(e.message) }
  }

  const wc = (settings.widgetConfig || { companyName: 'EZ Budget', primaryColor: '#16a34a', taxRate: 0, quoteExpiryDays: 30 }) as any
  const qr = (settings.quoteRange || { lowPercent: -5, highPercent: 15, label: 'Estimated Budget Range' }) as any
  const nt = (settings.notifications || { emailEnabled: false, notificationEmail: '' }) as any

  if (loading) return <p className="text-gray-400 text-center py-12">Loading...</p>

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Widget Configuration</h3>
        <div className="grid grid-cols-2 gap-4">
          <SInp label="Company Name" value={wc.companyName} set={v => save('widgetConfig', { ...wc, companyName: v })} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Primary Color</label>
            <div className="flex gap-2">
              <input type="color" value={wc.primaryColor} onChange={e => save('widgetConfig', { ...wc, primaryColor: e.target.value })} className="w-10 h-10 rounded-lg border border-gray-200 p-0.5" />
              <input type="text" value={wc.primaryColor} onChange={e => save('widgetConfig', { ...wc, primaryColor: e.target.value })} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <SInp label="Tax Rate (%)" value={String(wc.taxRate)} set={v => save('widgetConfig', { ...wc, taxRate: parseFloat(v) || 0 })} type="number" />
          <SInp label="Quote Expiry (days)" value={String(wc.quoteExpiryDays)} set={v => save('widgetConfig', { ...wc, quoteExpiryDays: parseInt(v) || 30 })} type="number" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Customer Quote Display</h3>
        <p className="text-sm text-gray-500">Customers see a budget range instead of an exact price.</p>
        <div className="grid grid-cols-3 gap-4">
          <SInp label="Range Label" value={qr.label} set={v => save('quoteRange', { ...qr, label: v })} />
          <div><label className="block text-xs text-gray-500 mb-1">Low ({qr.lowPercent}%)</label><input type="range" min={-30} max={0} value={qr.lowPercent} onChange={e => save('quoteRange', { ...qr, lowPercent: parseInt(e.target.value) })} className="w-full accent-orange-500" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">High (+{qr.highPercent}%)</label><input type="range" min={0} max={50} value={qr.highPercent} onChange={e => save('quoteRange', { ...qr, highPercent: parseInt(e.target.value) })} className="w-full accent-orange-500" /></div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-400">Preview ($5,000):</p>
          <p className="font-bold text-orange-600">${(5000 * (1 + qr.lowPercent / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })} — ${(5000 * (1 + qr.highPercent / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Notifications</h3>
        <div className="flex items-center justify-between">
          <div><p className="text-sm text-gray-700">Email on new quote</p><p className="text-xs text-gray-400">Get emailed when a quote is submitted</p></div>
          <button onClick={() => save('notifications', { ...nt, emailEnabled: !nt.emailEnabled })} className={`relative w-11 h-6 rounded-full transition ${nt.emailEnabled ? 'bg-orange-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition ${nt.emailEnabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        {nt.emailEnabled && <SInp label="Email" value={nt.notificationEmail} set={v => save('notifications', { ...nt, notificationEmail: v })} />}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Embed Code</h3>
        <p className="text-sm text-gray-500">Paste this on any website to show the EZ Budget widget.</p>
        <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs overflow-x-auto">{`<iframe src="${window.location.origin}/embed/quote" width="100%" height="900" frameborder="0" style="border-radius:12px;border:1px solid #e5e7eb"></iframe>`}</pre>
      </div>
    </div>
  )
}

// ════════════════════════════════════════
// SHARED
// ════════════════════════════════════════

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className="bg-white rounded-2xl border border-gray-200 p-5"><p className="text-xs text-gray-400 uppercase">{label}</p><p className={`text-2xl font-bold ${accent ? 'text-orange-600' : 'text-gray-900'}`}>{value}</p></div>
}

function Empty({ title, desc, action, onAction }: { title: string; desc: string; action?: string; onAction?: () => void }) {
  return <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center"><p className="text-gray-500 font-medium mb-1">{title}</p><p className="text-sm text-gray-400 mb-4">{desc}</p>{action && onAction && <button onClick={onAction} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium">{action}</button>}</div>
}

function Inp({ label, value, set, ph }: { label: string; value: string; set: (v: string) => void; ph?: string }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label><input type="text" value={value} onChange={e => set(e.target.value)} placeholder={ph} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 outline-none" /></div>
}

function SInp({ label, value, set, type = 'text' }: { label: string; value: string; set: (v: string) => void; type?: string }) {
  return <div><label className="block text-xs text-gray-500 mb-1">{label}</label><input type={type} value={value} onChange={e => set(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 outline-none" /></div>
}

function statusColor(s: string) {
  return ({ draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-purple-100 text-purple-700', accepted: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700', expired: 'bg-yellow-100 text-yellow-700' })[s] || 'bg-gray-100 text-gray-600'
}
