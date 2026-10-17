import { useState, useMemo, useRef, useEffect } from 'react'
import { totalMaterialCost } from './materialCalculator'
import type { LineItem, MaterialResult } from './materialCalculator'
import { resolveSubRate, cleanOverrides } from './pricingEngine'
import type { LaborMode, SubUnit, PriceMethod, QuotePricingOverrides } from './pricingEngine'
import { INVENTORY_UPDATED_EVENT, getInventory } from './inventoryStore'
import { normalizeItemName } from './materialCalculator'
import { stalePartsOnQuote, priceAgeLabel, DEFAULT_PRICE_STALE_MONTHS } from './priceAge'
import { newId } from './recordSync'
import type { SavedQuote } from './QuotesPage'
import { getCustomers, getCustomerById, upsertCustomer } from './customerStore'
import AddressAutocomplete from './AddressAutocomplete'
import { getConfig } from './configStore'
import { getRailOptimizerConfig } from './configStore'
import { calculateQuote, widthComparison, type QuoteCalcInput } from './quoteCalc'
import { sectionWidthForStyle } from './materialCalculator'
import { deriveLayout, formatFtIn, postSpacing, type YardLayout } from './yardLayout'
import LayoutEditor from './LayoutEditor'
import VoicePanel, { type VoiceHandle } from './VoicePanel'
import MediaGallery, { type ShownMedia } from './MediaGallery'
import { fetchCurrentUser } from './crmAuth'
import { saveConfig } from './configStore'
import { tapeChecks, tapeFlags, gateChecks, marginCheck, perFootCheck, type NamedRun } from './quoteChecks'
import { getQuotes } from './quoteStore'
import { renderToStaticMarkup } from 'react-dom/server'
import SitePlan from './SitePlan'
import { compareStyles, priceOption, buildProposal, optionLabel } from './proposal'
import { resolveTiers, tierOptions, isVinylStyle, DEFAULT_TIERS, DEFAULT_POPULAR, type TierPrefs, type TierKey } from './tiers'
import { getContractSections } from './contractStore'
import { listStylePhotos } from './stylePhotosApi'
import { useBackLayer, useLeaveWarning, BackClose, navigate } from './nav'
import PercentField from './PercentField'
import { targetMarginPct, overheadPctOf } from './configStore'
import DollarPickets from './DollarPickets'
import { businessDate } from './businessDate'

// Settings are read when the builder opens (not when the app loads), so a
// change in Settings → Pricing or Fence Styles applies to the next quote
// without a page reload.
const DEFAULT_LEAD_SOURCES = ['Google', 'Facebook', 'Instagram', 'Yard Sign', 'Referral', 'Door Hanger', 'Repeat Customer', 'Nextdoor', 'Other']
function leadSources(): string[] {
  const ls = getConfig().leadSources
  return ls?.length ? ls : DEFAULT_LEAD_SOURCES
}

