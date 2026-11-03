import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { formatPhone } from './phoneFormat'
import { splitOnLastSpace } from './personName'
import { Camera, ChevronLeft } from 'lucide-react'
import { totalMaterialCost } from './materialCalculator'
import type { LineItem, MaterialResult } from './materialCalculator'
import { resolveSubRate, subUnitOf, subUnitOnOpen, subUnitRateMissing, cleanOverrides, importedOldPrice, keepsCents, crewTime } from './pricingEngine'
import type { LaborMode, SubUnit, PriceMethod, QuotePricingOverrides } from './pricingEngine'
import { INVENTORY_UPDATED_EVENT, getInventory } from './inventoryStore'
import { normalizeItemName } from './materialCalculator'
import { stalePartsOnQuote, borrowedPartsOnQuote, priceAgeLabel, staleCutoff, DEFAULT_PRICE_STALE_MONTHS, stalePricesHeading, monthsText } from './priceAge'
import FromBlackWarning from './FromBlackWarning'
import StyleChoices from './StyleChoices'
import { catalogOf } from './fenceCatalog'
import { newId } from './recordSync'
import type { SavedQuote } from './QuotesPage'
import { getCustomers, getCustomerById, upsertCustomer, findPossibleMatches } from './customerStore'
import { customersMatching, decideNewCustomer, contactToAdd, quoteDraftAddress, serviceAddressShown } from './customerPick'
import AddressAutocomplete from './AddressAutocomplete'
import { getConfig } from './configStore'
import { BUSINESS_STATE_UPDATED_EVENT } from './businessStateStore'
import { checkPricing, heldPricingStamp, repriceOutcome, draftPriceLine, priceText, samePrice, fenceOffLine, PRICING_CHANGED_EVENT } from './pricingFreshness'
import { getRailOptimizerConfig } from './configStore'
import { sourcePicker } from './optionListsStore'
import { calculateQuote, widthComparison, laborLabel, type QuoteCalcInput } from './quoteCalc'
import { layoutPanelFt } from './gateSlide'
import { defaultGateWidths, deriveLayout, fitGateWidths, formatFtIn, postSpacing, teePostFor, TYPED_DBL_GATE_FT, TYPED_WALK_GATE_FT, type YardLayout } from './yardLayout'
import LayoutEditor, { nextEmptySide } from './LayoutEditor'
import CustomerDrawing from './CustomerDrawing'
import SiteVisitInQuote from './SiteVisitInQuote'
import CustomerPhotoTicks from './CustomerPhotoTicks'
import VoicePanel, { type VoiceHandle } from './VoicePanel'
import MediaGallery, { type ShownMedia } from './MediaGallery'
import { fetchCurrentUser, currentUser } from './crmAuth'
import { saveConfig } from './configStore'
import { tapeChecks, tapeFlags, gateChecks, marginCheck, perFootCheck, type NamedRun } from './quoteChecks'
import { getQuotes, quoteStillMine, QUOTE_REPRICE_EVENT, serverSavedPrice } from './quoteStore'
import { saveGate, gatedOnce } from './movedGate'
import { pendingFor } from './outbox'
import { renderToStaticMarkup } from 'react-dom/server'
import SitePlan from './SitePlan'
import { compareStyles, priceOption, buildProposal, optionLabel, gateWarnings, optionBlocks, withoutAdjustment } from './proposal'
import { resolveTiers, tierOptions, tierSetFor, cheapestStyle, ownCardAsSent, ownTierKey, twinTierKey, frozenOwnTierKey, tierCategory, pinnedForMain, offeredCount, newOptionKey, optionCard, materialWord, MAX_TIERS, type OptionCard, type ResolvedTier, type TierPrefs, type TierKey } from './tiers'
import { warrantySettingsOf, stampWarranties } from './warranties'
import { proposalSent, ownTierToStamp, proposalStamp, tickedStyles, addsPastLimit } from './proposalOptions'
import { sentTierCards, sentTiersNote } from './sentTiers'
import { proposalPriceChanges, type ProposalPriceChange } from './sentReprice'
import { customerFenceName } from '../../portal/src/server/lib/customerFenceName'
import { useTierSets } from './tierSetsApi'
import { getContractSections } from './contractStore'
import { listStylePhotos } from './stylePhotosApi'
import { useBackLayer, useLeaveWarning, BackClose, navigate } from './nav'
import PercentField from './PercentField'
import { targetMarginPct, overheadPctOf } from './configStore'
import DollarPickets, { splitDollars } from './DollarPickets'
import { businessDate } from './businessDate'
import { isQuotable } from './styleAvailability'
import { isHeldSavedQuote, heldQuoteSave, heldSavedNumbers, heldNote, heldNotSaved, heldBarReason } from './heldQuote'
import { calculateQuote as calcNewFence } from './quoteCalc'
import {
  priceMove, priceRepair, moveRepairSettings, damagePctFor, postTypeOf, seesCosts, newFenceBetter, matchRisk, toSavedWork, gatesText as workGatesText, repairChangeWords, moveChangeWords, moveGateFlags,
  REPAIR_ITEMS, chargedRepairItems, repairLines, oldPostsMethod, oldPostsCheck, type MoveDraft, type RepairDraft, type JobType, type MoveInputs, type RepairInputs, type PostType, type WorkResult,
} from './moveRepair'
import { JobTypePicker, MovePanel, RepairPanel, WorkBreakdown } from './MoveRepairPanels'
import { workOption, buildWorkProposal, pricingForMain, type MainPricingKey } from './proposal'
import { signedInRole, can } from './permissions'
import { sendJson } from './syncHttp'
import { jobMinimumCents, newlyUnderMinimum, underMinimumWarning, type MinimumOption } from './discountMinimum'
import { salesmanSwitchDefault, seesCommission, clearedCommission } from './salesmanCommission'
import { marginTone, pricedTarget } from './moneyTruth'
import { getBookingTeam } from './bookingTeamStore'
import { toast } from './toast'
import { useServerQuoteView, viewCalc, viewWork, viewTiers, viewCompare, viewProposalOptions } from './quoteViewApi'
import { minimumPrice, wholeDollarRecord, adjustmentRecord, isNewMin, type QuoteJobRequest } from './quoteJob'
import { bakedBackdrop } from './aerialBake'
// A signed quote's lock: the same rules the server checks every save with.
import { isSignedQuote, lockedChanges, keepPrices, LOCKED_MESSAGE } from '../../portal/src/server/lib/quoteLock'
import { shapeOf, sideChanges, sideChangeWords } from '../../portal/src/server/lib/changeOrderMerge'
import { QuickChangeOrderModal, foldedStates, getOrdersForQuote, refreshChangeOrders, signedQuoteOf, openChangesNote, type ChangeOrderPrefill } from './ChangeOrders'
import { changeOrderDraft, gatesPutIn } from './changeOrderDraft'
import { changeBaseOf, changeOrderPrice, noWorkNote, type ChangeNow } from './changeOrderPricing'
import { SignedDocumentLinks } from './SignedDocuments'
import { partWithPair } from '../../portal/src/server/lib/partNames'
import SalesmanPicker from './SalesmanPicker'
import { defaultRepNow } from './salesmanChoice'
import { betterInstall, oneWidthEach, widthSiblings } from './salesmanPicks'

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

/** Why a style is off for quoting, in words (the Price step and the save's dialog say the same). */
const offReason = (s: { isActive?: boolean; quotable?: boolean; held?: string } | null | undefined): string | null =>
  !s ? null : s.isActive === false || s.quotable === false ? 'switched off in Settings' : s.held || null

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

// ── Save Modal ────────────────────────────────────────────────────────────────

