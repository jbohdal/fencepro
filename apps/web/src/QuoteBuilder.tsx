import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { formatPhone } from './phoneFormat'
import { Camera, ChevronLeft } from 'lucide-react'
import { totalMaterialCost } from './materialCalculator'
import type { LineItem, MaterialResult } from './materialCalculator'
import { resolveSubRate, cleanOverrides, importedOldPrice, keepsCents, crewTime } from './pricingEngine'
import type { LaborMode, SubUnit, PriceMethod, QuotePricingOverrides } from './pricingEngine'
import { INVENTORY_UPDATED_EVENT, getInventory } from './inventoryStore'
import { normalizeItemName } from './materialCalculator'
import { stalePartsOnQuote, priceAgeLabel, staleCutoff, DEFAULT_PRICE_STALE_MONTHS } from './priceAge'
import StyleChoices from './StyleChoices'
import { catalogOf } from './fenceCatalog'
import { newId } from './recordSync'
import type { SavedQuote } from './QuotesPage'
import { getCustomers, getCustomerById, upsertCustomer, findPossibleMatches } from './customerStore'
import AddressAutocomplete from './AddressAutocomplete'
import { getConfig } from './configStore'
import { getRailOptimizerConfig } from './configStore'
import { sourcePicker } from './optionListsStore'
import { calculateQuote, widthComparison, type QuoteCalcInput } from './quoteCalc'
import { layoutPanelFt } from './gateSlide'
import { deriveLayout, formatFtIn, postSpacing, teePostFor, type YardLayout } from './yardLayout'
import LayoutEditor, { nextEmptySide } from './LayoutEditor'
import CustomerDrawing from './CustomerDrawing'
import SiteVisitInQuote from './SiteVisitInQuote'
import CustomerPhotoTicks from './CustomerPhotoTicks'
import VoicePanel, { type VoiceHandle } from './VoicePanel'
import MediaGallery, { type ShownMedia } from './MediaGallery'
import { fetchCurrentUser, currentUser } from './crmAuth'
import { saveConfig } from './configStore'
import { tapeChecks, tapeFlags, gateChecks, marginCheck, perFootCheck, type NamedRun } from './quoteChecks'
import { getQuotes } from './quoteStore'
import { renderToStaticMarkup } from 'react-dom/server'
import SitePlan from './SitePlan'
import { compareStyles, priceOption, buildProposal, optionLabel } from './proposal'
import { resolveTiers, tierOptions, tierSetFor, type TierPrefs, type TierKey } from './tiers'
import { useTierSets } from './tierSetsApi'
import { getContractSections } from './contractStore'
import { listStylePhotos } from './stylePhotosApi'
import { useBackLayer, useLeaveWarning, BackClose, navigate } from './nav'
import PercentField from './PercentField'
import { targetMarginPct, overheadPctOf } from './configStore'
import DollarPickets, { splitDollars } from './DollarPickets'
import { businessDate } from './businessDate'
import { isQuotable } from './styleAvailability'
import { calculateQuote as calcNewFence } from './quoteCalc'
import {
  priceMove, priceRepair, moveRepairSettings, damagePctFor, postTypeOf, seesCosts, newFenceBetter, matchRisk, toSavedWork, gatesText as workGatesText,
  REPAIR_ITEMS, repairLines, type JobType, type MoveInputs, type RepairInputs, type PostType, type WorkResult,
} from './moveRepair'
import { JobTypePicker, MovePanel, RepairPanel, WorkBreakdown } from './MoveRepairPanels'
import { workOption, buildWorkProposal } from './proposal'
import { signedInRole, can } from './permissions'
import { toast } from './toast'
import { useServerQuoteView, viewCalc, viewWork, viewTiers, viewCompare, viewProposalOptions } from './quoteViewApi'
import { minimumPrice, wholeDollarRecord, adjustmentRecord, isNewMin, type QuoteJobRequest } from './quoteJob'
import { bakedBackdrop } from './aerialBake'
// A signed quote's lock: the same rules the server checks every save with.
import { isSignedQuote, lockedChanges, keepPrices, LOCKED_MESSAGE } from '../../portal/src/server/lib/quoteLock'
import { QuickChangeOrderModal, getOrdersForQuote, refreshChangeOrders, signedQuoteOf, type ChangeOrderPrefill } from './ChangeOrders'
import { changeOrderDraft } from './changeOrderDraft'
import { SignedDocumentLinks } from './SignedDocuments'
import { partWithPair } from '../../portal/src/server/lib/partNames'

/** A style in the picker; one this quote keeps but that is not offered for new quotes says so. */
/** "2026-10-19" → "Oct 19, 2026" */
const fmtYmd = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return y && m && dd ? new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : d }
const styleOptionLabel = (s: { name: string; label?: string; isActive?: boolean; quotable?: boolean; held?: string }) => (isQuotable(s) ? (s.label || s.name) : `${s.label || s.name} (Not available for new quotes)`)

