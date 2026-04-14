import { useState, useRef } from 'react'
import type { SavedQuote } from './QuotesPage'

export interface StagingJob {
  id: string
  clientName: string
  contractDate: string
  locatesGoodDate: string
  locatesExpDate: string
  area: string
  sections: number
  fenceType: string
  manhoursSold: number
  jobPrice: number
  tearout: boolean
  notes: string
  status: string
  quoteId?: string
  createdAt: string
  lastMoved: string
}

const STAGING_STATUSES = [
  'Awaiting Locates',
  'Need Drawing',
  'Materials Ordered',
  'Ready to Pull',
  'Scheduled',
  'Jobs In Progress',
  'Job Complete',
  'Customer Delay',
  'Hold (HOA)',
  'Deed Restricted',
  'Backorder',
  'Warranty / Call Back',
]

const STATUS_COLORS: Record<string, { bg: string, text: string, dot: string }> = {
  'Awaiting Locates':    { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  'Need Drawing':        { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  'Materials Ordered':   { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  'Ready to Pull':       { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  'Scheduled':           { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500'  },
  'Jobs In Progress':    { bg: 'bg-teal-50',   text: 'text-teal-700',   dot: 'bg-teal-500'   },
  'Job Complete':        { bg: 'bg-gray-50',   text: 'text-gray-600',   dot: 'bg-gray-400'   },
  'Customer Delay':      { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500'    },
  'Hold (HOA)':          { bg: 'bg-pink-50',   text: 'text-pink-700',   dot: 'bg-pink-500'   },
  'Deed Restricted':     { bg: 'bg-rose-50',   text: 'text-rose-700',   dot: 'bg-rose-500'   },
  'Backorder':           { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
  'Warranty / Call Back':{ bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

const uid = () => Math.random().toString(36).slice(2, 9)

function loadStaging(): StagingJob[] {
  try {
    const raw = localStorage.getItem('fencepro_staging')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveStaging(jobs: StagingJob[]) {
  localStorage.setItem('fencepro_staging', JSON.stringify(jobs))
}

function loadSoldQuotes(): SavedQuote[] {
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    const quotes: SavedQuote[] = raw ? JSON.parse(raw) : []
    return quotes.filter(q => q.status === 'SOLD')
  } catch { return [] }
}

// ── Job Drawer ────────────────────────────────────────────────────────────────

function JobDrawer({
  job, onClose, onUpdate, onDelete,
}: {
  job: StagingJob
  onClose: () => void
  onUpdate: (job: StagingJob) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<StagingJob>({ ...job })
  const colors = STATUS_COLORS[job.status] ?? { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' }

  function save() { onUpdate(form); setEditing(false) }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[500px] bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">{job.clientName}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} font-medium`}>{job.status}</span>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={save} className="bg-orange-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">Save</button>
                <button onClick={() => { setForm({ ...job }); setEditing(false) }} className="border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-lg">Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50">Edit</button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Move to Status</p>
            <div className="flex flex-wrap gap-1.5">
              {STAGING_STATUSES.map(s => {
                const c = STATUS_COLORS[s] ?? { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' }
                return (
                  <button
                    key={s}
                    onClick={() => onUpdate({ ...job, status: s, lastMoved: new Date().toISOString().slice(0, 10) })}
                    className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${
                      job.status === s ? `${c.bg} ${c.text} border-transparent font-semibold` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >{s}</button>
                )
              })}
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job Details</p>
            {editing ? (
              <div className="space-y-2">
                <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Client Name" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <input className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Fence Type" value={form.fenceType} onChange={e => setForm(f => ({ ...f, fenceType: e.target.value }))} />
                  <input className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Area" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Sections" value={form.sections || ''} onChange={e => setForm(f => ({ ...f, sections: Number(e.target.value) }))} />
                  <input type="number" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Manhours" value={form.manhoursSold || ''} onChange={e => setForm(f => ({ ...f, manhoursSold: Number(e.target.value) }))} />
                </div>
                <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Job Price" value={form.jobPrice || ''} onChange={e => setForm(f => ({ ...f, jobPrice: Number(e.target.value) }))} />
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="tearout" checked={form.tearout} onChange={e => setForm(f => ({ ...f, tearout: e.target.checked }))} className="accent-orange-500" />
                  <label htmlFor="tearout" className="text-sm text-gray-600">Tear out included</label>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {[
                  { label: 'Fence Type', value: job.fenceType },
                  { label: 'Area',       value: job.area },
                  { label: 'Sections',   value: job.sections != null ? String(job.sections) : '0' },
                  { label: 'Manhours',   value: job.manhoursSold != null ? String(job.manhoursSold) : '0' },
                  { label: 'Job Price',  value: job.jobPrice ? fmt(job.jobPrice) : '' },
                  { label: 'Tearout',    value: job.tearout ? 'Yes' : '' },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex gap-3">
                    <span className="text-xs text-gray-400 w-24 shrink-0">{r.label}</span>
                    <span className="text-sm text-gray-800">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dates</p>
            {editing ? (
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Contract Date</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.contractDate} onChange={e => setForm(f => ({ ...f, contractDate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Locates Good Date</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.locatesGoodDate} onChange={e => setForm(f => ({ ...f, locatesGoodDate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Locates Expiry Date</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.locatesExpDate} onChange={e => setForm(f => ({ ...f, locatesExpDate: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {[
                  { label: 'Contract',       value: job.contractDate },
                  { label: 'Locates Good',   value: job.locatesGoodDate },
                  { label: 'Locates Expire', value: job.locatesExpDate },
                  { label: 'Last Moved',     value: job.lastMoved },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex gap-3">
                    <span className="text-xs text-gray-400 w-28 shrink-0">{r.label}</span>
                    <span className="text-sm text-gray-800">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Notes</p>
            {editing ? (
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" rows={4} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            ) : (
              <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 min-h-[60px]">
                {job.notes || <span className="text-gray-400">No notes</span>}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={() => { if (confirm('Remove this job from staging?')) { onDelete(job.id); onClose() } }}
              className="text-red-400 hover:text-red-600 text-sm font-medium"
            >Remove from staging</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Push Quote Modal ──────────────────────────────────────────────────────────

function PushQuoteModal({
  onClose, onPush, existingJobIds,
}: {
  onClose: () => void
  onPush: (job: StagingJob) => void
  existingJobIds: Set<string>
}) {
  const soldQuotes = loadSoldQuotes().filter(q => !existingJobIds.has(q.id))
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SavedQuote | null>(null)
  const [status, setStatus] = useState('Awaiting Locates')
  const [area, setArea] = useState('')
  const [locatesGoodDate, setLocatesGoodDate] = useState('')
  const [locatesExpDate, setLocatesExpDate] = useState('')
  const [notes, setNotes] = useState('')

  const filtered = soldQuotes.filter(q => {
    const s = search.toLowerCase()
    return !s || q.customerName.toLowerCase().includes(s) || q.fenceStyle.toLowerCase().includes(s)
  })

  function handlePush() {
    if (!selected) return
    const job: StagingJob = {
      id: uid(),
      clientName: selected.customerName,
      contractDate: selected.date,
      locatesGoodDate,
      locatesExpDate,
      area,
      sections: selected.sections,
      fenceType: selected.fenceStyle,
      manhoursSold: 0,
      jobPrice: selected.finalPrice,
      tearout: selected.tearOutSections > 0 || selected.tearOutGates > 0,
      notes,
      status,
      quoteId: selected.id,
      createdAt: new Date().toISOString().slice(0, 10),
      lastMoved: new Date().toISOString().slice(0, 10),
    }
    onPush(job)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Push Sold Quote to Staging</h2>
            <p className="text-xs text-gray-400 mt-0.5">{soldQuotes.length} sold quotes available</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block font-medium">Search sold quotes</label>
            <input
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Customer name or fence style..."
              value={search}
              onChange={e => { setSearch(e.target.value); setSelected(null) }}
            />
            {!selected && (
              <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No sold quotes available</p>
                ) : filtered.map(q => (
                  <div key={q.id} onClick={() => { setSelected(q); setSearch(q.customerName) }} className="px-3 py-2.5 hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">{q.customerName}</p>
                      <p className="text-sm font-bold text-green-600">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(q.finalPrice)}</p>
                    </div>
                    <p className="text-xs text-gray-400">{q.fenceStyle} · {q.sections} sections · {q.date}</p>
                  </div>
                ))}
              </div>
            )}
            {selected && (
              <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selected.customerName}</p>
                  <p className="text-xs text-gray-500">{selected.fenceStyle} · {selected.sections} sec · {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(selected.finalPrice)}</p>
                </div>
                <button onClick={() => { setSelected(null); setSearch('') }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1.5 block font-medium">Initial Status</label>
            <div className="flex flex-wrap gap-1.5">
              {STAGING_STATUSES.slice(0, 6).map(s => (
                <button key={s} onClick={() => setStatus(s)} className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${status === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">Area / Location</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="e.g. sw ocala, lady lake, inverness..." value={area} onChange={e => setArea(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Locates Good Date</label>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={locatesGoodDate} onChange={e => setLocatesGoodDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Locates Expiry</label>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={locatesExpDate} onChange={e => setLocatesExpDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">Notes</label>
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" rows={2} placeholder="HOA restrictions, access notes, special requirements..." value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
            <button onClick={handlePush} disabled={!selected} className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold py-2.5 rounded-xl">Push to Staging</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({
  job, onClick, onDragStart,
}: {
  job: StagingJob
  onClick: () => void
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  const colors = STATUS_COLORS[job.status] ?? { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' }
  const today = new Date().toISOString().slice(0, 10)
  const locatesExpired = job.locatesExpDate && job.locatesExpDate < today
  const locatesExpiringSoon = job.locatesExpDate && !locatesExpired &&
    new Date(job.locatesExpDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, job.id)}
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-3.5 cursor-pointer hover:shadow-md hover:border-orange-300 transition-all select-none"
    >
      <div className="flex items-start justify-between mb-2">
        <p className="font-semibold text-gray-900 text-sm leading-tight">{job.clientName}</p>
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} shrink-0 ml-1`}>{job.fenceType}</span>
      </div>
      {job.area && <p className="text-xs text-gray-400 mb-1">📍 {job.area}</p>}
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {job.sections > 0 && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{job.sections} sec</span>}
        {job.jobPrice > 0 && <span className="text-xs font-semibold text-green-600">{fmt(job.jobPrice)}</span>}
        {job.tearout && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">Tearout</span>}
      </div>
      {job.locatesExpDate && (
        <p className={`text-xs mt-1.5 ${locatesExpired ? 'text-red-500 font-semibold' : locatesExpiringSoon ? 'text-yellow-600 font-semibold' : 'text-gray-400'}`}>
          {locatesExpired ? '⚠ Locates EXPIRED' : locatesExpiringSoon ? '⚠ Locates expiring soon' : `Locates exp: ${job.locatesExpDate}`}
        </p>
      )}
      {job.contractDate && <p className="text-xs text-gray-300 mt-1">CT: {job.contractDate}</p>}
    </div>
  )
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  status, jobs, onJobClick, onDragStart, onDrop, onRename,
}: {
  status: string
  jobs: StagingJob[]
  onJobClick: (job: StagingJob) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onDrop: (e: React.DragEvent, status: string) => void
  onRename: (old: string, next: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [name, setName]         = useState(status)
  const colors = STATUS_COLORS[status] ?? { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' }
  const totalValue = jobs.reduce((s, j) => s + (j.jobPrice || 0), 0)

  function commitRename() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== status) onRename(status, trimmed)
    else setName(status)
    setEditing(false)
  }

  return (
    <div
      className={`flex flex-col w-60 shrink-0 rounded-2xl border transition-colors ${dragOver ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { setDragOver(false); onDrop(e, status) }}
    >
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
          {editing ? (
            <input
              autoFocus
              className="flex-1 text-sm font-bold text-gray-900 bg-transparent border-b border-orange-400 outline-none"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setName(status); setEditing(false) } }}
            />
          ) : (
            <span
              className="text-sm font-bold text-gray-900 truncate cursor-pointer hover:text-orange-500"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >{status}</span>
          )}
          <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-1.5 py-0.5 shrink-0">{jobs.length}</span>
        </div>
        {totalValue > 0 && (
          <p className="text-xs text-gray-400 font-mono ml-4">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalValue)}
          </p>
        )}
      </div>
      <div className="flex-1 px-3 pb-3 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
        {jobs.map(job => (
          <KanbanCard key={job.id} job={job} onClick={() => onJobClick(job)} onDragStart={onDragStart} />
        ))}
        {jobs.length === 0 && <div className="text-center py-8 text-gray-300 text-xs">Drop jobs here</div>}
      </div>
    </div>
  )
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({ jobs, onJobClick }: { jobs: StagingJob[], onJobClick: (job: StagingJob) => void }) {
  const [statusFilter, setStatusFilter] = useState('All')
  const today = new Date().toISOString().slice(0, 10)
  const filtered = jobs.filter(j => statusFilter === 'All' || j.status === statusFilter)
    .sort((a, b) => a.contractDate.localeCompare(b.contractDate))

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        <button onClick={() => setStatusFilter('All')} className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${statusFilter === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
          All ({jobs.length})
        </button>
        {STAGING_STATUSES.map(s => {
          const count = jobs.filter(j => j.status === s).length
          if (count === 0) return null
          const c = STATUS_COLORS[s] ?? { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' }
          return (
            <button key={s} onClick={() => setStatusFilter(s)} className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${statusFilter === s ? `${c.bg} ${c.text} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {s} ({count})
            </button>
          )
        })}
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">No jobs in this status</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Area</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sec</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Locates Exp</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Contract</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(job => {
                const c = STATUS_COLORS[job.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' }
                const locatesExpired = job.locatesExpDate && job.locatesExpDate < today
                const locatesExpiringSoon = job.locatesExpDate && !locatesExpired &&
                  new Date(job.locatesExpDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                return (
                  <tr key={job.id} className="hover:bg-orange-50 cursor-pointer transition-colors" onClick={() => onJobClick(job)}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-900">{job.clientName}</p>
                      {job.tearout && <p className="text-xs text-yellow-600">Tearout</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{job.fenceType}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{job.area}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{job.sections || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{job.jobPrice ? fmt(job.jobPrice) : '—'}</td>
                    <td className={`px-4 py-3 text-xs ${locatesExpired ? 'text-red-500 font-bold' : locatesExpiringSoon ? 'text-yellow-600 font-semibold' : 'text-gray-400'}`}>
                      {job.locatesExpDate || '—'}{locatesExpired && ' ⚠'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{job.contractDate || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>{job.status}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2 text-right">{filtered.length} of {jobs.length} jobs</p>
    </div>
  )
}

// ── Main StagingPage ──────────────────────────────────────────────────────────

export default function StagingPage() {
  const [jobs, setJobs]               = useState<StagingJob[]>(loadStaging)
  const [view, setView]               = useState<'kanban' | 'list'>('kanban')
  const [selectedJob, setSelectedJob] = useState<StagingJob | null>(null)
  const [showPushModal, setShowPushModal] = useState(false)
  const [search, setSearch]           = useState('')
  const dragId = useRef<string | null>(null)

  function persist(updated: StagingJob[]) {
    saveStaging(updated)
    setJobs(updated)
  }

  function handlePush(job: StagingJob) {
    persist([job, ...jobs])
    setShowPushModal(false)
  }

  function handleUpdate(updated: StagingJob) {
    const next = jobs.map(j => j.id === updated.id ? updated : j)
    persist(next)
    if (selectedJob?.id === updated.id) setSelectedJob(updated)
  }

  function handleDelete(id: string) {
    persist(jobs.filter(j => j.id !== id))
  }

  function handleRename(oldName: string, newName: string) {
    const updated = jobs.map(j => j.status === oldName ? { ...j, status: newName } : j)
    persist(updated)
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDrop(e: React.DragEvent, status: string) {
    e.preventDefault()
    if (!dragId.current) return
    const next = jobs.map(j =>
      j.id === dragId.current
        ? { ...j, status, lastMoved: new Date().toISOString().slice(0, 10) }
        : j
    )
    persist(next)
    dragId.current = null
  }

  const filtered = jobs.filter(j => {
    const s = search.toLowerCase()
    return !s ||
      j.clientName.toLowerCase().includes(s) ||
      (j.area || '').toLowerCase().includes(s) ||
      (j.fenceType || '').toLowerCase().includes(s)
  })

  const totalValue = jobs.filter(j => j.status !== 'Job Complete').reduce((s, j) => s + (j.jobPrice || 0), 0)
  const totalSections = jobs.filter(j => j.status !== 'Job Complete').reduce((s, j) => s + (j.sections || 0), 0)
  const existingJobIds = new Set(jobs.map(j => j.quoteId).filter(Boolean) as string[])
  const today = new Date().toISOString().slice(0, 10)
  const expiredCount = jobs.filter(j => j.locatesExpDate && j.locatesExpDate < today && j.status !== 'Job Complete').length
  const expiringSoonCount = jobs.filter(j => {
    if (!j.locatesExpDate || j.status === 'Job Complete') return false
    const exp = new Date(j.locatesExpDate)
    return exp >= new Date() && exp <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }).length

  const [stagingStatuses, setStagingStatuses] = useState<string[]>(STAGING_STATUSES)

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-5 gap-3 mb-4">
        {[
          { label: 'Total Jobs',      value: String(jobs.filter(j => j.status !== 'Job Complete').length), sub: 'in staging',       color: 'text-gray-900'   },
          { label: 'Pipeline Value',  value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalValue), sub: 'active jobs', color: 'text-green-600' },
          { label: 'Total Sections',  value: String(totalSections),  sub: 'pending install', color: 'text-blue-600'   },
          { label: 'Locates Expired', value: String(expiredCount),   sub: expiredCount > 0 ? 'need renewal' : 'all good', color: expiredCount > 0 ? 'text-red-500' : 'text-green-600' },
          { label: 'Expiring Soon',   value: String(expiringSoonCount), sub: 'within 7 days', color: expiringSoonCount > 0 ? 'text-yellow-600' : 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <input
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 w-64"
          placeholder="Search jobs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          <button onClick={() => setView('kanban')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'kanban' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Board</button>
          <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>List</button>
        </div>
        <button onClick={() => setShowPushModal(true)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg ml-auto">
          + Push Sold Quote
        </button>
      </div>

      {view === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {stagingStatuses.map(status => (
            <KanbanColumn
              key={status}
              status={status}
              jobs={filtered.filter(j => j.status === status)}
              onJobClick={setSelectedJob}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onRename={(old, next) => {
                setStagingStatuses(prev => prev.map(s => s === old ? next : s))
                handleRename(old, next)
              }}
            />
          ))}
        </div>
      ) : (
        <ListView jobs={filtered} onJobClick={setSelectedJob} />
      )}

      {showPushModal && (
        <PushQuoteModal
          onClose={() => setShowPushModal(false)}
          onPush={handlePush}
          existingJobIds={existingJobIds}
        />
      )}

      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}