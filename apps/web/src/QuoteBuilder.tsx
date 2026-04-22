import { useState, useMemo, useRef } from 'react'
import { calculateMaterials, totalMaterialCost } from './materialCalculator'
import type { LineItem } from './materialCalculator'
import type { SavedQuote } from './QuotesPage'
import QuoteOptionsPanel from './QuoteOptionsPanel'
import { addLeadForNewCustomer } from './pipelineSeeder'
import AddressAutocomplete from './AddressAutocomplete'
import { getConfig } from './configStore'

const FENCE_STYLES = [
  { id: '1',  name: "WV-ND 6'x6' Privacy",     category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6  },
  { id: '2',  name: "WV-ND 6'x8' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6  },
  { id: '3',  name: "WV-ND 8'x6' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8  },
  { id: '4',  name: "WV-ND 8'x8' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 8  },
  { id: '5',  name: "WV-ND Bell 4'x6'",         category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.25, panelWidth: 4  },
  { id: '6',  name: "WV-DS 6'x6' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6  },
  { id: '7',  name: "WV-DS 6'x8' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.8,  panelWidth: 6  },
  { id: '8',  name: "WV-DS 8'x6' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8  },
  { id: '9',  name: "WV-DS 8'x8' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 0.7,  panelWidth: 8  },
  { id: '10', name: "TV-ND 6'x6' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.2,  panelWidth: 6  },
  { id: '11', name: "TV-ND 6'x8' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 6  },
  { id: '12', name: "TV-DS 6'x6' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6  },
  { id: '13', name: "TV-DS 6'x8' Privacy",      category: 'Vinyl',      margin: 0.64, sectionsPerMH: 1.1,  panelWidth: 6  },
  { id: '14', name: "CL - 4' Galv",             category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10 },
  { id: '15', name: "CL - 5' Galv",             category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10 },
  { id: '16', name: "CL - 6' Galv",             category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10 },
  { id: '17', name: "CL - 4' Black",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10 },
  { id: '18', name: "CL - 5' Black",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10 },
  { id: '19', name: "CL - 6' Black",            category: 'Chainlink',  margin: 0.56, sectionsPerMH: 1.5,  panelWidth: 10 },
  { id: '20', name: "CL - Com 6'",              category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10 },
  { id: '21', name: "CL - Com 6'+1'",           category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10 },
  { id: '22', name: "CL - Com 6'+1' Black",     category: 'Commercial', margin: 0.56, sectionsPerMH: 1.0,  panelWidth: 10 },
  { id: '23', name: "Alum - ND - Emily - 48",   category: 'Aluminum',   margin: 0.64, sectionsPerMH: 1.5,  panelWidth: 6  },
  { id: '24', name: "Alum - DS - Emily - 48",   category: 'Aluminum',   margin: 0.62, sectionsPerMH: 1.2,  panelWidth: 6  },
  { id: '25', name: "Alum - DS - Ind Abigail",  category: 'Aluminum',   margin: 0.58, sectionsPerMH: 1.2,  panelWidth: 8  },
  { id: '26', name: "Durafence",                category: 'Other',      margin: 0.64, sectionsPerMH: 1.0,  panelWidth: 8  },
]

// Pull live values from Settings → Pricing so changes in admin propagate here
const CFG = getConfig()
const LEAD_SOURCES = CFG.leadSources?.length ? CFG.leadSources : ['Google', 'Facebook', 'Instagram', 'Yard Sign', 'Referral', 'Door Hanger', 'Repeat Customer', 'Nextdoor', 'Other']
const MAN_HOUR_RATE  = CFG.pricing?.manHourRate ?? 22
const TEAR_OUT_FENCE = CFG.pricing?.tearOutFence ?? 9.50
const TEAR_OUT_GATE  = CFG.pricing?.tearOutGate ?? 27.00
const FLAME_COLORS   = ['text-blue-400','text-cyan-400','text-yellow-400','text-orange-500','text-red-500']
const FLAME_LABELS   = ['Cold','Cool','Warm','Hot','On Fire']

interface RunLength { ft: string }

interface SavedCustomer {
  id: string
  firstName: string
  lastName: string
  phone: string
  email: string
  serviceAddress: string
  leadSource: string
  salesRep: string
}

function sectionsForRun(ft: number, panelWidth: number) {
  if (ft <= 0) return 0
  return ft % panelWidth === 0 ? ft / panelWidth : Math.ceil(ft / panelWidth)
}

function r2(n: number) { return n }

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const uid = () => Math.random().toString(36).slice(2, 9)

// ── Save Modal ────────────────────────────────────────────────────────────────

function SaveModal({
  onSave,
  onCancel,
  initialCustomerName,
  initialCustomerId,
}: {
  onSave: (data: {
    customerId: string
    customerName: string
    customerPhone: string
    customerEmail: string
    customerAddress: string
    leadSource: string
    salesRep: string
    status: SavedQuote['status']
    notes: string
    leadTemp: number
  }) => void
  onCancel: () => void
  initialCustomerName: string
  initialCustomerId?: string
}) {
  const [mode, setMode]           = useState<'search' | 'new'>('search')
  const [search, setSearch]       = useState(initialCustomerName)
  const [selectedCustomer, setSelectedCustomer] = useState<SavedCustomer | null>(() => {
    if (!initialCustomerId) return null
    try {
      const raw = localStorage.getItem('fencepro_customers')
      const all = raw ? JSON.parse(raw) : []
      return all.find((c: SavedCustomer) => c.id === initialCustomerId) ?? null
    } catch { return null }
  })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [address, setAddress]     = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [salesRep, setSalesRep]   = useState('')
  const [status, setStatus]       = useState<SavedQuote['status']>('DRAFT')
  const [notes, setNotes]         = useState('')
  const [leadTemp, setLeadTemp]   = useState(0)

  const allCustomers: SavedCustomer[] = useMemo(() => {
    try {
      const raw = localStorage.getItem('fencepro_customers')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }, [])

  const filtered = allCustomers.filter(c => {
    const q = search.toLowerCase()
    return !q ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q)
  }).slice(0, 6)

  function handleSelectCustomer(c: SavedCustomer) {
    setSelectedCustomer(c)
    setSearch(`${c.firstName} ${c.lastName}`)
  }

  function handleSubmit() {
    if (mode === 'search' && selectedCustomer) {
      onSave({
        customerId: selectedCustomer.id,
        customerName: `${selectedCustomer.firstName} ${selectedCustomer.lastName}`,
        customerPhone: selectedCustomer.phone,
        customerEmail: selectedCustomer.email,
        customerAddress: selectedCustomer.serviceAddress,
        leadSource: selectedCustomer.leadSource,
        salesRep: selectedCustomer.salesRep,
        status,
        notes,
        leadTemp,
      })
      return
    }
    if (mode === 'new') {
      if (!firstName.trim()) return
      const newCustomer = {
        id: uid(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        email,
        serviceAddress: address,
        billingAddress: '',
        billingDifferent: false,
        leadSource,
        notes: '',
        tags: [],
        createdAt: new Date().toISOString().slice(0, 10),
        salesRep,
        firstApptDate: '',
      }
      try {
        const existing = JSON.parse(localStorage.getItem('fencepro_customers') || '[]')
        localStorage.setItem('fencepro_customers', JSON.stringify([newCustomer, ...existing]))
      } catch {}
      // Also add to sales pipeline under First Contact
      addLeadForNewCustomer(newCustomer)
      onSave({
        customerId: newCustomer.id,
        customerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        customerPhone: phone,
        customerEmail: email,
        customerAddress: address,
        leadSource,
        salesRep,
        status,
        notes,
        leadTemp,
      })
    }
  }

  const canSubmit = mode === 'search' ? !!selectedCustomer : !!firstName.trim()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto mx-4 lg:mx-0">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Save Quote</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            <button onClick={() => setMode('search')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'search' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Existing Customer
            </button>
            <button onClick={() => setMode('new')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              New Customer
            </button>
          </div>

          {mode === 'search' ? (
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block font-medium">Search customers</label>
              <input
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Name, phone, or email..."
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedCustomer(null) }}
              />
              {search && !selectedCustomer && filtered.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  {filtered.map(c => (
                    <div key={c.id} onClick={() => handleSelectCustomer(c)} className="px-3 py-2.5 hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0">
                      <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                      <p className="text-xs text-gray-400">{c.phone} {c.email && `· ${c.email}`}</p>
                    </div>
                  ))}
                </div>
              )}
              {selectedCustomer && (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                    <p className="text-xs text-gray-500">{selectedCustomer.phone} · {selectedCustomer.serviceAddress}</p>
                  </div>
                  <button onClick={() => { setSelectedCustomer(null); setSearch('') }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                </div>
              )}
              {search && !selectedCustomer && filtered.length === 0 && (
                <div className="mt-2 text-center py-3">
                  <p className="text-xs text-gray-400">No customers found.</p>
                  <button onClick={() => setMode('new')} className="text-xs text-orange-500 hover:underline mt-1">Create new customer instead</button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">First Name *</label>
                  <input autoFocus className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={firstName} onChange={e => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(352) 555-0100" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Email</label>
                  <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Service Address</label>
                <AddressAutocomplete value={address} onChange={setAddress} onSelect={p => setAddress(p.formatted)} placeholder="Address..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Sales Rep</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="e.g. jb" value={salesRep} onChange={e => setSalesRep(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Lead Source</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={leadSource} onChange={e => setLeadSource(e.target.value)}>
                    <option value="">Select...</option>
                    {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500 mb-1.5 block font-medium">Quote Status</label>
            <div className="flex gap-1.5 flex-wrap">
              {(['DRAFT', 'SENT', 'SOLD', 'LOST'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold border transition-colors ${
                    status === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1.5 block font-medium">Lead Temperature</label>
            <div className="flex items-center gap-1.5">
              {[1,2,3,4,5].map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLeadTemp(i)}
                  className={`text-2xl transition-all hover:scale-125 ${i <= leadTemp ? FLAME_COLORS[i-1] : 'text-gray-200'}`}
                >🔥</button>
              ))}
              {leadTemp > 0 && (
                <span className="text-xs text-gray-400 ml-1">{FLAME_LABELS[leadTemp - 1]}</span>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">Notes (optional)</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              rows={3}
              placeholder="HOA requirements, access notes, special instructions..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onCancel} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold py-2.5 rounded-xl"
            >
              Save Quote
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── QuoteBuilder ──────────────────────────────────────────────────────────────

export default function QuoteBuilder({
  onClose,
  onSave,
  initialQuote,
}: {
  onClose: () => void
  onSave: (q: SavedQuote) => void
  initialQuote?: SavedQuote | null
}) {
  const init = initialQuote

  const [customerName, setCustomerName] = useState(init?.customerName ?? '')
  const [styleId, setStyleId]           = useState(() => {
    if (!init) return ''
    const found = FENCE_STYLES.find(s => s.name === init.fenceStyle)
    return found?.id ?? ''
  })
  const [runs, setRuns]                 = useState<RunLength[]>(
    init?.runs.length ? init.runs.map(ft => ({ ft: String(ft) })) : [{ ft: '' }]
  )
  const [corners, setCorners]           = useState(init?.corners ?? 0)
  const [ends, setEnds]                 = useState(init?.ends ?? 0)
  const [walkGates, setWalkGates]       = useState(init?.walkGates ?? 0)
  const [dblGates, setDblGates]         = useState(init?.dblGates ?? 0)
  const [tearOutSec, setTearOutSec]     = useState(init?.tearOutSections ?? 0)
  const [tearOutGates, setTearOutGates] = useState(init?.tearOutGates ?? 0)
  const [adjLaborHrs, setAdjLaborHrs]   = useState(init?.adjLaborHrs ? String(init.adjLaborHrs) : '')
  const [priceAdjust, setPriceAdjust]   = useState(init?.priceAdjust ?? 0)
  const [hasSalesman, setHasSalesman]   = useState(init?.hasSalesman ?? false)
  const [showPullSheet, setShowPullSheet] = useState(true)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const quoteIdRef = useRef<string>(init?.id ?? uid())

  const style = FENCE_STYLES.find(s => s.id === styleId)

  const sections = runs.reduce((sum, r) => {
    const ft = parseFloat(r.ft) || 0
    return sum + (style ? sectionsForRun(ft, style.panelWidth) : 0)
  }, 0)

  const materialItems: LineItem[] = useMemo(() => {
    if (!style || sections === 0) return []
    return calculateMaterials({
      fenceStyle:      style.name,
      runs:            runs.map(r => parseFloat(r.ft) || 0).filter(f => f > 0),
      corners,
      ends,
      walkGates,
      dblGates,
      tearOutSections: tearOutSec,
      tearOutGates,
    })
  }, [style, runs, corners, ends, walkGates, dblGates, tearOutSec, tearOutGates])

  const materialCost = useMemo(() => totalMaterialCost(materialItems), [materialItems])

  const mhPerWalkGate = 2.4
  const mhPerDblGate  = 4.8
  const baseMH = style
    ? sections / style.sectionsPerMH + walkGates * mhPerWalkGate + dblGates * mhPerDblGate
    : 0
  const adjustedMH  = baseMH + (parseFloat(adjLaborHrs) || 0)
  const laborCost   = r2(adjustedMH * MAN_HOUR_RATE)
  const tearOutCost = r2(tearOutSec * TEAR_OUT_FENCE + tearOutGates * TEAR_OUT_GATE)
  const totalCOGS   = r2(laborCost + materialCost + tearOutCost)
  const margin      = style ? style.margin : 0.64
  const basePrice   = margin > 0 ? r2(totalCOGS / margin) : 0
  const adjPrice    = r2(basePrice * (1 + priceAdjust))
  const commPct     = hasSalesman ? 0.10 : 0
  const commAmt     = r2(adjPrice * commPct)
  const grossMargin = r2(adjPrice - totalCOGS - commAmt)
  const gmPct       = adjPrice > 0 ? grossMargin / adjPrice : 0
  const gmColor     = gmPct >= 0.34 ? 'text-green-600' : gmPct >= 0.27 ? 'text-yellow-500' : 'text-red-500'

  function addRun() { setRuns(r => [...r, { ft: '' }]) }
  function removeRun(i: number) { setRuns(r => r.filter((_, idx) => idx !== i)) }
  function updateRun(i: number, val: string) {
    setRuns(r => r.map((run, idx) => idx === i ? { ft: val } : run))
  }

  const categories = [...new Set(FENCE_STYLES.map(s => s.category))]
  const canSave = styleId && sections > 0

  function handleSave(data: {
    customerId: string
    customerName: string
    customerPhone: string
    customerEmail: string
    customerAddress: string
    leadSource: string
    salesRep: string
    status: SavedQuote['status']
    notes: string
    leadTemp: number
  }) {
    const quote: SavedQuote = {
      id: quoteIdRef.current,
      customerId: data.customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      customerAddress: data.customerAddress,
      leadSource: data.leadSource,
      salesRep: data.salesRep,
      fenceStyle: style?.name ?? '',
      runs: runs.map(r => parseFloat(r.ft) || 0).filter(f => f > 0),
      corners,
      ends,
      walkGates,
      dblGates,
      tearOutSections: tearOutSec,
      tearOutGates,
      adjLaborHrs: parseFloat(adjLaborHrs) || 0,
      hasSalesman,
      priceAdjust,
      sections,
      materialCost,
      laborCost,
      tearOutCost,
      totalCOGS,
      finalPrice: adjPrice,
      gmPct,
      pullSheet: materialItems,
      status: data.status,
      date: new Date().toISOString().slice(0, 10),
      notes: data.notes,
      leadTemp: data.leadTemp ?? 0,
    }
    setShowSaveModal(false)
    onSave(quote)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto py-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mx-4">

        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{init ? 'Edit Quote' : 'New Quote'}</h2>
            <p className="text-sm text-gray-400 mt-0.5">EZ-Quote Builder</p>
          </div>
          <div className="flex items-center gap-3">
            {materialItems.length > 0 && (
              <button onClick={() => setShowPullSheet(p => !p)} className="text-sm text-orange-500 border border-orange-300 rounded-lg px-3 py-1.5 hover:bg-orange-50">
                {showPullSheet ? 'Hide Pull Sheet' : 'Show Pull Sheet'} ({materialItems.length} items)
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>
        </div>

        <div className="flex gap-0">
          <div className="flex-1 px-8 py-6 space-y-6 border-r border-gray-100 overflow-y-auto max-h-[80vh]">

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Customer Name</h3>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Customer name (required when saving)"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
              />
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Fence Style</h3>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={styleId}
                onChange={e => setStyleId(e.target.value)}
              >
                <option value="">Select a fence style...</option>
                {categories.map(cat => (
                  <optgroup key={cat} label={cat}>
                    {FENCE_STYLES.filter(s => s.category === cat).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fence Runs (ft)</h3>
                <button onClick={addRun} className="text-orange-500 text-xs hover:underline">+ Add run</button>
              </div>
              <div className="space-y-2">
                {runs.map((run, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-10">Run {i + 1}</span>
                    <input
                      type="number"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="Length in feet"
                      value={run.ft}
                      onChange={e => updateRun(i, e.target.value)}
                    />
                    <span className="text-xs text-gray-400 w-16 text-right">
                      {style && (parseFloat(run.ft) || 0) > 0 ? `${sectionsForRun(parseFloat(run.ft), style.panelWidth)} sec` : ''}
                    </span>
                    {runs.length > 1 && (
                      <button onClick={() => removeRun(i)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Layout</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Corners', val: corners, set: setCorners },
                  { label: 'Ends',    val: ends,    set: setEnds },
                ].map(f => (
                  <div key={f.label}>
                    <label className="text-xs text-gray-400 mb-1 block">{f.label}</label>
                    <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={f.val} onChange={e => f.set(Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Gates</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Walk Gates',   val: walkGates, set: setWalkGates },
                  { label: 'Double Gates', val: dblGates,  set: setDblGates },
                ].map(f => (
                  <div key={f.label}>
                    <label className="text-xs text-gray-400 mb-1 block">{f.label}</label>
                    <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={f.val} onChange={e => f.set(Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Tear Out</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Sections', val: tearOutSec,   set: setTearOutSec },
                  { label: 'Gates',    val: tearOutGates, set: setTearOutGates },
                ].map(f => (
                  <div key={f.label}>
                    <label className="text-xs text-gray-400 mb-1 block">{f.label}</label>
                    <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={f.val} onChange={e => f.set(Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Labor Override</h3>
              <label className="text-xs text-gray-400 mb-1 block">Extra hours added on top of calculated</label>
              <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="0" value={adjLaborHrs} onChange={e => setAdjLaborHrs(e.target.value)} />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-gray-700">Salesman on this job?</p>
                <p className="text-xs text-gray-400">Adds 10% commission</p>
              </div>
              <button
                onClick={() => setHasSalesman(h => !h)}
                className={`relative w-11 h-6 rounded-full transition-colors ${hasSalesman ? 'bg-orange-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${hasSalesman ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            <QuoteOptionsPanel inputs={{
              quoteId: quoteIdRef.current,
              runs: runs.map(r => parseFloat(r.ft) || 0).filter(f => f > 0),
              corners, ends, walkGates, dblGates,
              tearOutSections: tearOutSec, tearOutGates,
              adjLaborHrs: parseFloat(adjLaborHrs) || 0,
              hasSalesman, priceAdjust,
              fenceStyleId: styleId,
            }} />
          </div>

          <div className="w-80 flex flex-col bg-gray-50 rounded-r-2xl">
            <div className="px-6 py-6 space-y-3 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Live Quote</h3>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500">Sections</span>
                  <span className="text-xl font-bold text-gray-900">{sections}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Projected MH</span>
                  <span className="text-xl font-bold text-gray-900">{r2(adjustedMH).toFixed(1)}</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                {[
                  { label: 'Material Cost', val: fmt(materialCost) },
                  { label: 'Labor Cost',    val: fmt(laborCost) },
                  { label: 'Tear Out',      val: fmt(tearOutCost) },
                ].map(row => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="text-gray-900 font-medium">{row.val}</span>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-semibold">
                  <span className="text-gray-700">Total COGS</span>
                  <span className="text-gray-900">{fmt(totalCOGS)}</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-500">Price Adjust</span>
                  <span className={`text-sm font-semibold ${priceAdjust >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {priceAdjust >= 0 ? '+' : ''}{(priceAdjust * 100).toFixed(0)}%
                  </span>
                </div>
                <input type="range" min={-20} max={20} step={1} value={priceAdjust * 100} onChange={e => setPriceAdjust(Number(e.target.value) / 100)} className="w-full accent-orange-500" />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>-20%</span><span>0%</span><span>+20%</span>
                </div>
              </div>

              <div className="bg-gray-900 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Adjusted Price</p>
                <p className="text-white text-3xl font-bold">{fmt(adjPrice)}</p>
                {hasSalesman && <p className="text-gray-400 text-xs mt-1">Commission: {fmt(commAmt)}</p>}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Gross Margin</span>
                  <span className={`text-2xl font-bold ${gmColor}`}>{(gmPct * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-400">Margin $</span>
                  <span className={`text-sm font-semibold ${gmColor}`}>{fmt(grossMargin)}</span>
                </div>
                <div className="mt-2">
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${gmPct >= 0.34 ? 'bg-green-500' : gmPct >= 0.27 ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${Math.min(gmPct * 100, 100)}%` }} />
                  </div>
                  <p className={`text-xs mt-1 ${gmColor}`}>
                    {gmPct >= 0.34 ? '✓ Above target' : gmPct >= 0.27 ? '⚠ Below target' : '✗ Danger zone'}
                  </p>
                </div>
              </div>

              <button
                disabled={!canSave}
                onClick={() => setShowSaveModal(true)}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                {init ? 'Update Quote' : 'Save Quote'}
              </button>
              {!canSave && <p className="text-xs text-gray-400 text-center">Select a style and enter at least one run</p>}
            </div>

            {showPullSheet && materialItems.length > 0 && (
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pull Sheet</h3>
                  <span className="text-xs text-gray-400">{materialItems.length} items</span>
                </div>
                <div className="space-y-1">
                  {materialItems.map((item, i) => (
                    <div key={i} className="flex items-start justify-between text-xs py-1.5 border-b border-gray-100 last:border-0">
                      <div className="flex-1 pr-2">
                        <p className="text-gray-800 font-medium leading-tight">{item.item}</p>
                        <p className="text-gray-400 mt-0.5">{item.qty} × {fmt(item.unitCost)}</p>
                      </div>
                      <span className="text-gray-900 font-semibold whitespace-nowrap">{fmt(item.total)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-300 flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-700">Total Material</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(materialCost)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSaveModal && (
        <SaveModal
          initialCustomerName={customerName}
          initialCustomerId={init?.customerId}
          onCancel={() => setShowSaveModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}