// Settings are read when the builder opens (not when the app loads), so a
// change in Settings → Pricing or Fence Styles applies to the next quote
// without a page reload.

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
  initialStatus = 'DRAFT',
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
  /** A saved quote keeps its status unless another is picked (it used to start at Draft every time). */
  initialStatus?: SavedQuote['status']
}) {
  const [mode, setMode]           = useState<'search' | 'new'>('search')
  const [search, setSearch]       = useState(initialCustomerName)
  const [selectedCustomer, setSelectedCustomer] = useState<SavedCustomer | null>(() => {
    if (!initialCustomerId) return null
    return (getCustomerById(initialCustomerId) as SavedCustomer | null) ?? null
  })
  // Opened from a customer (their page, their card): the quote is theirs; no Existing / New choice unless
  // "Change customer" is tapped (review, Oct 25, 2026).
  const [knownCustomer, setKnownCustomer] = useState(() => !!initialCustomerId && !!getCustomerById(initialCustomerId))
  const [firstName, setFirstName] = useState('')
  // The new customer's id, chosen when this opens: tapped twice, it is one customer.
  const [newCustomerId] = useState(() => newId())
  const [lastName, setLastName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [address, setAddress]     = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [salesRep, setSalesRep]   = useState('')
  const [status, setStatus]       = useState<SavedQuote['status']>(initialStatus)
  const [notes, setNotes]         = useState(initialNotes)
  const [leadTemp, setLeadTemp]   = useState(0)
  // The quote's property. It is the quote's own: clearing or changing the customer never changes it.
  const [propertyAddress, setPropertyAddress] = useState(initialAddress || selectedCustomer?.serviceAddress || '')
  // Settings > Lead Sources (shown ones), and the quote's own word when it is not among them.
  const LEAD_SOURCES = sourcePicker(leadSource)

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

  // Someone on file with the phone or email typed for a new customer: offered, not assumed.
  const matches = mode === 'new' ? (findPossibleMatches({ phone, email }) as SavedCustomer[]) : []

  // A pick links the quote to that customer; their record is not changed. Their
  // address fills Property address only when the quote has none yet.
  function handleSelectCustomer(c: SavedCustomer) {
    setSelectedCustomer(c)
    setSearch(`${c.firstName} ${c.lastName}`)
    setPropertyAddress(prev => prev.trim() ? prev : (c.serviceAddress || ''))
  }

  // Save tapped twice before the window closes: saved once.
  const submitted = useRef(false)
  function handleSubmit() {
    if (submitted.current) return
    if (mode === 'search' && selectedCustomer) {
      submitted.current = true
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
      submitted.current = true
      // Always a new customer (a phone or email on file is only offered above, with Use).
      // Their address, if left empty, is this property; the quote's property, if left empty, is theirs.
      const { customer } = upsertCustomer({
        id: newCustomerId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        email,
        serviceAddress: address.trim() || propertyAddress.trim(),
        leadSource,
        salesRep,
      })
      onSave({
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        customerPhone: customer.phone,
        customerEmail: customer.email,
        customerAddress: propertyAddress.trim() || customer.serviceAddress,
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
          {knownCustomer && selectedCustomer ? (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-2" data-save-known-customer>
              <div>
                <p className="text-xs text-gray-500">Quote for</p>
                <p className="text-sm font-semibold text-gray-900">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                <p className="text-xs text-gray-500">{formatPhone(selectedCustomer.phone)}{selectedCustomer.serviceAddress ? ` · ${selectedCustomer.serviceAddress}` : ''}</p>
              </div>
              <button type="button" onClick={() => setKnownCustomer(false)} className="btn btn-quiet btn-sm shrink-0" data-save-change-customer>Change customer</button>
            </div>
          ) : <>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            <button onClick={() => setMode('search')} data-save-mode="search" className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'search' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Existing Customer
            </button>
            <button onClick={() => setMode('new')} data-save-mode="new" className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
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
                value={search} data-customer-search
                onChange={e => { setSearch(e.target.value); setSelectedCustomer(null) }}
              />
              {search && !selectedCustomer && filtered.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  {filtered.map(c => (
                    <div key={c.id} onClick={() => handleSelectCustomer(c)} data-customer-option={c.id} className="px-3 py-2.5 hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0">
                      <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                      <p className="text-xs text-gray-400">{formatPhone(c.phone)} {c.email && `· ${c.email}`}</p>
                    </div>
                  ))}
                </div>
              )}
              {selectedCustomer && (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                    <p className="text-xs text-gray-500">{formatPhone(selectedCustomer.phone)} · {selectedCustomer.serviceAddress}</p>
                  </div>
                  <button onClick={() => { setSelectedCustomer(null); setSearch('') }} data-clear-customer className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
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
                  <input autoFocus className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={firstName} onChange={e => setFirstName(e.target.value)} data-new-field="first-name" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={lastName} onChange={e => setLastName(e.target.value)} data-new-field="last-name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(352) 555-0100" value={phone} onChange={e => setPhone(e.target.value)} data-new-field="phone" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Email</label>
                  <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={email} onChange={e => setEmail(e.target.value)} data-new-field="email" />
                </div>
              </div>
              {matches.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5" data-possible-match>
                  <p className="text-xs text-amber-800">Already on file with this phone or email. Save makes a new customer unless you pick one.</p>
                  {matches.slice(0, 3).map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-800 min-w-0 truncate">{`${c.firstName} ${c.lastName}`.trim()}{c.phone ? ` · ${formatPhone(c.phone)}` : ''}</span>
                      <button type="button" onClick={() => { handleSelectCustomer(c); setMode('search') }} data-use-customer={c.id}
                        className="shrink-0 min-h-[40px] px-3 rounded-lg border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                        Use {c.firstName || 'this customer'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                    {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
          </>}

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

          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">Property address</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={propertyAddress}
              onChange={e => setPropertyAddress(e.target.value)}
              data-quote-property-address
            />
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

type StepKey = 'customer' | 'yard' | 'style' | 'price'
const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'customer', label: 'Customer' }, { key: 'yard', label: 'Yard' }, { key: 'style', label: 'Style' }, { key: 'price', label: 'Price' },
]


/** The signed in Salesman's name, for a quote of hers with no rep; blank for any other login. */
function mySalesRepName(): string {
  if (signedInRole() !== 'sales_rep') return ''
  const u = currentUser()
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.replace(/\s+/g, ' ').trim()
}

export default function QuoteBuilder({
  onClose,
  onSave,
  initialQuote,
  startOnYard = false,
  changeOrder = false,
}: {
  onClose: () => void
  onSave: (q: SavedQuote) => void
  initialQuote?: SavedQuote | null
  /** Open on the Yard step (a draft opened from Ready to quote: the customer's drawing and the site visit are there). */
  startOnYard?: boolean
  /** Opened from "Change order" > "Change the yard drawing": the bar's button makes the change order straight away. */
  changeOrder?: boolean
}) {
  const init = initialQuote

  // Styles, rates and thresholds all come from Settings. Styles turned off or
  // not available for quoting (Settings → Fence Styles) are hidden unless this
  // quote already uses one; then it stays, marked, and the quote keeps working.
  const cfg = useMemo(() => getConfig(), [])
  const FENCE_STYLES = useMemo(
    () => cfg.fenceStyles.filter(s => isQuotable(s) || s.name === init?.fenceStyle),
    [cfg, init?.fenceStyle],
  )
  // The choice picker shows every style turned on, greying the ones not available for quoting.
  const catalog = useMemo(() => catalogOf(cfg), [cfg])
  const PICKER_STYLES = useMemo(() => cfg.fenceStyles.filter(s => s.isActive !== false || s.name === init?.fenceStyle), [cfg, init?.fenceStyle])
  const pickable = useCallback((s: { name: string; isActive?: boolean; quotable?: boolean; held?: string }) => isQuotable(s) || s.name === init?.fenceStyle, [init?.fenceStyle])
  // A quote brought in from JobNimbus carries the old system's price; unless it is sold, it is priced from its parts here.
  const oldPrice = importedOldPrice(init as any)
  const keepOldPrice = oldPrice != null && init?.status === 'SOLD'
  const initPricing: QuotePricingOverrides = oldPrice != null && !keepOldPrice ? {} : (init?.pricing ?? {})

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
  // The ± dollar adjustment (whole dollars, "-30" = $30 off), after the slider; and how the proposal shows it.
  const [adjDollarsStr, setAdjDollarsStr] = useState(typeof initPricing.priceAdjustmentCents === 'number' && initPricing.priceAdjustmentCents !== 0 ? String(Math.round(initPricing.priceAdjustmentCents / 100)) : '')
  const [showDiscount, setShowDiscount] = useState(initPricing.showDiscountOnProposal === true)
  // The Final price field while it is being typed in (else it shows the price).
  const [finalTyped, setFinalTyped] = useState<string | null>(null)
  // Bumps when Inventory changes so material costs are re-read while the builder is open.
  const [invTick, setInvTick]           = useState(0)
  useEffect(() => {
    const onInv = () => setInvTick(t => t + 1)
    window.addEventListener(INVENTORY_UPDATED_EVENT, onInv)
    return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, onInv)
  }, [])
  const [showPullSheet, setShowPullSheet] = useState(true)
  // One step on screen at a time: a new quote starts with the customer, a saved one on its price.
  const [step, setStep] = useState<StepKey>(() => (startOnYard ? 'yard' : init?.id ? 'price' : 'customer'))
  // The one side of the yard shown open (Next side moves it on).
  const [openSide, setOpenSide] = useState<string | null>(null)
  const [photosOpen, setPhotosOpen] = useState(false)
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
  const { sets: tierSets } = useTierSets()
  const [photoIds, setPhotoIds] = useState<Record<string, string>>({})
  useEffect(() => {
    listStylePhotos().then(list => setPhotoIds(Object.fromEntries(list.map(p => [p.styleName, p.id])))).catch(() => {})
  }, [])
  const [showSaveModal, setShowSaveModal] = useState(false)
  // Signed (Sold or accepted): the price is locked, changes go on a change order. Sent: the price the customer saw.
  const signedQuote = !!init?.id && isSignedQuote({ status: init.status, acceptedAt: init.acceptedAt, soldAt: init.soldAt })
  const sentQuote = !!init?.id && !signedQuote && init.status === 'SENT'
  const [pending, setPending] = useState<{ quote: SavedQuote; kind: 'locked' | 'sent' } | null>(null)
  const [coPrefill, setCoPrefill] = useState<ChangeOrderPrefill | null>(null)
  useEffect(() => { if (signedQuote && init?.id) void refreshChangeOrders(init.id) }, [signedQuote, init?.id])
  // Fence moves and repairs (moveRepair.ts). A new fence is priced exactly as before.
  const [jobType, setJobType] = useState<JobType>(init?.work?.type ?? 'new')
  const [move, setMove] = useState<Omit<MoveInputs, 'oldPostType'> & { oldPostType?: PostType }>(() => init?.work?.move ?? { oldFt: 0, oldWalkGates: 0, oldDblGates: 0, newPostCaps: false })
  const [repair, setRepair] = useState<Omit<RepairInputs, 'postType'> & { postType?: PostType }>(() => init?.work?.repair ?? { what: 'other', items: {}, newPostCaps: false, gateKind: 'walk' })
  const [offerNewFence, setOfferNewFence] = useState<boolean>(!!init?.work?.newFence?.offered)
  const [offerMoveAsIs, setOfferMoveAsIs] = useState<boolean>(true)

  // Unsaved work: anything changed since the builder opened (after it settles).
  // Back, the close button and closing the tab ask before it is dropped.
  const workRef = useRef('')
  workRef.current = JSON.stringify([customerName, styleId, runs, entry, yard, corners, ends, walkGates, dblGates, tearOutSec, tearOutGates, adjLaborHrs, priceAdjust, hasSalesman,
    laborMode, subUnit, subRateStr, laborFlatStr, priceMethod, perFootStr, factorStr, finalPriceStr, adjDollarsStr, showDiscount, offer, tierPrefs, voiceNotes, jobType, move, repair, offerNewFence, offerMoveAsIs])
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
  // The card window (or quote drawer) this was opened from stays open underneath, hidden (index.css).
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('data-quote-open', '')
    return () => el.removeAttribute('data-quote-open')
  }, [])
  // Use `||` instead of `??` so an empty-string id (from callers that
  // preseed a "new quote" with id: '') also falls through to a fresh uid.
  const quoteIdRef = useRef<string>(init?.id || newId())

  const style = FENCE_STYLES.find(s => s.id === styleId)
  const cfgStyle = style
  const isAutoMix = !!cfgStyle?.autoRailMix
  const optSettings = getRailOptimizerConfig()
  // Owner, admin, manager and office see costs and price the quote here. A
  // Salesman or Installer gets prices only: the server prices it (quoteJob.ts)
  // and their phone never receives a cost (Jonathan, Oct 2026).
  const internal = seesCosts(signedInRole())
  // Whole dollar prices (Oct 21 2026): a quote sent, sold or accepted before keeps its cents exactly as the
  // customer saw or signed them; a sent one that is changed here is priced to the whole dollar like any new price.
  const [keptCents] = useState(() => !!init?.id && keepsCents(init as any))
  const keepCents = keptCents && (signedQuote || !dirty())
  // Whole dollars only: "-30", "−30" or "30".
  const adjWantedCents = (() => { const n = parseFloat(adjDollarsStr.replace(/[−–]/g, '-').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n) * 100 : 0 })()

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
    wholeDollar: keepCents ? false : undefined,
    priceAdjustmentCents: adjWantedCents || undefined,
    showDiscountOnProposal: adjWantedCents && showDiscount ? true : undefined,
  }
  // Section width decides where a gate "near the house" sits: one section in.
  // (gateSlide.ts layoutPanelFt: the crew packet and the saved quote's drawing use the same rule.)
  const widthFt = layoutPanelFt(style)
  // A tee is posted as the style's tee post (chain link, aluminum, wood: a corner; vinyl: yardLayout.ts VINYL_TEE_POST).
  const teeAs = teePostFor(style)
  const layoutResult = useMemo(() => (entry === 'layout' && yard ? deriveLayout(yard, widthFt * 12, { teeAs }) : null), [entry, yard, widthFt, teeAs])
  // What reaches the quote math: the layout's runs and posts, or the typed run list.
  const fromLayout = !!layoutResult
  const effRuns = fromLayout ? layoutResult!.runs.map(r => ({ ft: r.ft, rail: 'auto' as const })) : runs.map(r => ({ ft: parseFloat(r.ft) || 0, rail: r.rail }))
  const effCorners = fromLayout ? layoutResult!.corners : corners
  const effEnds = fromLayout ? layoutResult!.ends : ends
  const effWalk = fromLayout ? layoutResult!.walkGates : walkGates
  const effDbl = fromLayout ? layoutResult!.dblGates : dblGates
  // Vinyl tees counted as line posts (VINYL_TEE_POST): line posts beyond the runs' own.
  const effTeeLines = fromLayout ? layoutResult!.linePosts : 0
  const calcInput: QuoteCalcInput = {
    style,
    runs: effRuns,
    corners: effCorners, ends: effEnds, walkGates: effWalk, dblGates: effDbl,
    ...(effTeeLines ? { extraLinePosts: effTeeLines } : {}),
    tearOutSections: tearOutSec, tearOutGates,
    extraLaborHrs: parseFloat(adjLaborHrs) || 0,
    hasSalesman,
    priceAdjust,
    pricing: cfg.pricing,
    overrides: pricingOverrides,
    optimizer: optSettings,
  }
  // ── Move or repair inputs, and the tier set (the server needs them too) ──
  const mr = moveRepairSettings(cfg)
  const stylePostType: PostType = style ? postTypeOf(style) : 'nd'
  const moveIn: MoveInputs = { ...move, oldPostType: move.oldPostType ?? stylePostType }
  const repairIn: RepairInputs = { ...repair, postType: repair.postType ?? stylePostType }
  // Good, Better, Best: the tier set for this style's category (Settings → Good Better Best),
  // priced from the same layout, no taps needed. A quote already sent keeps the
  // tiers it was sent with unless "Use current tiers" is tapped.
  const sentTierSet = init?.id && (init.shareToken || init.status === 'SENT' || init.status === 'SOLD') ? init.proposal?.tierSet : undefined
  const [keepSentTiers, setKeepSentTiers] = useState(!!sentTierSet)
  const liveTierSet = tierSetFor(tierSets, style)
  const usingSentTiers = keepSentTiers && !!sentTierSet && !!style && sentTierSet.category.trim().toLowerCase() === String(style.category).trim().toLowerCase()
  const tierSet = usingSentTiers ? sentTierSet! : liveTierSet
  // What the server prices for a Salesman or Installer (and what their save sends).
  const priceRequest: QuoteJobRequest = {
    fenceStyle: style?.name ?? '', runs: effRuns.map(r => ({ ft: r.ft, rail: r.rail ?? 'auto' })), corners: effCorners, ends: effEnds, walkGates: effWalk, dblGates: effDbl,
    ...(effTeeLines ? { extraLinePosts: effTeeLines } : {}),
    tearOutSections: tearOutSec, tearOutGates, extraLaborHrs: parseFloat(adjLaborHrs) || 0, hasSalesman, priceAdjust,
    overrides: pricingOverrides, jobType,
    move: jobType === 'move' ? moveIn : null, repair: jobType === 'repair' ? repairIn : null,
    tierSet: tierSet ?? null, tierPrefs, compare: showCompare, offer, offerNewFence, offerMoveAsIs, photoIds, keepStyle: init?.fenceStyle ?? null,
    keepCents,
  }
  const { view: sv, pricing: svPricing, error: svError } = useServerQuoteView(!internal, priceRequest, init?.id)

  // invTick: re-read Inventory costs when Inventory changes while the builder is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const calcLocal = useMemo(() => calculateQuote(calcInput), [JSON.stringify(calcInput), invTick])
  const calc = internal ? calcLocal : viewCalc(calcLocal, sv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const compareLocal = useMemo(() => (internal ? widthComparison(calcInput, FENCE_STYLES) : null), [JSON.stringify(calcInput), invTick, internal])
  const compare = internal ? compareLocal : (sv?.width ?? null)
  const sections = calc.sections
  const materials: MaterialResult = calc.materials
  const priced = calc.priced

  const newFenceItems: LineItem[] = materials.items
  const newFenceMaterial = useMemo(() => totalMaterialCost(newFenceItems), [newFenceItems])
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
  // Overhead % this quote is priced at (kept with it, so "where every dollar goes" does not move later).
  const overheadNow = typeof initPricing.overheadPct === 'number' && init?.id ? initPricing.overheadPct : overheadPctOf(cfg)
  // ── Move or repair: priced by moveRepair.ts from the same style, Settings and kits ──
  const newLine = { runs: effRuns.map(r => r.ft), corners: effCorners, ends: effEnds, walkGates: effWalk, dblGates: effDbl }
  const workCommon = style ? { style, pricing: cfg.pricing, overrides: pricingOverrides, settings: mr, overheadPct: overheadNow, hasSalesman, priceAdjust, extraLaborHrs: parseFloat(adjLaborHrs) || 0 } : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const workLocal: WorkResult | null = useMemo(() => (!internal || !workCommon || jobType === 'new' ? null
    : jobType === 'move' ? priceMove(workCommon, moveIn, newLine) : priceRepair(workCommon, repairIn)),
  [jobType, JSON.stringify(moveIn), JSON.stringify(repairIn), JSON.stringify(newLine), JSON.stringify(calcInput), invTick, overheadNow, internal])  // eslint-disable-line react-hooks/exhaustive-deps
  const work: WorkResult | null = internal ? workLocal : viewWork(sv?.work ?? null)
  // A move to a longer line: "Move as is" (only the old length, the same shape) next to "Move plus new fence for the extra length".
  const moveAsIsLocal: WorkResult | null = useMemo(() => {
    if (!internal || !workCommon || jobType !== 'move' || !work || !(moveIn.oldFt > 0)) return null
    const total = newLine.runs.reduce((t, n) => t + (n > 0 ? n : 0), 0)
    if (!(total > moveIn.oldFt + 0.01)) return null
    const k = moveIn.oldFt / total
    return priceMove(workCommon, moveIn, { ...newLine, runs: newLine.runs.map(ft => Math.round(ft * k * 100) / 100) })
  }, [work])  // eslint-disable-line react-hooks/exhaustive-deps
  const moveAsIs: WorkResult | null = internal ? moveAsIsLocal : viewWork(sv?.moveAsIs ?? null)
  // Repair: "A new fence may be the better deal" (damaged sections over half a run, or price over 60% of a new fence there).
  const repairCheckLocal = useMemo(() => {
    if (!internal || jobType !== 'repair' || !work || !style) return null
    const runs = calc.perRunSections
    const tapped = repairIn.tapped ?? []
    const damagedRuns = tapped.length ? [...new Set(tapped.map(k => Number(k.split(':')[0])))] : runs.map((_, i) => i)
    const damagedByRun = tapped.length
      ? damagedRuns.map(r => ({ damaged: tapped.filter(k => Number(k.split(':')[0]) === r).length, sections: runs[r] ?? 0 }))
      : runs.some(n => n > 0) ? [{ damaged: (repairIn.items.repairSection ?? 0) + (repairIn.items.replaceSection ?? 0), sections: runs.reduce((t, n) => t + n, 0) }] : []
    const runsFt = effRuns.map((r, i) => (damagedRuns.includes(i) ? r.ft : 0))
    const nf = runsFt.some(f => f > 0) ? calcNewFence({ ...calcInput, runs: runsFt.map(ft => ({ ft, rail: 'auto' as const })), tearOutSections: 0, tearOutGates: 0, overrides: { ...pricingOverrides, finalPrice: undefined } }) : null
    const newFenceCents = nf ? Math.round(nf.priced.price * 100) : null
    return { ...newFenceBetter({ repairCents: work.priceCents, newFenceCents, damagedByRun }), newFenceCents, nf, runsFt }
  }, [work, JSON.stringify(calc.perRunSections)])  // eslint-disable-line react-hooks/exhaustive-deps
  const repairCheck = internal ? repairCheckLocal : sv?.repairCheck ?? null
  const matchWarning = jobType !== 'new' && style ? matchRisk(style) : null
  // A new fence under the minimum job price, when Settings say the minimum applies to new fences too.
  const newMin = !internal ? !!sv?.newMin : isNewMin(jobType, mr, priced)
  const minimum = minimumPrice(mr.minimumJobCents, pricingOverrides, Math.round((priced.totalCOGS * 100) + mr.minimumJobCents * priced.commissionPct))
  const adjustedMH  = work ? work.manHours : priced.manHours
  // Crew time from the man hours shown: a move or repair's own (the new fence math gave a repair 0.0 hr while it said 1.7 man hours).
  const crew = crewTime(adjustedMH, priced, cfg.pricing?.crewHoursPerDay)
  const laborCost   = work ? work.laborCents / 100 : priced.laborCost
  const tearOutCost = work ? work.disposalCents / 100 : priced.tearOutCost
  const totalCOGS   = work ? work.costCents / 100 : priced.totalCOGS
  const adjPrice    = work ? work.priceCents / 100 : newMin ? minimum.price : priced.price
  // Cents the price was rounded down by to the whole dollar: its own line, out of profit (commission and overhead stay on the price before it).
  const roundingCents = !internal ? 0 : work ? work.roundingCents : newMin ? minimum.roundingCents : priced.roundingCents
  const commAmt     = work ? work.commissionCents / 100 : newMin ? Math.round(mr.minimumJobCents * priced.commissionPct) / 100 : priced.commissionAmt
  const grossMargin = work ? work.grossMarginCents / 100 : newMin ? Math.round((adjPrice - totalCOGS - commAmt) * 100) / 100 : priced.grossMargin
  const gmPct       = work ? work.gmPct : newMin ? (adjPrice > 0 ? grossMargin / adjPrice : 0) : priced.gmPct
  // The ± dollar adjustment: the price without it (the proposal's list price), the amount applied, a reduction refused (under cost).
  const listPrice   = !internal ? (sv?.listPrice ?? adjPrice) : work ? work.listCents / 100 : newMin ? minimum.listPrice : priced.listPrice
  const adjApplied  = !internal ? (sv?.adjustmentCents ?? 0) : work ? work.adjustmentCents : newMin ? minimum.adjustmentCents : priced.adjustmentCents
  const adjRefused  = !internal ? !!sv?.adjustmentRefused : work ? work.adjustmentRefused : newMin ? minimum.adjustmentRefused : priced.adjustmentRefused
  // The pull sheet: a move or repair lists only the NEW material.
  const materialItems: LineItem[] = work ? work.pullSheet : newFenceItems
  const materialCost = work ? work.materialCents / 100 : newFenceMaterial
  const gmGood      = cfg.margins?.good ?? 0.34
  const gmWarn      = cfg.margins?.warning ?? 0.27
  const gmColor     = gmPct >= gmGood ? 'text-green-600' : gmPct >= gmWarn ? 'text-yellow-500' : 'text-red-500'
  const defaultSubRate = resolveSubRate(cfgStyle, cfg.pricing)
  totalsRef.current = { footage: totalFootage, sections, price: adjPrice }
  // What the quote prices at today, as it opened (before any change): a sent quote compares it with the price sent.
  const openPriceRef = useRef<number | null>(null)
  if (!dirty() && (internal || sv)) openPriceRef.current = adjPrice
  // The pricing and option choices it opened with: a signed quote compares what was changed against them.
  const openChoices = useRef<{ pricing: string; work: string; proposal: string } | null>(null)
  const choicesNow = {
    pricing: JSON.stringify(cleanOverrides(pricingOverrides)),
    work: JSON.stringify([jobType, move, repair, offerNewFence, offerMoveAsIs]),
    proposal: JSON.stringify([offer, tierPrefs, keepSentTiers, showCompare]),
  }
  if (!openChoices.current) openChoices.current = choicesNow
  const openOverrides = useRef(pricingOverrides)
  const sentPricesChanged = sentQuote && openPriceRef.current != null && Math.round(openPriceRef.current * 100) !== Math.round((init?.finalPrice ?? 0) * 100)
  const commissionPctLabel = `${Math.round((cfg.pricing.commissionSalesman ?? 0) * 1000) / 10}%`
  // Help that prevents bad quotes: plain warnings, never a block.
  const namedRuns: NamedRun[] = fromLayout
    ? layoutResult!.runs.map(r => ({ ft: r.ft, label: `${r.sideName}${r.pieces > 1 ? ` piece ${r.piece}` : ''} (${formatFtIn(r.inches)})` }))
    : effRuns.map((r, i) => ({ ft: r.ft, label: `Run ${i + 1} (${formatFtIn(r.ft * 12)})` }))
  const runWidths = effRuns.map((_, i) => (isAutoMix ? (calc.perRunRail[i] === '6ft' ? 6 : 8) : widthFt))
  const tapeRunFlags = style ? tapeFlags(namedRuns, runWidths) : []
  const pastQuotes = useMemo(() => getQuotes(), [])
  const tiersLocal = useMemo(() => (internal && tierSet && style && sections > 0
    // Every style: tiers take only those available for quoting, and say why a held one (a dig set waiting for prices) is not offered.
    ? resolveTiers(calcInput, cfg.fenceStyles, tierSet, tierPrefs)
    : []), [tierSet, style, sections, JSON.stringify(calcInput), tierPrefs, invTick, internal])  // eslint-disable-line react-hooks/exhaustive-deps
  const tiers = internal ? tiersLocal : viewTiers(sv, FENCE_STYLES)
  // Compare options: the same yard as the styles that make sense for this one.
  const compareRowsLocal = useMemo(() => (internal && showCompare && style && sections > 0
    ? compareStyles(style, FENCE_STYLES).map(s => ({ style: s, option: priceOption(calcInput, s) }))
    : []), [showCompare, style, sections, JSON.stringify(calcInput), invTick, internal])  // eslint-disable-line react-hooks/exhaustive-deps
  const compareRows = internal ? compareRowsLocal : viewCompare(sv, FENCE_STYLES) as typeof compareRowsLocal
  // Parts whose Inventory price is old or was never confirmed: a warning, never a block.
  const staleMonths = cfg.pricing.priceStaleMonths ?? DEFAULT_PRICE_STALE_MONTHS
  const staleParts = useMemo(() => (internal && style
    // Parts a job lot piece price covers are not priced from Inventory, so their Inventory date does not matter.
    ? stalePartsOnQuote(materialItems.filter(i => i.qty > 0 && i.costSource !== 'jobLot' && i.costSource !== 'wood').map(i => i.item), getInventory(), businessDate(new Date()), staleMonths, normalizeItemName)
    : []), [style, materialItems, invTick, staleMonths])  // eslint-disable-line react-hooks/exhaustive-deps
  // A color priced by the piece: whose job lot quote, from when, and whether that quote is old.
  const jobLot = style?.jobLot
  const jobLotOld = !!jobLot && !jobLot.kit && !jobLot.tall && !!jobLot.quotedOn && jobLot.quotedOn <= staleCutoff(businessDate(new Date()), staleMonths)
  const quoteWarnings = work ? [
    ...(style && jobType === 'move' ? tapeChecks(namedRuns, runWidths) : []),
    ...(fromLayout && jobType === 'move' ? gateChecks(yard) : []),
    ...work.warnings,
    ...(matchWarning ? [matchWarning] : []),
    ...(work.needs811 ? ['New posts go in the ground: an 811 locate ticket is needed before digging. It goes on the crew packet.'] : []),
    ...[internal && work.costCents > 0 && !work.minimumApplied ? marginCheck(work.gmPct, cfg.margins?.good ?? 0.34, adjPrice) : null].filter((x): x is string => !!x),
  ] : [
    ...(style ? tapeChecks(namedRuns, runWidths) : []),
    ...(fromLayout ? gateChecks(yard) : []),
    // Pricing notes only once a style is picked (before that there is nothing to price).
    ...(style ? materials.warnings : []),
    ...(style ? priced.notes : []),
    ...[internal && style && sections > 0 ? marginCheck(priced.gmPct, cfg.margins?.good ?? 0.34, priced.price) : null,
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
  const canSave = !!styleId && (internal || (!!sv && !svPricing && !svError)) && (jobType === 'new' ? sections > 0
    : jobType === 'move' ? moveIn.oldFt > 0 && !!work && work.sections > 0
    : REPAIR_ITEMS.some(k => (repairIn.items[k] ?? 0) > 0))

  // A yard shape just picked opens on its first side.
  useEffect(() => {
    if (yard && step === 'yard' && !openSide) setOpenSide(nextEmptySide(yard, null)?.id ?? null)
  }, [yard?.shape])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Steps and the bottom bar ──
  const sidesOn = yard ? yard.sides.filter(s => s.on).length : 0
  const sidesDone = yard ? yard.sides.filter(s => s.on && s.lengthIn > 0).length : 0
  const nextSide = entry === 'layout' && yard ? nextEmptySide(yard, openSide) : null
  function goStep(k: StepKey) {
    setStep(k)
    // The Yard step opens on the first side still to fill in.
    if (k === 'yard' && entry === 'layout' && yard && !openSide) setOpenSide(nextEmptySide(yard, null)?.id ?? null)
    document.querySelector('[data-quote-builder]')?.scrollTo({ top: 0 })
    document.querySelector('[data-quote-scroll]')?.scrollTo({ top: 0 })
  }
  const stepIndex = STEPS.findIndex(x => x.key === step)
  function barBack() { if (stepIndex > 0) goStep(STEPS[stepIndex - 1].key) }
  const barNextLabel = step === 'customer' ? 'Next: Yard' : step === 'yard' ? (nextSide ? 'Next side' : 'Next: Style') : 'Next: Price'
  function barNext() {
    if (step === 'customer') return goStep('yard')
    if (step === 'yard') {
      // This side is already saved as it was typed; on to the next empty one, or the style.
      if (nextSide) { setOpenSide(nextSide.id); return }
      return goStep('style')
    }
    goStep('price')
  }

  // The 6 ft / 8 ft picker's per run choice. On auto mix styles it drives the
  // pull sheet; on locked 6 ft tall vinyl it is shown for information.
  const showOptimizer = optSettings.enabled && optSettings.showDetailsInBuilder && !!calc.optimizer
  const optimizerResult = calc.optimizer

  async function handleSave(data: {
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
    // The aerial photo, turned as saved, under the plan on the proposal (when it is on).
    const photo = fromLayout && yard ? await bakedBackdrop(yard) : null
    const company = { name: cfg.company?.name || 'Getter Done Fence', phone: cfg.company?.phone || '', email: cfg.company?.email || '' }
    const warranty = getContractSections().find(x => x.key === 'warranty' && x.visible !== false)?.body ?? ''
    // A move or repair keeps what was entered and every cost line it was priced with (internal).
    const savedWork = work ? toSavedWork(work, jobType === 'move' ? { move: moveIn } : { repair: repairIn }, {
      newFence: repairCheck?.show && repairCheck.newFenceCents ? { cents: repairCheck.newFenceCents, offered: offerNewFence } : null,
      photoOverride: init?.work?.photoOverride ?? null,
    }) : undefined
    const runSecs = calc.perRunSections.filter((_, i) => effRuns[i].ft > 0)
    const workPlan = fromLayout && yard ? renderToStaticMarkup(<SitePlan layout={yard} result={layoutResult!} runSections={calc.perRunSections} widthFt={widthFt} aerial={photo}
      oldLine={jobType === 'move' && moveIn.oldLinePlan ? { ...moveIn.oldLinePlan, ft: moveIn.oldFt, label: `Old line ${Math.round(moveIn.oldFt)} ft` } : null}
      damaged={jobType === 'repair' ? repairIn.tapped : undefined} />) : undefined
    const workProposal = work && style && savedWork ? (() => {
      const options = []
      if (!internal) options.push(...viewProposalOptions(sv))
      else if (jobType === 'move') {
        if (moveAsIs && offerMoveAsIs) {
          options.push(workOption(`Move as is: ${Math.round(moveIn.oldFt)} ft of your fence on the new line`, style.name, moveAsIs, toSavedWork(moveAsIs, { move: moveIn }), runSecs))
          options.push({ ...workOption('Move plus new fence for the extra length', style.name, work, savedWork, runSecs), finalPrice: adjPrice, adjustmentCents: adjApplied || undefined })
        } else options.push({ ...workOption('Move your fence to the new line', style.name, work, savedWork, runSecs), finalPrice: adjPrice, adjustmentCents: adjApplied || undefined })
      } else {
        options.push({ ...workOption('Repair', style.name, work, savedWork, runSecs), finalPrice: adjPrice, adjustmentCents: adjApplied || undefined })
        if (offerNewFence && repairCheck?.nf) {
          const o = priceOption({ ...calcInput, runs: repairCheck.runsFt.map(ft => ({ ft, rail: 'auto' as const })), tearOutSections: 0, tearOutGates: 0 }, style)
          options.push({ ...o, label: `New fence instead: ${o.label}`, snapshot: { ...o.snapshot, work: null } })
        }
      }
      return buildWorkProposal({
        kind: jobType as 'move' | 'repair', description: work.description, options, company,
        customer: { name: data.customerName, address: data.customerAddress }, planSvg: workPlan, warranty, settings: cfg.proposal ?? {},
        footageFt: jobType === 'move' ? work.footage : 0,
        gatesText: jobType === 'move' ? workGatesText(effWalk, effDbl) : '', photoIds, wholeDollar: !keepCents, showDiscount: showDiscount && adjApplied < 0,
      })
    })() : undefined
    const quote: SavedQuote = {
      id: quoteIdRef.current,
      customerId: data.customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      customerAddress: data.customerAddress,
      leadSource: data.leadSource,
      // A Salesman's quote with no rep is hers (the server does the same: lib/salesRep.ts).
      salesRep: data.salesRep || mySalesRepName(),
      fenceStyle: style?.name ?? '',
      runs: effRuns.map(r => r.ft).filter(f => f > 0),
      // Persist per-run rail decisions for auto-mix quotes so reload reproduces
      // the exact pull sheet (and so user overrides survive).
      runRails: isAutoMix
        ? effRuns.filter(r => r.ft > 0).map(r => r.rail ?? 'auto')
        : undefined,
      // The yard as drawn, and each run's sections, so the quote redraws and
      // the crew sees post spacing exactly as priced.
      layout: { yard: fromLayout ? yard : null, runSections: calc.perRunSections.filter((_, i) => effRuns[i].ft > 0), ...(effTeeLines ? { teeLinePosts: effTeeLines } : {}) },
      corners: effCorners,
      ends: effEnds,
      walkGates: effWalk,
      dblGates: effDbl,
      tearOutSections: tearOutSec,
      tearOutGates,
      adjLaborHrs: parseFloat(adjLaborHrs) || 0,
      hasSalesman,
      priceAdjust,
      sections: work ? work.sections : sections,
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
      pricing: cleanOverrides({ ...pricingOverrides, ...(work ? { costFactor: work.costFactor } : priced.priceMethod === 'cost_factor' ? { costFactor: priced.costFactor } : {}), overheadPct: overheadNow, ...wholeDollarRecord(pricingOverrides, roundingCents), ...adjustmentRecord(pricingOverrides, adjApplied) }),
      work: savedWork,
      // A Salesman's or Installer's save: the server works out the costs from these inputs.
      ...(internal ? {} : { priceRequest }),
      proposal: workProposal ?? (style ? buildProposal({
        input: calcInput,
        // A Salesman or Installer: every option comes priced from the server.
        styles: internal ? [style, ...FENCE_STYLES.filter(s => offer.includes(s.name) && s.name !== style.name)] : [],
        ownPrice: adjPrice,
        ownRoundingCents: roundingCents,
        ownAdjustmentCents: adjApplied,
        showDiscount: showDiscount && adjApplied < 0,
        wholeDollar: !keepCents,
        company: { name: cfg.company?.name || 'Getter Done Fence', phone: cfg.company?.phone || '', email: cfg.company?.email || '' },
        customer: { name: data.customerName, address: data.customerAddress },
        planSvg: fromLayout && yard ? renderToStaticMarkup(<SitePlan layout={yard} result={layoutResult!} runSections={calc.perRunSections} widthFt={widthFt} aerial={photo} />) : undefined,
        warranty: getContractSections().find(x => x.key === 'warranty' && x.visible !== false)?.body ?? '',
        settings: cfg.proposal ?? {},
        photoIds,
        tiers: internal ? tierOptions(tiers, photoIds) : viewProposalOptions(sv),
        tierPrefs: { off: tierPrefs.off, swap: tierPrefs.swap as Record<string, string> },
        tierSet: tierSet ?? undefined,
      }) : undefined),
    }
    setShowSaveModal(false)
    if (init?.id && signedQuote) {
      // Only what was changed counts (today's costs moving the figures does not): the work, the choices.
      const changed = lockedChanges(init, {
        fenceStyle: quote.fenceStyle, runs: quote.runs, runRails: quote.runRails, corners: quote.corners, ends: quote.ends,
        walkGates: quote.walkGates, dblGates: quote.dblGates, tearOutSections: quote.tearOutSections, tearOutGates: quote.tearOutGates,
        adjLaborHrs: quote.adjLaborHrs, hasSalesman: quote.hasSalesman, priceAdjust: quote.priceAdjust, layout: quote.layout,
      })
      for (const k of ['pricing', 'work', 'proposal'] as const) if (choicesNow[k] !== openChoices.current![k]) changed.push(k)
      // "Make change order" (the bar on a signed quote): straight to the change order, filled in; no status, no detour.
      const direct = directCo.current
      directCo.current = false
      if (changed.filter(k => k !== 'status').length) { setPending({ quote, kind: 'locked' }); if (direct) startChangeOrder(quote); return }
      if (direct) { toast.info('Nothing changed yet', 'Change the drawing first (footage, gates, style or height), then tap Make change order. Or type the change from the job\'s Change order button.'); return }
      // The quote as signed is what is saved (the builder may show the work as changed by approved change orders).
      onSave(keepPrices(signedQuoteOf(init), { ...quote, date: init.date }))
      return
    }
    if (init?.id && sentPricesChanged) { setPending({ quote, kind: 'sent' }); return }
    onSave(quote)
  }

  /**
   * "Make change order" on a signed quote: the quote as it is now, as the save
   * would make it, straight into the change order (round 2, Oct 26 2026: it went
   * through "Update quote", the status picker and the lock message first).
   */
  const directCo = useRef(false)
  function makeChangeOrderNow() {
    if (!init?.id || !canSave) return
    directCo.current = true
    void handleSave({
      customerId: init.customerId ?? '', customerName: init.customerName, customerPhone: init.customerPhone, customerEmail: init.customerEmail,
      customerAddress: init.customerAddress, leadSource: init.leadSource, salesRep: init.salesRep, status: init.status, notes: init.notes ?? '', leadTemp: init.leadTemp ?? 0,
    })
  }

  /**
   * "Make change order" on the length pad: the length is kept first, so the
   * change order is made on the next draw, once the drawing (and, for a
   * prices only login, the server's price of it) has caught up. No Done first.
   */
  const [makeQueued, setMakeQueued] = useState(0)
  const queuedPriced = useRef(false)
  useEffect(() => {
    if (!makeQueued) return
    if (!internal) {
      // A prices only login: wait for the server to price the new drawing.
      if (svPricing) { queuedPriced.current = true; return }
      if (!queuedPriced.current) { const t = setTimeout(() => { queuedPriced.current = true; setMakeQueued(n => n + 1) }, 1500); return () => clearTimeout(t) }
    }
    queuedPriced.current = false
    setMakeQueued(0)
    makeChangeOrderNow()
  }, [makeQueued, svPricing])  // eslint-disable-line react-hooks/exhaustive-deps
  const [typeInstead, setTypeInstead] = useState(false)

  /** The change order, filled in from what was changed here, priced at today's costs. */
  function startChangeOrder(changedQuote?: SavedQuote) {
    const q = changedQuote ?? pending?.quote
    if (!init || !q) return
    const draft = changeOrderDraft({
      signed: init, current: calcInput, signedOverrides: openOverrides.current, styles: FENCE_STYLES,
      priceNow: adjPrice, sectionsNow: work ? work.sections : sections, simple: !internal || jobType !== 'new',
    })
    // A new fence: the new work goes with it (the server prices it and keeps it, so the pull sheet, packet,
    // site plan, crew days and job costing follow once it is approved).
    setCoPrefill(jobType === 'new' && style ? { ...draft, work: { request: priceRequest as unknown as Record<string, unknown>, layout: q.layout ?? null, planSvg: q.proposal?.planSvg ?? null } } : draft)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start md:items-center justify-center overflow-y-auto md:overflow-hidden md:p-4" data-quote-builder>
      {/* On a computer or tablet: a window about 92% of the screen tall. Its content scrolls inside it; the bar is its footer. */}
      <div className="bg-white md:rounded-2xl shadow-2xl w-full max-w-6xl min-h-full md:min-h-0 pb-24 md:pb-0 md:h-[92vh] md:flex md:flex-col md:overflow-hidden md:border md:border-gray-300" data-quote-window>

        <div className="flex items-center justify-between gap-3 px-4 md:px-8 py-3 md:py-4 border-b border-gray-200 sticky top-0 md:static md:shrink-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{init?.id ? 'Edit quote' : 'New quote'}</h2>
            <p className="text-sm text-gray-500 mt-0.5 hidden md:block">Quote builder</p>
            {signedQuote && <p className="text-xs font-semibold text-amber-800 mt-0.5" data-quote-locked-banner>{changeOrder ? 'Change order: change the drawing, then tap Make change order.' : 'Signed: the price is locked. Changes to the fence go on a change order.'}</p>}
            {signedQuote && changeOrder && init?.id && <button type="button" onClick={() => setTypeInstead(true)} className="text-sm text-orange-700 font-semibold underline min-h-[44px]" data-co-type-instead>Type the change instead</button>}
            {signedQuote && init?.id && <SignedDocumentLinks quoteId={init.id} />}
            {sentQuote && sentPricesChanged && <p className="text-xs font-semibold text-amber-800 mt-0.5" data-quote-sent-changed-banner>Prices changed since this was sent ({fmt(init!.finalPrice)} then, {fmt(adjPrice)} now).</p>}
          </div>
          <div className="flex items-center gap-3">
            {materialItems.length > 0 && (
              <button onClick={() => { if (step !== 'price') { setShowPullSheet(true); goStep('price') } else setShowPullSheet(p => !p) }} className="text-sm text-orange-500 border border-orange-300 rounded-lg px-3 py-1.5 hover:bg-orange-50">
                <span className="hidden sm:inline">{showPullSheet && step === 'price' ? 'Hide Pull Sheet' : 'Show Pull Sheet'} ({materialItems.length} items)</span>
                <span className="sm:hidden">Pull sheet ({materialItems.length})</span>
              </button>
            )}
            <button onClick={() => { if (okToLeave()) onClose() }} aria-label="Close" className="text-gray-500 hover:text-gray-800 text-3xl leading-none w-12 h-12 grid place-items-center" data-quote-close>×</button>
          </div>
        </div>

        <div className="flex gap-1 px-2 md:px-6 pt-2 pb-0 border-b border-gray-200 bg-white md:shrink-0" role="tablist" data-steps>
          {STEPS.map((st, n) => (
            <button key={st.key} type="button" role="tab" aria-selected={step === st.key} onClick={() => goStep(st.key)} data-step={st.key}
              className={`flex-1 min-h-[48px] px-1 text-sm font-semibold border-b-[3px] -mb-px ${step === st.key ? 'border-orange-500 text-gray-900' : 'border-transparent text-gray-500'}`}>
              <span className="text-xs font-normal mr-1 hidden sm:inline">{n + 1}.</span>{st.label}
            </button>
          ))}
        </div>

        {/* One step at a time; the others stay mounted (hidden) so nothing typed is lost. */}
        <div className="md:flex-1 md:min-h-0 md:overflow-y-auto" data-quote-scroll>
        <div className={`px-4 md:px-8 py-5 md:py-6 pb-44 md:pb-8 mx-auto w-full ${step === 'yard' && entry === 'layout' && yard ? 'max-w-3xl lg:max-w-none' : 'max-w-3xl'}`}>
          <div className={step === 'customer' ? 'space-y-6' : 'hidden'} data-step-panel="customer">
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

          </div>

          <div className={step === 'yard' ? 'space-y-6' : 'hidden'} data-step-panel="yard">
            {jobType !== 'new' && (
              <p className="text-sm text-gray-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2" data-yard-job-hint>
                {jobType === 'move' ? 'Fence move: draw the NEW fence line here. The old line is entered at the Style step.' : 'Repair: drawing the existing fence is optional. With it you can tap the damaged sections and see a new fence price beside the repair.'}
              </p>
            )}
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
                  openSideId={openSide}
                  onOpenSide={setOpenSide}
                  locked={signedQuote}
                  teeAs={teeAs}
                  padAction={signedQuote && changeOrder ? { label: 'Make change order', onTap: () => setMakeQueued(n => n + 1) } : undefined}
                  address={init?.customerAddress || (init?.customerId ? getCustomerById(init.customerId)?.serviceAddress : '') || ''}
                />
              )}
            </div>
            {init?.layout?.widgetDrawing && <CustomerDrawing record={init.layout.widgetDrawing} />}
            {/* The site visit's footage, notes and photos (SiteVisitInQuote.tsx): a repair or a move too (its photos go on the proposal once ticked). */}
            <SiteVisitInQuote customerId={init?.customerId} />

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

          </div>

          <div className={step === 'style' ? 'space-y-6' : 'hidden'} data-step-panel="style">
            <JobTypePicker value={jobType} onChange={setJobType} />
            <div>
              <h3 className="text-xs font-semibold text-gray-500 mb-3">{jobType === 'new' ? 'Fence' : 'The fence (its style)'}</h3>
              <StyleChoices styles={PICKER_STYLES} catalog={catalog} value={styleId} onChange={setStyleId} isOk={pickable} />
              <p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Or pick from the list</p>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={styleId}
                onChange={e => setStyleId(e.target.value)}
                data-style-list
              >
                <option value="">Select a fence style...</option>
                {/* Auto-mix styles surface first — optimizer picks 6'/8' per run */}
                {(() => {
                  const autoStyles = FENCE_STYLES.filter(s => (s as any).autoRailMix)
                  return autoStyles.length > 0 ? (
                    <optgroup label="Vinyl Privacy — Auto-mix (recommended)">
                      {autoStyles.map(s => (
                        <option key={s.id} value={s.id}>{styleOptionLabel(s)}</option>
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
                        <option key={s.id} value={s.id}>{styleOptionLabel(s)}</option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
              {style && !isQuotable(style) && (
                <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-style-not-quotable>
                  {style.label || style.name} is not available for new quotes ({style.isActive === false ? 'turned off' : style.held ? style.held : 'pricing on hold'} in Settings → Fence Styles). This quote keeps it and still prices.
                </p>
              )}
            </div>

            {jobType === 'move' && (
              <MovePanel style={style} move={moveIn} setMove={fn => setMove(m => fn({ ...m, oldPostType: m.oldPostType ?? stylePostType }))}
                defaultPostType={stylePostType} defaultDamagePct={style ? damagePctFor(mr, style.name) : mr.damagePctDefault}
                newLine={{ walkGates: effWalk, dblGates: effDbl, footage: totalFootage, sections: work?.sections ?? 0 }}
                yard={fromLayout ? yard : null} layoutResult={layoutResult} runSections={calc.perRunSections} widthFt={widthFt} />
            )}
            {jobType === 'repair' && (
              <RepairPanel style={style} repair={repairIn} setRepair={fn => setRepair(r => fn({ ...r, postType: r.postType ?? stylePostType }))}
                yard={fromLayout ? yard : null} layoutResult={layoutResult} runSections={calc.perRunSections} widthFt={widthFt} />
            )}

            <div className={jobType === 'new' ? '' : 'hidden'}>
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

            {!internal && (
              <div data-labor-prices-only>
                <h3 className="text-xs font-semibold text-gray-500 mb-3">Labor</h3>
                <label className="text-xs text-gray-400 mb-1 block">Extra hours</label>
                <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="0" value={adjLaborHrs} onChange={e => setAdjLaborHrs(e.target.value)} />
              </div>
            )}
            <div className={internal ? '' : 'hidden'}>
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
                {internal && <p className="text-xs text-gray-400">
                  {commissionPctLabel} commission, {priced.commissionMode === 'added' ? 'added on top of the price' : 'taken out of the price'}
                </p>}
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

          <div className={step === 'price' ? 'space-y-3' : 'hidden'} data-step-panel="price">
              <div className="bg-gray-900 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">{priced.priceMethod === 'manual' ? 'Price (set by hand)' : 'Adjusted Price'}</p>
                <p className="text-white text-3xl font-bold" data-quote-price>{fmt(adjPrice)}</p>
                {!internal && svPricing && <p className="text-gray-300 text-xs mt-1" data-price-pending>Pricing…</p>}
                {!internal && svError && !svPricing && <p className="text-amber-300 text-xs mt-1" data-price-error>{svError}</p>}
                {priced.priceMethod === 'manual' && (
                  <button type="button" className="mt-2 text-xs font-semibold text-amber-300 underline min-h-[44px]" onClick={() => setFinalPriceStr('')} data-price-from-cost>
                    This price was set by hand, so the parts do not change it. Price it from cost instead
                  </button>
                )}
                {oldPrice != null && !keepOldPrice && priced.priceMethod !== 'manual' && (
                  <p className="text-gray-300 text-xs mt-2" data-old-price>
                    Old system price (imported): {fmt(oldPrice)}.{' '}
                    <button type="button" className="underline font-semibold min-h-[44px]" onClick={() => setFinalPriceStr(String(oldPrice))} data-use-old-price>Use the old price</button>
                  </p>
                )}
                {work && <p className="text-gray-300 text-xs mt-1" data-work-kind>{jobType === 'move' ? 'Fence move' : 'Repair'}: {work.description}</p>}
                {work?.minimumApplied && internal && <p className="text-blue-200 text-xs mt-1 font-semibold" data-price-minimum>Minimum job price applied (internal)</p>}
                {newMin && internal && <p className="text-blue-200 text-xs mt-1 font-semibold" data-price-minimum>Minimum job price applied (internal)</p>}
                {!work && totalFootage > 0 && <p className="text-gray-400 text-xs mt-1">{fmt(priced.pricePerFoot)} per foot</p>}
                {commAmt > 0 && <p className="text-gray-400 text-xs mt-1">Commission: {fmt(commAmt)}</p>}
                {compare && !work && (
                  <p className="text-gray-300 text-xs mt-2 pt-2 border-t border-gray-700" data-width-compare>
                    Same job at 6 ft wide: {fmt(compare.at6)}  |  at 8 ft wide: {fmt(compare.at8)}
                  </p>
                )}
              </div>

              {jobType === 'move' && moveAsIs && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2" data-move-options>
                  <p className="text-xs font-semibold text-gray-500">On the proposal</p>
                  <label className="flex items-start gap-3 min-h-[48px]">
                    <input type="checkbox" className="mt-1 w-5 h-5 accent-orange-500" checked={offerMoveAsIs} onChange={e => setOfferMoveAsIs(e.target.checked)} data-offer-move-as-is />
                    <span className="flex-1 text-sm">Also offer "Move as is" (only the old {Math.round(moveIn.oldFt)} ft, on the same shape): <b className="tabular-nums">{fmt(moveAsIs.priceCents / 100)}</b>, next to "Move plus new fence for the extra length": <b className="tabular-nums">{fmt(adjPrice)}</b></span>
                  </label>
                </div>
              )}

              {jobType === 'repair' && repairCheck?.show && (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 space-y-2" data-new-fence-better>
                  <p className="text-sm font-bold text-amber-900">A new fence may be the better deal</p>
                  <p className="text-xs text-amber-900">
                    {repairCheck.over50 ? 'More than half of a run is damaged. ' : ''}
                    {repairCheck.over60 ? 'This repair is more than 60% of a new fence there. ' : ''}
                    {repairCheck.newFenceCents !== null ? <>New fence for {repairCheck.runsFt.filter(f => f > 0).length === effRuns.filter(r => r.ft > 0).length ? 'the whole fence' : 'the damaged run'}: <b className="tabular-nums" data-new-fence-price>{fmt(repairCheck.newFenceCents / 100)}</b> (repair: {fmt(adjPrice)}).</> : 'Draw the fence in the Yard step to see a new fence price beside it.'}
                  </p>
                  {repairCheck.nf && (
                    <button type="button" className={`btn ${offerNewFence ? 'btn-secondary' : 'btn-primary'} w-full`} onClick={() => setOfferNewFence(v => !v)} data-offer-new-fence>
                      {offerNewFence ? 'New fence is offered as an option (tap to remove)' : 'Add the new fence as an option'}
                    </button>
                  )}
                </div>
              )}

              {jobType === 'new' && style && sections > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2" data-tiers>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-500" data-tiers-title>{tierSet?.tiers.length === 2 ? 'Two options' : 'Good, Better, Best'} <span className="font-normal">· on the proposal</span></p>
                    {can('settings.change') && <button type="button" className="btn btn-quiet btn-sm shrink-0" data-edit-tiers
                      onClick={() => { if (okToLeave()) navigate('/settings?tab=tiers') }}>Edit tiers</button>}
                  </div>
                  {usingSentTiers && (
                    <p className="text-xs text-gray-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5" data-tiers-as-sent>
                      Tiers as they were when this proposal was sent.{' '}
                      <button type="button" className="underline font-semibold min-h-[44px]" onClick={() => setKeepSentTiers(false)} data-tiers-use-current>Use the current tiers</button>
                    </p>
                  )}
                  {!tierSet && tierSets === null && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5" data-tiers-not-loaded>Good, Better, Best have not loaded yet (weak signal). They are tried again every few seconds; a proposal saved now would not show them.</p>}
                  {!tierSet && tierSets !== null && <p className="text-sm text-gray-600" data-tiers-none>No Good, Better, Best set for {style.category} yet. {can('settings.change') ? 'Tap Edit tiers to add one.' : 'Ask Jonathan to add one.'}</p>}
                  {tierSet && tierSet.tiers.length === 0 && <p className="text-sm text-gray-600" data-tiers-none>No tiers for {tierSet.category} yet. {can('settings.change') ? 'Tap Edit tiers to add them.' : 'Ask Jonathan to add them.'}</p>}
                  {tiers.map(t => {
                    if (!t.style || !t.option) return (
                      <div key={t.spec.key} className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3" data-tier={t.spec.key}>
                        <p className="font-bold text-gray-900">{t.spec.name}</p>
                        <p className="text-xs text-amber-900 mt-1" data-tier-reason>Not offered on this quote: {t.reason}</p>
                        <select className="mt-2 w-full border border-gray-300 rounded-lg px-2 h-9 text-xs bg-white" value="" aria-label={`Style for ${t.spec.name}`}
                          onChange={e => { const v = e.target.value; if (v) setTierPrefs(p => ({ ...p, swap: { ...p.swap, [t.spec.key]: v } })) }} data-tier-swap>
                          <option value="">Pick a style for this quote…</option>
                          {FENCE_STYLES.filter(s => isQuotable(s) && !s.autoRailMix).map(s => <option key={s.id} value={s.name}>{s.label || s.name}</option>)}
                        </select>
                      </div>
                    )
                    const main = t.style.name === style?.name
                    const price = main ? adjPrice : t.option.finalPrice
                    return (
                      <div key={t.spec.key} className={`rounded-lg border p-3 ${main ? 'border-orange-500 bg-orange-50' : 'border-gray-200'} ${t.off ? 'opacity-60' : ''}`} data-tier={t.spec.key}>
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-center gap-2 min-w-0">
                            <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={!t.off} aria-label={`Offer ${t.spec.name}`}
                              onChange={e => setTierPrefs(p => ({ ...p, off: e.target.checked ? p.off.filter(k => k !== t.spec.key) : [...p.off, t.spec.key] }))} />
                            <span className="font-bold text-gray-900" data-tier-name>{t.spec.name}</span>
                            {t.popular && <span className="text-[11px] font-semibold bg-orange-500 text-white rounded-full px-2 py-0.5">Most popular</span>}
                          </label>
                          <span className="text-right">
                            <span className="block font-bold tabular-nums" data-tier-price>{fmt(price)}</span>
                            <span className="block text-xs text-gray-600 tabular-nums">{fmt(t.option.perFoot)}/ft</span>
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 mt-1" data-tier-style>{optionLabel(t.style.name)}</p>
                        {t.spec.text && <p className="text-xs text-gray-600 mt-0.5" data-tier-text>{t.spec.text}</p>}
                        {t.widthFt && <p className="text-xs text-gray-600" data-tier-width>{t.widthFt} ft wide prices lower for this yard{t.otherWidth ? ` (${t.otherWidth.widthFt} ft wide: ${fmt(t.otherWidth.price)})` : ''}.</p>}
                        {t.sameAs && <p className="text-xs text-amber-800" data-tier-same>Same fence as {t.sameAs} for this yard.</p>}
                        <div className="flex gap-2 mt-2">
                          <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={main}
                            onClick={() => { const s = FENCE_STYLES.find(x => x.name === t.style!.name); if (s) setStyleId(s.id) }} data-tier-main>{main ? 'Main option' : 'Make main'}</button>
                          <select className="min-w-0 flex-1 border border-gray-300 rounded-lg px-2 h-9 text-xs bg-white" value={tierPrefs.swap[t.spec.key] ?? ''} aria-label={`Style for ${t.spec.name}`}
                            onChange={e => setTierPrefs(p => { const swap = { ...p.swap }; if (e.target.value) swap[t.spec.key] = e.target.value; else delete swap[t.spec.key]; return { ...p, swap } })} data-tier-swap>
                            <option value="">Style: automatic</option>
                            {FENCE_STYLES.filter(s => isQuotable(s) && !s.autoRailMix).map(s => <option key={s.id} value={s.name}>{s.label || s.name}</option>)}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {work && internal && <WorkBreakdown work={work} />}
              {internal && <DollarPickets price={adjPrice} materials={materialCost} labor={laborCost + tearOutCost} commission={commAmt} overheadPct={overheadNow} roundingCents={roundingCents} adjustmentCents={adjApplied} />}

              {quoteWarnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-amber-800">Check before you quote</p>
                  {quoteWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-800 leading-snug">{w}</p>
                  ))}
                </div>
              )}

              {jobLot && (
                <div className={`rounded-xl p-3 space-y-1 border ${jobLotOld ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`} data-job-lot-note>
                  {jobLot.tall ? (<>
                    <p className="text-xs font-semibold text-gray-800">8 ft tall is priced by the piece</p>
                    <p className="text-xs text-gray-600 leading-snug">One price per section and one per post (Settings → Price List); the parts they cover show at $0 on the pull sheet. Gates are priced from their parts. Internal only.</p>
                  </>) : jobLot.kit ? (<>
                    <p className="text-xs font-semibold text-gray-800">{jobLot.color} sections are sold as a kit</p>
                    <p className="text-xs text-gray-600 leading-snug">Each section line carries the kit's cost (a gate leaf takes one); the parts in the kit show at $0 on the pull sheet. Internal only.</p>
                  </>) : (<>
                    <p className="text-xs font-semibold text-gray-800">Job lot pricing from {jobLot.supplier}, quoted {fmtYmd(jobLot.quotedOn)}</p>
                    <p className="text-xs text-gray-600 leading-snug">{jobLot.color} sections, posts and gates are priced from that quote; the parts they include show at $0 on the pull sheet. Internal only.</p>
                  </>)}
                  {jobLotOld && <p className="text-xs text-amber-800 leading-snug" data-job-lot-old>That job lot quote is older than {staleMonths} months. Ask {jobLot.supplier} for a new one and update it in Settings → Fence styles.</p>}
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

              <div className={`bg-white rounded-xl border border-gray-200 p-4 ${!internal ? 'hidden' : ''}`}>
                {roundingCents > 0 && (
                  <div className="flex justify-between items-center text-sm mb-2 pb-2 border-b border-gray-100" data-quote-rounding>
                    <span className="text-gray-600">Rounded to the whole dollar <span className="text-xs text-gray-400">(out of profit)</span></span>
                    <span className="font-semibold text-red-600 tabular-nums" data-quote-rounding-amount>−{fmt(roundingCents / 100)}</span>
                  </div>
                )}
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

              <h3 className="text-xs font-semibold text-gray-500">Live quote</h3>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                {/* A repair: its items, not "Total sections 0 · Total footage 0 ft" (round 2 review, Oct 26 2026). A move: its new line. */}
                {jobType === 'repair' && work ? (
                  <div className="mb-1" data-live-repair>
                    <span className="text-xs text-gray-500">Repair work</span>
                    <ul className="text-sm font-semibold text-gray-900">
                      {(repairLines({ type: 'repair', repair: repairIn }) ?? ['Nothing picked yet']).map(l => <li key={l}>{l}</li>)}
                    </ul>
                  </div>
                ) : (<>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500">Total sections</span>
                  <span className="text-xl font-bold text-gray-900">{work ? work.sections : sections}</span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500">Total footage</span>
                  <span className="text-sm font-semibold text-gray-700">
                    {totalFootage} ft
                  </span>
                </div>
                </>)}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Projected man hours</span>
                  <span className="text-xl font-bold text-gray-900">{adjustedMH.toFixed(1)}</span>
                </div>
                {adjustedMH > 0 && (
                  <div className="flex justify-between items-center mt-1" data-crew-time>
                    <span className="text-xs text-gray-500">Crew time ({crew.size} men)</span>
                    <span className="text-sm font-semibold text-gray-700">
                      {crew.hours.toFixed(1)} hr · {crew.days.toFixed(1)} {crew.days.toFixed(1) === '1.0' ? 'day' : 'days'}
                    </span>
                  </div>
                )}
              </div>

              <div className={`bg-white rounded-xl border border-gray-200 p-4 space-y-2 ${work || !internal ? 'hidden' : ''}`}>
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

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className={`flex items-center justify-between ${work || !internal ? 'hidden' : ''}`}>
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
                {!internal ? null : priceMethod === 'cost_factor' || work ? (
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

              {/* ± dollars after the slider (Jonathan, Oct 22 2026): out of profit, never overhead or commission; frozen with the quote. */}
              {adjPrice > 0 && (signedQuote ? (adjApplied !== 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm" data-price-adjustment-locked>
                  <p className="text-gray-700">Signed with a {adjApplied < 0 ? 'discount' : 'price adjustment'} of <b className="tabular-nums">{adjApplied < 0 ? '−' : '+'}{fmt(Math.abs(adjApplied) / 100)}</b> (list {fmt(listPrice)}).</p>
                </div>
              )) : (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-price-adjustment>
                  <p className="text-xs text-gray-500">Dollar adjustment <span className="text-gray-400">(after the slider, whole dollars)</span></p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs text-gray-400 mb-1 block">Final price ($)</span>
                      <input type="text" inputMode="numeric" autoComplete="off" data-adjust-final
                        className="w-full border border-gray-300 rounded-lg px-3 h-11 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400"
                        value={finalTyped ?? String(Math.round(adjPrice))}
                        onFocus={e => { setFinalTyped(String(Math.round(adjPrice))); e.currentTarget.select() }}
                        onBlur={() => setFinalTyped(null)}
                        onChange={e => {
                          const v = e.target.value
                          setFinalTyped(v)
                          const n = parseFloat(v.replace(/[$,\s]/g, ''))
                          if (!Number.isFinite(n) || !(n > 0)) return
                          // The adjustment is what takes the list price to the price typed (whole dollars).
                          const d = Math.round(n) - Math.round(listPrice)
                          setAdjDollarsStr(d === 0 ? '' : String(d))
                        }} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-gray-400 mb-1 block">± dollars</span>
                      <span className="flex gap-1">
                        <button type="button" className="btn btn-secondary shrink-0 w-11 h-11 px-0 text-lg" aria-label="Switch between taking off and adding on" data-adjust-sign
                          onClick={() => setAdjDollarsStr(v => { const t = v.trim(); if (!t) return '-'; return t.startsWith('-') || t.startsWith('−') ? t.slice(1) : '-' + t })}>±</button>
                        <input type="text" inputMode="numeric" autoComplete="off" placeholder="−30" data-adjust-dollars
                          className="min-w-0 w-full border border-gray-300 rounded-lg px-3 h-11 text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400"
                          value={adjDollarsStr} onChange={e => setAdjDollarsStr(e.target.value.replace(/[^0-9\-−]/g, ''))} />
                      </span>
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={showDiscount} onChange={e => setShowDiscount(e.target.checked)} data-adjust-show-discount />
                    Show as discount on the proposal
                  </label>
                  {adjRefused && <p className="text-xs font-semibold text-red-700" data-adjust-refused>Taking {fmt(Math.abs(adjWantedCents) / 100)} off would put the price under cost, so it is not applied.</p>}
                  {adjApplied !== 0 && (() => {
                    const profitOf = (price: number, rounding: number, adj: number) => splitDollars({ price, materials: materialCost, labor: laborCost + tearOutCost, commission: commAmt, overheadPct: overheadNow, roundingCents: rounding, adjustmentCents: adj }).find(x => x.part === 'profit')!.dollars
                    const netAfter = profitOf(adjPrice, roundingCents, adjApplied)
                    const netBefore = profitOf(listPrice, roundingCents, 0)
                    const optionCount = jobType === 'new' ? new Set([style?.name, ...offer, ...tiers.filter(t => !t.off && t.style).map(t => t.style!.name)].filter(Boolean)).size : (work ? 1 : 0)
                    return (
                      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1 text-sm" data-adjust-summary>
                        <div className="flex justify-between"><span className="text-gray-600">Price before adjustment</span><span className="tabular-nums" data-adjust-list>{fmt(listPrice)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">{adjApplied < 0 ? 'Discount' : 'Adjustment'} <span className="text-xs text-gray-400">(out of profit)</span></span><span className={`tabular-nums font-semibold ${adjApplied < 0 ? 'text-red-600' : 'text-green-700'}`} data-adjust-amount>{adjApplied < 0 ? '−' : '+'}{fmt(Math.abs(adjApplied) / 100)}</span></div>
                        <div className="flex justify-between font-semibold"><span>Final price</span><span className="tabular-nums" data-adjust-final-price>{fmt(adjPrice)}</span></div>
                        {internal && <>
                          <div className="flex justify-between border-t border-gray-200 pt-1 mt-1"><span className="text-gray-600">Margin after</span><span className={`tabular-nums font-semibold ${gmColor}`} data-adjust-margin>{(gmPct * 100).toFixed(1)}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-600">Net profit after</span><span className={`tabular-nums font-semibold ${netAfter < 0 ? 'text-red-700' : 'text-gray-900'}`} data-adjust-profit>{fmt(netAfter)}</span></div>
                          <p className="text-xs text-gray-500" data-adjust-gave>{adjApplied < 0 ? `You give up ${fmt(netBefore - netAfter)} of profit.` : `${fmt(netAfter - netBefore)} more profit.`} Overhead and commission stay on {fmt(listPrice)}.</p>
                        </>}
                        {optionCount > 1 && <p className="text-xs font-semibold text-amber-800" data-adjust-every-option>{adjApplied < 0 ? '−' : '+'}{fmt(Math.abs(adjApplied) / 100)} on every option on the proposal.</p>}
                        <p className="text-xs text-gray-500" data-adjust-customer-sees>{showDiscount && adjApplied < 0 ? 'The customer sees the list price, the discount and the final price.' : 'The customer sees the final price only.'}</p>
                      </div>
                    )
                  })()}
                </div>
              ))}

              {jobType === 'new' && style && sections > 0 && (
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
                              <span className="block text-xs text-gray-600">{o.sections} sections · {fmt(o.perFoot)}/ft</span>
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

              {signedQuote && (
                <button disabled={!canSave} onClick={makeChangeOrderNow} className="btn btn-primary btn-lg w-full" data-co-make-panel>Make change order</button>
              )}
              <button
                disabled={!canSave}
                onClick={() => setShowSaveModal(true)}
                className={signedQuote ? 'btn btn-secondary w-full min-h-[48px]' : 'btn btn-primary btn-lg w-full'}
              >
                {signedQuote ? 'Save notes and customer details only' : init?.id ? 'Update quote' : 'Save quote'}
              </button>
              {!canSave && <p className="text-xs text-gray-400 text-center">{jobType === 'move' ? 'Select a style, draw the new line and enter the old line footage' : jobType === 'repair' ? 'Select a style and add at least one repair item' : 'Select a style and enter at least one run'}</p>}
            {showPullSheet && materialItems.length > 0 && (
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500">{work ? 'Pull sheet (new material only)' : 'Pull Sheet'}</h3>
                  <span className="text-xs text-gray-400">{materialItems.length} items</span>
                </div>
                <div className="space-y-1">
                  {materialItems.map((item, i) => (
                    <div key={i} className="flex items-start justify-between text-xs py-1.5 border-b border-gray-100 last:border-0">
                      <div className="flex-1 pr-2">
                        <p className="text-gray-800 font-medium leading-tight">{partWithPair(item.item)}</p>
                        <p className="text-gray-400 mt-0.5">{!internal ? `${item.qty}` : `${item.qty} × ${fmt(item.unitCost)}`}</p>
                      </div>
                      {internal && <span className="text-gray-900 font-semibold whitespace-nowrap">{fmt(item.total)}</span>}
                    </div>
                  ))}
                </div>
                <div className={`mt-3 pt-3 border-t border-gray-300 flex justify-between items-center ${!internal ? 'hidden' : ''}`}>
                  <span className="text-sm font-semibold text-gray-700">Total Material</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(materialCost)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>

        {/* The bar: the window's own footer on a computer or tablet; pinned to the bottom of the screen on a phone. */}
        <div className={`${showSaveModal ? 'hidden md:block' : ''} fixed inset-x-0 bottom-0 z-[60] md:static md:z-auto md:shrink-0 md:rounded-b-2xl bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] px-3 md:px-6 pt-2 md:pt-3 pb-[calc(10px+env(safe-area-inset-bottom))] md:pb-3`} data-quote-bar>
          <div className="max-w-3xl md:max-w-none mx-auto md:flex md:items-center md:gap-4">
            <button type="button" onClick={barBack} disabled={stepIndex === 0} data-bar-back
              className="hidden md:inline-flex btn btn-lg shrink-0 min-w-[128px] bg-gray-200 text-gray-900 border-2 border-gray-400 hover:bg-gray-300 font-semibold">
              <ChevronLeft size={20} aria-hidden="true" /> Back
            </button>
            <div className="md:flex-1 md:min-w-0">
            <p className="text-xs font-semibold text-gray-600 truncate tabular-nums" data-bar-facts>
              {step === 'yard' && entry === 'layout' && yard
                ? `${sidesDone} of ${sidesOn} sides · ${totalFootage} ft · ${effCorners} corner, ${effEnds} end`
                : work ? (jobType === 'move' ? `Move ${Math.round(moveIn.oldFt)} ft → ${totalFootage} ft · ${work.sections} sections` : `Repair · ${REPAIR_ITEMS.reduce((t, k) => t + (repairIn.items[k] ?? 0), 0)} items`)
                : totalFootage > 0 ? `${totalFootage} ft · ${sections} sections · ${effCorners} corner, ${effEnds} end` : 'No fence yet'}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xl font-bold tabular-nums text-gray-900 shrink-0 whitespace-nowrap mr-auto" data-bar-price>{fmt(adjPrice)}{priced.priceMethod === 'manual' && <span className="block text-xs font-semibold text-amber-700" data-bar-price-typed>Set by hand: parts do not change it</span>}</p>
              <button type="button" className="btn btn-secondary shrink-0 min-h-[48px] px-3" onClick={() => setPhotosOpen(true)} data-photos-open aria-label={`Photos and video (${mediaItems.length})`}>
                <Camera size={18} aria-hidden="true" /><span className="tabular-nums">{mediaItems.length}</span>
              </button>
              {signedQuote ? (
                // A signed quote: the change order is one tap from any step (the next step stays beside it).
                <>
                  {step !== 'price' && <button type="button" onClick={barNext} className="btn btn-secondary shrink-0 min-h-[48px] px-3" data-bar-next>{step === 'yard' && nextSide ? 'Next side' : 'Next'}</button>}
                  {/* Wraps to two lines on a narrow phone so the price beside it is never cut off (round 2 review: "$7,02"). */}
                  <button disabled={!canSave} onClick={makeChangeOrderNow} className="btn btn-primary min-h-[52px] px-3 text-[15px] font-semibold min-w-0 shrink whitespace-normal leading-tight md:shrink-0 md:min-w-[160px] md:text-base" data-co-make>Make change order</button>
                </>
              ) : step === 'price' ? (
                <button disabled={!canSave} onClick={() => setShowSaveModal(true)} className="btn btn-primary btn-lg shrink-0 md:min-w-[160px]" data-save-open>{init?.id ? 'Update quote' : 'Save quote'}</button>
              ) : (
                <button type="button" onClick={barNext} className="btn btn-primary btn-lg shrink-0 md:min-w-[160px]" data-bar-next>{barNextLabel}</button>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Photos and video: their own sheet, opened from the bottom bar; kept mounted so uploads carry on. */}
      <div className={photosOpen ? 'fixed inset-0 z-[70] bg-black/50 flex items-end md:items-center justify-center' : 'hidden'} data-photos-sheet>
        <div className="bg-white w-full md:max-w-2xl max-h-[88vh] overflow-y-auto rounded-t-2xl md:rounded-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-gray-900">Photos and video</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPhotosOpen(false)} data-photos-done>Done</button>
          </div>
            <div data-quote-media>
              <MediaGallery
                where={{ quoteKey: quoteIdRef.current }}
                quoteCustomerId={init?.customerId ?? null}
                layout={entry === 'layout' ? yard : null}
                onLayout={l => setYard(l)}
                defaultCategory="Site walk"
                onItems={setMediaItems}
                openKey={openMedia}
                onOpened={() => setOpenMedia(null)}
                cameraSignal={cameraSignal}
              />
            </div>
            {/* Which of them the customer sees on the proposal: one tap each (Internal until ticked). */}
            {photosOpen && <div className="mt-4 border-t border-gray-100 pt-3"><CustomerPhotoTicks quoteId={quoteIdRef.current} customerId={init?.customerId ?? null} /></div>}

        </div>
      </div>
      {photosOpen && <BackClose name="quote-photos" onClose={() => setPhotosOpen(false)} />}

      {showSaveModal && <BackClose name="save-quote" onClose={() => setShowSaveModal(false)} />}
      {showSaveModal && (
        <SaveModal
          initialCustomerName={customerName}
          initialCustomerId={init?.customerId}
          initialAddress={init?.customerAddress}
          initialStatus={init?.status ?? 'DRAFT'}
          initialNotes={[init?.notes, ...voiceNotes.map(n => `Crew note: ${n}`)].filter(Boolean).join('\n')}
          onCancel={() => setShowSaveModal(false)}
          onSave={handleSave}
        />
      )}

      {pending && !coPrefill && <BackClose name="quote-lock" onClose={() => setPending(null)} />}
      {pending && !coPrefill && (
        <div className="fixed inset-0 z-[75] bg-black/50 flex items-center justify-center p-3" data-quote-lock-dialog={pending.kind}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            {pending.kind === 'locked' ? (
              <>
                <p className="text-base font-bold text-gray-900" data-quote-lock-message>{LOCKED_MESSAGE}</p>
                <p className="text-sm text-gray-600">The customer signed at {fmt(signedQuoteOf(init!).finalPrice)}. That price, the fence and the pull sheet stay as signed. A change order adds the changes, priced at today's costs.</p>
                <div className="flex flex-col gap-2">
                  <button type="button" className="btn btn-primary min-h-[48px]" onClick={() => startChangeOrder()} data-quote-lock-co>Make a change order</button>
                  <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => { const q = pending.quote; setPending(null); onSave(keepPrices(signedQuoteOf(init!), { ...q, date: init!.date })) }} data-quote-lock-keep>Save notes and customer details only</button>
                  <button type="button" className="min-h-[44px] text-sm text-gray-600" onClick={() => setPending(null)} data-quote-lock-cancel>Back to the quote</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-base font-bold text-gray-900" data-quote-sent-message>Prices changed since this was sent (was {fmt(init!.finalPrice)}, now {fmt(openPriceRef.current ?? adjPrice)}). Save as a new version and send again, or keep the sent prices?</p>
                <div className="flex flex-col gap-2">
                  <button type="button" className="btn btn-primary min-h-[48px]" onClick={() => { const q = pending.quote; setPending(null); onSave({ ...q, needsResend: true }) }} data-quote-sent-new>Save new version (send it again)</button>
                  <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => { const q = pending.quote; setPending(null); onSave(keepPrices(init!, q)) }} data-quote-sent-keep>Keep the sent prices</button>
                  <button type="button" className="min-h-[44px] text-sm text-gray-600" onClick={() => setPending(null)}>Back to the quote</button>
                </div>
                <p className="text-xs text-gray-500">Keep the sent prices saves notes and customer details only; the fence, price and proposal stay as sent.</p>
              </>
            )}
          </div>
        </div>
      )}
      {typeInstead && init?.id && (
        <QuickChangeOrderModal
          quoteId={init.id}
          customerName={init.customerName}
          existingCount={getOrdersForQuote(init.id).length}
          onSaved={() => { setTypeInstead(false); onClose() }}
          onClose={() => setTypeInstead(false)}
        />
      )}
      {coPrefill && pending && init?.id && (
        <QuickChangeOrderModal
          quoteId={init.id}
          customerName={init.customerName}
          existingCount={getOrdersForQuote(init.id).length}
          prefill={coPrefill}
          // The change order is its own record: the signed quote is not saved again (that re-save said "Quote sold, job
          // created" and sent the signed quote a second time). Same as Type the change instead.
          onSaved={() => { setCoPrefill(null); setPending(null); onClose() }}
          onClose={() => setCoPrefill(null)}
        />
      )}
    </div>
  )
}