function SaveModal({
  onSave,
  onCancel,
  stillMine,
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
  /**
   * Asked before a customer is made or picked (a Salesman's quote the owner moved meanwhile: false, and the app has
   * said "The owner moved this to <name>" once and closed the builder). Review, Oct 30 2026: New Customer made a
   * customer before the save found the quote was moved.
   */
  stillMine?: () => Promise<boolean>
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
  // The name typed in the quote builder fills New Customer's First and Last Name (split on the last space).
  const [firstName, setFirstName] = useState(() => splitOnLastSpace(initialCustomerName).firstName)
  // The new customer's id, chosen when this opens: tapped twice, it is one customer.
  const [newCustomerId] = useState(() => newId())
  const [lastName, setLastName]   = useState(() => splitOnLastSpace(initialCustomerName).lastName)
  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  // A new customer's address follows Property address (the address the quote is drawn on) until something is
  // typed in it (audit #52; review Oct 28 2026: both boxes were empty after the Yard step's aerial address).
  const [typedAddress, setAddress] = useState<string | null>(null)
  const [leadSource, setLeadSource] = useState('')
  const [salesRep, setSalesRep]   = useState('')
  const [status, setStatus]       = useState<SavedQuote['status']>(initialStatus)
  const [notes, setNotes]         = useState(initialNotes)
  const [leadTemp, setLeadTemp]   = useState(0)
  // The quote's property. It is the quote's own: clearing or changing the customer never changes it.
  const [propertyAddress, setPropertyAddress] = useState(initialAddress || selectedCustomer?.serviceAddress || '')
  const address = serviceAddressShown(typedAddress, propertyAddress)
  // Settings > Lead Sources (shown ones), and the quote's own word when it is not among them.
  const LEAD_SOURCES = sourcePicker(leadSource)

  const allCustomers: SavedCustomer[] = useMemo(() => {
    return getCustomers() as SavedCustomer[]
  }, [])

  const filtered = customersMatching(allCustomers, search)

  // Someone on file with the phone or email typed for a new customer: offered. On Save, the same name
  // goes on them; a different name is a new customer with a Possible match (customerPick decideNewCustomer).
  const matches = mode === 'new' ? (findPossibleMatches({ phone, email }) as SavedCustomer[]) : []
  const onFile = decideNewCustomer({ first: firstName, last: lastName }, matches)
  // Put on them: a phone or email typed that they have none of is added; one where they have another is not saved, said below (audit #48).
  const contact = onFile.kind === 'attach' ? contactToAdd(onFile.to, { phone, email }) : null

  // A pick links the quote to that customer; their record is not changed. Their
  // address fills Property address only when the quote has none yet.
  function handleSelectCustomer(c: SavedCustomer) {
    setSelectedCustomer(c)
    setSearch(`${c.firstName} ${c.lastName}`)
    setPropertyAddress(prev => prev.trim() ? prev : (c.serviceAddress || ''))
  }

  // Save tapped twice before the window closes: saved once.
  const submitted = useRef(false)
  // Asked first (a moved quote: no customer is made or picked; movedGate.ts), then saved once.
  // The newest submit and check (this render's form), called through refs so the once-guard is made one time.
  const latest = useRef({ submitNow, stillMine })
  latest.current = { submitNow, stillMine }
  const gated = useRef(gatedOnce(() => (latest.current.stillMine ? latest.current.stillMine() : Promise.resolve(true)), () => latest.current.submitNow()))
  function handleSubmit() {
    if (submitted.current) return
    void gated.current()
  }

  function submitNow() {
    if (submitted.current) return
    const onto = mode === 'search' ? selectedCustomer : mode === 'new' && firstName.trim() && onFile.kind === 'attach' ? onFile.to : null
    if (onto) {
      submitted.current = true
      // New Customer that is someone on file: what they had none of is added to them (their own are kept).
      const add = mode === 'new' && contact ? contact.add : {}
      const who = add.phone || add.email ? upsertCustomer({ id: onto.id, firstName: onto.firstName, ...add }).customer : onto
      onSave({
        customerId: onto.id,
        customerName: `${onto.firstName} ${onto.lastName}`,
        customerPhone: who.phone,
        customerEmail: who.email,
        customerAddress: propertyAddress.trim() || onto.serviceAddress,
        leadSource: onto.leadSource,
        salesRep: onto.salesRep,
        status,
        notes,
        leadTemp,
      })
      return
    }
    if (mode === 'new') {
      if (!firstName.trim()) return
      submitted.current = true
      // A new customer; with a phone or email on file under another name, marked Possible match on the server
      // (Merge is one tap on their page). Their address, if left empty, is this property; the quote's property, if left empty, is theirs.
      const { customer } = upsertCustomer({
        id: newCustomerId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        email,
        serviceAddress: address.trim() || propertyAddress.trim(),
        leadSource,
        // The Salesman picked (where the choice starts unless another is picked: the person entering, the office's
        // the owner; salesmanChoice.ts). The quote takes the customer's below.
        salesRep: salesRep.trim() || defaultRepNow(),
      }, { recordMatches: onFile.kind === 'new_possible' })
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
                  <p className="text-xs text-amber-800">{onFile.kind === 'attach'
                    ? `Already on file with this phone or email, same name: Save puts the quote on ${`${onFile.to.firstName} ${onFile.to.lastName}`.trim()}.`
                    : 'Already on file with this phone or email, another name: Save makes a new customer, marked Possible match to merge if it is the same person. Or pick one.'}</p>
                  {contact?.add.phone && <p className="text-xs text-amber-800" data-contact-added="phone">They have no phone on file: Save adds {formatPhone(contact.add.phone)}.</p>}
                  {contact?.add.email && <p className="text-xs text-amber-800 [overflow-wrap:anywhere]" data-contact-added="email">They have no email on file: Save adds {contact.add.email}.</p>}
                  {contact?.kept.map(k => (
                    <p key={k.what} className="text-xs font-semibold text-red-700 [overflow-wrap:anywhere]" data-contact-not-saved={k.what}>
                      The {k.what} typed, {k.what === 'phone' ? formatPhone(k.typed) : k.typed}, is not saved: they have {k.what === 'phone' ? formatPhone(k.theirs) : k.theirs} on file, and it stays. If theirs changed, change it on their page.
                    </p>
                  ))}
                  {matches.slice(0, 3).map(c => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-gray-800 min-w-0 [overflow-wrap:anywhere]">{`${c.firstName} ${c.lastName}`.trim()}{c.phone ? ` · ${formatPhone(c.phone)}` : ''}</span>
                      <button type="button" onClick={() => { handleSelectCustomer(c); setMode('search') }} data-use-customer={c.id}
                        className="shrink-0 max-w-[55%] min-h-[40px] px-3 rounded-lg border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100 text-left [overflow-wrap:anywhere]">
                        Use {`${c.firstName} ${c.lastName}`.trim() || 'this customer'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Service Address</label>
                <AddressAutocomplete value={address} onChange={setAddress} onSelect={p => setAddress(p.formatted)} placeholder="Address..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* The Salesman choice (salesmanChoice.ts): the person entering, unless another is picked. */}
                {onFile.kind === 'attach'
                  ? <p className="text-xs text-gray-500 self-end" data-salesman-kept>{`${onFile.to.firstName} ${onFile.to.lastName}`.trim()}'s Salesman stays as on file{onFile.to.salesRep ? ` (${onFile.to.salesRep})` : ''}.</p>
                  : <SalesmanPicker value={salesRep} onChange={setSalesRep} onQuote />}
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
  repriceOnOpen = false,
}: {
  onClose: () => void
  onSave: (q: SavedQuote) => void
  initialQuote?: SavedQuote | null
  /** Open on the Yard step (a draft opened from Ready to quote: the customer's drawing and the site visit are there). */
  startOnYard?: boolean
  /** Opened from "Change order" > "Change the yard drawing": the bar's button makes the change order straight away. */
  changeOrder?: boolean
  /** Opened because the server sent its save back for new prices (#58): it reprices and asks before saving. */
  repriceOnOpen?: boolean
}) {
  const init = initialQuote

  // Styles, rates and thresholds all come from Settings. Styles turned off or
  // not available for quoting (Settings → Fence Styles) are hidden unless this
  // quote already uses one; then it stays, marked, and the quote keeps working.
  // Read again when Settings change while the builder is open (the owner's price change reaches an open quote:
  // broken list #58, pricingFreshness.ts); nothing typed here is lost.
  const [cfgTick, setCfgTick] = useState(0)
  useEffect(() => {
    const on = () => setCfgTick(t => t + 1)
    window.addEventListener(BUSINESS_STATE_UPDATED_EVENT, on)
    return () => window.removeEventListener(BUSINESS_STATE_UPDATED_EVENT, on)
  }, [])
  const cfg = useMemo(() => getConfig(), [cfgTick])  // eslint-disable-line react-hooks/exhaustive-deps
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
  // A customer on file picked at the Customer name step (audit #44): Save puts the quote on them, never a second copy.
  // A quote that already has its customer (opened from them, or saved) is not offered others here; Save's Change customer is.
  const [pickedCustomerId, setPickedCustomerId] = useState<string | null>(null)
  const quoteCustomerId = init?.customerId || pickedCustomerId || ''
  const pickedCustomer = pickedCustomerId ? getCustomerById(pickedCustomerId) : null
  const nameMatches = useMemo(() => (quoteCustomerId ? [] : customersMatching(getCustomers(), customerName, 4)), [quoteCustomerId, customerName])
  const [styleId, setStyleId]           = useState(() => {
    if (!init) return ''
    const found = FENCE_STYLES.find(s => s.name === init.fenceStyle)
    return found?.id ?? ''
  })
  // The Salesman's picks name a fence in every section width: the quote takes the cheapest for the yard (always the
  // best price), until another fence is picked another way. Null: the style stays as picked.
  const [widthIds, setWidthIds] = useState<string[] | null>(null)
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
  // The typed run list's gate widths in feet: kept from the drawing when "Advanced: type runs" is opened
  // (a 10 ft double gate stays two 5 ft leaves), or as the saved typed quote kept them. Absent: 4 ft / 8 ft.
  const [typedGateWidths, setTypedGateWidths] = useState<{ walk: number[]; dbl: number[] }>(() =>
    !init?.layout?.yard && init?.layout?.gateWidths ? fitGateWidths(init.layout.gateWidths, init.walkGates ?? 0, init.dblGates ?? 0) : { walk: [], dbl: [] })
  const [tearOutSec, setTearOutSec]     = useState(init?.tearOutSections ?? 0)
  const [tearOutGates, setTearOutGates] = useState(init?.tearOutGates ?? 0)
  const [adjLaborHrs, setAdjLaborHrs]   = useState(init?.adjLaborHrs ? String(init.adjLaborHrs) : '')
  const [priceAdjust, setPriceAdjust]   = useState(init?.priceAdjust ?? 0)
  // On for a new quote by a Salesman (or for her customer); a saved quote keeps its own (Oct 27 2026, salesmanCommission.ts).
  const [hasSalesman, setHasSalesman]   = useState(() => salesmanSwitchDefault(init as any, signedInRole(), getBookingTeam()))
  // A saved quote whose rep is positively not a Salesman (the server's one rule, lib/commissionRule.ts): a save would
  // take commission off, so the switch does not offer it. A new quote's rep comes with the customer at save.
  const [repOff, setRepOff] = useState<{ rep: string } | null>(null)
  useEffect(() => {
    if (!init?.id || !seesCommission(signedInRole(), can('costs.view'))) return
    let live = true
    void sendJson('POST', '/api/saved-quotes/commission-rule', { quoteId: init.id }).then(r => { if (live && r.result.ok && r.json?.data?.off) setRepOff({ rep: String(r.json.data.rep ?? '') }) })
    return () => { live = false }
  }, [init?.id])
  // A save that would take commission off: said first, and it saves only when that is chosen.
  const [commissionAsk, setCommissionAsk] = useState<{ data: Parameters<typeof handleSave>[0]; rep: string } | null>(null)
  // Pricing choices for this quote. A saved quote reopens with the choices it
  // was saved with; a new quote starts from Settings → Pricing.
  const [laborMode, setLaborMode]       = useState<LaborMode>(initPricing.laborMode ?? cfg.pricing.laborMode ?? 'hourly')
  // The sub's "Paid per" travels with the rate (Oct 30 2026, subUnitOf): a quote with no rate of its own follows
  // Settings for both; it keeps its own unit when "Paid per" was picked on it, or with its own typed rate.
  const subOpen = subUnitOnOpen(initPricing, cfg.pricing)
  const initOwnUnit = subOpen.own
  const [subUnitPicked, setSubUnitPicked] = useState(subOpen.picked)
  const [subUnit, setSubUnit]           = useState<SubUnit>(subOpen.unit)
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
  // Bumps when Inventory or Settings change so costs, rates, tiers and Compare are re-read while the builder is open.
  const [invTick, setInvTick]           = useState(0)
  useEffect(() => {
    const onInv = () => setInvTick(t => t + 1)
    window.addEventListener(INVENTORY_UPDATED_EVENT, onInv)
    window.addEventListener(BUSINESS_STATE_UPDATED_EVENT, onInv)
    return () => { window.removeEventListener(INVENTORY_UPDATED_EVENT, onInv); window.removeEventListener(BUSINESS_STATE_UPDATED_EVENT, onInv) }
  }, [])
  const [showPullSheet, setShowPullSheet] = useState(true)
  // One step on screen at a time: a new quote starts with the customer, a saved one on its price.
  const [step, setStep] = useState<StepKey>(() => (startOnYard ? (init?.work?.type === 'repair' ? 'style' : 'yard') : init?.id ? 'price' : 'customer'))
  // The one side of the yard shown open (Next side moves it on).
  const [openSide, setOpenSide] = useState<string | null>(null)
  const [photosOpen, setPhotosOpen] = useState(false)
  // Options offered on the proposal besides this quote's own style.
  const [offer, setOffer] = useState<string[]>(() => tickedStyles(init?.proposal, init?.fenceStyle))
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
    ...(init?.proposal?.tierPrefs?.added?.length ? { added: init.proposal.tierPrefs.added } : {}),
    ...(init?.proposal?.tierPrefs?.popular !== undefined ? { popular: init.proposal.tierPrefs.popular } : {}),
    ...(init?.proposal?.tierPrefs?.pin ? { pin: init.proposal.tierPrefs.pin } : {}),
  }))
  const { sets: tierSets } = useTierSets()
  const [photoIds, setPhotoIds] = useState<Record<string, string>>({})
  useEffect(() => {
    listStylePhotos().then(list => setPhotoIds(Object.fromEntries(list.map(p => [p.styleName, p.id])))).catch(() => {})
  }, [])
  const [showSaveModal, setShowSaveModal] = useState(false)
  // A Salesman's saved quote: is it still hers? Asked when the Save window would open and again before it makes a
  // customer (review, Oct 30 2026). Moved: the app says "The owner moved this to <name>" once and closes the builder.
  const salesmanCheck = signedInRole() === 'sales_rep' && !!init?.id
  const stillMineNow = saveGate({ isSalesman: signedInRole() === 'sales_rep', quoteId: init?.id, check: quoteStillMine })
  // Signed (Sold or accepted): the price is locked, changes go on a change order. Sent: the price the customer saw.
  const signedQuote = !!init?.id && isSignedQuote({ status: init.status, acceptedAt: init.acceptedAt, soldAt: init.soldAt })
  const sentQuote = !!init?.id && !signedQuote && init.status === 'SENT'
  const [pending, setPending] = useState<{ quote: SavedQuote; kind: 'locked' | 'sent'; changes?: ProposalPriceChange[] } | null>(null)
  const [coPrefill, setCoPrefill] = useState<ChangeOrderPrefill | null>(null)
  useEffect(() => { if (signedQuote && init?.id) void refreshChangeOrders(init.id) }, [signedQuote, init?.id])
  // Fence moves and repairs (moveRepair.ts). A new fence is priced exactly as before.
  const [jobType, setJobType] = useState<JobType>(init?.work?.type ?? 'new')
  // The old posts' method stays blank (it follows the style) until picked by hand; a saved quote opens with the one it saved.
  // An old "Replace gate" list reads with the walk gates it was saved with: as signed, whatever the change orders did since.
  const moveOpened = useMemo(() => (init?.work?.move ? moveGateFlags(init.work.move, signedQuoteOf(init).walkGates) : null), [init])
  const [move, setMove] = useState<MoveDraft>(() => moveOpened ?? { oldFt: 0, oldWalkGates: 0, oldDblGates: 0, newPostCaps: false })
  const [repair, setRepair] = useState<RepairDraft>(() => init?.work?.repair ?? { what: 'other', items: {}, newPostCaps: false, gateKind: 'walk' })
  const [offerNewFence, setOfferNewFence] = useState<boolean>(!!init?.work?.newFence?.offered)
  const [offerMoveAsIs, setOfferMoveAsIs] = useState<boolean>(true)

  // Unsaved work: anything changed since the builder opened (after it settles).
  // Back, the close button and closing the tab ask before it is dropped.
  const workRef = useRef('')
  workRef.current = JSON.stringify([customerName, styleId, runs, entry, yard, corners, ends, walkGates, dblGates, tearOutSec, tearOutGates, adjLaborHrs, priceAdjust, hasSalesman,
    typedGateWidths, laborMode, subUnit, subUnitPicked, subRateStr, laborFlatStr, priceMethod, perFootStr, factorStr, finalPriceStr, adjDollarsStr, showDiscount, offer, tierPrefs, voiceNotes, jobType, move, repair, offerNewFence, offerMoveAsIs])
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
  // The fence picked here was taken off quoting while the quote was open (switched off, or its prices removed):
  // said on the Price step with the reason, not dropped silently (#58 review).
  const droppedStyle = (() => {
    if (!styleId || style) return null
    const s = cfg.fenceStyles.find(x => x.id === styleId)
    if (!s) return null
    return fenceOffLine(optionLabel(s.name), offReason(s))
  })()
  // A saved quote whose style is held now because its costs are missing (8 ft tall with its piece costs cleared in
  // Settings, review Oct 29 2026: it repriced at $0 a piece, $5,050 → $698): never repriced. The saved price stays
  // on screen and is what a save keeps; a change that would move the price cannot be saved (heldChanged below).
  const heldSaved = isHeldSavedQuote(init, style)
  // While held: the saved numbers (per foot, costs, margin, pull sheet), never today's $0 cost math (review Oct 29 2026).
  const heldNums = heldSaved ? heldSavedNumbers(init as any) : null
  const canPrice = can('prices.change')
  const cfgStyle = style
  const isAutoMix = !!cfgStyle?.autoRailMix
  const optSettings = getRailOptimizerConfig()
  // Owner, admin, manager and office see costs and margin and price the quote here. A Salesman or Installer is
  // priced by the server (quoteJob.ts): a Salesman never sees margin (Jonathan, Nov 2 2026), and her phone no longer
  // receives the margin, Target Profit, overhead or sub rates the quote math needs. She still sees material and
  // labor costs (the server's view, `costs`); the Installer sees no cost and no price.
  const internal = seesCosts(signedInRole()) && signedInRole() !== 'sales_rep'
  // Every margin an owner or office login reads, read the same way: price less cost.
  const seesMargin = internal
  const seesCostLines = seesCosts(signedInRole())
  // The Salesman's picker (salesmanPicks.ts): Material > Style > Height > Color > add ons; install and section width
  // are worked out. Owner and office keep the full picker, and the Advanced section width on the Price step.
  const simplePicks = signedInRole() === 'sales_rep'
  // The commission is not shown to a Salesman (Jonathan, Oct 27 2026): her cost view reads as it did without it.
  const showCommission = seesCommission(signedInRole(), internal)
  // Whole dollar prices (Oct 21 2026): a quote sent, sold or accepted before keeps its cents exactly as the
  // customer saw or signed them; a sent one that is changed here is priced to the whole dollar like any new price.
  const [keptCents] = useState(() => !!init?.id && keepsCents(init as any))
  const keepCents = keptCents && (signedQuote || !dirty())
  // Whole dollars only: "-30", "−30" or "30".
  const adjWantedCents = (() => { const n = parseFloat(adjDollarsStr.replace(/[−–]/g, '-').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n) * 100 : 0 })()

  // Everything about sections, the 6 ft / 8 ft choice per run, the pull sheet,
  // labor, cost and price comes out of quoteCalc, driven by Settings, the
  // style, Inventory prices and the choices on this quote.
  // A rate typed here goes with the unit shown (Settings', unless picked); the saved own rate keeps the saved unit.
  const subUnitNow = subUnitOf({ subUnit, subUnitPicked, subRate: initOwnUnit ? numOrUndef(subRateStr) : undefined }, cfg.pricing)
  const pricingOverrides: QuotePricingOverrides = {
    laborMode,
    subUnit: laborMode === 'subcontractor' ? subUnitNow : undefined,
    subUnitPicked: laborMode === 'subcontractor' && subUnitPicked ? true : undefined,
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
  // Tees on the drawing, for an option of a style that posts them another way (corners and ends typed on the drawing stand as typed).
  const effTees = fromLayout && yard?.cornersOverride == null && yard?.endsOverride == null ? layoutResult!.tees : 0
  // Gate widths (chain link gate leaves go by width): the drawing's, or the typed list's (kept from the drawing
  // it was typed from, or set there). A typed list with every gate at 4 ft / 8 ft sends none, as before.
  const typedWidths = fitGateWidths(typedGateWidths, walkGates, dblGates)
  const keptTypedWidths = !fromLayout && !defaultGateWidths(typedWidths) ? typedWidths : null
  const effGateWidths = fromLayout ? layoutResult!.gateWidthsFt : keptTypedWidths
  const mr = moveRepairSettings(cfg)
  const calcInput: QuoteCalcInput = {
    style,
    runs: effRuns,
    corners: effCorners, ends: effEnds, walkGates: effWalk, dblGates: effDbl,
    ...(effGateWidths ? { gateWidths: effGateWidths } : {}),
    ...(effTeeLines ? { extraLinePosts: effTeeLines } : {}),
    ...(effTees ? { tees: effTees } : {}),
    // Every option is lifted to the minimum job price (proposal.ts priceOption).
    ...(jobType === 'new' && mr.minimumAppliesToNew && mr.minimumJobCents > 0 ? { minimumCents: mr.minimumJobCents } : {}),
    tearOutSections: tearOutSec, tearOutGates,
    extraLaborHrs: parseFloat(adjLaborHrs) || 0,
    hasSalesman,
    priceAdjust,
    pricing: cfg.pricing,
    overrides: pricingOverrides,
    optimizer: optSettings,
  }
  // ── Move or repair inputs, and the tier set (the server needs them too) ──
  const stylePostType: PostType = style ? postTypeOf(style) : 'nd'
  const moveOldPosts = oldPostsMethod(move.oldPostType, stylePostType)
  const repairOldPosts = oldPostsMethod(repair.postType, stylePostType)
  const moveIn: MoveInputs = { ...move, oldPostType: moveOldPosts.type }
  const repairIn: RepairInputs = { ...repair, postType: repairOldPosts.type }
  // Good, Better, Best: the tier set for this style's category (Settings → Good Better Best),
  // priced from the same layout, no taps needed. A quote already sent keeps the
  // tiers it was sent with unless "Use current tiers" is tapped.
  const sentTierSet = init?.id && (init.shareToken || init.status === 'SENT' || init.status === 'SOLD' || heldSaved) ? init.proposal?.tierSet : undefined
  const [keepSentTiers, setKeepSentTiers] = useState(!!sentTierSet)
  // The tier set of the quote's own material; another material made main stays on the set it had (tiers.ts tierCategory).
  const tierCat = tierCategory(tierPrefs, style)
  const liveTierSet = tierSetFor(tierSets, style ? { category: tierCat } : undefined)
  // Mixed styles: a quote signed for another material's option keeps the set it went out with.
  const sentMixed = (init?.proposal?.options ?? []).some(o => o.tier?.swapped)
  const usingSentTiers = (keepSentTiers || heldSaved) && !!sentTierSet && !!style && (sentMixed || sentTierSet.category.trim().toLowerCase() === String(tierCat).trim().toLowerCase())
  const tierSet = usingSentTiers ? sentTierSet! : liveTierSet
  // A sent proposal with the quote's own fence as a card of its own (sent before Better took the main fence): its tiers
  // resolve as it went out, here and on the server, so a save keeps the old cards as sent (tiers.ts ownCardAsSent).
  const ownCardSent = usingSentTiers && ownCardAsSent(init?.proposal as Parameters<typeof ownCardAsSent>[0], style?.name)
  // What prices the tiers: the fence, its gates, its pricing choices and the tier choices. Changed since the quote
  // opened, the Price step prices them anew; unchanged, a sent proposal's tiers show as the customer reads them.
  const fenceKey = JSON.stringify([style?.name ?? '', effRuns, effCorners, effEnds, effWalk, effDbl, effGateWidths, effTeeLines, tearOutSec, tearOutGates,
    // (Not wholeDollar: it follows any edit, a name or a note too.)
    parseFloat(adjLaborHrs) || 0, hasSalesman, priceAdjust, cleanOverrides({ ...pricingOverrides, wholeDollar: undefined }), tierPrefs, jobType])
  const fenceRef = useRef('')
  fenceRef.current = fenceKey
  // As it opened, once settled (as the unsaved work check does).
  const openFence = useRef<string | null>(null)
  useEffect(() => { const t = setTimeout(() => { openFence.current = fenceRef.current }, 400); return () => clearTimeout(t) }, [])
  const fenceChanged = openFence.current !== null && openFence.current !== fenceKey
  // The tiers as the customer reads them on the proposal that went out (sentTiers.ts): its frozen prices and fences,
  // never priced again here (review Oct 27 2026: Good $8,780 here at today's costs, $9,407 on the proposal).
  const sentCards = useMemo(() => (usingSentTiers && init?.proposal
    ? sentTierCards(init.proposal as Parameters<typeof sentTierCards>[0], init as Parameters<typeof sentTierCards>[1], n => cfg.fenceStyles.find(s => s.name === n))
    : null), [usingSentTiers, init, cfg.fenceStyles])
  const showSentCards = !!sentCards && Object.keys(sentCards).length > 0 && !fenceChanged
  // The big price and the bottom bar show the customer's price on a signed quote, and on a sent one until its fence
  // changes (review Oct 27 2026: today's price under "Signed: the price is locked" read as the customer's).
  const customerPrice: number | null = signedQuote ? signedQuoteOf(init!).finalPrice : heldSaved ? init!.finalPrice : sentQuote && !fenceChanged ? init!.finalPrice : null
  // A signed quote changed: the drawing now and what a change order starts from (the signed quote, so it holds across change orders).
  const changeNow: ChangeNow | null = entry === 'layout' && yard ? { yard, nearIn: widthFt * 12, teeAs } : null
  const changeBase = signedQuote ? changeBaseOf(signedQuoteOf(init!), changeNow, FENCE_STYLES.find(s => s.name === signedQuoteOf(init!).fenceStyle)) : null
  // What the server prices for a Salesman or Installer (and what their save sends).
  const priceRequest: QuoteJobRequest = {
    fenceStyle: style?.name ?? '', runs: effRuns.map(r => ({ ft: r.ft, rail: r.rail ?? 'auto' })), corners: effCorners, ends: effEnds, walkGates: effWalk, dblGates: effDbl,
    ...(effGateWidths ? { gateWidths: effGateWidths } : {}),
    ...(effTeeLines ? { extraLinePosts: effTeeLines } : {}),
    ...(effTees ? { tees: effTees } : {}),
    tearOutSections: tearOutSec, tearOutGates, extraLaborHrs: parseFloat(adjLaborHrs) || 0, hasSalesman, priceAdjust,
    overrides: pricingOverrides, jobType,
    move: jobType === 'move' ? moveIn : null, repair: jobType === 'repair' ? repairIn : null,
    tierSet: tierSet ?? null, tierPrefs, ...(ownCardSent ? { ownCardAsSent: true } : {}), compare: showCompare, offer, offerNewFence, offerMoveAsIs, photoIds, keepStyle: init?.fenceStyle ?? null,
    keepCents,
    ...(changeBase && !internal ? { changeBase } : {}),
    // The Salesman's picker: the server says which width of her fence prices lowest, and lists each fence once.
    ...(simplePicks && widthIds && widthIds.length > 1 ? { widthWays: FENCE_STYLES.filter(s => widthIds.includes(s.id)).map(s => s.name) } : {}),
    ...(simplePicks ? { oneWidth: true } : {}),
  }
  const { view: sv, pricing: svPricing, error: svError } = useServerQuoteView(!internal, priceRequest, init?.id)
  // Prices priced here are kept current (broken list #58): checked when the builder opens and every 30 seconds
  // while it is on screen (focus, signal back and every minute: liveRefresh.ts); a part that changed is read again.
  useEffect(() => {
    if (!internal) return
    void checkPricing()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void checkPricing() }, 30_000)
    return () => clearInterval(t)
  }, [internal])
  // The copy of the price data this render priced with: it goes with the save (the server refuses an older one).
  const pricingStampNow = internal ? heldPricingStamp() : null

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
      // Each drawn gate keeps its width on the run list (a 12 ft double gate is not repriced as 8 ft).
      setTypedGateWidths(layoutResult.gateWidthsFt)
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
    // Another option than the main one: the ± dollar adjustment is not on it (proposal.ts optionOverrides).
    return priceMove({ ...workCommon, overrides: withoutAdjustment(workCommon.overrides) }, moveIn, { ...newLine, runs: newLine.runs.map(ft => Math.round(ft * k * 100) / 100) })
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
    const nf = runsFt.some(f => f > 0) ? calcNewFence({ ...calcInput, runs: runsFt.map(ft => ({ ft, rail: 'auto' as const })), tearOutSections: 0, tearOutGates: 0, overrides: { ...withoutAdjustment(pricingOverrides), finalPrice: undefined } }) : null
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
  // The customer's price (above) when there is one, else the builder's.
  const shownPrice = customerPrice ?? adjPrice
  const todayDiffers = !heldSaved && customerPrice != null && Math.round(customerPrice * 100) !== Math.round(adjPrice * 100)
  // Cents the price was rounded down by to the whole dollar: its own line, out of profit (commission and overhead stay on the price before it).
  const roundingCents = !internal ? 0 : work ? work.roundingCents : newMin ? minimum.roundingCents : priced.roundingCents
  const commAmt     = work ? work.commissionCents / 100 : newMin ? Math.round(mr.minimumJobCents * priced.commissionPct) / 100 : priced.commissionAmt
  const grossMargin = work ? work.grossMarginCents / 100 : newMin ? Math.round((adjPrice - totalCOGS - commAmt) * 100) / 100 : priced.grossMargin
  const gmPct       = work ? work.gmPct : newMin ? (adjPrice > 0 ? grossMargin / adjPrice : 0) : priced.gmPct
  // What every login reads and what the warning grades: price less cost, before commission (a Salesman's commission
  // is not shown to her, Oct 27 2026; a quote at target never warns for it). The quote saves the margin after it.
  const viewGrossMargin = Math.round((grossMargin + commAmt) * 100) / 100
  const viewGmPct   = adjPrice > 0 ? viewGrossMargin / adjPrice : 0
  // The ± dollar adjustment: the price without it (the proposal's list price), the amount applied, a reduction refused (under cost).
  const listPrice   = !internal ? (sv?.listPrice ?? adjPrice) : work ? work.listCents / 100 : newMin ? minimum.listPrice : priced.listPrice
  const adjApplied  = !internal ? (sv?.adjustmentCents ?? 0) : work ? work.adjustmentCents : newMin ? minimum.adjustmentCents : priced.adjustmentCents
  const adjRefused  = !internal ? !!sv?.adjustmentRefused : work ? work.adjustmentRefused : newMin ? minimum.adjustmentRefused : priced.adjustmentRefused
  // The pull sheet: a move or repair lists only the NEW material.
  const materialItems: LineItem[] = work ? work.pullSheet : newFenceItems
  // The pull sheet shown: the saved one while held (today's would be $0 costs); what a save writes stays materialItems.
  const shownItems: LineItem[] = heldNums ? (heldNums.pullSheet as LineItem[]) : materialItems
  const shownMaterial = heldNums ? heldNums.material : null
  const materialCost = work ? work.materialCents / 100 : newFenceMaterial
  // Graded as every screen grades a quote (moneyTruth.quoteGrade): against its Target Margin. The "good" margin in Settings is its own warning line.
  const quoteTarget = pricedTarget({ fenceStyle: style?.name, pricing: { costFactor: work ? work.costFactor : priced.priceMethod === 'cost_factor' ? priced.costFactor : undefined, overheadPct: overheadNow }, work: work ? { priced: { targetMarginPct: work.targetMarginPct } } : null }, cfg.fenceStyles, 0)
  const gmTone      = marginTone(viewGmPct, quoteTarget)
  const gmColor     = gmTone === 'good' ? 'text-green-600' : gmTone === 'near' ? 'text-yellow-500' : 'text-red-500'
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
  // What the price is worked out from (the unsaved work, less the customer's name and notes), as it settled when
  // opened: a held style's quote may save only when none of it changed.
  const priceInputs = JSON.stringify([styleId, runs, entry, yard, corners, ends, walkGates, dblGates, tearOutSec, tearOutGates, adjLaborHrs, priceAdjust, hasSalesman,
    typedGateWidths, laborMode, subUnit, subUnitPicked, subRateStr, laborFlatStr, priceMethod, perFootStr, factorStr, finalPriceStr, adjDollarsStr, showDiscount, offer, tierPrefs, jobType, move, repair, offerNewFence, offerMoveAsIs])
  const openPriceInputs = useRef<string | null>(null)
  useEffect(() => { const t = setTimeout(() => { openPriceInputs.current = priceInputsRef.current }, 400); return () => clearTimeout(t) }, [])
  const priceInputsRef = useRef(priceInputs)
  priceInputsRef.current = priceInputs
  const heldChanged = heldSaved && openPriceInputs.current !== null && priceInputs !== openPriceInputs.current
  const openOverrides = useRef(pricingOverrides)
  const sentPricesChanged = sentQuote && openPriceRef.current != null && Math.round(openPriceRef.current * 100) !== Math.round((init?.finalPrice ?? 0) * 100)
  // A sent, shared or signed quote keeps its saved prices (the server never reprices it); every other save is checked.
  const pricesStand = signedQuote || (!!init?.id && (proposalSent(init as Parameters<typeof proposalSent>[0]) || !!init.shareToken))
  // Prices read again while this quote was open (pricingFreshness.ts): the price shown before, while the fence is
  // unchanged since (once it is edited, the price on screen is simply the new one). The save asks first.
  const priceNowRef = useRef(0)
  priceNowRef.current = adjPrice
  const [repricedFrom, setRepricedFrom] = useState<{ was: number; fence: string } | null>(null)
  useEffect(() => {
    const on = () => setRepricedFrom(prev => prev ?? { was: priceNowRef.current, fence: fenceRef.current })
    window.addEventListener(PRICING_CHANGED_EVENT, on)
    return () => window.removeEventListener(PRICING_CHANGED_EVENT, on)
  }, [])
  const repriced = repricedFrom && repricedFrom.fence === fenceKey && priceNowRef.current > 0 && !samePrice(repricedFrom.was, adjPrice) ? repricedFrom : null
  // A draft opened after a price change says so, rather than silently showing the new price (a quote brought in
  // from JobNimbus is priced from its parts on purpose, so it is not compared).
  // A quote that never reached the server (its first save was sent back for new prices) was not "saved": since it was opened.
  const neverSaved = !!init?.id && pendingFor(`quote:${init.id}`).some(o => o.kind === 'quote.create')
  // A save the server sent back left this phone's copy at the refused price: the saved one is the server's.
  const sentBack = !!init?.id && pendingFor(`quote:${init.id}`).some(o => o.redo)
  const savedPrice = (sentBack && init?.id ? serverSavedPrice(init.id) : undefined) ?? init?.finalPrice ?? 0
  const draftLine = !pricesStand && !heldSaved && !!init?.id && init.status === 'DRAFT' && oldPrice == null && !fenceChanged && !!style && (internal || !!sv)
    ? draftPriceLine(savedPrice, adjPrice, neverSaved ? 'opened' : 'saved') : null
  const repricedLine = !draftLine && !pricesStand && !heldSaved && repriced ? `Prices changed while this quote was open. It is now ${priceText(adjPrice)} (was ${priceText(repriced.was)}).` : null
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
    ? resolveTiers(calcInput, cfg.fenceStyles, tierSet, tierPrefs, { ownCardAsSent: ownCardSent })
    : []), [tierSet, style, sections, JSON.stringify(calcInput), tierPrefs, invTick, internal, ownCardSent])  // eslint-disable-line react-hooks/exhaustive-deps
  const tiers = internal ? tiersLocal : viewTiers(sv, FENCE_STYLES)
  // The Salesman's fence in its cheapest section width for this yard (tiers.ts cheapestStyle, the same pick as the
  // Better option's "whichever prices lower"), so the main price and Better are the same fence at the same price.
  // Priced on the server (her phone has no margin to price with): it says the cheapest of her fence's widths.
  useEffect(() => {
    if (!simplePicks || !widthIds || widthIds.length < 2 || !widthIds.includes(styleId) || jobType !== 'new' || signedQuote || !sv?.cheapest) return
    const best = FENCE_STYLES.find(s => s.name === sv.cheapest && widthIds.includes(s.id))
    if (best && best.id !== styleId) setStyleId(best.id)
  }, [simplePicks, widthIds, styleId, jobType, signedQuote, sv?.cheapest])  // eslint-disable-line react-hooks/exhaustive-deps
  // Owner and office: the section width forced by hand (Advanced on the Price step), the same fence in another width.
  const widthWays = useMemo(() => (simplePicks || !style ? [] : widthSiblings(style, FENCE_STYLES)), [simplePicks, style, FENCE_STYLES])
  // A best price quote's own option is shown on the proposal as one tier's card, at the quote's price and with the
  // panels its runs took (proposalOptions.ts ownTierFold): that tier shows the same here (review Oct 27 2026: Better
  // read $8,593 all 8 ft here, $8,409 6 ft and 8 ft on the proposal). A sent proposal keeps only the fold it went out with.
  const ownTierNow = useMemo(() => {
    if (jobType !== 'new' || !style || sections <= 0) return null
    if (!internal) return sv?.ownTierKey ?? null
    if (!tiersLocal.length || !(adjPrice > 0)) return null
    return ownTierKey(tiersLocal, { ...priceOption(calcInput, style), finalPrice: adjPrice }, n => cfg.fenceStyles.find(s => s.name === n), tierSet?.tiers)
  }, [jobType, style, sections, internal, sv, tiersLocal, adjPrice, JSON.stringify(calcInput), tierSet, invTick])  // eslint-disable-line react-hooks/exhaustive-deps
  // A best price quote that came out all one width: the tier that is the same fence at the same price is the quote's card.
  const twinTier = useMemo(() => {
    if (jobType !== 'new' || !style || sections <= 0) return null
    if (!internal) return sv?.twinTierKey ?? null
    if (!tiersLocal.length || !(adjPrice > 0)) return null
    return twinTierKey(tiersLocal, { ...priceOption(calcInput, style), finalPrice: adjPrice })
  }, [jobType, style, sections, internal, sv, tiersLocal, adjPrice, JSON.stringify(calcInput), invTick])  // eslint-disable-line react-hooks/exhaustive-deps
  const foldedTier: TierKey | null = ownTierNow && (!init?.id || !proposalSent(init as Parameters<typeof proposalSent>[0]) || frozenOwnTierKey(init.proposal as Parameters<typeof frozenOwnTierKey>[0]) === ownTierNow) ? ownTierNow : null
  // The panels the quote's runs took, as the customer reads them ("6 ft and 8 ft panels"; lib/customerFenceName.ts).
  // Each option's card for staff (tiers.ts optionCard): from the server on a Salesman's phone.
  const tierCards: Record<string, OptionCard> = useMemo(() => {
    if (!internal) return sv?.tierCards ?? {}
    const w = warrantySettingsOf(cfg), out: Record<string, OptionCard> = {}
    for (const t of tiersLocal) { const c = optionCard(t, photoIds, tierSets, w, calcInput); if (c) out[t.spec.key] = c }
    return out
  }, [internal, sv, tiersLocal, photoIds, tierSets, cfg])
  const mixed = Object.keys(tierPrefs.swap).length > 0 || !!tierPrefs.added?.length
  // The card that is the quote's own fence.
  const mainCard: TierKey | null = tiers.find(t => t.style?.name === style?.name)?.spec.key ?? foldedTier ?? twinTier
  /** Another option becomes the quote's main one. A mixed quote keeps every option where it is: nothing changes for one that is not. */
  const makeMain = (t: ResolvedTier, name: string) => {
    const s = FENCE_STYLES.find(x => x.name === name)
    if (!s) return
    if (mixed || name !== t.style?.name) setTierPrefs(p => pinnedForMain(p, tiers, t.spec.key, name, tierSet?.category ?? String(style?.category ?? ''), style?.name, mainCard))
    // Priced as its card showed: the old main's margin, final price and other material's labor stay with the old main (proposal.ts pricingForMain).
    const next = pricingForMain({ costFactor: factorStr, finalPrice: finalPriceStr, laborCost: laborFlatStr, subRate: subRateStr, pricePerFoot: perFootStr }, mainKept.current, style, s, '')
    mainKept.current = next.kept
    setFactorStr(next.typed.costFactor); setFinalPriceStr(next.typed.finalPrice); setLaborFlatStr(next.typed.laborCost); setSubRateStr(next.typed.subRate); setPerFootStr(next.typed.pricePerFoot)
    setWidthIds(null)
    setStyleId(s.id)
  }
  // Each former main option's own typed pricing choices, by style name, for Make main back.
  const mainKept = useRef<Record<string, Record<MainPricingKey, string>>>({})
  const removeAdded = (key: TierKey) => setTierPrefs(p => {
    const swap = { ...p.swap }; delete swap[key]
    const added = (p.added ?? []).filter(a => a.key !== key)
    const { added: _a, ...rest } = p
    // The Most popular pick goes with it: no option stands in for it (null: none).
    return { ...rest, swap, ...(added.length ? { added } : {}), ...(p.popular === key ? { popular: null } : {}) }
  })
  const offeredNow = offeredCount(tiers, style?.name, !!foldedTier || !!twinTier, offer)
  // Every style on for quoting, by material, for "Change style" and "Add option".
  // A style already on another card is shown, and cannot be picked: the same fence twice is one card to the customer.
  const stylePicks = (card?: TierKey) => {
    const taken = new Set(tiers.filter(t => t.spec.key !== card && !t.off && t.style).map(t => t.style!.name))
    const groups = new Map<string, typeof FENCE_STYLES>()
    // A Salesman picks no section width: each fence once, in its best price width (salesmanPicks.ts oneWidthEach).
    const offered = simplePicks && sv?.oneWidth ? FENCE_STYLES.filter(s => isQuotable(s) && sv.oneWidth!.includes(s.name)) : FENCE_STYLES.filter(isQuotable)
    for (const s of offered) { const w = materialWord(s); groups.set(w, [...(groups.get(w) ?? []), s]) }
    return [...groups].map(([word, list]) => <optgroup key={word} label={word}>{list.map(s => <option key={s.id} value={s.name} disabled={taken.has(s.name)}>{s.label || s.name}{taken.has(s.name) ? ' (already an option)' : ''}</option>)}</optgroup>)
  }
  const ownPanelsLabel = style ? customerFenceName(optionLabel(style.name), effRuns.map((r, i) => ({ r, i })).filter(x => x.r.ft > 0).map(x => calc.perRunRail[x.i])) : ''
  // Compare options: the same yard as the styles that make sense for this one.
  const compareRowsLocal = useMemo(() => (internal && showCompare && style && sections > 0
    ? (() => {
      const all = compareStyles(style, FENCE_STYLES)
      // A Salesman compares fences, not section widths: each other fence once, in its best price width.
      const keep = simplePicks ? new Set(oneWidthEach(FENCE_STYLES.filter(isQuotable), ways => cheapestStyle(calcInput, ways)).map(s => s.name)) : null
      return all.filter((s, i) => i === 0 || !keep || keep.has(s.name)).map(s => ({ style: s, option: priceOption(calcInput, s) }))
    })()
    : []), [showCompare, style, sections, JSON.stringify(calcInput), invTick, internal, simplePicks])  // eslint-disable-line react-hooks/exhaustive-deps
  const compareRows = internal ? compareRowsLocal : viewCompare(sv, FENCE_STYLES) as typeof compareRowsLocal
  // Parts whose Inventory price is old or was never confirmed: a warning, never a block.
  const staleMonths = cfg.pricing.priceStaleMonths ?? DEFAULT_PRICE_STALE_MONTHS
  // Parts still priced from another part (a green part at Black's price, Oct 27 2026): their own warning, so they leave this list.
  const fromBlackParts = useMemo(() => (internal && style
    ? borrowedPartsOnQuote(materialItems.filter(i => i.qty > 0 && i.costSource !== 'jobLot' && i.costSource !== 'wood').map(i => i.item), getInventory(), normalizeItemName)
    : []), [style, materialItems, invTick])  // eslint-disable-line react-hooks/exhaustive-deps
  const staleParts = useMemo(() => (internal && style
    // Parts a job lot piece price covers are not priced from Inventory, so their Inventory date does not matter.
    ? stalePartsOnQuote(materialItems.filter(i => i.qty > 0 && i.costSource !== 'jobLot' && i.costSource !== 'wood').map(i => i.item), getInventory(), businessDate(new Date()), staleMonths, normalizeItemName)
      .filter(p => !fromBlackParts.some(b => b.item.id === p.item.id))
    : []), [style, materialItems, invTick, staleMonths, fromBlackParts])  // eslint-disable-line react-hooks/exhaustive-deps
  // A color priced by the piece: whose job lot quote, from when, and whether that quote is old.
  const jobLot = style?.jobLot
  const jobLotOld = !!jobLot && !jobLot.kit && !jobLot.tall && !!jobLot.quotedOn && jobLot.quotedOn <= staleCutoff(businessDate(new Date()), staleMonths)
  // A hand picked old posts' method that differs from the style: said here too, not only on the Style step.
  const oldPostsWarning = oldPostsCheck(jobType, moveOldPosts, repairOldPosts, repairIn.items)
  const quoteWarnings = [...(oldPostsWarning ? [oldPostsWarning] : []), ...(jobType === 'new' && style && !tiers.some(t => t.style?.name === style.name) ? gateWarnings(style, calcInput.gateWidths, calcInput.walkGates, calcInput.dblGates) : []), ...(work ? [
    ...(style && jobType === 'move' ? tapeChecks(namedRuns, runWidths) : []),
    ...(fromLayout && jobType === 'move' ? gateChecks(yard) : []),
    ...work.warnings,
    ...(matchWarning ? [matchWarning] : []),
    ...(work.needs811 ? ['New posts go in the ground: an 811 locate ticket is needed before digging. It goes on the crew packet.'] : []),
    ...[seesMargin && work.costCents > 0 && !work.minimumApplied ? marginCheck(viewGmPct, cfg.margins?.good ?? 0.34, adjPrice) : null].filter((x): x is string => !!x),
  ] : [
    ...(style ? tapeChecks(namedRuns, runWidths) : []),
    ...(fromLayout ? gateChecks(yard) : []),
    // Pricing notes only once a style is picked (before that there is nothing to price).
    ...(style ? materials.warnings : []),
    ...(style ? priced.notes : []),
    ...[seesMargin && style && sections > 0 ? marginCheck(viewGmPct, cfg.margins?.good ?? 0.34, adjPrice) : null,
        style && sections > 0 ? perFootCheck(priced.pricePerFoot, style.name, pastQuotes, quoteIdRef.current) : null].filter((x): x is string => !!x),
  ])]

  function addRun() { setRuns(r => [...r, { ft: '', rail: 'auto' }]) }
  function removeRun(i: number) { setRuns(r => r.filter((_, idx) => idx !== i)) }
  function updateRun(i: number, val: string) {
    setRuns(r => r.map((run, idx) => idx === i ? { ...run, ft: val } : run))
  }
  function updateRunRail(i: number, rail: 'auto' | '6ft' | '8ft') {
    setRuns(r => r.map((run, idx) => idx === i ? { ...run, rail } : run))
  }

  const categories = [...new Set(FENCE_STYLES.map(s => s.category))]
  // Paid per a unit Settings has no rate for, and no rate typed (Oct 30 2026): never priced at the other unit's rate.
  // A quote whose prices stand (sent, shared, signed, held) keeps them and is not priced here.
  const subRateMissing = !pricesStand && !heldSaved ? subUnitRateMissing(pricingOverrides, cfg.pricing, style) : null
  // A discount or a price typed by hand that would put a price under the minimum job price (Jonathan, Nov 2 2026): every login
  // but the owner is stopped here, and the owner saves it only with the box ticked (the server holds to the same: portal
  // lib/discountMinimum.ts). Asked only when the quote takes something off; a signed or held quote keeps its saved prices.
  const minimumCents = jobMinimumCents(cfg, jobType !== 'new')
  const takesOff = adjWantedCents < 0 || numOrUndef(finalPriceStr) !== undefined
  const underMinimum = takesOff && !signedQuote && !heldSaved && !!style ? newlyUnderMinimum({ fenceStyle: style.name, finalPrice: adjPrice, proposal: { options: optionsNow() } }, init?.id ? init : null, minimumCents) : []
  const mayGoUnder = can('quotes.underMinimum')
  const underKey = JSON.stringify(underMinimum)
  const [overrideFor, setOverrideFor] = useState<string | null>(null)
  const minimumOverride = underMinimum.length > 0 && mayGoUnder && overrideFor === underKey
  const minimumHeld = underMinimum.length > 0 && !minimumOverride
  const canSave = !minimumHeld && !subRateMissing && !heldChanged && !!styleId && (internal || heldSaved || (!!sv && !svPricing && !svError)) && (jobType === 'new' ? sections > 0
    : jobType === 'move' ? moveIn.oldFt > 0 && !!work && work.sections > 0
    : REPAIR_ITEMS.some(k => (chargedRepairItems(repairIn)[k] ?? 0) > 0))

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
  // Section width is never the Salesman's choice (Nov 2 2026): no width per run, no optimizer details.
  const showOptimizer = optSettings.enabled && optSettings.showDetailsInBuilder && !!calc.optimizer && !simplePicks
  const optimizerResult = calc.optimizer

  /** The proposal's prices as a save would write them, the quote's own included. */
  function proposalNow() {
    return buildProposal({
      input: calcInput, styles: internal ? [style!, ...FENCE_STYLES.filter(s => offer.includes(s.name) && s.name !== style!.name)] : [], ownPrice: adjPrice,
      company: { name: '', phone: '', email: '' }, customer: { name: '', address: '' }, warranty: '', settings: {}, photoIds: {},
      tiers: internal ? tierOptions(tiers, {}, tierSets) : viewProposalOptions(sv),
    })
  }
  /** The options a save would write: a move as is beside the move, or every option of a new fence. */
  function optionsNow(): MinimumOption[] {
    if (jobType === 'new') return proposalNow().options
    return moveAsIs && offerMoveAsIs ? [{ fenceStyle: style!.name, label: `Move as is: ${Math.round(moveIn.oldFt)} ft of your fence on the new line`, finalPrice: moveAsIs.priceCents / 100 }] : []
  }

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
  }, opts: { pricesChecked?: boolean; commissionOff?: boolean } = {}) {
    // The switch shows commission on: what a save would do is asked first, so nothing changes silently. No signal: it is saved
    // as shown and the server holds to the rule when it arrives.
    if (hasSalesman && !opts.commissionOff && showCommission && !signedQuote && !directCo.current) {
      const r = await sendJson('POST', '/api/saved-quotes/commission-rule', { ...(init?.id ? { quoteId: init.id } : {}), rep: data.salesRep || mySalesRepName() })
      if (r.result.ok && r.json?.data?.off) {
        setShowSaveModal(false)
        keepSaveWindow(data)
        setCommissionAsk({ data, rep: String(r.json.data.rep ?? '') })
        return
      }
    }
    // Before a quote priced here is saved, its prices are the server's current ones (broken list #58): a part that
    // changed is read again, the quote reprices, and a changed price is shown and confirmed first (never saved
    // silently at old prices). No signal: it is saved, and the server checks it when it arrives.
    if (internal && !pricesStand && !heldSaved && !opts.pricesChecked && !directCo.current) {
      const was = repriced?.was ?? adjPrice
      const styleName = style ? optionLabel(style.name) : ''
      const check = await checkPricing()
      if (check.changed.length || repriced) {
        setShowSaveModal(false)
        keepSaveWindow(data)
        setRecheck({ data, was, styleName, asked: false })
        return
      }
    }
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
          const o = priceOption({ ...calcInput, runs: repairCheck.runsFt.map(ft => ({ ft, rail: 'auto' as const })), tearOutSections: 0, tearOutGates: 0, overrides: withoutAdjustment(calcInput.overrides) }, style)
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
    // Commission as the switch shows it, unless "Save without commission" was chosen above.
    const commissionOn = hasSalesman && !opts.commissionOff
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
      layout: { yard: fromLayout ? yard : null, runSections: calc.perRunSections.filter((_, i) => effRuns[i].ft > 0), ...(effTeeLines ? { teeLinePosts: effTeeLines } : {}), ...(keptTypedWidths ? { gateWidths: keptTypedWidths } : {}) },
      corners: effCorners,
      ends: effEnds,
      walkGates: effWalk,
      dblGates: effDbl,
      tearOutSections: tearOutSec,
      tearOutGates,
      adjLaborHrs: parseFloat(adjLaborHrs) || 0,
      hasSalesman: commissionOn,
      priceAdjust,
      sections: work ? work.sections : sections,
      materialCost,
      laborCost,
      tearOutCost,
      totalCOGS,
      finalPrice: adjPrice,
      gmPct: commissionOn ? gmPct : viewGmPct,
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
      // The options this save is built on: if another save changed them meanwhile, it is refused (Nov 2 2026).
      ...(init?.id && init.proposal ? { proposalBase: proposalStamp(init.proposal) } : {}),
      // Priced here: the copy of the price data it was priced with (the server refuses an older one).
      ...(pricingStampNow ? { pricingStamp: pricingStampNow } : {}),
      // Draft picked on a sent or lost quote: said, or the server keeps it as it is.
      ...(data.status === 'DRAFT' && init?.status && init.status !== 'DRAFT' ? { backToDraft: true } : {}),
      ...(minimumOverride ? { minimumOverride: true } : {}),
      proposal: workProposal ?? (style ? buildProposal({
        input: calcInput,
        // A Salesman or Installer: every option comes priced from the server.
        styles: internal ? [style, ...FENCE_STYLES.filter(s => offer.includes(s.name) && s.name !== style.name)] : [],
        ownPrice: adjPrice,
        ownGmPct: commissionOn ? gmPct : viewGmPct,
        ownRoundingCents: roundingCents,
        ownAdjustmentCents: adjApplied,
        showDiscount: showDiscount && adjApplied < 0,
        wholeDollar: !keepCents,
        company: { name: cfg.company?.name || 'Getter Done Fence', phone: cfg.company?.phone || '', email: cfg.company?.email || '' },
        customer: { name: data.customerName, address: data.customerAddress },
        planSvg: fromLayout && yard ? renderToStaticMarkup(<SitePlan layout={yard} result={layoutResult!} runSections={calc.perRunSections} widthFt={widthFt} aerial={photo} noSections={tiers.some(t => (t.added || t.ownWords) && !t.off && !!t.option && t.option.sections !== sections)} />) : undefined,
        warranty: getContractSections().find(x => x.key === 'warranty' && x.visible !== false)?.body ?? '',
        settings: cfg.proposal ?? {},
        photoIds,
        tiers: internal ? tierOptions(tiers, photoIds, tierSets) : viewProposalOptions(sv),
        tierPrefs: {
          off: tierPrefs.off, swap: tierPrefs.swap as Record<string, string>,
          ...(tierPrefs.added?.length ? { added: tierPrefs.added } : {}),
          ...(tierPrefs.popular !== undefined ? { popular: tierPrefs.popular } : {}),
          ...(tierPrefs.pin ? { pin: tierPrefs.pin } : {}),
        },
        tierSet: tierSet ?? undefined,
      }) : undefined),
    }
    if (hasSalesman && !commissionOn) Object.assign(quote, clearedCommission(quote.work, quote.proposal))
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
    // A style held now for missing costs: the saved quote with only its words changed, at its saved price (heldSaved).
    if (init?.id && heldSaved) {
      const kept = heldQuoteSave(init, quote, heldChanged)
      if (kept) onSave(kept)
      return
    }
    // A sent or shared proposal never reprices unless the office chooses it (Jonathan's rule): a save that would change
    // any price or fence the customer reads (a tier at today's costs, not only the quote's own price) asks first.
    // The server keeps the sent prices on any save that did not choose new ones (routes/saved-quotes.ts).
    const shared = !!init?.id && !signedQuote && (proposalSent(init as Parameters<typeof proposalSent>[0]) || !!init.shareToken)
    if (shared) {
      const styleOfCfg = (n: string) => cfg.fenceStyles.find(s => s.name === n)
      const next = quote.proposal as Parameters<typeof ownTierToStamp>[0] | undefined
      const changes = init!.proposal && next
        ? proposalPriceChanges(init!.proposal as Parameters<typeof proposalPriceChanges>[0], init as Parameters<typeof proposalPriceChanges>[1],
          { ...next, ownTier: ownTierToStamp(next, quote, init!.proposal as Parameters<typeof ownTierToStamp>[2], proposalSent(init as Parameters<typeof proposalSent>[0]), styleOfCfg) } as Parameters<typeof proposalPriceChanges>[2],
          { ...init, ...quote } as Parameters<typeof proposalPriceChanges>[3], styleOfCfg)
        : []
      if (sentPricesChanged || changes.length) { setPending({ quote, kind: 'sent', changes }); return }
    }
    onSave(quote)
  }

  // A save held back because the prices changed: priced again with the new data, then saved as it is (same price),
  // or shown with the new price to confirm, or stopped (the fence is no longer available for quoting).
  const [recheck, setRecheck] = useState<{ data: Parameters<typeof handleSave>[0] | null; was: number; styleName: string; asked: boolean } | null>(null)
  const recheckOutcome = recheck ? repriceOutcome(recheck.was, adjPrice, {
    name: recheck.styleName, available: !!style && isQuotable(style) || (!!style && style.name === init?.fenceStyle),
    why: offReason(style ?? cfg.fenceStyles.find(x => x.id === styleId) ?? null),
  }) : null
  useEffect(() => {
    if (!recheck || recheck.asked || !recheckOutcome) return
    if (recheckOutcome.kind === 'save') {
      const d = recheck.data
      setRecheck(null); setRepricedFrom(null)
      if (d) void handleSave(d, { pricesChecked: true }); else setShowSaveModal(true)
      return
    }
    setRecheck({ ...recheck, asked: true })
  }, [recheck, recheckOutcome?.kind])  // eslint-disable-line react-hooks/exhaustive-deps
  function saveRepriced() {
    if (!recheck) return
    const d = recheck.data
    setRecheck(null); setRepricedFrom(null)
    // Checked before the Save window: it opens now, at the new price (no customer is made before this).
    if (d) void handleSave(d, { pricesChecked: true }); else setShowSaveModal(true)
  }
  // What the Save window had when its save was held back for new prices: it opens with them again (the customer
  // just made stays picked: #58 review, "Create new customer instead" made a second one).
  const [saveWindowKept, setSaveWindowKept] = useState<{ status: SavedQuote['status']; notes: string } | null>(null)
  function keepSaveWindow(d: Parameters<typeof handleSave>[0]) {
    if (d.customerId && !init?.customerId) setPickedCustomerId(d.customerId)
    setSaveWindowKept({ status: d.status, notes: d.notes })
  }
  /** Save / Update quote: prices are checked before the Save window opens (nothing, a new customer included, is made first). */
  const [checkingPrices, setCheckingPrices] = useState(false)
  /**
   * What the server would refuse, said here, before anything says the quote is stored: options someone else changed
   * since this opened, styles brought past the limit (the server's own count, on the server's copy), a picked style not
   * fit to go on a link already out. With more than 3 options and no answer from the server, the outcome is not known: not saved.
   */
  async function saveWouldBeRefused(): Promise<boolean> {
    const opened = init?.proposal ? proposalStamp(init.proposal) : null
    let saved: SavedQuote | undefined
    let reached = true
    if (init?.id && !signedQuote) {
      const r = await sendJson('GET', `/api/saved-quotes/${encodeURIComponent(init.id)}`).catch(() => null)
      reached = !!r?.result.ok
      saved = reached ? (r!.json?.data as SavedQuote | undefined) : undefined
      if (opened !== null && saved?.proposal && proposalStamp(saved.proposal) !== opened) { toast.error('Not saved', 'This quote was changed on another phone or computer while you had it open. Close it and open it again to see the changes.'); return true }
    }
    if (jobType !== 'new' || signedQuote || !style) return false
    const after = proposalNow()
    const was = saved ?? init
    const shown = addsPastLimit(after, was?.proposal ?? null, { ...(was ?? {}), fenceStyle: style.name }, n => cfg.fenceStyles.find(s => s.name === n))
    if (shown !== null) { toast.error('Not saved', `A proposal has ${MAX_TIERS} options at most, and this one would have ${shown}. Take one off, then save again.`); return true }
    if (!reached && after.options.length > MAX_TIERS) { toast.error('Not saved', 'This proposal has more than 3 options and the app could not reach the server to check it. Try again when you have signal.'); return true }
    // A link is out: the server's own check, on the options as it will stamp them (warranties.ts, proposal.ts optionBlocks).
    if (was?.shareToken) {
      const frozen = was.status !== 'DRAFT'
      const blocked = optionBlocks(stampWarranties(after, warrantySettingsOf(cfg), n => cfg.fenceStyles.find(s => s.name === n), was.proposal ?? null, frozen))
      if (blocked.length) { toast.error('Not saved', `This proposal is on the customer's link, so this cannot be saved yet. ${blocked.join(' ')}`); return true }
    }
    return false
  }

  async function openSave() {
    // Order on Save: is it still hers (a Salesman's saved quote the owner may have moved), then the prices, then the
    // Save window. Moved: the app says so once and closes the builder; nothing opens and nothing is made.
    if (!(await stillMineNow())) { setShowSaveModal(false); return }
    // What the server would refuse is said here, before anything says the quote is stored.
    if (await saveWouldBeRefused()) return
    // A held saved quote keeps its saved price (heldQuote.ts): no reprice to check.
    if (!internal || pricesStand || heldSaved) { setShowSaveModal(true); return }
    const was = repriced?.was ?? adjPrice
    const styleName = style ? optionLabel(style.name) : ''
    setCheckingPrices(true)
    const check = await checkPricing().finally(() => setCheckingPrices(false))
    if (check.changed.length || repriced) { setRecheck({ data: null, was, styleName, asked: false }); return }
    setShowSaveModal(true)
  }
  // The data a sent-back save is made again with: the quote's own customer and details.
  const dataOfInit = (): Parameters<typeof handleSave>[0] | null => init ? {
    customerId: init.customerId ?? '', customerName: init.customerName, customerPhone: init.customerPhone, customerEmail: init.customerEmail,
    customerAddress: init.customerAddress, leadSource: init.leadSource, salesRep: init.salesRep, status: init.status, notes: init.notes ?? '', leadTemp: init.leadTemp ?? 0,
  } : null
  // Opened because the server sent the save back for new prices (the app read the prices again first): repriced
  // now, then saved as it is (same price) or shown to confirm.
  useEffect(() => {
    if (!repriceOnOpen || !init || !internal) return
    const t = setTimeout(() => setRecheck({ data: dataOfInit(), was: init.finalPrice ?? 0, styleName: style ? optionLabel(style.name) : optionLabel(init.fenceStyle), asked: false }), 500)
    return () => clearTimeout(t)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  // Sent back while this builder is still open on it: the prices are read again and it asks here.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { id?: string } | undefined
      if (!d?.id || d.id !== quoteIdRef.current || !internal) return
      e.preventDefault()
      const was = priceNowRef.current
      const styleName = style ? optionLabel(style.name) : ''
      void checkPricing().then(() => setRecheck({ data: dataOfInit(), was, styleName, asked: false }))
    }
    window.addEventListener(QUOTE_REPRICE_EVENT, on)
    return () => window.removeEventListener(QUOTE_REPRICE_EVENT, on)
  })

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

  // A move or repair with an earlier change order whose work was not kept: said on screen (changeOrderPricing.ts noWorkNote).
  const coNoWorkNote = signedQuote && init?.id && jobType !== 'new' ? noWorkNote(getOrdersForQuote(init.id)) : null

  /** The change order, filled in from what was changed here, priced at today's costs. */
  function startChangeOrder(changedQuote?: SavedQuote) {
    const q = changedQuote ?? pending?.quote
    if (!init || !q) return
    // The one price difference line: a change order's price of the new version. Today that is a move, here (a Salesman sees costs: step lines).
    const priceNow = !internal ? sv?.changePrice ?? adjPrice
      : jobType === 'move' && changeBase && workCommon ? changeOrderPrice(calcInput, changeBase, { common: workCommon, inputs: moveIn, line: newLine })
        : adjPrice
    const draft = changeOrderDraft({
      signed: init, current: calcInput, signedOverrides: openOverrides.current, styles: FENCE_STYLES,
      now: changeNow, priceNow, sectionsNow: work ? work.sections : sections, simple: !internal || jobType !== 'new',
      workWords: jobType === 'repair' ? repairChangeWords(init.work?.repair, repairIn) : jobType === 'move' ? moveChangeWords(moveOpened, moveIn) : [],
      earlier: { orders: getOrdersForQuote(init.id) as never, states: foldedStates(init), sold: signedQuoteOf(init) },
      gatesIn: gatesPutIn((init.layout as { yard?: YardLayout | null } | undefined)?.yard ?? null, entry === 'layout' ? yard : null),
      // Its own change side by side ("Left side 40 ft → 50 ft"), never the whole fence before and after (round 3 recheck).
      sides: entry === 'layout' && yard && (init.layout as { yard?: YardLayout | null } | undefined)?.yard
        ? sideChangeWords(sideChanges(shapeOf({ yard: (init.layout as { yard?: YardLayout | null }).yard }), shapeOf({ yard })))
        : null,
    })
    // The new work goes with it (the server prices it and keeps it, so the pull sheet, packet, site plan, crew days
    // and job costing follow once it is approved), and the next change order opens on it. A move or repair too, its
    // inputs in the request: else that one is priced against a contract holding work it never opens on.
    setCoPrefill(style ? { ...draft, note: coNoWorkNote, work: { request: { ...priceRequest, changeBase: undefined } as unknown as Record<string, unknown>, layout: q.layout ?? null, planSvg: q.proposal?.planSvg ?? null } } : draft)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start md:items-center justify-center overflow-y-auto md:overflow-hidden md:p-4" data-quote-builder>
      {/* On a computer or tablet: a window about 92% of the screen tall. Its content scrolls inside it; the bar is its footer. */}
      <div className="bg-white md:rounded-2xl shadow-2xl w-full max-w-6xl min-h-full md:min-h-0 pb-24 md:pb-0 md:h-[92vh] md:flex md:flex-col md:overflow-hidden md:border md:border-gray-300" data-quote-window>

        <div className="flex items-center justify-between gap-3 px-4 md:px-8 py-3 md:py-4 border-b border-gray-200 sticky top-0 md:static md:shrink-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{init?.id ? 'Edit quote' : 'New quote'}</h2>
            <p className="text-sm text-gray-500 mt-0.5 hidden md:block">Quote builder</p>
            {signedQuote && <p className="text-xs font-semibold text-amber-800 mt-0.5" data-quote-locked-banner>{changeOrder ? `Change order: change the ${jobType === 'repair' ? 'repair list' : entry === 'layout' ? 'drawing' : 'run list'}, then tap Make change order.` : 'Signed: the price is locked. Changes to the fence go on a change order.'}</p>}
            {/* Another change order still open is in this drawing and its price: said, not only in a passing toast (round 3 recheck). */}
            {signedQuote && changeOrder && openChangesNote(init) && <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 mt-1 max-w-xl" data-co-open-in-drawing>{openChangesNote(init)}</p>}
            {coNoWorkNote && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1 max-w-xl" data-co-no-work-note>{coNoWorkNote}</p>}
            {signedQuote && changeOrder && init?.id && <button type="button" onClick={() => setTypeInstead(true)} className="text-sm text-orange-700 font-semibold underline min-h-[44px]" data-co-type-instead>Type the change instead</button>}
            {signedQuote && init?.id && <SignedDocumentLinks quoteId={init.id} />}
            {sentQuote && sentPricesChanged && <p className="text-xs font-semibold text-amber-800 mt-0.5" data-quote-sent-changed-banner>Prices changed since this was sent ({priceText(init!.finalPrice)} then, {priceText(adjPrice)} now).</p>}
            {(draftLine || repricedLine) && <p className="text-xs font-semibold text-amber-800 mt-0.5" data-quote-price-changed-banner>{draftLine || repricedLine}</p>}
          </div>
          <div className="flex items-center gap-3">
            {shownItems.length > 0 && (
              <button onClick={() => { if (step !== 'price') { setShowPullSheet(true); goStep('price') } else setShowPullSheet(p => !p) }} className="text-sm text-orange-500 border border-orange-300 rounded-lg px-3 py-1.5 hover:bg-orange-50">
                <span className="hidden sm:inline">{showPullSheet && step === 'price' ? 'Hide Pull Sheet' : 'Show Pull Sheet'} ({shownItems.length} items)</span>
                <span className="sm:hidden">Pull sheet ({shownItems.length})</span>
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
        <div className={`px-4 md:px-8 py-5 md:py-6 ${signedQuote || underMinimum.length ? 'pb-60' : 'pb-44'} md:pb-8 mx-auto w-full ${step === 'yard' && entry === 'layout' && yard ? 'max-w-3xl lg:max-w-none' : 'max-w-3xl'}`}>
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
                onChange={e => { setCustomerName(e.target.value); setPickedCustomerId(null) }}
                data-quote-customer-name
              />
              {pickedCustomer ? (
                <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2" data-quote-customer-picked={pickedCustomer.id}>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Quote for this customer on file</p>
                    <p className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{`${pickedCustomer.firstName} ${pickedCustomer.lastName}`.trim()}</p>
                    <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">{[formatPhone(pickedCustomer.phone), pickedCustomer.serviceAddress].filter(Boolean).join(' · ')}</p>
                  </div>
                  <button type="button" onClick={() => setPickedCustomerId(null)} className="btn btn-quiet btn-sm shrink-0 min-h-[44px]" data-quote-customer-unpick>Not them</button>
                </div>
              ) : nameMatches.length > 0 && (
                <div className="mt-2" data-quote-customer-matches>
                  <p className="text-xs text-gray-500 mb-1">Already a customer? Tap them so this quote goes on their record.</p>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                    {nameMatches.slice(0, 3).map(c => (
                      <button key={c.id} type="button" data-quote-customer-option={c.id}
                        onClick={() => { setPickedCustomerId(c.id); setCustomerName(`${c.firstName} ${c.lastName}`.trim()) }}
                        className="w-full min-h-[48px] text-left px-3 py-2 hover:bg-orange-50 active:bg-orange-100">
                        <span className="block text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{`${c.firstName} ${c.lastName}`.trim()}</span>
                        <span className="block text-xs text-gray-500 [overflow-wrap:anywhere]">{[formatPhone(c.phone), c.serviceAddress].filter(Boolean).join(' · ') || 'No phone or address on file'}</span>
                      </button>
                    ))}
                  </div>
                  {/* Three rows stay above a phone's keyboard; past that, a narrower name finds them. */}
                  {nameMatches.length > 3 && <p className="text-xs text-gray-500 mt-1" data-quote-customer-more>More on file. Keep typing (last name, phone or email) to narrow it.</p>}
                </div>
              )}
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
                  changeOrder={signedQuote && changeOrder}
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
                      {isAutoMix && optSettings.allowOverrides && !simplePicks && (
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
                              title={opt === 'auto' ? 'Best price picks' : `Force ${opt === '6ft' ? '6' : '8'} ft sections`}
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
              {/* Each gate's width: kept from the drawing, or picked here (chain link gate leaves go by width). */}
              {walkGates + dblGates > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3" data-typed-gate-widths>
                  {(['walk', 'dbl'] as const).flatMap(kind => typedWidths[kind].map((w, i) => {
                    const choices = kind === 'walk' ? [4, 5, 6] : [8, 10, 12]
                    const opts = choices.some(c => Math.abs(c - w) < 0.05) ? choices : [...choices, w].sort((x, y) => x - y)
                    const label = `${kind === 'walk' ? 'Walk gate' : 'Double gate'}${typedWidths[kind].length > 1 ? ` ${i + 1}` : ''} width`
                    return (
                      <div key={`${kind}${i}`}>
                        <label className="text-xs text-gray-400 mb-1 block" htmlFor={`gate-w-${kind}-${i}`}>{label}</label>
                        <select id={`gate-w-${kind}-${i}`} data-gate-width-typed={`${kind}-${i}`}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                          value={String(opts.find(c => Math.abs(c - w) < 0.05) ?? w)}
                          onChange={e => {
                            const v = Number(e.target.value)
                            setTypedGateWidths(prev => {
                              const cur = fitGateWidths(prev, walkGates, dblGates)
                              return { ...cur, [kind]: cur[kind].map((x, j) => (j === i ? v : x)) }
                            })
                          }}>
                          {opts.map(c => <option key={c} value={String(c)}>{formatFtIn(c * 12)}</option>)}
                        </select>
                      </div>
                    )
                  }))}
                  <p className="col-span-2 text-xs text-gray-500">
                    {yard ? 'Widths as drawn unless changed here. ' : ''}A gate added here starts at {TYPED_WALK_GATE_FT} ft (walk) or {TYPED_DBL_GATE_FT} ft (double).
                  </p>
                </div>
              )}
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
                            {r.railType === '8ft' ? '8' : '6'} ft wide
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
            {/* A signed job stays what it was sold as: a flip to Repair made a -$8,239 change order (the server refuses it too). */}
            {signedQuote
              ? <p className="text-sm text-gray-700" data-job-type-locked>Job type: <b>{jobType === 'move' ? 'Fence move' : jobType === 'repair' ? 'Repair' : 'New fence'}</b>. A signed job stays what it was sold as.</p>
              : <JobTypePicker value={jobType} onChange={setJobType} />}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 mb-3">{jobType === 'new' ? 'Fence' : 'The fence (its style)'}</h3>
              {simplePicks
                ? <StyleChoices styles={PICKER_STYLES} catalog={catalog} value={styleId} onChange={setStyleId} isOk={pickable}
                    simple={{ installFor: category => betterInstall(tierSetFor(tierSets, { category })) }} onWidths={setWidthIds} />
                : <StyleChoices styles={PICKER_STYLES} catalog={catalog} value={styleId} onChange={id => { setWidthIds(null); setStyleId(id) }} isOk={pickable} />}
              {!simplePicks && <>
              <p className="text-xs font-semibold text-gray-500 mt-4 mb-2">Or pick from the list</p>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={styleId}
                onChange={e => { setWidthIds(null); setStyleId(e.target.value) }}
                data-style-list
              >
                <option value="">Select a fence style...</option>
                {/* Best price styles first: the optimizer picks 6 or 8 ft sections per run. */}
                {(() => {
                  const autoStyles = FENCE_STYLES.filter(s => (s as any).autoRailMix)
                  return autoStyles.length > 0 ? (
                    <optgroup label="Vinyl Privacy, 6 ft or 8 ft sections (best price)">
                      {autoStyles.map(s => (
                        <option key={s.id} value={s.id}>{styleOptionLabel(s)}</option>
                      ))}
                    </optgroup>
                  ) : null
                })()}
                {categories.map(cat => {
                  const styles = FENCE_STYLES.filter(s => s.category === cat && !(s as any).autoRailMix)
                  if (styles.length === 0) return null
                  const label = cat === 'Vinyl' ? 'Vinyl, one section width' : cat
                  return (
                    <optgroup key={cat} label={label}>
                      {styles.map(s => (
                        <option key={s.id} value={s.id}>{styleOptionLabel(s)}</option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
              </>}
              {heldSaved && !signedQuote && (
                <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-style-held-saved>
                  {heldNote(style!.label || style!.name, style!.held!, fmt(init!.finalPrice), canPrice)}
                </p>
              )}
              {style && !isQuotable(style) && !heldSaved && (
                <p className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-style-not-quotable>
                  {style.label || style.name} is not available for new quotes ({style.isActive === false ? 'turned off' : style.held ? style.held : 'pricing on hold'} in Settings → Fence Styles). This quote keeps it and still prices.
                </p>
              )}
              {sections > 0 && <div className="mt-3"><FromBlackWarning parts={fromBlackParts} where="style" /></div>}
            </div>

            {jobType === 'move' && (
              <MovePanel style={style} move={moveIn} setMove={setMove} oldPostsNote={moveOldPosts.note}
                defaultPostType={stylePostType}defaultDamagePct={style ? damagePctFor(mr, style.name) : mr.damagePctDefault}
                newLine={{ walkGates: effWalk, dblGates: effDbl, footage: totalFootage, sections: work?.sections ?? 0 }}
                yard={fromLayout ? yard : null} layoutResult={layoutResult} runSections={calc.perRunSections} widthFt={widthFt} />
            )}
            {jobType === 'repair' && (
              <RepairPanel style={style} repair={repairIn} setRepair={setRepair} oldPostsNote={repairOldPosts.note} postRates={internal ? mr : null}
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
                    <input type="number" min={0} step="0.25" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder={subUnitNow !== (cfg.pricing.subUnit ?? 'foot') ? `Rate per ${subUnitNow}` : defaultSubRate > 0 ? `${defaultSubRate} from Settings` : 'No rate set'} value={subRateStr} onChange={e => setSubRateStr(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Paid per</label>
                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={subUnitNow} onChange={e => { setSubUnit(e.target.value as SubUnit); setSubUnitPicked(true) }}>
                      <option value="foot">Foot</option>
                      <option value="section">Section</option>
                    </select>
                  </div>
                  {subRateMissing && <p className="col-span-2 text-sm font-medium text-red-700" role="alert" data-sub-rate-missing>{subRateMissing}</p>}
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
                {showCommission && <p className="text-xs text-gray-400" data-salesman-commission-words>
                  {repOff ? `No commission: ${repOff.rep || 'no rep, and this quote was not made by a Salesman'}${repOff.rep ? ' is not a Salesman' : ''}` : <>{commissionPctLabel} commission, {priced.commissionMode === 'added' ? 'added on top of the price' : 'taken out of the price'}. Only with a Salesman as the rep.</>}
                </p>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hasSalesman}
                aria-label="Salesman on this job"
                disabled={!!repOff && !hasSalesman}
                onClick={() => setHasSalesman(h => !h)}
                className={`shrink-0 w-14 h-12 grid place-items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 ${repOff && !hasSalesman ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={`relative block w-11 h-6 rounded-full transition-colors ${hasSalesman ? 'bg-orange-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${hasSalesman ? 'translate-x-5' : 'translate-x-0'}`} />
                </span>
              </button>
            </div>
          </div>

          <div className={step === 'price' ? 'space-y-3' : 'hidden'} data-step-panel="price">
              {droppedStyle && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2" data-style-off>
                  <p className="text-sm font-semibold text-amber-900" data-style-off-line>{droppedStyle}</p>
                  <button type="button" className="btn btn-primary min-h-[48px] w-full" onClick={() => goStep('style')} data-style-off-pick>Pick another fence</button>
                </div>
              )}
              <div className="bg-gray-900 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">{customerPrice != null ? (signedQuote ? "The customer's price (as signed)" : heldSaved ? 'The saved price (kept: our costs for this fence are missing)' : "The customer's price (as sent)") : priced.priceMethod === 'manual' ? 'Price (set by hand)' : priceAdjust !== 0 || adjApplied !== 0 ? 'Adjusted price' : 'Price'}</p>
                <p className="text-white text-3xl font-bold" data-quote-price>{fmt(shownPrice)}</p>
                {todayDiffers && <p className="text-gray-300 text-xs mt-1" data-price-today>At today's costs it would be {fmt(adjPrice)}.</p>}
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
                {heldNums ? (heldNums.perFoot != null && <p className="text-gray-400 text-xs mt-1" data-held-per-foot>{fmt(heldNums.perFoot)} per foot (saved)</p>)
                  : !work && totalFootage > 0 && <p className="text-gray-400 text-xs mt-1">{fmt(priced.pricePerFoot)} per foot</p>}
                {!heldSaved && showCommission && commAmt > 0 && <p className="text-gray-400 text-xs mt-1" data-commission>Commission: {fmt(commAmt)}</p>}
                {!heldSaved && compare && !work && !simplePicks && (
                  <p className="text-gray-300 text-xs mt-2 pt-2 border-t border-gray-700" data-width-compare>
                    Same job at 6 ft wide: {fmt(compare.at6)}  |  at 8 ft wide: {fmt(compare.at8)}
                  </p>
                )}
              </div>

              {widthWays.length > 1 && jobType === 'new' && !signedQuote && !heldSaved && (
                <details className="bg-white rounded-xl border border-gray-200 px-4" data-advanced-width>
                  <summary className="text-sm font-semibold text-gray-700 min-h-[48px] flex items-center">Advanced: section width</summary>
                  <label className="block pb-4">
                    <span className="block text-xs text-gray-600 mb-1">6 ft or 8 ft sections (best price) takes the width that prices lower for each run. Pick one width to force it on this quote.</span>
                    <select className="w-full border border-gray-300 rounded-lg px-2 h-11 text-sm bg-white" value={styleId} aria-label="Section width"
                      onChange={e => { setWidthIds(null); setStyleId(e.target.value) }} data-advanced-width-pick>
                      {widthWays.map(w => <option key={w.style.id} value={w.style.id}>{w.label}</option>)}
                    </select>
                  </label>
                </details>
              )}

              {/* Right under the price: a part priced from Black can make it low (Jonathan, Oct 27). */}
              {sections > 0 && <FromBlackWarning parts={fromBlackParts} where="price" />}

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
                    <p className="text-xs font-semibold text-gray-500" data-tiers-title>{tiers.length === 2 ? 'Two options' : tierPrefs.added?.length ? 'Options' : 'Good, Better, Best'} <span className="font-normal" data-tiers-where={sentTierSet && !usingSentTiers ? 'today' : 'proposal'}>{sentTierSet && !usingSentTiers ? "· at today's prices, not on the customer's proposal" : '· on the proposal'}</span></p>
                    {can('settings.change') && <button type="button" className="btn btn-quiet btn-sm shrink-0" data-edit-tiers
                      onClick={() => { if (okToLeave()) navigate('/settings?tab=tiers') }}>Edit options</button>}
                  </div>
                  {heldSaved && (
                    <p className="text-xs rounded-lg px-2 py-1.5 border text-gray-700 bg-blue-50 border-blue-200" data-tiers-held>
                      {showSentCards ? 'As saved: our costs for this fence are missing, so these are the options and prices this quote was saved with, kept as they are.' : 'Good, Better, Best are not priced while our costs for this fence are missing. This quote keeps the options it was saved with.'}
                    </p>
                  )}
                  {usingSentTiers && !heldSaved && (() => {
                    // Said as it is (review Oct 27 2026): the prices the customer has, or new prices once the fence is changed.
                    const note = sentTiersNote({ asSent: showSentCards, fenceChanged, signed: signedQuote, sentPricesChanged: !!sentPricesChanged })
                    return (
                      <p className={`text-xs rounded-lg px-2 py-1.5 border ${note.kind === 'changed' ? 'text-amber-900 bg-amber-50 border-amber-300' : 'text-gray-700 bg-blue-50 border-blue-200'}`} data-tiers-as-sent={note.kind}>
                        {note.text}{' '}
                        <button type="button" className="underline font-semibold min-h-[44px]" onClick={() => setKeepSentTiers(false)} data-tiers-use-current>Use the current tiers</button>
                      </p>
                    )
                  })()}
                  {sentTierSet && !keepSentTiers && !heldSaved && (
                    // After "Use the current tiers" (review Oct 27 2026: the heading still said "on the proposal" over today's prices).
                    <p className="text-xs rounded-lg px-2 py-1.5 border text-amber-900 bg-amber-50 border-amber-300" data-tiers-current-note>
                      These are today's tiers. The customer's proposal still shows the sent prices; saving asks whether to keep them.{' '}
                      <button type="button" className="underline font-semibold min-h-[44px]" onClick={() => setKeepSentTiers(true)} data-tiers-use-sent>Show the sent prices</button>
                    </p>
                  )}
                  {!tierSet && tierSets === null && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5" data-tiers-not-loaded>Good, Better, Best have not loaded yet (weak signal). They are tried again every few seconds; a proposal saved now would not show them.</p>}
                  {!tierSet && tierSets !== null && <p className="text-sm text-gray-600" data-tiers-none>No Good, Better, Best set for {style.category} yet. {can('settings.change') ? 'Tap Edit options to add one.' : 'Ask Jonathan to add one.'}</p>}
                  {tierSet && tierSet.tiers.length === 0 && <p className="text-sm text-gray-600" data-tiers-none>No Good, Better, Best options for {tierSet.category} yet. {can('settings.change') ? 'Tap Edit options to add them.' : 'Ask Jonathan to add them.'}</p>}
                  {(heldSaved && !showSentCards ? [] : tiers).map(t => {
                    // A sent proposal, the fence unchanged: each tier as the customer reads it (frozen price and fence).
                    const sent = showSentCards ? sentCards![t.spec.key] : undefined
                    if (showSentCards && !sent) return (
                      <div key={t.spec.key} className="rounded-lg border border-dashed border-gray-300 p-3 opacity-80" data-tier={t.spec.key} data-tier-not-sent>
                        <label className="flex items-center gap-2 min-w-0">
                          <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={!tierPrefs.off.includes(t.spec.key)} disabled={heldSaved} aria-label={`Offer ${t.spec.name}`}
                            onChange={e => setTierPrefs(p => ({ ...p, off: e.target.checked ? p.off.filter(k => k !== t.spec.key) : [...p.off, t.spec.key] }))} />
                          <span className="font-bold text-gray-900" data-tier-name>{t.spec.name}</span>
                        </label>
                        <p className="text-xs text-gray-600 mt-1">{heldSaved && !sentQuote ? 'Not on the saved quote.' : `Not on the proposal that was ${signedQuote ? 'signed' : 'sent'}.`}</p>
                      </div>
                    )
                    if (!sent && (!t.style || !t.option)) return (
                      <div key={t.spec.key} className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3" data-tier={t.spec.key}>
                        <p className="font-bold text-gray-900">{t.spec.name}</p>
                        <p className="text-xs text-amber-900 mt-1" data-tier-reason>Not offered on this quote: {t.reason}</p>
                        <select className="mt-2 w-full border border-gray-300 rounded-lg px-2 h-11 text-sm bg-white" value="" aria-label={`Style for ${t.spec.name}`}
                          onChange={e => { const v = e.target.value; if (v) setTierPrefs(p => ({ ...p, swap: { ...p.swap, [t.spec.key]: v } })) }} data-tier-swap>
                          <option value="">Pick a style for this quote…</option>
                          {stylePicks(t.spec.key)}
                        </select>
                        {t.added && <button type="button" className="btn btn-quiet btn-sm mt-2" onClick={() => removeAdded(t.spec.key)} data-option-remove>Remove this option</button>}
                      </div>
                    )
                    // The tier whose card is the quote's own best price option on the proposal: its price, its panels.
                    const folded = sent ? sent.own : t.spec.key === foldedTier
                    const twin = sent ? sent.twin : t.spec.key === twinTier
                    // One main card: a second card of the same style is not it.
                    const main = folded || twin || (!!t.style && t.style.name === style?.name && tiers.find(x => x.style?.name === style?.name)?.spec.key === t.spec.key)
                    const price = sent ? sent.price : main ? adjPrice : t.option!.finalPrice
                    const perFoot = sent ? sent.perFoot : folded ? (totalFootage > 0 ? Math.round((adjPrice / totalFootage) * 100) / 100 : 0) : t.option!.perFoot
                    const card = sent ? undefined : tierCards[t.spec.key]
                    const name = sent?.name ?? card?.name ?? t.spec.name
                    const words = sent ? sent.blurb ?? t.spec.text : card ? card.blurb : t.spec.text
                    const picked = !sent && !!(t.added || t.ownWords)
                    const canPick = !heldSaved && !signedQuote
                    return (
                      <div key={t.spec.key} className={`rounded-lg border p-3 ${main ? 'border-orange-500 bg-orange-50' : 'border-gray-200'} ${t.off ? 'opacity-60' : ''}`} data-tier={t.spec.key}>
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-center gap-2 min-w-0">
                            {/* The quote's own fence stays on the proposal: another option is made main first. Three at most. */}
                            <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={!tierPrefs.off.includes(t.spec.key)} disabled={heldSaved || (main && !t.off) || (t.off && offeredNow >= MAX_TIERS)} aria-label={`Offer ${t.spec.name}`}
                              onChange={e => setTierPrefs(p => ({ ...p, off: e.target.checked ? p.off.filter(k => k !== t.spec.key) : [...p.off, t.spec.key] }))} />
                            <span className="font-bold text-gray-900" data-tier-name>{name}</span>
                            {t.popular && <span className="text-[11px] font-semibold bg-orange-500 text-white rounded-full px-2 py-0.5" data-tier-popular>Most popular</span>}
                          </label>
                          <span className="text-right">
                            <span className="block font-bold tabular-nums" data-tier-price>{fmt(price)}</span>
                            <span className="block text-xs text-gray-600 tabular-nums">{fmt(perFoot)}/ft</span>
                          </span>
                        </div>
                        <p className="text-xs text-gray-700 mt-1" data-tier-style>{sent ? sent.label : folded || (main && t.style?.name === style?.name) ? ownPanelsLabel : customerFenceName(optionLabel(t.style!.name), t.option?.snapshot?.runRails)}</p>
                        {words && <p className="text-xs text-gray-600 mt-0.5" data-tier-text>{words}</p>}
                        {!sent && t.swapOff && <p className="text-xs font-semibold text-amber-800 mt-1" data-tier-swap-off>{optionLabel(t.swapOff)} is off for quoting now, so this option went back to automatic. Pick another style or take it off.</p>}
                        {!sent && t.option && !t.off && t.option.minimumLifted && <p className="text-xs font-semibold text-gray-700 mt-0.5" data-tier-minimum>Lifted to the minimum job price (internal).</p>}
                        {!sent && t.option && !t.off && t.option.adjustmentRefused && <p className="text-xs font-semibold text-amber-800 mt-0.5" data-tier-adjust-refused>The dollar adjustment is not on this option: it would go under cost.</p>}
                        {!sent && seesMargin && t.option && !t.off && !main && t.option.finalPrice > 0 && <p className="text-xs text-gray-700 mt-0.5" data-tier-margin>Margin {((t.option.finalPrice - t.option.snapshot.totalCOGS) / t.option.finalPrice * 100).toFixed(1)}% <span className="text-gray-500">(price less cost)</span>{t.option.adjustmentCents ? ` after ${t.option.adjustmentCents < 0 ? '−' : '+'}${fmt(Math.abs(t.option.adjustmentCents) / 100)}` : ''}</p>}
                        {!sent && tierCards[t.spec.key]?.gates.map(w => <p key={w} className="text-xs text-amber-800 mt-1" data-tier-gate>{w}</p>)}
                        {picked && card && <p className="text-xs text-gray-700 mt-0.5" data-tier-warranty>{card.warranty ? `Warranty: ${card.warranty}` : ''}</p>}
                        {picked && card && !card.hasPhoto && !card.blurb && <p className="text-xs text-gray-600" data-tier-no-words>No photo or description for this style: the customer reads its name, price and warranty.</p>}
                        {picked && card && card.block.map(b => <p key={b} className="text-xs font-semibold text-red-800 mt-1" data-tier-block>Cannot be sent: {b}</p>)}
                        {picked && card && card.warn.map(w => <p key={w} className="text-xs text-amber-800 mt-1" data-tier-warn>{w}</p>)}
                        {folded && <p className="text-xs text-gray-600" data-tier-own>Your best price quote (the cheaper section width for each run), shown as {t.spec.name} on the proposal.{!sent && t.widthFt && t.option ? ` All ${t.widthFt} ft sections would be ${fmt(t.option.finalPrice)}.` : ''}</p>}
                        {!sent && !folded && t.widthFt && t.otherWidth && <p className="text-xs text-gray-600" data-tier-width>{t.widthFt} ft wide prices lower for this yard ({t.otherWidth.widthFt} ft wide: {fmt(t.otherWidth.price)}).</p>}
                        {!sent && !folded && t.widthFt && !t.otherWidth && t.otherWidthHeld && <p className="text-xs text-amber-700" data-tier-width-held>Priced with {t.widthFt} ft wide sections: {t.otherWidthHeld.widthFt} ft wide is not priced yet ({t.otherWidthHeld.held}).</p>}
                        {!sent && t.sameAs && <p className="text-xs text-amber-800" data-tier-same>Same fence as {t.sameAs} for this yard.</p>}
                        {(() => {
                          // An offered option with a green part still priced from Black: its price may be low too (the main one says so above).
                          if (sent || main || t.off || !t.option || !internal) return null
                          const pull = ((t.option.snapshot?.pullSheet ?? []) as Array<{ item: string; qty: number; costSource?: string }>)
                          const fb = borrowedPartsOnQuote(pull.filter(i => i.qty > 0 && i.costSource !== 'jobLot' && i.costSource !== 'wood').map(i => i.item), getInventory(), normalizeItemName)
                          return fb.length ? (
                            <p className="text-xs font-semibold text-red-800 mt-1" data-tier-from-black={t.spec.key}>
                              Price may be low: {fb.map(x => x.item.name.replace(/^\*/, '').trim()).join('; ')} {fb.length === 1 ? 'is' : 'are'} priced from Black.
                            </p>
                          ) : null
                        })()}
                        {!heldSaved && <div className="flex gap-2 mt-2">
                          <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={main || !t.style}
                            onClick={() => makeMain(t, t.style!.name)} data-tier-main>{main ? 'Main option' : 'Make main'}</button>
                          {canPick && <button type="button" className={`btn btn-sm shrink-0 ${t.popular ? 'btn-primary' : 'btn-quiet'}`} aria-pressed={t.popular} disabled={t.off}
                            onClick={() => setTierPrefs(p => ({ ...p, popular: t.popular ? null : t.spec.key }))} data-tier-popular-pick>{t.popular ? 'Most popular ✓' : 'Most popular'}</button>}
                        </div>}
                        {!heldSaved && <label className="block mt-2">
                          <span className="block text-xs font-semibold text-gray-600">Change style</span>
                          <select className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 h-11 text-sm bg-white" disabled={signedQuote} value={main ? style?.name ?? '' : tierPrefs.swap[t.spec.key] ?? ''} aria-label={`Style for ${t.spec.name}`}
                            onChange={e => {
                              const v = e.target.value
                              // The main option's style is the quote's: the other options stay as they are.
                              if (main) { if (v) makeMain(t, v); return }
                              setTierPrefs(p => { const swap = { ...p.swap }; if (v) swap[t.spec.key] = v; else delete swap[t.spec.key]; return { ...p, swap } })
                            }} data-tier-swap>
                            {!main && <option value="">{t.added ? t.style?.label || t.style?.name : 'Automatic'}</option>}
                            {stylePicks(t.spec.key)}
                          </select>
                        </label>}
                        {t.added && canPick && <button type="button" className="btn btn-quiet btn-sm mt-1" onClick={() => removeAdded(t.spec.key)} data-option-remove>Remove this option</button>}
                        {picked && (t.option?.snapshot?.pullSheet?.length ?? 0) > 0 && (
                          <details className="mt-1" data-tier-pull>
                            <summary className="text-xs font-semibold text-gray-600 min-h-[44px] flex items-center">This option's pull sheet</summary>
                            <ul className="text-xs text-gray-700 space-y-0.5">{t.option!.snapshot.pullSheet.filter(l => !l.moneyOnly).map(l => <li key={l.item} className="flex justify-between gap-2"><span>{l.item}</span><span className="tabular-nums">{l.qty}</span></li>)}</ul>
                          </details>
                        )}
                      </div>
                    )
                  })}
                  {tierSet && !heldSaved && !signedQuote && offeredNow < MAX_TIERS && (
                    <label className="block" data-option-add>
                      <span className="block text-xs font-semibold text-gray-600">Add option ({offeredNow} of {MAX_TIERS} on the proposal)</span>
                      <select className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 h-11 text-sm bg-white" value="" aria-label="Add option"
                        onChange={e => { const v = e.target.value; if (v) setTierPrefs(p => ({ ...p, added: [...(p.added ?? []), { key: newOptionKey(p), style: v }] })) }}>
                        <option value="">Pick a style…</option>
                        {stylePicks()}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {work && seesMargin && !heldSaved && <WorkBreakdown work={work} />}
              {internal && heldNums && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1" data-held-saved-costs>
                  <p className="text-xs font-semibold text-gray-500">From the saved quote (our costs for this fence are missing, so nothing is priced today)</p>
                  <p className="text-sm flex justify-between"><span>Material</span><span className="tabular-nums" data-held-material>{fmt(heldNums.material)}</span></p>
                  <p className="text-sm flex justify-between"><span>Labor and tear out</span><span className="tabular-nums">{fmt(heldNums.labor)}</span></p>
                  <p className="text-sm flex justify-between"><span>Total cost</span><span className="tabular-nums" data-held-cogs>{fmt(heldNums.cogs)}</span></p>
                  {seesMargin && heldNums.marginPct != null && <p className="text-sm flex justify-between"><span>Margin</span><span className="tabular-nums" data-held-margin>{Math.round(heldNums.marginPct * 1000) / 10}%</span></p>}
                </div>
              )}
              {seesMargin && !heldSaved && <DollarPickets price={adjPrice} materials={materialCost} labor={laborCost + tearOutCost} commission={showCommission ? commAmt : 0} overheadPct={overheadNow} roundingCents={roundingCents} adjustmentCents={adjApplied} category={style?.category ?? null} />}

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
                    <p className="text-xs text-gray-600 leading-snug">One price for a section's vinyl and one for the vinyl post (Settings → Price List); those parts show at $0 on the pull sheet. Caps, donuts, pipe, concrete and gates are priced from Inventory. Internal only.</p>
                  </>) : jobLot.kit ? (<>
                    <p className="text-xs font-semibold text-gray-800">{jobLot.color} sections are sold as a kit</p>
                    <p className="text-xs text-gray-600 leading-snug">Each section line carries the kit's cost (a gate leaf takes one); the parts in the kit show at $0 on the pull sheet. Internal only.</p>
                  </>) : (<>
                    <p className="text-xs font-semibold text-gray-800">Job lot pricing from {jobLot.supplier}, quoted {fmtYmd(jobLot.quotedOn)}</p>
                    <p className="text-xs text-gray-600 leading-snug">{jobLot.color} sections, posts and gates are priced from that quote; the parts they include show at $0 on the pull sheet. Internal only.</p>
                  </>)}
                  {jobLotOld && <p className="text-xs text-amber-800 leading-snug" data-job-lot-old>That job lot quote is older than {monthsText(staleMonths)}. Ask {jobLot.supplier} for a new one and update it in Settings → Fence styles.</p>}
                </div>
              )}

              {staleParts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5" data-stale-prices>
                  <p className="text-xs font-semibold text-amber-800">
                    {stalePricesHeading(staleParts.length, staleMonths)}
                  </p>
                  {staleParts.slice(0, 6).map(({ item }) => (
                    <p key={item.id} className="text-xs text-amber-800 leading-snug" data-stale-part={item.name}>{item.name.replace(/^\*/, '')} · {priceAgeLabel(item)}</p>
                  ))}
                  {staleParts.length > 6 && <p className="text-xs text-amber-800">and {staleParts.length - 6} more</p>}
                  {/* Inventory is not open to a Salesman's login: no button that would leave his quote for a page he cannot open (reviewer, Oct 27). */}
                  {can('inventory.stock') ? (
                    <button type="button" className="btn btn-quiet btn-sm" data-stale-open
                      onClick={() => { if (okToLeave()) navigate(`/inventory?items=${encodeURIComponent(staleParts.map(p => p.item.id).join(','))}`) }}>
                      Open in Inventory
                    </button>
                  ) : <p className="text-xs text-amber-800" data-stale-note>OK to quote. The office updates these prices in Inventory.</p>}
                </div>
              )}

              {/* Not rendered at all for a Salesman (never margin, not even hidden in the page). */}
              {seesMargin && <div className="bg-white rounded-xl border border-gray-200 p-4">
                {roundingCents > 0 && (
                  <div className="flex justify-between items-center text-sm mb-2 pb-2 border-b border-gray-100" data-quote-rounding>
                    <span className="text-gray-600">Rounded to the whole dollar {seesMargin && <span className="text-xs text-gray-400">(out of profit)</span>}</span>
                    <span className="font-semibold text-red-600 tabular-nums" data-quote-rounding-amount>−{fmt(roundingCents / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Gross Margin <span className="text-xs text-gray-400">(price less cost)</span></span>
                  <span className={`text-2xl font-bold ${gmColor}`}>{(viewGmPct * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-400">Margin $</span>
                  <span className={`text-sm font-semibold ${gmColor}`}>{fmt(viewGrossMargin)}</span>
                </div>
                {showCommission && commAmt > 0 && (
                  <div className="flex justify-between items-center mt-1" data-quote-margin-after>
                    <span className="text-xs text-gray-400">After commission</span>
                    <span className="text-sm text-gray-600 tabular-nums">{(gmPct * 100).toFixed(1)}%, {fmt(grossMargin)}</span>
                  </div>
                )}
                <div className="mt-2">
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${gmTone === 'good' ? 'bg-green-500' : gmTone === 'near' ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${Math.max(0, Math.min(viewGmPct * 100, 100))}%` }} />
                  </div>
                  <p className={`text-xs mt-1 ${gmColor}`}>
                    {`${gmTone === 'good' ? '✓ At or above' : gmTone === 'near' ? '⚠ Below' : '✗ Well below'} its ${Math.round(quoteTarget * 1000) / 10}% Target Margin`}
                  </p>
                </div>
              </div>}

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

              {/* Costs: priced here for the owner and office; a Salesman reads the server's (material and labor, never margin). */}
              <div className={`bg-white rounded-xl border border-gray-200 p-4 space-y-2 ${work || !(internal || (seesCostLines && sv?.costs)) ? 'hidden' : ''}`} data-quote-costs>
                {[
                  { label: 'Material cost', val: fmt(internal ? materialCost : sv?.costs?.materialCost ?? 0) },
                  { label: internal ? laborLabel(priced, calcInput.style) : 'Labor cost', val: fmt(internal ? laborCost : sv?.costs?.laborCost ?? 0) },
                  { label: 'Tear out',      val: fmt(internal ? tearOutCost : sv?.costs?.tearOutCost ?? 0) },
                ].map(row => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="text-gray-900 font-medium">{row.val}</span>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-semibold">
                  <span className="text-gray-700">Total cost</span>
                  <span className="text-gray-900">{fmt(internal ? totalCOGS : sv?.costs?.totalCOGS ?? 0)}</span>
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
                {!internal || (!seesMargin && (priceMethod === 'cost_factor' || !!work)) ? null : priceMethod === 'cost_factor' || work ? (
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
                    const profitOf = (price: number, rounding: number, adj: number) => splitDollars({ price, materials: materialCost, labor: laborCost + tearOutCost, commission: showCommission ? commAmt : 0, overheadPct: overheadNow, roundingCents: rounding, adjustmentCents: adj }).find(x => x.part === 'profit')!.dollars
                    const netAfter = profitOf(adjPrice, roundingCents, adjApplied)
                    const netBefore = profitOf(listPrice, roundingCents, 0)
                    const optionCount = jobType === 'new' ? new Set([style?.name, ...offer, ...tiers.filter(t => !t.off && t.style).map(t => t.style!.name)].filter(Boolean)).size - (foldedTier ? 1 : 0) : (work ? 1 : 0)
                    return (
                      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1 text-sm" data-adjust-summary>
                        <div className="flex justify-between"><span className="text-gray-600">Price before adjustment</span><span className="tabular-nums" data-adjust-list>{fmt(listPrice)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">{adjApplied < 0 ? 'Discount' : 'Adjustment'} {seesMargin && <span className="text-xs text-gray-400">(out of profit)</span>}</span><span className={`tabular-nums font-semibold ${adjApplied < 0 ? 'text-red-600' : 'text-green-700'}`} data-adjust-amount>{adjApplied < 0 ? '−' : '+'}{fmt(Math.abs(adjApplied) / 100)}</span></div>
                        <div className="flex justify-between font-semibold"><span>Final price</span><span className="tabular-nums" data-adjust-final-price>{fmt(adjPrice)}</span></div>
                        {seesMargin && <>
                          <div className="flex justify-between border-t border-gray-200 pt-1 mt-1"><span className="text-gray-600">Margin after</span><span className={`tabular-nums font-semibold ${gmColor}`} data-adjust-margin>{(viewGmPct * 100).toFixed(1)}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-600">Net profit after</span><span className={`tabular-nums font-semibold ${netAfter < 0 ? 'text-red-700' : 'text-gray-900'}`} data-adjust-profit>{fmt(netAfter)}</span></div>
                          <p className="text-xs text-gray-500" data-adjust-gave>{adjApplied < 0 ? `You give up ${fmt(netBefore - netAfter)} of profit.` : `${fmt(netAfter - netBefore)} more profit.`} {showCommission ? 'Overhead and commission stay' : 'Overhead stays'} on {fmt(listPrice)}.</p>
                        </>}
                        {optionCount > 1 && (
                          // The ± dollars are the main option's only (Jonathan, Nov 2 2026: "A discount on one option must never change the price of the other options").
                          <p className="text-xs text-gray-700 border-t border-gray-200 pt-1 mt-1" data-adjust-options>
                            {adjApplied < 0 ? 'The discount is' : 'The adjustment is'} on this option only. The other options keep their own prices.
                          </p>
                        )}
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
                            <input type="checkbox" className="mt-1 w-5 h-5 accent-orange-500" checked={own || offer.includes(s.name)} disabled={own || (!offer.includes(s.name) && offeredNow >= MAX_TIERS)}
                              onChange={e => setOffer(list => e.target.checked ? [...list, s.name] : list.filter(n => n !== s.name))} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-semibold text-gray-900">{o.label}</span>
                              <span className="block text-xs text-gray-600">{o.sections} section{o.sections === 1 ? '' : 's'} · {fmt(o.perFoot)}/ft</span>
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
                onClick={() => { void openSave() }}
                className={signedQuote ? 'btn btn-secondary w-full min-h-[48px]' : 'btn btn-primary btn-lg w-full'}
              >
                {signedQuote ? 'Save notes and customer details only' : init?.id ? 'Update quote' : 'Save quote'}
              </button>
              {heldChanged && <p className="text-xs font-semibold text-amber-800 text-center" data-held-no-save>{heldNotSaved(style!.label || style!.name, style!.held!, canPrice)}</p>}
              {subRateMissing && <p className="text-xs text-red-700 text-center" data-sub-rate-missing-save>{subRateMissing}</p>}
              {minimumHeld && <p className="text-xs text-red-700 text-center" data-below-minimum-save>{underMinimumWarning(underMinimum, minimumCents, mayGoUnder)}</p>}
              {!canSave && !heldChanged && !subRateMissing && !minimumHeld && <p className="text-xs text-gray-400 text-center">{jobType === 'move' ? 'Select a style, draw the new line and enter the old line footage' : jobType === 'repair' ? 'Select a style and add at least one repair item' : 'Select a style and enter at least one run'}</p>}
            {showPullSheet && shownItems.length > 0 && (
              <div className="flex-1 overflow-y-auto px-6 py-4" data-pull-sheet>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500">{heldSaved ? 'Pull sheet (as saved)' : work ? 'Pull sheet (new material only)' : 'Pull Sheet'}</h3>
                  <span className="text-xs text-gray-400">{shownItems.length} items</span>
                </div>
                <div className="space-y-1">
                  {shownItems.map((item, i) => (
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
                  <span className="text-sm font-bold text-gray-900">{fmt(shownMaterial ?? materialCost)}</span>
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
                : work ? (jobType === 'move' ? `Move ${Math.round(moveIn.oldFt)} ft → ${totalFootage} ft · ${work.sections} section${work.sections === 1 ? '' : 's'}` : `Repair · ${REPAIR_ITEMS.reduce((t, k) => t + (chargedRepairItems(repairIn)[k] ?? 0), 0)} items`)
                : totalFootage > 0 ? `${totalFootage} ft · ${sections} section${sections === 1 ? '' : 's'} · ${effCorners} corner, ${effEnds} end` : 'No fence yet'}
            </p>
            <div className={`flex items-center gap-2 mt-1 ${signedQuote ? 'flex-wrap md:flex-nowrap' : ''}`}>
              <p className="text-xl font-bold tabular-nums text-gray-900 shrink-0 whitespace-nowrap mr-auto" data-bar-price data-builder-cents={Math.round(adjPrice * 100)}>{fmt(shownPrice)}{priced.priceMethod === 'manual' && <span className="block text-xs font-semibold text-amber-700" data-bar-price-typed>Set by hand: parts do not change it</span>}</p>
              <button type="button" className="btn btn-secondary shrink-0 min-h-[48px] px-3" onClick={() => setPhotosOpen(true)} data-photos-open aria-label={`Photos and video (${mediaItems.length})`}>
                <Camera size={18} aria-hidden="true" /><span className="tabular-nums">{mediaItems.length}</span>
              </button>
              {signedQuote ? (
                // A signed quote: the change order is one tap from any step (the next step stays beside it).
                // On a phone its own row under the price, full width, so neither the price (round 2: "$7,02") nor
                // "Make change order" (round 5, iPhone 13: "Make / hange / order") is cut off; one row on a computer.
                <div className="flex items-center gap-2 w-full md:w-auto md:shrink-0" data-co-make-row>
                  {step !== 'price' && <button type="button" onClick={barNext} className="btn btn-secondary shrink-0 min-h-[52px] px-4" data-bar-next>{step === 'yard' && nextSide ? 'Next side' : 'Next'}</button>}
                  <button disabled={!canSave} onClick={makeChangeOrderNow} className="btn btn-primary min-h-[52px] px-3 text-base font-semibold flex-1 min-w-0 whitespace-nowrap md:flex-none md:min-w-[160px]" data-co-make>Make change order</button>
                </div>
              ) : step === 'price' ? (
                <button disabled={!canSave || checkingPrices} onClick={() => { void openSave() }} className="btn btn-primary btn-lg shrink-0 md:min-w-[160px]" data-save-open>{init?.id ? 'Update quote' : 'Save quote'}</button>
              ) : (
                <button type="button" onClick={barNext} className="btn btn-primary btn-lg shrink-0 md:min-w-[160px]" data-bar-next>{barNextLabel}</button>
              )}
            </div>
            {heldChanged && <p className="text-xs font-semibold text-amber-800 mt-1 leading-snug" data-held-bar-reason>{heldBarReason(canPrice)}</p>}
            {underMinimum.length > 0 && (
              <div className="mt-1" data-below-minimum>
                <p className="text-xs font-semibold text-red-700 leading-snug" data-below-minimum-text>{underMinimumWarning(underMinimum, minimumCents, mayGoUnder)}</p>
                {mayGoUnder && (
                  <label className="flex items-center gap-2 min-h-[44px] text-sm font-semibold text-gray-800">
                    <input type="checkbox" className="w-5 h-5 accent-orange-500" checked={minimumOverride} onChange={e => setOverrideFor(e.target.checked ? underKey : null)} data-below-minimum-override />
                    Save under the minimum (owner override)
                  </label>
                )}
              </div>
            )}
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
          initialCustomerId={quoteCustomerId || undefined}
          initialAddress={quoteDraftAddress(entry === 'layout' ? yard?.plan?.aerial?.address : null, init?.customerAddress)}
          initialStatus={saveWindowKept?.status ?? init?.status ?? 'DRAFT'}
          initialNotes={saveWindowKept ? saveWindowKept.notes : [init?.notes, ...voiceNotes.map(n => `Crew note: ${n}`)].filter(Boolean).join('\n')}
          onCancel={() => setShowSaveModal(false)}
          stillMine={salesmanCheck ? stillMineNow : undefined}
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
                <p className="text-base font-bold text-gray-900" data-quote-sent-message>{(() => { const now = Number((pending.quote as any)?.finalPrice ?? adjPrice); return Math.round(now * 100) !== Math.round((init?.finalPrice ?? 0) * 100) ? <>The price changed since this was sent (sent at {priceText(init!.finalPrice)}, saving now would make it {priceText(now)}). </> : null })()}
                  {pending.changes?.length
                    ? <>Prices on the customer's proposal would change ({pending.changes.slice(0, 3).map(c => `${c.name}: ${c.wasCents == null ? 'not on it' : fmt(c.wasCents / 100)} then, ${c.nowCents == null ? 'gone' : fmt(c.nowCents / 100)} now`).join('; ')}{pending.changes.length > 3 ? `; ${pending.changes.length - 3} more` : ''}). </>
                    : null}
                  Save as a new version and send again, or keep the sent prices?</p>
                <div className="flex flex-col gap-2">
                  {/* Keeping the sent prices is the safe choice, first (a sent proposal never reprices unless chosen). */}
                  <button type="button" className="btn btn-primary min-h-[48px]" onClick={() => { const q = pending.quote; setPending(null); onSave({ ...keepPrices(init!, q), ...(q.backToDraft ? { backToDraft: true } : {}) }) }} data-quote-sent-keep>Keep the sent prices</button>
                  <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => { const q = pending.quote; setPending(null); onSave({ ...q, needsResend: true }) }} data-quote-sent-new>Save new version (send it again)</button>
                  <button type="button" className="min-h-[44px] text-sm text-gray-600" onClick={() => setPending(null)}>Back to the quote</button>
                </div>
                <p className="text-xs text-gray-500">Keep the sent prices saves notes and customer details only; the fence, price and proposal stay as sent.</p>
              </>
            )}
          </div>
        </div>
      )}
      {recheck?.asked && recheckOutcome && recheckOutcome.kind !== 'save' && <BackClose name="price-recheck" onClose={() => setRecheck(null)} />}
      {commissionAsk && (
        <div className="fixed inset-0 z-[75] bg-black/50 flex items-center justify-center p-3" data-commission-ask>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <p className="text-base font-bold text-gray-900">Commission comes off when this saves</p>
            <p className="text-sm text-gray-600">{commissionAsk.rep ? `${commissionAsk.rep} is not a Salesman` : 'This quote has no rep and was not made by a Salesman'}, so nobody is paid on it. The price stays {priceText(adjPrice)}.</p>
            <div className="flex flex-col gap-2">
              <button type="button" className="btn btn-primary min-h-[48px]" data-commission-ask-save onClick={() => { const d = commissionAsk.data; setCommissionAsk(null); setHasSalesman(false); void handleSave(d, { commissionOff: true }) }}>Save without commission</button>
              <button type="button" className="min-h-[44px] text-sm text-gray-600" data-commission-ask-back onClick={() => setCommissionAsk(null)}>Back to the quote</button>
            </div>
          </div>
        </div>
      )}
      {recheck?.asked && recheckOutcome && recheckOutcome.kind !== 'save' && (
        <div className="fixed inset-0 z-[75] bg-black/50 flex items-center justify-center p-3" data-price-recheck={recheckOutcome.kind}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <p className="text-base font-bold text-gray-900" data-price-recheck-line>{recheckOutcome.line}</p>
            {recheckOutcome.kind === 'confirm' ? (
              <div className="flex flex-col gap-2">
                <button type="button" className="btn btn-primary min-h-[48px]" onClick={saveRepriced} data-price-recheck-save>Save at {priceText(adjPrice)}</button>
                <button type="button" className="min-h-[44px] text-sm text-gray-600" onClick={() => setRecheck(null)} data-price-recheck-back>Back to the quote</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button type="button" className="btn btn-primary min-h-[48px]" onClick={() => { setRecheck(null); goStep('style') }} data-price-recheck-style>Pick another fence</button>
                <button type="button" className="min-h-[44px] text-sm text-gray-600" onClick={() => setRecheck(null)} data-price-recheck-back>Back to the quote</button>
              </div>
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