/** '' → undefined, otherwise the number if it is valid and not negative. */
function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = parseFloat(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
const FLAME_COLORS   = ['text-blue-400','text-cyan-400','text-yellow-400','text-orange-500','text-red-500']
const FLAME_LABELS   = ['Cold','Cool','Warm','Hot','On Fire']

interface RunLength {
  ft: string
  /** Auto-mix only: per-run rail-width override or 'auto' (let optimizer decide). */
  rail?: 'auto' | '6ft' | '8ft'
}

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

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

// ── Save Modal ────────────────────────────────────────────────────────────────

function SaveModal({
  onSave,
  onCancel,
  initialCustomerName,
  initialCustomerId,
  initialAddress = '',
  initialNotes = '',
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
  /** The property this quote is for (it can differ from the customer's main address). */
  initialAddress?: string
  initialNotes?: string
}) {
  const [mode, setMode]           = useState<'search' | 'new'>('search')
  const [search, setSearch]       = useState(initialCustomerName)
  const [selectedCustomer, setSelectedCustomer] = useState<SavedCustomer | null>(() => {
    if (!initialCustomerId) return null
    return (getCustomerById(initialCustomerId) as SavedCustomer | null) ?? null
  })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [address, setAddress]     = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [salesRep, setSalesRep]   = useState('')
  const [status, setStatus]       = useState<SavedQuote['status']>('DRAFT')
  const [notes, setNotes]         = useState(initialNotes)
  const [leadTemp, setLeadTemp]   = useState(0)
  const [propertyAddress, setPropertyAddress] = useState(initialAddress || selectedCustomer?.serviceAddress || '')
  const LEAD_SOURCES = useMemo(() => leadSources(), [])

  const allCustomers: SavedCustomer[] = useMemo(() => {
    return getCustomers() as SavedCustomer[]
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
    setPropertyAddress(c.serviceAddress || '')
  }

  function handleSubmit() {
    if (mode === 'search' && selectedCustomer) {
      onSave({
        customerId: selectedCustomer.id,
        customerName: `${selectedCustomer.firstName} ${selectedCustomer.lastName}`,
        customerPhone: selectedCustomer.phone,
        customerEmail: selectedCustomer.email,
        customerAddress: propertyAddress.trim() || selectedCustomer.serviceAddress,
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
      const { customer } = upsertCustomer({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        email,
        serviceAddress: address,
        leadSource,
        salesRep,
      })
      onSave({
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        customerPhone: customer.phone,
        customerEmail: customer.email,
        customerAddress: customer.serviceAddress,
        leadSource: customer.leadSource,
        salesRep: customer.salesRep,
        status,
        notes,
        leadTemp,
      })
    }
  }

  const canSubmit = mode === 'search' ? !!selectedCustomer : !!firstName.trim()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto mx-4 lg:mx-0 modal-responsive">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Save quote</h2>
          <button onClick={onCancel} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
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
                // The keyboard only opens when a customer still has to be picked; it would cover Save.
                autoFocus={!selectedCustomer}
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
                  <button onClick={() => { setSelectedCustomer(null); setSearch('') }} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
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
                  className={`text-2xl min-w-[48px] min-h-[48px] transition-all hover:scale-125 ${i <= leadTemp ? FLAME_COLORS[i-1] : 'text-gray-200'}`}
                >🔥</button>
              ))}
              {leadTemp > 0 && (
                <span className="text-xs text-gray-400 ml-1">{FLAME_LABELS[leadTemp - 1]}</span>
              )}
            </div>
          </div>

          {mode === 'search' && selectedCustomer && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-medium">Property address</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={propertyAddress}
                onChange={e => setPropertyAddress(e.target.value)}
                data-quote-property-address
              />
            </div>
          )}

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
              className="btn btn-primary flex-1"
              data-save-submit
            >
              Save quote
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

  // Styles, rates and thresholds all come from Settings. Inactive styles are
  // hidden unless this quote already uses one.
  const cfg = useMemo(() => getConfig(), [])
  const FENCE_STYLES = useMemo(
    () => cfg.fenceStyles.filter(s => s.isActive !== false || s.name === init?.fenceStyle),
    [cfg, init?.fenceStyle],
  )
  const initPricing: QuotePricingOverrides = init?.pricing ?? {}

  const [customerName, setCustomerName] = useState(init?.customerName ?? '')
  const [styleId, setStyleId]           = useState(() => {
    if (!init) return ''
    const found = FENCE_STYLES.find(s => s.name === init.fenceStyle)
    return found?.id ?? ''
  })
  const [runs, setRuns]                 = useState<RunLength[]>(
    init?.runs.length
      ? init.runs.map((ft, i) => ({ ft: String(ft), rail: init.runRails?.[i] ?? 'auto' }))
      : [{ ft: '', rail: 'auto' }]
  )
  // Layout first quoting: a new quote starts from the yard shape; a quote
  // saved with a layout reopens on it; older quotes open on the run list.
  const [entry, setEntry]               = useState<'layout' | 'advanced'>(() =>
    init?.layout?.yard ? 'layout' : (init?.runs?.length ? 'advanced' : 'layout'))
  const [yard, setYard]                 = useState<YardLayout | null>(init?.layout?.yard ?? null)
  const [corners, setCorners]           = useState(init?.corners ?? 0)
  const [ends, setEnds]                 = useState(init?.ends ?? 0)
  const [walkGates, setWalkGates]       = useState(init?.walkGates ?? 0)
  const [dblGates, setDblGates]         = useState(init?.dblGates ?? 0)
  const [tearOutSec, setTearOutSec]     = useState(init?.tearOutSections ?? 0)
  const [tearOutGates, setTearOutGates] = useState(init?.tearOutGates ?? 0)
  const [adjLaborHrs, setAdjLaborHrs]   = useState(init?.adjLaborHrs ? String(init.adjLaborHrs) : '')
  const [priceAdjust, setPriceAdjust]   = useState(init?.priceAdjust ?? 0)
  const [hasSalesman, setHasSalesman]   = useState(init?.hasSalesman ?? false)
  // Pricing choices for this quote. A saved quote reopens with the choices it
  // was saved with; a new quote starts from Settings → Pricing.
  const [laborMode, setLaborMode]       = useState<LaborMode>(initPricing.laborMode ?? cfg.pricing.laborMode ?? 'hourly')
  const [subUnit, setSubUnit]           = useState<SubUnit>(initPricing.subUnit ?? cfg.pricing.subUnit ?? 'foot')
  const [subRateStr, setSubRateStr]     = useState(initPricing.subRate != null ? String(initPricing.subRate) : '')
  const [laborFlatStr, setLaborFlatStr] = useState(initPricing.laborCost != null ? String(initPricing.laborCost) : '')
  const [priceMethod, setPriceMethod]   = useState<PriceMethod>(initPricing.priceMethod ?? cfg.pricing.priceMethod ?? 'cost_factor')
  const [perFootStr, setPerFootStr]     = useState(initPricing.pricePerFoot != null ? String(initPricing.pricePerFoot) : '')
  const [factorStr, setFactorStr]       = useState(initPricing.costFactor != null ? String(initPricing.costFactor) : '')
  const [finalPriceStr, setFinalPriceStr] = useState(initPricing.finalPrice != null ? String(initPricing.finalPrice) : '')
  // Bumps when Inventory changes so material costs are re-read while the builder is open.
  const [invTick, setInvTick]           = useState(0)
  useEffect(() => {
    const onInv = () => setInvTick(t => t + 1)
    window.addEventListener(INVENTORY_UPDATED_EVENT, onInv)
    return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, onInv)
  }, [])
  const [showPullSheet, setShowPullSheet] = useState(true)
  // Options offered on the proposal besides this quote's own style.
  const [offer, setOffer] = useState<string[]>(() => (init?.proposal?.options ?? []).slice(1).map(o => o.fenceStyle))
  const [showCompare, setShowCompare] = useState(false)
  // Voice: off by default, remembered per user (Settings → Voice).
  const [userId, setUserId] = useState<string | null>(null)
  useEffect(() => { fetchCurrentUser().then(u => setUserId(u?.id ?? null)).catch(() => {}) }, [])
  const [voiceOn, setVoiceOn] = useState(false)
  useEffect(() => { if (userId) setVoiceOn(!!getConfig().voice?.onFor?.includes(userId)) }, [userId])
  const voiceRef = useRef<VoiceHandle | null>(null)
  const [voiceNotes, setVoiceNotes] = useState<string[]>([])
  // Photos and video: pins on the plan, and which one a tapped pin opens.
  const [mediaItems, setMediaItems] = useState<ShownMedia[]>([])
  const [openMedia, setOpenMedia] = useState<string | null>(null)
  const [cameraSignal, setCameraSignal] = useState(0)
  function toggleVoice(on: boolean) {
    setVoiceOn(on)
    if (!userId) return
    const c = getConfig()
    const onFor = new Set(c.voice?.onFor ?? [])
    if (on) onFor.add(userId); else onFor.delete(userId)
    saveConfig({ ...c, voice: { ...(c.voice ?? {}), onFor: [...onFor] } })
  }
  const [tierPrefs, setTierPrefs] = useState<TierPrefs>(() => ({
    off: (init?.proposal?.tierPrefs?.off ?? []) as TierKey[],
    swap: (init?.proposal?.tierPrefs?.swap ?? {}) as TierPrefs['swap'],
  }))
  const [photoIds, setPhotoIds] = useState<Record<string, string>>({})
  useEffect(() => {
    listStylePhotos().then(list => setPhotoIds(Object.fromEntries(list.map(p => [p.styleName, p.id])))).catch(() => {})
  }, [])
  const [showSaveModal, setShowSaveModal] = useState(false)

  // Unsaved work: anything changed since the builder opened (after it settles).
  // Back, the close button and closing the tab ask before it is dropped.
  const workRef = useRef('')
  workRef.current = JSON.stringify([styleId, runs, entry, yard, corners, ends, walkGates, dblGates, tearOutSec, tearOutGates, adjLaborHrs, priceAdjust, hasSalesman,
    laborMode, subUnit, subRateStr, laborFlatStr, priceMethod, perFootStr, factorStr, finalPriceStr, offer, tierPrefs, voiceNotes])
  const startWork = useRef<string | null>(null)
  useEffect(() => { const t = setTimeout(() => { startWork.current = workRef.current }, 400); return () => clearTimeout(t) }, [])
  const dirty = () => startWork.current !== null && workRef.current !== startWork.current
  const okToLeave = () => !dirty() || window.confirm('Leave without saving?\n\nThe changes to this quote have not been saved.')
  // Its own address: ?quote=<id>, or ?quote=new&for=<customer>, so a reload or a link reopens it.
  useBackLayer(onClose, {
    key: 'quote',
    params: init?.id ? { quote: init.id } : { quote: 'new', ...(init?.customerId ? { for: init.customerId } : {}) },
    guard: okToLeave,
  })
  useLeaveWarning(dirty)
  // Use `||` instead of `??` so an empty-string id (from callers that
  // preseed a "new quote" with id: '') also falls through to a fresh uid.
  const quoteIdRef = useRef<string>(init?.id || newId())

  const style = FENCE_STYLES.find(s => s.id === styleId)
  const cfgStyle = style
  const isAutoMix = !!cfgStyle?.autoRailMix
  const optSettings = getRailOptimizerConfig()

  // Everything about sections, the 6 ft / 8 ft choice per run, the pull sheet,
  // labor, cost and price comes out of quoteCalc, driven by Settings, the
  // style, Inventory prices and the choices on this quote.
  const pricingOverrides: QuotePricingOverrides = {
    laborMode,
    subUnit: laborMode === 'subcontractor' ? subUnit : undefined,
    subRate: laborMode === 'subcontractor' ? numOrUndef(subRateStr) : undefined,
    laborCost: numOrUndef(laborFlatStr),
    priceMethod,
    pricePerFoot: priceMethod === 'per_foot' ? numOrUndef(perFootStr) : undefined,
    costFactor: priceMethod === 'cost_factor' ? numOrUndef(factorStr) : undefined,
    finalPrice: numOrUndef(finalPriceStr),
  }
  // Section width decides where a gate "near the house" sits: one section in.
  const widthFt = style ? (style.autoRailMix ? 8 : sectionWidthForStyle(style.name, style.panelWidth)) : 8
  const layoutResult = useMemo(() => (entry === 'layout' && yard ? deriveLayout(yard, widthFt * 12) : null), [entry, yard, widthFt])
  // What reaches the quote math: the layout's runs and posts, or the typed run list.
  const fromLayout = !!layoutResult
  const effRuns = fromLayout ? layoutResult!.runs.map(r => ({ ft: r.ft, rail: 'auto' as const })) : runs.map(r => ({ ft: parseFloat(r.ft) || 0, rail: r.rail }))
  const effCorners = fromLayout ? layoutResult!.corners : corners
  const effEnds = fromLayout ? layoutResult!.ends : ends
  const effWalk = fromLayout ? layoutResult!.walkGates : walkGates
  const effDbl = fromLayout ? layoutResult!.dblGates : dblGates
  const calcInput: QuoteCalcInput = {
    style,
    runs: effRuns,
    corners: effCorners, ends: effEnds, walkGates: effWalk, dblGates: effDbl,
    tearOutSections: tearOutSec, tearOutGates,
    extraLaborHrs: parseFloat(adjLaborHrs) || 0,
    hasSalesman,
    priceAdjust,
    pricing: cfg.pricing,
    overrides: pricingOverrides,
    optimizer: optSettings,
  }
  // invTick: re-read Inventory costs when Inventory changes while the builder is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const calc = useMemo(() => calculateQuote(calcInput), [JSON.stringify(calcInput), invTick])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const compare = useMemo(() => widthComparison(calcInput, FENCE_STYLES), [JSON.stringify(calcInput), invTick])
  const sections = calc.sections
  const materials: MaterialResult = calc.materials
  const priced = calc.priced

  const materialItems: LineItem[] = materials.items
  const materialCost = useMemo(() => totalMaterialCost(materialItems), [materialItems])
  const totalFootage = Math.round(effRuns.reduce((s, r) => s + r.ft, 0) * 100) / 100
  const totalsRef = useRef({ footage: 0, sections: 0, price: 0 })

  /** Switch to the typed run list, starting from what the layout produced. */
  function toAdvanced() {
    if (layoutResult) {
      setRuns(layoutResult.runs.length ? layoutResult.runs.map(r => ({ ft: String(r.ft), rail: 'auto' })) : [{ ft: '', rail: 'auto' }])
      setCorners(layoutResult.corners); setEnds(layoutResult.ends)
      setWalkGates(layoutResult.walkGates); setDblGates(layoutResult.dblGates)
    }
    setEntry('advanced')
  }
  const adjustedMH  = priced.manHours
  const laborCost   = priced.laborCost
  const tearOutCost = priced.tearOutCost
  const totalCOGS   = priced.totalCOGS
  const adjPrice    = priced.price
  const commAmt     = priced.commissionAmt
  const grossMargin = priced.grossMargin
  const gmPct       = priced.gmPct
  // Overhead % this quote is priced at (kept with it, so "where every dollar goes" does not move later).
  const overheadNow = typeof initPricing.overheadPct === 'number' && init?.id ? initPricing.overheadPct : overheadPctOf(cfg)
  const gmGood      = cfg.margins?.good ?? 0.34
  const gmWarn      = cfg.margins?.warning ?? 0.27
  const gmColor     = gmPct >= gmGood ? 'text-green-600' : gmPct >= gmWarn ? 'text-yellow-500' : 'text-red-500'
  const defaultSubRate = resolveSubRate(cfgStyle, cfg.pricing)
  totalsRef.current = { footage: totalFootage, sections, price: adjPrice }
  const commissionPctLabel = `${Math.round((cfg.pricing.commissionSalesman ?? 0) * 1000) / 10}%`
  // Help that prevents bad quotes: plain warnings, never a block.
  const namedRuns: NamedRun[] = fromLayout
    ? layoutResult!.runs.map(r => ({ ft: r.ft, label: `${r.sideName}${r.pieces > 1 ? ` piece ${r.piece}` : ''} (${formatFtIn(r.inches)})` }))
    : effRuns.map((r, i) => ({ ft: r.ft, label: `Run ${i + 1} (${formatFtIn(r.ft * 12)})` }))
  const runWidths = effRuns.map((_, i) => (isAutoMix ? (calc.perRunRail[i] === '6ft' ? 6 : 8) : widthFt))
  const tapeRunFlags = style ? tapeFlags(namedRuns, runWidths) : []
  const pastQuotes = useMemo(() => getQuotes(), [])
  // Good, Better, Best: priced from the same layout on every vinyl quote, no taps needed.
  const tiers = useMemo(() => (isVinylStyle(style) && sections > 0
    ? resolveTiers(calcInput, FENCE_STYLES, cfg.proposal?.tiers?.length ? cfg.proposal.tiers : DEFAULT_TIERS, cfg.proposal?.popular ?? DEFAULT_POPULAR, tierPrefs)
    : []), [style, sections, JSON.stringify(calcInput), tierPrefs, invTick])  // eslint-disable-line react-hooks/exhaustive-deps
  // Compare options: the same yard as the styles that make sense for this one.
  const compareRows = useMemo(() => (showCompare && style && sections > 0
    ? compareStyles(style, FENCE_STYLES).map(s => ({ style: s, option: priceOption(calcInput, s) }))
    : []), [showCompare, style, sections, JSON.stringify(calcInput), invTick])  // eslint-disable-line react-hooks/exhaustive-deps
  // Parts whose Inventory price is old or was never confirmed: a warning, never a block.
  const staleMonths = cfg.pricing.priceStaleMonths ?? DEFAULT_PRICE_STALE_MONTHS
  const staleParts = useMemo(() => (style
    ? stalePartsOnQuote(materialItems.filter(i => i.qty > 0).map(i => i.item), getInventory(), businessDate(new Date()), staleMonths, normalizeItemName)
    : []), [style, materialItems, invTick, staleMonths])  // eslint-disable-line react-hooks/exhaustive-deps
  const quoteWarnings = [
    ...(style ? tapeChecks(namedRuns, runWidths) : []),
    ...(fromLayout ? gateChecks(yard) : []),
    // Pricing notes only once a style is picked (before that there is nothing to price).
    ...(style ? materials.warnings : []),
    ...(style ? priced.notes : []),
    ...[style && sections > 0 ? marginCheck(priced.gmPct, cfg.margins?.good ?? 0.34, priced.price) : null,
        style && sections > 0 ? perFootCheck(priced.pricePerFoot, style.name, pastQuotes, quoteIdRef.current) : null].filter((x): x is string => !!x),
  ]

  function addRun() { setRuns(r => [...r, { ft: '', rail: 'auto' }]) }
  function removeRun(i: number) { setRuns(r => r.filter((_, idx) => idx !== i)) }
  function updateRun(i: number, val: string) {
    setRuns(r => r.map((run, idx) => idx === i ? { ...run, ft: val } : run))
  }
  function updateRunRail(i: number, rail: 'auto' | '6ft' | '8ft') {
    setRuns(r => r.map((run, idx) => idx === i ? { ...run, rail } : run))
  }

  const categories = [...new Set(FENCE_STYLES.map(s => s.category))]
  const canSave = styleId && sections > 0

  // The 6 ft / 8 ft picker's per run choice. On auto mix styles it drives the
  // pull sheet; on locked 6 ft tall vinyl it is shown for information.
  const showOptimizer = optSettings.enabled && optSettings.showDetailsInBuilder && !!calc.optimizer
  const optimizerResult = calc.optimizer

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
      runs: effRuns.map(r => r.ft).filter(f => f > 0),
      // Persist per-run rail decisions for auto-mix quotes so reload reproduces
      // the exact pull sheet (and so user overrides survive).
      runRails: isAutoMix
        ? effRuns.filter(r => r.ft > 0).map(r => r.rail ?? 'auto')
        : undefined,
      // The yard as drawn, and each run's sections, so the quote redraws and
      // the crew sees post spacing exactly as priced.
      layout: { yard: fromLayout ? yard : null, runSections: calc.perRunSections.filter((_, i) => effRuns[i].ft > 0) },
      corners: effCorners,
      ends: effEnds,
      walkGates: effWalk,
      dblGates: effDbl,
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
      date: businessDate(new Date()),
      notes: data.notes,
      leadTemp: data.leadTemp ?? 0,
      // The Target Margin it was priced at is kept, so this quote's price never moves when Settings change.
      pricing: cleanOverrides({ ...pricingOverrides, ...(priced.priceMethod === 'cost_factor' ? { costFactor: priced.costFactor } : {}), overheadPct: overheadNow }),
      proposal: style ? buildProposal({
        input: calcInput,
        styles: [style, ...FENCE_STYLES.filter(s => offer.includes(s.name) && s.name !== style.name)],
        ownPrice: adjPrice,
        company: { name: cfg.company?.name || 'Getter Done Fence', phone: cfg.company?.phone || '', email: cfg.company?.email || '' },
        customer: { name: data.customerName, address: data.customerAddress },
        planSvg: fromLayout && yard ? renderToStaticMarkup(<SitePlan layout={yard} result={layoutResult!} runSections={calc.perRunSections} widthFt={widthFt} />) : undefined,
        warranty: getContractSections().find(x => x.key === 'warranty' && x.visible !== false)?.body ?? '',
        settings: cfg.proposal ?? {},
        photoIds,
        tiers: tierOptions(tiers),
        tierPrefs: { off: tierPrefs.off, swap: tierPrefs.swap as Record<string, string> },
      }) : undefined,
    }
    setShowSaveModal(false)
    onSave(quote)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto md:py-6" data-quote-builder>
      <div className="bg-white md:rounded-2xl shadow-2xl w-full max-w-6xl md:mx-4 min-h-full md:min-h-0 pb-24 md:pb-0">

        <div className="flex items-center justify-between gap-3 px-4 md:px-8 py-3 md:py-5 border-b border-gray-200 sticky top-0 md:static bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{init?.id ? 'Edit quote' : 'New quote'}</h2>
            <p className="text-sm text-gray-500 mt-0.5 hidden md:block">Quote builder</p>
          </div>
          <div className="flex items-center gap-3">
            {materialItems.length > 0 && (
              <button onClick={() => setShowPullSheet(p => !p)} className="text-sm text-orange-500 border border-orange-300 rounded-lg px-3 py-1.5 hover:bg-orange-50">
                {showPullSheet ? 'Hide Pull Sheet' : 'Show Pull Sheet'} ({materialItems.length} items)
              </button>
            )}
            <button onClick={() => { if (okToLeave()) onClose() }} aria-label="Close" className="text-gray-500 hover:text-gray-800 text-3xl leading-none w-12 h-12 grid place-items-center" data-quote-close>×</button>
          </div>
        </div>

        {/* One column on the phone: inputs, then the live quote; two side by side on a computer. */}
        <div className="flex flex-col md:flex-row gap-0">
          <div className="flex-1 min-w-0 px-4 md:px-8 py-5 md:py-6 space-y-6 md:border-r border-gray-100 md:overflow-y-auto md:max-h-[80vh]">

            <VoicePanel
              ref={voiceRef}
              on={voiceOn}
              onToggle={toggleVoice}
              layout={entry === 'layout' ? yard : null}
              setLayout={fn => setYard(prev => fn(prev))}
              widthFt={style ? widthFt : null}
              styles={FENCE_STYLES}
              currentStyle={style}
              onStyle={id => setStyleId(id)}
              totals={() => totalsRef.current}
              onNote={text => setVoiceNotes(n => [...n, text])}
              onPhoto={() => setCameraSignal(n => n + 1)}
              quoteKey={quoteIdRef.current}
              readBack={cfg.voice?.readBack !== false}
              rate={cfg.voice?.rate ?? 1}
            />
            {voiceNotes.length > 0 && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm" data-voice-notes>
                <p className="text-xs font-semibold text-gray-600 mb-1">Crew notes (saved with the quote)</p>
                {voiceNotes.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-gray-500 mb-3">Customer name</h3>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Customer name (required when saving)"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
              />
            </div>

            <div data-yard-section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500">{entry === 'layout' ? 'Yard layout' : 'Fence runs (advanced)'}</h3>
                {entry === 'layout'
                  ? <button type="button" onClick={toAdvanced} className="btn btn-quiet btn-sm" data-to-advanced>Advanced: type runs</button>
                  : <button type="button" onClick={() => setEntry('layout')} className="btn btn-quiet btn-sm" data-to-layout>{yard ? 'Back to the yard layout' : 'Use a yard layout'}</button>}
              </div>
              {entry === 'layout' && (
                <LayoutEditor
                  layout={yard}
                  onChange={setYard}
                  result={layoutResult}
                  runSections={calc.perRunSections}
                  nearIn={widthFt * 12}
                  hasStyle={!!style}
                  widthFt={widthFt}
                  tapeFlags={tapeRunFlags}
                  onVoiceSide={voiceOn ? name => voiceRef.current?.quick(name) : undefined}
                  pins={mediaItems.filter(m => m.pin).map(m => ({ id: m.key, x: m.pin!.x, y: m.pin!.y, angle: m.pin!.angle ?? null }))}
                  onPinTap={id => setOpenMedia(id)}
                  address={init?.customerAddress || getCustomers().find(c => `${c.firstName} ${c.lastName}`.trim().toLowerCase() === customerName.trim().toLowerCase())?.serviceAddress || ''}
                />
              )}
            </div>

            <div data-quote-media>
              <MediaGallery
                where={{ quoteKey: quoteIdRef.current }}
                layout={entry === 'layout' ? yard : null}
                onLayout={l => setYard(l)}
                defaultCategory="Site walk"
                onItems={setMediaItems}
                openKey={openMedia}
                onOpened={() => setOpenMedia(null)}
                cameraSignal={cameraSignal}
              />
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 mb-3">Fence style</h3>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={styleId}
                onChange={e => setStyleId(e.target.value)}
              >
                <option value="">Select a fence style...</option>
                {/* Auto-mix styles surface first — optimizer picks 6'/8' per run */}
                {(() => {
                  const autoStyles = FENCE_STYLES.filter(s => (s as any).autoRailMix)
                  return autoStyles.length > 0 ? (
                    <optgroup label="Vinyl Privacy — Auto-mix (recommended)">
                      {autoStyles.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  ) : null
                })()}
                {categories.map(cat => {
                  const styles = FENCE_STYLES.filter(s => s.category === cat && !(s as any).autoRailMix)
                  if (styles.length === 0) return null
                  const label = cat === 'Vinyl' ? 'Vinyl — Locked width' : cat
                  return (
                    <optgroup key={cat} label={label}>
                      {styles.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
            </div>

            {entry === 'advanced' && (<>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500">Fence runs (ft)</h3>
                <button onClick={addRun} className="text-orange-500 text-xs hover:underline">+ Add run</button>
              </div>
              <div className="space-y-2">
                {runs.map((run, i) => {
                  const ft = parseFloat(run.ft) || 0
                  const resolvedRail = isAutoMix ? calc.perRunRail[i] : null
                  const sectionsThisRun = calc.perRunSections[i] ?? 0
                  const isOverridden = isAutoMix && (run.rail === '6ft' || run.rail === '8ft')
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-10">Run {i + 1}</span>
                      <input
                        type="number"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                        placeholder="Length in feet"
                        value={run.ft}
                        onChange={e => updateRun(i, e.target.value)}
                      />
                      {isAutoMix && optSettings.allowOverrides && (
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                          {(['auto', '6ft', '8ft'] as const).map(opt => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateRunRail(i, opt)}
                              className={`text-[10px] font-semibold px-1.5 py-1 rounded ${
                                (run.rail ?? 'auto') === opt
                                  ? 'bg-white text-orange-600 shadow-sm'
                                  : 'text-gray-500 hover:text-gray-800'
                              }`}
                              title={opt === 'auto' ? 'Optimizer chooses' : `Force ${opt} rails`}
                            >
                              {opt === 'auto' ? 'Auto' : opt}
                            </button>
                          ))}
                        </div>
                      )}
                      <span className={`text-xs font-medium w-32 text-right leading-tight ${isOverridden ? 'text-blue-600' : 'text-orange-600'}`}>
                        {ft > 0
                          ? isAutoMix
                            ? `${resolvedRail} · ${sectionsThisRun} sec`
                            : `= ${sectionsThisRun} sec`
                          : ''}
                        {ft > 0 && sectionsThisRun > 0 && <span className="block text-gray-600 font-normal">posts {postSpacing(ft, sectionsThisRun)} apart</span>}
                      </span>
                      {runs.length > 1 && (
                        <button onClick={() => removeRun(i)} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                      )}
                    </div>
                  )
                })}
              </div>

            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 mb-3">Layout</h3>
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
              <h3 className="text-xs font-semibold text-gray-500 mb-3">Gates</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Walk gates',   val: walkGates, set: setWalkGates },
                  { label: 'Double gates', val: dblGates,  set: setDblGates },
                ].map(f => (
                  <div key={f.label}>
                    <label className="text-xs text-gray-400 mb-1 block">{f.label}</label>
                    <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={f.val} onChange={e => f.set(Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>

            </>)}

            {/* 6 ft or 8 ft per run (both entry modes) */}
            <div>
              {/* Smart Rail Optimizer (advisory) */}
              {showOptimizer && optimizerResult && (
                <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="text-xs font-bold text-orange-700">6 ft or 8 ft wide, per run</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {isAutoMix
                          ? `Each run is priced both ways, all parts and labor. The cheaper width is used; 8 ft is kept when it costs no more than ${Math.round(optSettings.costPreferenceThreshold * 100)}% extra.`
                          : 'What auto mix would choose for these runs. This style stays at its own width.'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 mb-3">
                    {optimizerResult.perRun.map(r => (
                      <div key={r.index} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-orange-100">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-12">Run {r.index + 1}</span>
                          <span className="text-gray-700 font-medium w-16">{r.footage} ft</span>
                          <span className={`px-2 py-0.5 rounded font-semibold ${r.railType === '8ft' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700'}`}>
                            {r.railType} rails
                          </span>
                          <span className="text-gray-500">{r.sectionCount} sections</span>
                        </div>
                        <span className="text-gray-400 text-[11px] truncate ml-2">{r.reason}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-orange-200">
                    <div>
                      <p className="text-[10px] text-gray-500">Mix</p>
                      <p className="text-sm font-bold text-gray-900">
                        {optimizerResult.totals.runs6ft} × 6ft / {optimizerResult.totals.runs8ft} × 8ft
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {optimizerResult.totals.sections6ft} + {optimizerResult.totals.sections8ft} = {optimizerResult.totals.totalSections} sections
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">Cost vs all 6 ft</p>
                      <p className={`text-sm font-bold ${optimizerResult.totals.savingsVsAll6ft > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                        {optimizerResult.totals.savingsVsAll6ft > 0 ? `-$${optimizerResult.totals.savingsVsAll6ft.toFixed(2)}` : '$0.00'}
                      </p>
                      <p className="text-[10px] text-gray-400">{optimizerResult.totals.savingsVsAll6ft > 0 ? 'saved' : 'no change'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">Sections vs all-6ft</p>
                      <p className={`text-sm font-bold ${optimizerResult.totals.sectionsSavedVsAll6ft > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                        {optimizerResult.totals.sectionsSavedVsAll6ft > 0 ? `-${optimizerResult.totals.sectionsSavedVsAll6ft}` : '0'}
                      </p>
                      <p className="text-[10px] text-gray-400">fewer sections (productivity)</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 mb-3">Tear out</h3>
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
              <h3 className="text-xs font-semibold text-gray-500 mb-3">Labor</h3>
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-3">
                {([['hourly', 'Hourly crew'], ['subcontractor', 'Subcontractor']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLaborMode(mode)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${laborMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >{label}</button>
                ))}
              </div>

              {laborMode === 'subcontractor' ? (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Sub rate ($)</label>
                    <input type="number" min={0} step="0.25" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder={defaultSubRate > 0 ? `${defaultSubRate} from Settings` : 'No rate set'} value={subRateStr} onChange={e => setSubRateStr(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Paid per</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={subUnit} onChange={e => setSubUnit(e.target.value as SubUnit)}>
                      <option value="foot">Foot</option>
                      <option value="section">Section</option>
                    </select>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">
                  Projected man hours × ${cfg.pricing.manHourRate}/hr from Settings.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Extra hours (at ${cfg.pricing.manHourRate}/hr)</label>
                  <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="0" value={adjLaborHrs} onChange={e => setAdjLaborHrs(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Flat labor $ (replaces calculated)</label>
                  <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Calculated" value={laborFlatStr} onChange={e => setLaborFlatStr(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-gray-700">Salesman on this job?</p>
                <p className="text-xs text-gray-400">
                  {commissionPctLabel} commission, {priced.commissionMode === 'added' ? 'added on top of the price' : 'taken out of the price'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hasSalesman}
                aria-label="Salesman on this job"
                onClick={() => setHasSalesman(h => !h)}
                className="shrink-0 w-14 h-12 grid place-items-center rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-300"
              >
                <span className={`relative block w-11 h-6 rounded-full transition-colors ${hasSalesman ? 'bg-orange-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${hasSalesman ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>
            </div>
          </div>

          <div className="w-full md:w-80 flex flex-col bg-gray-50 md:rounded-r-2xl border-t md:border-t-0 border-gray-200">
            <div className="px-6 py-6 space-y-3 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-500">Live quote</h3>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500">Total sections</span>
                  <span className="text-xl font-bold text-gray-900">{sections}</span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500">Total footage</span>
                  <span className="text-sm font-semibold text-gray-700">
                    {totalFootage} ft
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Projected man hours</span>
                  <span className="text-xl font-bold text-gray-900">{adjustedMH.toFixed(1)}</span>
                </div>
                {adjustedMH > 0 && (
                  <div className="flex justify-between items-center mt-1" data-crew-time>
                    <span className="text-xs text-gray-500">Crew time ({priced.crewSize} men)</span>
                    <span className="text-sm font-semibold text-gray-700">
                      {priced.crewHours.toFixed(1)} hr · {priced.crewDays.toFixed(1)} {priced.crewDays.toFixed(1) === '1.0' ? 'day' : 'days'}
                    </span>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                {[
                  { label: 'Material cost', val: fmt(materialCost) },
                  { label: priced.laborMode === 'flat' ? 'Labor (flat)' : priced.laborMode === 'subcontractor' ? `Labor (sub, $${priced.subRate}/${priced.subUnit === 'section' ? 'sec' : 'ft'})` : 'Labor Cost', val: fmt(laborCost) },
                  { label: 'Tear out',      val: fmt(tearOutCost) },
                ].map(row => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="text-gray-900 font-medium">{row.val}</span>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-semibold">
                  <span className="text-gray-700">Total cost</span>
                  <span className="text-gray-900">{fmt(totalCOGS)}</span>
                </div>
              </div>

              {quoteWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-amber-800">Check before you quote</p>
                  {quoteWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-800 leading-snug">{w}</p>
                  ))}
                </div>
              )}

              {staleParts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5" data-stale-prices>
                  <p className="text-xs font-semibold text-amber-800">
                    {staleParts.length} part{staleParts.length === 1 ? '' : 's'} on this quote {staleParts.length === 1 ? 'has a price' : 'have prices'} older than {staleMonths} months or never confirmed
                  </p>
                  {staleParts.slice(0, 6).map(({ item }) => (
                    <p key={item.id} className="text-xs text-amber-800 leading-snug" data-stale-part={item.name}>{item.name.replace(/^\*/, '')} · {priceAgeLabel(item)}</p>
                  ))}
                  {staleParts.length > 6 && <p className="text-xs text-amber-800">and {staleParts.length - 6} more</p>}
                  <button type="button" className="btn btn-quiet btn-sm" data-stale-open
                    onClick={() => { if (okToLeave()) navigate(`/inventory?items=${encodeURIComponent(staleParts.map(p => p.item.id).join(','))}`) }}>
                    Open in Inventory
                  </button>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Price from</span>
                  <div className="flex gap-0.5 bg-gray-100 rounded-md p-0.5">
                    {([['cost_factor', 'Cost'], ['per_foot', 'Per foot']] as const).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPriceMethod(m)}
                        className={`text-[11px] font-semibold px-2 py-1 rounded ${priceMethod === m ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                {priceMethod === 'cost_factor' ? (
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Target Margin for this quote</label>
                    {/* Typed as a percent (44 or 44%); kept on the quote as the number price is divided into. */}
                    <PercentField value={factorStr ? Math.round((1 - parseFloat(factorStr)) * 10000) / 100 : undefined} min={1} max={95}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder={`${cfgStyle ? targetMarginPct(cfgStyle) : 36}% from the style`} data-quote-target-margin
                      onChange={v => setFactorStr(v == null ? '' : String((100 - v) / 100))} />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Price per foot ($)</label>
                    <input type="number" min={0} step="0.25" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder={cfgStyle?.pricePerFoot ? `${cfgStyle.pricePerFoot} from style` : 'No price set for this style'} value={perFootStr} onChange={e => setPerFootStr(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Set final price by hand ($)</label>
                  <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Calculated" value={finalPriceStr} onChange={e => setFinalPriceStr(e.target.value)} />
                </div>
              </div>

              <div className={`bg-white rounded-xl border border-gray-200 p-4 ${priced.priceMethod === 'manual' ? 'opacity-40' : ''}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-500">Price adjust</span>
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
                <p className="text-gray-400 text-xs mb-1">{priced.priceMethod === 'manual' ? 'Price (set by hand)' : 'Adjusted Price'}</p>
                <p className="text-white text-3xl font-bold" data-quote-price>{fmt(adjPrice)}</p>
                {totalFootage > 0 && <p className="text-gray-400 text-xs mt-1">{fmt(priced.pricePerFoot)} per foot</p>}
                {commAmt > 0 && <p className="text-gray-400 text-xs mt-1">Commission: {fmt(commAmt)}</p>}
                {compare && (
                  <p className="text-gray-300 text-xs mt-2 pt-2 border-t border-gray-700" data-width-compare>
                    Same job at 6 ft wide: {fmt(compare.at6)}  |  at 8 ft wide: {fmt(compare.at8)}
                  </p>
                )}
              </div>

              {tiers.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2" data-tiers>
                  <p className="text-xs font-semibold text-gray-500">Good, Better, Best <span className="font-normal">· on the proposal</span></p>
                  {tiers.map(t => {
                    const main = t.style.name === style?.name
                    const price = main ? adjPrice : t.option.finalPrice
                    return (
                      <div key={t.spec.key} className={`rounded-lg border p-3 ${main ? 'border-orange-500 bg-orange-50' : 'border-gray-200'} ${t.off ? 'opacity-60' : ''}`} data-tier={t.spec.key}>
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-center gap-2 min-w-0">
                            <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={!t.off} aria-label={`Offer ${t.spec.label}`}
                              onChange={e => setTierPrefs(p => ({ ...p, off: e.target.checked ? p.off.filter(k => k !== t.spec.key) : [...p.off, t.spec.key] }))} />
                            <span className="font-bold text-gray-900">{t.spec.label}</span>
                            {t.popular && <span className="text-[11px] font-semibold bg-orange-500 text-white rounded-full px-2 py-0.5">Most popular</span>}
                          </label>
                          <span className="text-right">
                            <span className="block font-bold tabular-nums" data-tier-price>{fmt(price)}</span>
                            <span className="block text-xs text-gray-600 tabular-nums">{fmt(t.option.perFoot)}/ft</span>
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 mt-1">{optionLabel(t.style.name)}</p>
                        {t.widthFt && <p className="text-xs text-gray-600" data-tier-width>{t.widthFt} ft wide prices lower for this yard{t.otherWidth ? ` (${t.otherWidth.widthFt} ft wide: ${fmt(t.otherWidth.price)})` : ''}.</p>}
                        <div className="flex gap-2 mt-2">
                          <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={main}
                            onClick={() => { const s = FENCE_STYLES.find(x => x.name === t.style.name); if (s) setStyleId(s.id) }} data-tier-main>{main ? 'Main option' : 'Make main'}</button>
                          <select className="min-w-0 flex-1 border border-gray-300 rounded-lg px-2 h-9 text-xs bg-white" value={tierPrefs.swap[t.spec.key] ?? ''} aria-label={`Style for ${t.spec.label}`}
                            onChange={e => setTierPrefs(p => { const swap = { ...p.swap }; if (e.target.value) swap[t.spec.key] = e.target.value; else delete swap[t.spec.key]; return { ...p, swap } })} data-tier-swap>
                            <option value="">Style: automatic</option>
                            {FENCE_STYLES.filter(s => s.isActive !== false && !s.autoRailMix).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {style && sections > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4" data-compare>
                  <button type="button" className="btn btn-secondary w-full" onClick={() => setShowCompare(v => !v)} data-compare-toggle>
                    {showCompare ? 'Hide options' : 'Compare options'}
                  </button>
                  {showCompare && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-600">The same yard, priced each way. Tick the ones to offer on the proposal.</p>
                      {compareRows.length <= 1 && <p className="text-sm text-gray-600">No other options make sense for this style.</p>}
                      {compareRows.map(({ style: s, option: o }, i) => {
                        const own = i === 0
                        const price = own ? adjPrice : o.finalPrice
                        const diff = price - adjPrice
                        return (
                          <label key={s.id} className={`flex items-start gap-3 rounded-lg border p-3 ${own ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`} data-compare-row={s.name}>
                            <input type="checkbox" className="mt-1 w-5 h-5 accent-orange-500" checked={own || offer.includes(s.name)} disabled={own}
                              onChange={e => setOffer(list => e.target.checked ? [...list, s.name] : list.filter(n => n !== s.name))} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-semibold text-gray-900">{o.label}</span>
                              <span className="block text-xs text-gray-600">{s.name} · {o.sections} sections · {fmt(o.perFoot)}/ft</span>
                            </span>
                            <span className="text-right shrink-0">
                              <span className="block text-sm font-bold tabular-nums">{fmt(price)}</span>
                              <span className={`block text-xs font-semibold ${own ? 'text-gray-600' : diff < 0 ? 'text-green-700' : 'text-gray-600'}`}>
                                {own ? 'this quote' : diff < 0 ? `saves ${fmt(-diff)}` : `+${fmt(diff)}`}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

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
                    <div className={`h-1.5 rounded-full transition-all ${gmPct >= gmGood ? 'bg-green-500' : gmPct >= gmWarn ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${Math.max(0, Math.min(gmPct * 100, 100))}%` }} />
                  </div>
                  <p className={`text-xs mt-1 ${gmColor}`}>
                    {gmPct >= gmGood ? '✓ Above target' : gmPct >= gmWarn ? '⚠ Below target' : '✗ Danger zone'}
                  </p>
                </div>
              </div>

              <DollarPickets price={adjPrice} materials={materialCost} labor={laborCost + tearOutCost} commission={commAmt} overheadPct={overheadNow} />

              <button
                disabled={!canSave}
                onClick={() => setShowSaveModal(true)}
                className="btn btn-primary btn-lg w-full"
              >
                {init?.id ? 'Update quote' : 'Save quote'}
              </button>
              {!canSave && <p className="text-xs text-gray-400 text-center">Select a style and enter at least one run</p>}
            </div>

            {showPullSheet && materialItems.length > 0 && (
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500">Pull Sheet</h3>
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

      {/* Phone: the price and Save always in reach at the bottom. */}
      {!showSaveModal && <div className="md:hidden fixed inset-x-0 bottom-0 z-[60] bg-white border-t border-gray-200 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] flex items-center gap-3" data-quote-sticky>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-600 truncate">{totalFootage > 0 ? `${totalFootage} ft · ${sections} sections` : 'Customer price'}</p>
          <p className="text-xl font-bold tabular-nums text-gray-900">{fmt(adjPrice)}</p>
        </div>
        <button disabled={!canSave} onClick={() => setShowSaveModal(true)} className="btn btn-primary btn-lg" data-save-open>{init?.id ? 'Update quote' : 'Save quote'}</button>
      </div>}

      {showSaveModal && <BackClose name="save-quote" onClose={() => setShowSaveModal(false)} />}
      {showSaveModal && (
        <SaveModal
          initialCustomerName={customerName}
          initialCustomerId={init?.customerId}
          initialAddress={init?.customerAddress}
          initialNotes={[init?.notes, ...voiceNotes.map(n => `Crew note: ${n}`)].filter(Boolean).join('\n')}
          onCancel={() => setShowSaveModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}