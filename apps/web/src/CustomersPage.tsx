import MediaGallery from './MediaGallery'
import { possessive } from './personName'
import TextButton from './TextButton'
import { dayWords } from './businessDate'
import ScreenErrorBoundary from './ScreenErrorBoundary'
import { usePipelineStages, stageName as pipelineStageName, roleId } from './pipelineStagesStore'
import { styleLabel } from './fenceCatalog'
import { soldStyleLabel, quoteStyleLabel } from './soldStyleLabel'
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, Fragment } from 'react'
import { getConfig } from './configStore'
import { sourcePicker, tagPicker, sourceLabel, tagLabel, getOptions, useOptions } from './optionListsStore'
import { wordToSave } from './optionListModel'
import { Phone, MessageSquare, Navigation, FilePlus2, CalendarPlus, Pencil, MapPin, ChevronLeft, ChevronRight } from 'lucide-react'
import { telHref, formatPhone } from './phoneFormat'
import PhoneLink from './PhoneLink'
import { nextFor, shortWhen, TYPE_LABELS } from './appointmentLogic'
import { useAppointmentList } from './TodayScreen'
import { loadCustomer as loadPaymentsOf, scheduleOf, subscribe as subscribePayments, paymentsVersion, money } from './paymentsStore'
import { HistoryList, useCustomerHistory, lastContactOf, type HistoryItem } from './CustomerHistory'
import { CUSTOMER_TAB_LABEL, asCustomerTab, customerTabsFor, shownCustomerTab, withTab, openQuotesOf, balanceDueCents, balanceTile, nextCompact, jobRowTarget, backLinkWords, type CustomerTab } from './customerPage'
import { startTouch } from './followUpStore'
import { openBooking } from './BookingDialog'
import { NextAppointmentBadge, CustomerAppointmentsTab } from './AppointmentWidgets'
import {
  getInvoicesForCustomer, createInvoice, recordPayment,
  getPaymentsForCustomer, getBillingSummary,
  nextInvoiceNumber,
  type Invoice, type Payment,
} from './billingStore'
import PaymentsPanel from './Payments'
import CustomerPullSheetsTab from './CustomerPullSheets'
import { toast } from './toast'
import CustomerPhotosTab from './CustomerPhotosTab'
import CustomerFilesTab from './CustomerFilesTab'
import CustomerMessagesTab from './CustomerMessagesTab'
import TextConsent from './TextConsent'
import ImportHistoryCard from './ImportHistoryCard'
import QuoteDetailDrawer from './QuoteDetailDrawer'
import type { SavedQuote } from './QuotesPage'
import FileViewerModal, { type CustomerFileShape } from './FileViewerModal'
import { getPortalAccessStatus, loadAccountsSoon, sendPortalInvite, resendPortalInvite, buildActivationLink } from './portalStaffApi'
import { portalPageUrl } from './publicDoor'
import { getEmailTemplate, renderTemplate } from './emailTemplatesStore'
import { logCustomerActivity, getActivityForCustomer, getCustomers, getArchivedCustomers, upsertCustomer, bulkImportCustomers } from './customerStore'
import { archiveRecord, unarchiveRecord, deleteRecord } from './recordArchive'
import { getQuotes, getQuoteById } from './quoteStore'
import { sectionsCell } from './moveRepair'
import { getJobs, getArchivedJobs } from './jobStore'
import { stageOf, stageName, stageColor, OPS_STAGES_UPDATED_EVENT } from './opsStagesStore'
import { getPipeline, getArchivedCards } from './pipelineStore'
import { loadPipeline } from './JobsPage'
import { changeLeadStage } from './pipelineStageChange'
import {
  listContactNotes, createContactNote, updateContactNote, deleteContactNote,
  type CrmContactNoteRecord, noteChangeFor, noteAuthor } from './crmContactsApi'
import { cloudStorage } from './cloudStorage'
import { navigate, goBack, goBackThen, useNav, useScreenMemory, takeOpenedParam, openedFrom, BackClose, useBackLayer, replaceUrl } from './nav'
import { CUSTOMER_FILTERS, asCustomerFilter, type CustomerFilter } from './customerFilters'
import { SaveStatus } from './SaveStatus'
import { newId } from './recordSync'
import { sendJson } from './syncHttp'
import { businessDate } from './businessDate'
import AddressAutocomplete from './AddressAutocomplete'
import { can, canOpenOperations, signedInRole } from './permissions'
import { seesCommission, shownMargin } from './salesmanCommission'
import PopMenu, { PopItem } from './PopMenu'
import ConfirmByTyping from './ConfirmByTyping'
import PossibleMatch from './PossibleMatch'
import { CustomerChangeOrderButtons } from './ChangeOrders'
import { PastCustomerBadge, ServiceRequestButton, ServiceTicketList } from './ServiceRequests'
import { lowTarget } from './moneyLoad'
import SalesmanPicker from './SalesmanPicker'
import { isMyRep, useOwnerChangesSalesman } from './salesmanChoice'
import SalesmanOnCustomer, { OWNER_ONLY_WORDS } from './SalesmanOnCustomer'

/** Open a customer's page (a possible match, or the one this customer was merged into). */
const openCustomerPage = (id: string) => navigate(`/customers/${encodeURIComponent(id)}`)

interface Customer {
  id: string
  firstName: string
  lastName: string
  phone: string
  email: string
  serviceAddress: string
  city?: string
  state?: string
  zip?: string
  billingAddress: string
  billingDifferent: boolean
  leadSource: string
  notes: string
  tags: string[]
  createdAt: string
  salesRep: string
  firstApptDate: string
  jobStatus?: string
}

interface ImportedQuote {
  id: string
  customerId: string
  projectType: string
  sections: number
  mhQuoted: number
  tearOut: boolean
  quotedPrice: number
  laborBid: number
  depositAmt: number
  salesRep: string
  soldDate: string
  firstApptDate: string
}

interface Quote {
  id: string
  customerId: string
  type: string
  /** The fence name shown: a sold best price quote names its panels (quoteStyleLabel). */
  label?: string
  /** The count, or a repair's work (moveRepair.ts sectionsCell). */
  sections: number | string
  price: number
  margin: number
  status: 'DRAFT' | 'SENT' | 'SOLD' | 'LOST'
  date: string
}

interface Job {
  id: string
  customerId: string
  type: string
  /** The fence name shown: a sold best price job names its panels (soldStyleLabel). */
  label?: string
  /** The count, or a repair's work (moveRepair.ts sectionsCell). */
  sections: number | string
  value: number
  stage: string
  scheduledDate: string
  /** The sold quote the job came from: a Salesman's tap opens it (she cannot open Operations). */
  quoteId?: string
}

interface CustomerFile {
  id: string
  customerId: string
  name: string
  size: string
  type: string
  uploadedAt: string
}

// Lead sources and tags: Settings > Lead Sources and Settings > Customer Tags (configStore).

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT:  'bg-blue-100 text-blue-700',
  SOLD:  'bg-green-100 text-green-700',
  LOST:  'bg-red-100 text-red-700',
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const uid = () => Math.random().toString(36).slice(2, 9)

const SAMPLE_QUOTES: Quote[] = [
  { id: 'q1', customerId: 'c1', type: "CL - 6' Black", sections: 23, price: 6025, margin: 0.64, status: 'SENT', date: '2025-03-01' },
  { id: 'q2', customerId: 'c2', type: "WV-ND 6'x6'", sections: 68, price: 18400, margin: 0.66, status: 'SOLD', date: '2025-02-10' },
  { id: 'q3', customerId: 'c3', type: "Alum - ND - Emily - 48", sections: 24, price: 5743, margin: 0.63, status: 'SOLD', date: '2025-02-20' },
]

const SAMPLE_JOBS: Job[] = [
  { id: 'j1', customerId: 'c2', type: 'Vinyl', sections: 68, value: 18400, stage: 'SCHEDULED', scheduledDate: '2025-04-12' },
  { id: 'j2', customerId: 'c3', type: 'Aluminum', sections: 24, value: 5743, stage: 'COMPLETE', scheduledDate: '2025-03-08' },
]

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">👥</span>
        </div>
        <h3 className="font-bold text-gray-900 mb-1">No customer selected</h3>
        <p className="text-sm text-gray-400 mb-4">Select a customer from the list or create a new one</p>
        <button onClick={onNew} className="btn btn-primary">
          + New Customer
        </button>
      </div>
    </div>
  )
}

/**
 * A link to a customer who is not on this screen's lists: still loading, or
 * deleted (with where to bring them back, for the owner and admins), or not
 * there at all. Never a bare "No customer selected" (review, Oct 26 2026).
 */
function CustomerNotHere({ id }: { id: string }) {
  const [where, setWhere] = useState<{ state: 'active' | 'archived' | 'deleted' | 'missing'; name?: string; deletedAt?: string | null } | null | false>(null)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    let live = true
    void sendJson('GET', `/api/crm-contacts/${encodeURIComponent(id)}/whereabouts`).then(r => {
      if (!live) return
      // Refused (another login's customer, an installer's not his): as good as not there.
      setWhere(r.result.ok && r.json?.data?.state ? r.json.data : r.status === 403 || r.status === 404 ? { state: 'missing' } : false)
    })
    // On the server but not on the lists after a while: say so rather than "Opening…" for ever.
    const t = setTimeout(() => { if (live) setSlow(true) }, 20_000)
    return () => { live = false; clearTimeout(t) }
  }, [id])
  const box = (title: string, body: React.ReactNode, extra?: React.ReactNode) => (
    <div className="flex-1 flex items-center justify-center p-6" data-customer-not-here={where ? where.state : where === false ? 'unknown' : 'loading'}>
      <div className="text-center max-w-md">
        <h3 className="font-bold text-gray-900 mb-1">{title}</h3>
        <div className="text-sm text-gray-600 mb-4">{body}</div>
        <div className="flex flex-wrap justify-center gap-2">
          {extra}
          <button type="button" onClick={() => navigate('/customers')} className="btn btn-secondary">Customer list</button>
        </div>
      </div>
    </div>
  )
  // On the server and not deleted: the lists are still arriving (a link opened as the app starts).
  const opening = where === null || (where && (where.state === 'active' || where.state === 'archived'))
  if (opening && !slow) return box('Opening the customer…', 'One moment while the customer list loads.')
  if (where === false || opening) return box('This customer could not be opened', 'The app could not reach the server. Try again when there is signal.', <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>)
  if (where.state === 'deleted') {
    const who = where.name || 'This customer'
    const on = where.deletedAt ? ` on ${dayWords(where.deletedAt)}` : ''
    return box(`${who} was deleted`,
      can('records.delete')
        ? <>Deleted{on}, with their quotes, jobs and pipeline card. You can bring them back from Settings &gt; Deleted Records.</>
        : <>Deleted{on}. The owner or an admin can bring them back from Settings &gt; Deleted Records.</>,
      can('records.delete') ? <button type="button" className="btn btn-primary" onClick={() => navigate('/settings?tab=deleted')} data-open-deleted-records>Open Deleted Records</button> : null)
  }
  // The Salesman's list has the Salesman's own customers and the ones assigned (the server sends no others, and
  // answers another person's customer as not there): the same words as the job page's.
  return box('Customer not found', signedInRole() === 'sales_rep'
    ? 'This customer is not one of yours, or it was deleted. Ask the office if you need this one.'
    : 'This link names a customer who is not in the app.')
}

// ── Customer Form ─────────────────────────────────────────────────────────────

function CustomerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Customer>
  onSave: (c: Customer, bookEstimate?: boolean) => void
  onCancel: () => void
}) {
  const ownerChangesSalesman = useOwnerChangesSalesman()
  const [form, setForm] = useState<Customer>({
    id: initial?.id ?? newId(),
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    serviceAddress: initial?.serviceAddress ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    zip: initial?.zip ?? '',
    billingAddress: initial?.billingAddress ?? '',
    billingDifferent: initial?.billingDifferent ?? false,
    leadSource: initial?.leadSource ?? '',
    notes: initial?.notes ?? '',
    tags: initial?.tags ?? [],
    createdAt: initial?.createdAt ?? businessDate(new Date()),
    salesRep: initial?.salesRep ?? '',
    firstApptDate: initial?.firstApptDate ?? '',
    jobStatus: initial?.jobStatus ?? '',
  })

  function toggle(tag: string) {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag],
    }))
  }

  const canSave = form.firstName.trim() && form.lastName.trim()
  const [bookNow, setBookNow] = useState(false)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-6 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{initial?.id ? 'Edit Customer' : 'New Customer'}</h2>
          <p className="text-sm text-gray-400 mt-0.5">Fill in the details below</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            disabled={!canSave}
            onClick={() => onSave(form, bookNow)}
            className="btn btn-primary" data-customer-save
          >
            Save Customer
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-8 max-w-2xl">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-4">Contact Info</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">First Name</label>
              <input autoFocus className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.firstName} data-customer-field="first-name" onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" data-customer-field="last-name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Phone</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(352) 555-0100" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email</label>
              <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="name@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-4">Addresses</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Service Address — where the fence is being installed</label>
              {/* A picked suggestion keeps its city, state and ZIP; typed by hand, the server reads them from the address. */}
              <AddressAutocomplete placeholder="1349 SE 32nd St, Ocala, FL 34470"
                value={form.serviceAddress} inputAttrs={{ 'data-customer-field': 'address' }}
                onChange={v => setForm(f => ({ ...f, serviceAddress: v, city: '', state: '', zip: '' }))}
                onSelect={p => setForm(f => ({ ...f, serviceAddress: p.formatted, city: p.city, state: p.state, zip: p.zip }))} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="billingDiff" checked={form.billingDifferent} onChange={e => setForm(f => ({ ...f, billingDifferent: e.target.checked }))} className="accent-orange-500" />
              <label htmlFor="billingDiff" className="text-sm text-gray-600">Billing address is different from service address</label>
            </div>
            {form.billingDifferent && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Billing Address</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Billing address (street, city, state zip)"
                  value={form.billingAddress}
                  onChange={e => setForm(f => ({ ...f, billingAddress: e.target.value }))}
                />
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-4">Lead Source</h3>
          <div className="flex flex-wrap gap-2">
            {sourcePicker(form.leadSource).map(({ value: src, label }) => (
              <button key={src} data-lead-source-choice={src} onClick={() => setForm(f => ({ ...f, leadSource: f.leadSource === src ? '' : src }))} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${form.leadSource === src ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-300'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-4">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {tagPicker(form.tags).map(({ value: tag, label }) => (
              <button key={tag} data-tag-choice={tag} onClick={() => toggle(tag)} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${form.tags.includes(tag) ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-4">Sales Info</h3>
          <div className="grid grid-cols-2 gap-4">
            {!initial?.id ? (
              <SalesmanPicker value={form.salesRep} onChange={v => setForm(f => ({ ...f, salesRep: v }))} />
            ) : (
              // Once saved, the Salesman is changed on the customer page (Details), which also moves their cards.
              <div data-salesman-on-file>
                <span className="text-xs text-gray-500 mb-1 block">Salesman</span>
                <span className="text-sm text-gray-800 block">{form.salesRep || 'None'}</span>
                <span className="text-xs text-gray-500 block mt-0.5">{ownerChangesSalesman ? 'Change it on the customer page, under Salesman.' : OWNER_ONLY_WORDS}</span>
              </div>
            )}
            {!initial?.id ? (
              <label className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 cursor-pointer" data-book-estimate-now>
                <input type="checkbox" className="mt-0.5" checked={bookNow} onChange={e => setBookNow(e.target.checked)} />
                <span className="text-sm text-gray-800"><b>Book estimate now</b><span className="block text-xs text-gray-500">Opens the booking dialog after saving, with the Salesman chosen here.</span></span>
              </label>
            ) : (
              <div className="text-xs text-gray-500 self-end pb-2">Appointments are booked from the customer page (Book appointment).</div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-4">Notes</h3>
          <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" rows={4} placeholder="HOA requirements, gate swing direction, dog fence, access notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
    </div>
  )
}

// ── Customer Billing Tab ─────────────────────────────────────────────────────

function CustomerBillingTab({ customerId, customerName, customerEmail }: { customerId: string; customerName: string; customerEmail: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [showPayment, setShowPayment] = useState<string | null>(null) // invoiceId
  const [sub, setSub] = useState<'overview' | 'invoices' | 'payments'>('overview')

  const load = useCallback(() => {
    setInvoices(getInvoicesForCustomer(customerId))
    setPayments(getPaymentsForCustomer(customerId))
  }, [customerId])
  useEffect(() => { load() }, [load])

  const summary = getBillingSummary(customerId)
  const fmtD = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-sky-100 text-sky-700',
    partially_paid: 'bg-yellow-100 text-yellow-700', paid: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700', void: 'bg-gray-100 text-gray-400',
  }

  // The payment schedules are what is owed (one source with the job's Financial and Billing); the old
  // hand-typed invoices show only for a customer who has some, so a $0.00 block never contradicts them.
  if (!invoices.length && !payments.length) return <div className="space-y-4"><PaymentsPanel customerId={customerId} /></div>
  return (
    <div className="space-y-4">
      {/* The payment schedules of this customer's sold jobs: due, paid, balance, Payment received (Payments.tsx). */}
      <PaymentsPanel customerId={customerId} />
      <p className="text-xs font-semibold text-gray-400">Invoices typed in Billing before payment schedules</p>
      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
        {(['overview', 'invoices', 'payments'] as const).map(t => (
          <button key={t} onClick={() => setSub(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition ${sub === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{t}</button>
        ))}
      </div>

      {sub === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Total Billed</p><p className="text-lg font-bold text-gray-900">{fmtD(summary.totalBilledCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Paid</p><p className="text-lg font-bold text-green-600">{fmtD(summary.totalPaidCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Outstanding</p><p className="text-lg font-bold text-orange-600">{fmtD(summary.outstandingCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Overdue</p><p className="text-lg font-bold text-red-600">{fmtD(summary.overdueCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Invoices</p><p className="text-lg font-bold text-gray-900">{summary.invoiceCount}</p></div>
          </div>
          {/* Aging */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">Aging Summary</h3>
            <div className="grid grid-cols-5 gap-2 text-center text-sm">
              <div><p className="text-xs text-gray-400">Current</p><p className="font-semibold text-green-600">{fmtD(summary.agingCurrent)}</p></div>
              <div><p className="text-xs text-gray-400">1-30d</p><p className="font-semibold text-yellow-600">{fmtD(summary.aging1to30)}</p></div>
              <div><p className="text-xs text-gray-400">31-60d</p><p className="font-semibold text-orange-600">{fmtD(summary.aging31to60)}</p></div>
              <div><p className="text-xs text-gray-400">61-90d</p><p className="font-semibold text-red-600">{fmtD(summary.aging61to90)}</p></div>
              <div><p className="text-xs text-gray-400">90+</p><p className="font-semibold text-red-700">{fmtD(summary.aging90plus)}</p></div>
            </div>
          </div>
        </div>
      )}

      {sub === 'invoices' && (
        <div className="space-y-3">
          <div className="flex justify-between">
            <p className="text-sm text-gray-500">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
            <button onClick={() => setShowCreateInvoice(true)} className="btn btn-primary">+ Create Invoice</button>
          </div>
          {invoices.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No invoices yet</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
              {invoices.map(inv => (
                <div key={inv.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{inv.invoiceNumber} — {inv.title}</p>
                    <p className="text-xs text-gray-500">Due: {inv.dueDate} {inv.jobName ? `· Job: ${inv.jobName}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{fmtD(inv.totalCents)}</p>
                      {inv.balanceDueCents > 0 && <p className="text-xs text-red-600">Due: {fmtD(inv.balanceDueCents)}</p>}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                    {inv.adoptedJobId && <span className="text-xs text-green-700" data-adopted-invoice>On the job's payment schedule</span>}
                    {inv.balanceDueCents > 0 && inv.status !== 'void' && !inv.adoptedJobId && (
                      <button onClick={() => setShowPayment(inv.id)} className="text-xs text-blue-600 hover:text-blue-800">Record Payment</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sub === 'payments' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{payments.length} payment{payments.length !== 1 ? 's' : ''}</p>
          {payments.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No payments recorded yet</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
              {payments.map(pay => (
                <div key={pay.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{fmtD(pay.amountCents)}</p>
                    <p className="text-xs text-gray-500">{pay.paymentDate} · {pay.paymentMethod} · Inv: {pay.invoiceNumber}</p>
                  </div>
                  {pay.referenceNumber && <span className="text-xs text-gray-400">Ref: {pay.referenceNumber}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateInvoice && (
        <CreateInvoiceModal customerId={customerId} customerName={customerName} onClose={() => setShowCreateInvoice(false)} onCreated={() => { setShowCreateInvoice(false); load() }} />
      )}

      {/* Record Payment Modal */}
      {showPayment && (
        <RecordPaymentModal invoiceId={showPayment} customerId={customerId} customerName={customerName} onClose={() => setShowPayment(null)} onRecorded={() => { setShowPayment(null); load() }} />
      )}
    </div>
  )
}

function CreateInvoiceModal({ customerId, customerName, onClose, onCreated }: { customerId: string; customerName: string; onClose: () => void; onCreated: () => void }) {
  useBackLayer(onClose, { key: 'create-invoice-modal' })
  const [title, setTitle] = useState('')
  const [invoiceNumber] = useState(nextInvoiceNumber())
  const [dueDate, setDueDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10) })
  const [lineItems, setLineItems] = useState<{ desc: string; qty: number; price: number }[]>([{ desc: '', qty: 1, price: 0 }])
  const [taxRate, setTaxRate] = useState(0)
  const [discountCents, setDiscountCents] = useState(0)
  const [notes, setNotes] = useState('')

  const subtotal = lineItems.reduce((s, li) => s + Math.round(li.qty * li.price * 100), 0)
  const tax = Math.round(subtotal * taxRate)
  const total = subtotal + tax - discountCents

  function addLine() { setLineItems([...lineItems, { desc: '', qty: 1, price: 0 }]) }
  function removeLine(i: number) { setLineItems(lineItems.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, field: string, val: any) { setLineItems(lineItems.map((li, idx) => idx === i ? { ...li, [field]: val } : li)) }

  // Tapped twice before the window closes: saved once.
  const savedOnce = useRef(false)
  function save() {
    if (savedOnce.current) return
    savedOnce.current = true
    createInvoice({
      customerId, customerName, invoiceNumber, title: title || `Invoice ${invoiceNumber}`,
      status: 'draft',
      lineItems: lineItems.map((li, i) => ({ id: Math.random().toString(36).slice(2), description: li.desc, quantity: li.qty, unitPriceCents: Math.round(li.price * 100), totalCents: Math.round(li.qty * li.price * 100), sortOrder: i })),
      subtotalCents: subtotal, taxRate, taxCents: tax, discountCents, totalCents: total,
      amountPaidCents: 0, dueDate, issuedDate: businessDate(new Date()),
      notes, createdBy: 'admin',
    })
    onCreated()
  }

  const fmtD = (c: number) => '$' + (c / 100).toFixed(2)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] max-h-[90vh] overflow-y-auto p-5 mx-4 space-y-4 modal-responsive">
        <div className="flex justify-between"><h2 className="font-bold text-gray-900 text-lg">Create invoice</h2><button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 text-xl">×</button></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">Invoice #</label><input value={invoiceNumber} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        </div>
        <div><label className="block text-xs text-gray-500 mb-1">Title</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Fence Installation" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>

        <div>
          <div className="flex justify-between mb-2"><label className="text-xs text-gray-500 font-semibold">Line Items</label><button onClick={addLine} className="text-xs text-orange-600">+ Add</button></div>
          {lineItems.map((li, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <input value={li.desc} onChange={e => updateLine(i, 'desc', e.target.value)} placeholder="Description" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              <input type="number" value={li.qty} onChange={e => updateLine(i, 'qty', parseFloat(e.target.value) || 0)} className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center" />
              <input type="number" step="0.01" value={li.price} onChange={e => updateLine(i, 'price', parseFloat(e.target.value) || 0)} placeholder="$" className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              <span className="text-sm text-gray-600 w-20 text-right self-center">{fmtD(Math.round(li.qty * li.price * 100))}</span>
              {lineItems.length > 1 && <button onClick={() => removeLine(i)} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-300 hover:text-red-500">×</button>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">Tax %</label><input type="number" step="0.1" value={taxRate * 100} onChange={e => setTaxRate((parseFloat(e.target.value) || 0) / 100)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Discount $</label><input type="number" step="0.01" value={discountCents / 100} onChange={e => setDiscountCents(Math.round((parseFloat(e.target.value) || 0) * 100))} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div className="text-right pt-5"><p className="text-lg font-bold text-gray-900">{fmtD(total)}</p><p className="text-xs text-gray-400">Total</p></div>
        </div>

        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={save} className="btn btn-primary flex-1">Create invoice</button>
        </div>
      </div>
    </div>
  )
}

function RecordPaymentModal({ invoiceId, customerId, customerName, onClose, onRecorded }: { invoiceId: string; customerId: string; customerName: string; onClose: () => void; onRecorded: () => void }) {
  useBackLayer(onClose, { key: 'record-payment-modal' })
  const inv = getInvoicesForCustomer(customerId).find(i => i.id === invoiceId)
  const [amount, setAmount] = useState(inv ? inv.balanceDueCents / 100 : 0)
  const [method, setMethod] = useState<string>('check')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(businessDate(new Date()))
  const [notes, setNotes] = useState('')

  if (!inv) return null

  // Tapped twice before the window closes: saved once.
  const savedOnce = useRef(false)
  function save() {
    if (savedOnce.current) return
    savedOnce.current = true
    recordPayment({
      invoiceId, invoiceNumber: inv!.invoiceNumber, customerId, customerName,
      amountCents: Math.round(amount * 100), paymentMethod: method as any,
      referenceNumber: ref, paymentDate: date, recordedBy: 'admin', notes,
    })
    onRecorded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] p-5 mx-4 space-y-4 modal-responsive">
        <h2 className="font-bold text-gray-900">Record Payment — {inv.invoiceNumber}</h2>
        <p className="text-sm text-gray-500">Balance due: ${(inv.balanceDueCents / 100).toFixed(2)}</p>
        <div><label className="block text-xs text-gray-500 mb-1">Amount</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Method</label><select value={method} onChange={e => setMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="cash">Cash</option><option value="check">Check</option><option value="credit_card">Credit Card</option><option value="bank_transfer">Bank Transfer</option><option value="other">Other</option></select></div>
        <div><label className="block text-xs text-gray-500 mb-1">Reference #</label><input value={ref} onChange={e => setRef(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Check # or transaction ID" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={save} className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-xl">Record Payment</button>
        </div>
      </div>
    </div>
  )
}

// ── Customer Notes Tab ──────────────────────────────────────────────────────

/** Notes drawn at first and per "Show more". */
const NOTES_PAGE = 30

function CustomerNotesTab({ customerId }: { customerId: string }) {
  const [notes, setNotes] = useState<CrmContactNoteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [search, setSearch] = useState('')
  // A page of notes at a time: a customer of many years can have hundreds.
  const [limit, setLimit] = useState(NOTES_PAGE)
  useEffect(() => { setLimit(NOTES_PAGE) }, [search])

  const [loadFailed, setLoadFailed] = useState(false)
  const load = useCallback(async () => {
    const rows = await listContactNotes(customerId)
    setLoadFailed(!rows)
    if (rows) setNotes(rows)
    setLoading(false)
  }, [customerId])
  useEffect(() => { setLoading(true); load() }, [load])

  async function handleCreate() {
    const body = newNote.trim()
    if (!body || busy) return
    setBusy(true)
    const created = await createContactNote(customerId, { body })
    setBusy(false)
    if (created) {
      setNewNote('')
      load()
    }
  }

  async function handlePin(id: string, pinned: boolean) {
    setBusy(true)
    const updated = await updateContactNote(customerId, id, { isPinned: !pinned })
    setBusy(false)
    if (updated) load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this note?')) return
    setBusy(true)
    const ok = await deleteContactNote(customerId, id)
    setBusy(false)
    if (ok) load()
  }

  function startEdit(n: CrmContactNoteRecord) { setEditingId(n.id); setEditBody(n.body) }

  async function saveEdit() {
    if (!editingId) return
    const body = editBody.trim()
    if (!body) return
    setBusy(true)
    const updated = await updateContactNote(customerId, editingId, { body })
    setBusy(false)
    if (updated) {
      setEditingId(null)
      load()
    }
  }

  const filtered = search ? notes.filter(n => n.body.toLowerCase().includes(search.toLowerCase())) : notes

  return (
    <div className="space-y-4">
      {/* Add note */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note..." rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-orange-400 outline-none" />
        <div className="flex justify-end mt-2">
          <button onClick={handleCreate} disabled={!newNote.trim() || busy} className="btn btn-primary disabled:opacity-40">Add Note</button>
        </div>
      </div>

      {/* Search */}
      {notes.length > 3 && (
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      )}

      {/* Notes list */}
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading notes…</div>
      ) : loadFailed && filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm">The notes did not load, usually because of weak signal. <button type="button" className="text-orange-700 font-semibold underline min-h-[44px]" onClick={() => { setLoading(true); load() }}>Try again</button></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No notes yet</div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, limit).map(n => (
            <div key={n.id} className={`bg-white rounded-xl border ${n.isPinned ? 'border-orange-300 bg-orange-50' : 'border-gray-200'} p-4`} data-note={n.id}>
              <SaveStatus keys={[`note:${n.id}`]} quietWhenSaved className="mb-2" />
              {editingId === n.id ? (
                <div>
                  <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={saveEdit} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {n.isPinned && <span className="text-xs text-orange-600 font-semibold mr-2">📌 Pinned</span>}
                      {n.visibility === 'internal' && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded mr-2">Internal</span>}
                      <p className="text-sm text-gray-800 whitespace-pre-wrap mt-1">{n.body}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => handlePin(n.id, n.isPinned)} className="text-xs text-gray-400 hover:text-orange-600">{n.isPinned ? 'Unpin' : 'Pin'}</button>
                      <button onClick={() => startEdit(n)} className="text-xs text-gray-400 hover:text-blue-600">Edit</button>
                      {can('ops.delete') && <button onClick={() => handleDelete(n.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{noteAuthor(n)} · {new Date(n.createdAt).toLocaleString()}</p>
                </>
              )}
            </div>
          ))}
          {filtered.length > limit && (
            <button type="button" className="btn btn-quiet btn-sm w-full" data-show-more="notes" onClick={() => setLimit(l => l + NOTES_PAGE)}>
              Show {Math.min(NOTES_PAGE, filtered.length - limit)} more <span className="font-normal text-gray-500">({limit} of {filtered.length})</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Customer Pull Sheets Tab: CustomerPullSheets.tsx (read from the server) ──

// ── Customer Job Costing Tab ──────────────────────────────────────────────────

function CustomerJobCostingTab({ quotes }: { quotes: any[] }) {
  const costEntries: any[] = (() => {
    try { const r = cloudStorage.getItem('fencepro_jobcosting'); return r ? JSON.parse(r) : [] } catch { return [] }
  })()

  const soldQuotes = quotes.filter((q: any) => q.status === 'SOLD')
  const costedJobs = soldQuotes.map((q: any) => {
    const entry = costEntries.find((e: any) => e.quoteId === q.id)
    if (!entry) return null
    const estLabor = (q.adjLaborHrs || 0) * 22
    const actLabor = entry.actualLaborHrs * 22
    const estCOGS = q.totalCOGS || 0
    const actCOGS = actLabor + entry.actualMaterialCost + (entry.actualOtherCosts || 0)
    const variance = actCOGS - estCOGS
    const estGM = shownMargin(q, seesCommission(signedInRole(), can('costs.view'))) || 0
    const actGM = q.finalPrice > 0 ? (q.finalPrice - actCOGS) / q.finalPrice : 0
    return { quote: q, entry, estCOGS, actCOGS, variance, estGM, actGM }
  }).filter(Boolean) as any[]

  const totalEst = costedJobs.reduce((s: number, j: any) => s + j.estCOGS, 0)
  const totalAct = costedJobs.reduce((s: number, j: any) => s + j.actCOGS, 0)
  const totalVariance = totalAct - totalEst

  const fmtD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
  const fmtP = (n: number) => `${(n * 100).toFixed(1)}%`
  const varColor = (v: number) => v > 0 ? 'text-red-600' : v < 0 ? 'text-green-600' : 'text-gray-600'

  if (costedJobs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="font-medium">No job costing data</p>
        {/* Budget is the owner's: no pointer to a screen the login cannot open (review Oct 27 2026: a Salesman was sent there). */}
        <p className="text-sm mt-1">{signedInRole() === 'super_admin' ? 'Complete jobs and enter actual costs in Budget → Job Costing to see data here.' : 'Shows here once a completed job has its actual costs entered.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Jobs Costed</p><p className="text-lg font-bold text-gray-900">{costedJobs.length}</p></div>
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Est. COGS</p><p className="text-lg font-bold text-gray-900">{fmtD(totalEst)}</p></div>
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Actual COGS</p><p className="text-lg font-bold text-gray-900">{fmtD(totalAct)}</p></div>
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Variance</p><p className={`text-lg font-bold ${varColor(totalVariance)}`}>{totalVariance > 0 ? '+' : ''}{fmtD(totalVariance)}</p></div>
      </div>

      {/* Job list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 grid grid-cols-7 gap-2 text-xs font-medium text-gray-500">
          <div className="col-span-2">Job</div><div>Est. COGS</div><div>Actual</div><div>Variance</div><div>Est. GM</div><div>Actual GM</div>
        </div>
        <div className="divide-y divide-gray-50">
          {costedJobs.map((j: any) => (
            <div key={j.quote.id} className="px-4 py-3 grid grid-cols-7 gap-2 items-center text-sm hover:bg-gray-50">
              <div className="col-span-2">
                <p className="font-medium text-gray-900">{j.quote.customerName}</p>
                <p className="text-xs text-gray-400">{styleLabel(j.quote.fenceStyle)} • {j.entry.completionDate}</p>
              </div>
              <div className="text-gray-700">{fmtD(j.estCOGS)}</div>
              <div className="text-gray-700">{fmtD(j.actCOGS)}</div>
              <div className={`font-medium ${varColor(j.variance)}`}>{j.variance > 0 ? '+' : ''}{fmtD(j.variance)}</div>
              <div className="text-gray-700">{fmtP(j.estGM)}</div>
              <div className={`font-medium ${j.actGM >= j.estGM ? 'text-green-600' : 'text-red-600'}`}>{fmtP(j.actGM)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Customer Detail ───────────────────────────────────────────────────────────

/** The customer's pipeline stage, changeable from the customer page. Shows
 *  nothing for a customer who has no pipeline card. */
function PipelineStageSelect({ customerId }: { customerId: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener('fencepro:pipeline:updated', bump)
    return () => window.removeEventListener('fencepro:pipeline:updated', bump)
  }, [])
  usePipelineStages()   // a rename in Settings shows here at once
  const lead = (getPipeline().leads || []).find((l: any) => l.customerId === customerId)
  if (!lead) return null
  const stages = loadPipeline().stages
  const options = stages.includes(lead.stage) ? stages : [lead.stage, ...stages]
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">
      Pipeline stage
      <select
        className="border border-gray-300 rounded-lg px-2 py-1 text-xs font-semibold text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
        value={lead.stage}
        onChange={e => { changeLeadStage(lead.id, e.target.value); setTick(t => t + 1) }}
      >
        {options.map(s => <option key={s} value={s}>{pipelineStageName(s)}</option>)}
      </select>
    </label>
  )
}

/** A media query's answer, kept up to date when the window is resized or turned. */
function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = () => setOn(mq.matches)
    h()
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return on
}
/** Wide enough for the side by side customer screen (Tailwind's lg): the actions in the header instead of the bar at the bottom. */
const useWide = () => useMedia('(min-width: 1024px)')
/** Wide enough for the details column beside the tabs (Tailwind's xl); narrower, the details are a tab. */
const useDetailsColumn = () => useMedia('(min-width: 1280px)')

/** Rows drawn at first and per "Show more" in the customer's tabs. */
const LIST_PAGE = 25

/** Call and Text from the customer screen ask "How'd it go?" afterwards, as the pipeline card does. */
function touchCustomer(customer: Customer, channel: 'call' | 'text') {
  const lead = (getPipeline().leads || []).find((l: any) => l.customerId === customer.id)
  if (!lead || !customer.phone) return
  const name = `${customer.firstName} ${customer.lastName}`.trim() || 'Customer'
  startTouch({ cardId: lead.id, customerId: customer.id, name, firstName: customer.firstName, phone: customer.phone, stage: lead.stage, channel })
}

/**
 * The customer's main actions on a phone: one row that stays put at the
 * bottom, above the tab bar (and the safe area), while the rest scrolls.
 */
function CustomerActionBar({ customer, onNewQuote, onEdit }: { customer: Customer; onNewQuote: () => void; onEdit: () => void }) {
  const item = 'flex flex-col items-center justify-center gap-0.5 min-w-0 h-14 rounded-xl text-[11px] font-semibold leading-tight text-center'
  const plain = `${item} text-gray-800 bg-white border border-gray-200 active:bg-orange-50`
  const off = 'opacity-40 pointer-events-none'
  const phone = customer.phone || ''
  const address = customer.serviceAddress || ''
  return (
    <div data-customer-actions
      className="fixed inset-x-0 z-30 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-0 md:pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] px-2 py-1.5 grid grid-cols-[1.45fr_1fr_1fr_1.25fr_1fr_1fr] gap-1">
      <button type="button" onClick={onNewQuote} data-customer-action="new-quote" className={`${item} bg-orange-500 text-white active:bg-orange-600`}>
        <FilePlus2 size={20} aria-hidden="true" />New quote
      </button>
      <a href={phone ? telHref(phone) : undefined} onClick={() => touchCustomer(customer, 'call')} aria-disabled={!phone} data-customer-action="call" className={`${plain} ${phone ? '' : off}`}>
        <Phone size={20} aria-hidden="true" />Call
      </a>
      <TextButton phone={phone} firstName={customer.firstName} name={`${customer.firstName} ${customer.lastName}`.trim()} onTap={() => touchCustomer(customer, 'text')} data-customer-action="text" className={`${plain} ${phone ? '' : off}`}>
        <MessageSquare size={20} aria-hidden="true" />Text
      </TextButton>
      <a href={address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!address} data-customer-action="navigate" className={`${plain} ${address ? '' : off}`}>
        <Navigation size={20} aria-hidden="true" />Navigate
      </a>
      <button type="button" onClick={() => openBooking({ customerId: customer.id })} aria-label="Book appointment" data-customer-action="book" data-book-appointment className={plain}>
        <CalendarPlus size={20} aria-hidden="true" />Book
      </button>
      <button type="button" onClick={onEdit} data-customer-action="edit" className={plain}>
        <Pencil size={20} aria-hidden="true" />Edit
      </button>
    </div>
  )
}

/**
 * A customer's own archived jobs and pipeline cards, each with Unarchive (the
 * record's own way back). Hidden while the whole customer is archived: its
 * Unarchive brings those back with it.
 */
function ArchivedOfCustomer({ customerId, customerArchived }: { customerId: string; customerArchived: boolean }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick(t => t + 1)
    window.addEventListener('fencepro:jobs:updated', on)
    window.addEventListener('fencepro:pipeline:updated', on)
    return () => { window.removeEventListener('fencepro:jobs:updated', on); window.removeEventListener('fencepro:pipeline:updated', on) }
  }, [])
  const [busy, setBusy] = useState<string | null>(null)
  if (customerArchived) return null
  const jobs = getArchivedJobs().filter(j => j.customerId === customerId)
  const cards = getArchivedCards().filter(c => c?.customerId === customerId)
  if (!jobs.length && !cards.length) return null
  const back = async (kind: 'job' | 'card', id: string) => {
    setBusy(id)
    const r = await unarchiveRecord(kind, id)
    setBusy(null)
    if (r.ok) toast.success(kind === 'job' ? 'Job unarchived' : 'Card unarchived', kind === 'job' ? 'It is back on the operations board.' : 'It is back on the pipeline.')
    else toast.error('Not unarchived', r.error || 'Try again.')
  }
  const canJob = can('records.archive') && can('schedule.change')
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2" data-customer-archived-children>
      <p className="text-xs font-semibold text-gray-600">Archived</p>
      {jobs.map(j => (
        <div key={j.id} className="flex flex-wrap items-center gap-2" data-archived-job={j.id}>
          <span className="flex-1 min-w-[10rem] text-sm text-gray-800 break-words">Job: {styleLabel(j.fenceStyle) || 'fence'}{j.contractValue ? `, ${fmt(j.contractValue)}` : ''}</span>
          {canJob && <button className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy === j.id} onClick={() => back('job', j.id)} data-unarchive-job={j.id}>Unarchive</button>}
        </div>
      ))}
      {cards.map(c => (
        <div key={c.id} className="flex flex-wrap items-center gap-2" data-archived-card={c.id}>
          <span className="flex-1 min-w-[10rem] text-sm text-gray-800 break-words">Pipeline card{c.stage ? ` (${c.stage})` : ''}</span>
          {can('records.archive') && <button className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy === c.id} onClick={() => back('card', c.id)} data-unarchive-card={c.id}>Unarchive</button>}
        </div>
      ))}
    </div>
  )
}

/** A sold quote's worth: its job's contract value (signed price plus change orders) when it has a job, else the quote's price. */
function soldValueOf(q: { id: string; price: number }): number {
  const j = getJobs().find(x => x.quoteId === q.id) ?? getArchivedJobs().find(x => x.quoteId === q.id)
  return j && j.contractValue > 0 ? j.contractValue : q.price
}

/** The customer's status as their records say it: newest job's stage (Operations), else their open pipeline card's stage, else the stored status. */
function customerStatusWords(customer: Customer): string {
  const job = [...getJobs(), ...getArchivedJobs()].filter(j => j.customerId === customer.id).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0]
  if (job) return `Job: ${stageName(stageOf(job)) || job.status}`
  const card = (getPipeline().leads || []).find((l: any) => l.customerId === customer.id)
  if (card?.stage) return pipelineStageName(card.stage) || card.stage
  return customer.jobStatus ? (pipelineStageName(customer.jobStatus) || customer.jobStatus) : ''
}

/** The property address in full: the street as typed, with the city, state and ZIP when it does not already say them. */
function fullAddress(c: Customer): string {
  const street = (c.serviceAddress || '').trim()
  const rest = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].map(s => (s || '').trim()).filter(Boolean)
  const missing = rest.filter(part => !street.toLowerCase().includes(part.toLowerCase()))
  return [street, ...missing].filter(Boolean).join(', ')
}
const mapsSearchUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
const directionsTo = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`

/** What was logged on this phone about the customer (portal invites, photo uploads), as history rows. */
function localActivityOf(customerId: string): HistoryItem[] {
  return getActivityForCustomer(customerId).map((a: any) => {
    const name = a?.meta?.name ? `: ${a.meta.name}` : ''
    const title = a.body || (a.action === 'photo_uploaded' ? `Photo uploaded${name}` : a.action === 'photo_deleted' ? `Photo deleted${name}` : String(a.action || ''))
    return { at: String(a.at || ''), kind: 'info', title, detail: '', by: a.actor && a.actor !== 'user' && a.actor !== 'system' ? String(a.actor) : '' }
  }).filter(h => h.title && !Number.isNaN(Date.parse(h.at)))
}

/**
 * The customer's contact details, texting answer, pipeline stage and tags: the
 * column on the left on a wide screen, the Details tab on a narrower one.
 */
function CustomerDetailsPanel({ customer, showStage }: { customer: Customer; showStage: boolean }) {
  const name = `${customer.firstName} ${customer.lastName}`.trim()
  const address = fullAddress(customer)
  const rows: Array<{ label: string; value: string; node?: React.ReactNode }> = [
    { label: 'Service Address', value: address, node: address ? <a href={mapsSearchUrl(address)} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{address}</a> : null },
    ...(customer.billingDifferent ? [{ label: 'Billing Address', value: customer.billingAddress }] : []),
    { label: 'Phone', value: customer.phone, node: customer.phone ? <PhoneLink phone={customer.phone} customerId={customer.id} name={name} data-customer-phone /> : null },
    { label: 'Email', value: customer.email, node: customer.email ? <a href={`mailto:${customer.email}`} className="text-blue-700 hover:underline">{customer.email}</a> : null },
    { label: 'Lead Source', value: sourceLabel(customer.leadSource) },
    { label: 'First Appt', value: customer.firstApptDate },
    // Where the customer really is: their newest job's Operations stage, else their pipeline card's stage; the typed or imported status only when there is neither.
    { label: 'Job Status', value: customerStatusWords(customer) },
    { label: 'Customer Since', value: dayWords(customer.createdAt) },
  ]
  return (
    <div className="space-y-4" data-customer-details>
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <h3 className="font-bold text-gray-900">Contact details</h3>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
          {rows.filter(r => r.value).map(r => (
            <div key={r.label} className="contents">
              <span className="text-xs text-gray-500 pt-0.5">{r.label}</span>
              <span className="text-sm text-gray-800 min-w-0 [overflow-wrap:anywhere]">{r.node ?? r.value}</span>
            </div>
          ))}
        </div>
        <SalesmanOnCustomer customerId={customer.id} salesRep={customer.salesRep} />
        {showStage && <div className="flex flex-wrap items-center gap-2"><PipelineStageSelect customerId={customer.id} /><NextAppointmentBadge customerId={customer.id} /></div>}
        <TextConsent customerId={customer.id} />
        {customer.tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {customer.tags.map(tag => (
              <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full" data-customer-tag={tag}>{tagLabel(tag)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The row under the header, most used first: open quotes, jobs, balance due,
 * next appointment, last contact, total revenue, customer since. A tap opens
 * the tab it comes from (or the booking for the appointment). Money only for a
 * login that sees prices.
 */
function CustomerSummary({ customer, quotes, importedQuotes, jobs, history, onTab }: {
  customer: Customer; quotes: Quote[]; importedQuotes: ImportedQuote[]; jobs: Job[]
  history: HistoryItem[] | null
  onTab: (t: CustomerTab) => void
}) {
  const prices = can('prices.view')
  const appointments = useAppointmentList()
  const next = nextFor(customer.id, appointments)
  // Payment schedules of the customer's sold jobs (the Billing tab reads the same ones).
  const [scheduleJobs, setScheduleJobs] = useState<string[]>([])
  // Signed jobs with no payment schedule yet: what they owe is not known, so never "Nothing owed".
  const [withoutJobs, setWithoutJobs] = useState<string[]>([])
  const [paymentsLoaded, setPaymentsLoaded] = useState<boolean | null>(null)
  const version = useSyncExternalStore(subscribePayments, paymentsVersion)
  useEffect(() => {
    if (!prices) return
    let live = true
    void loadPaymentsOf(customer.id).then(d => {
      if (!live) return
      if (!d) { setPaymentsLoaded(l => l ?? false); return }
      setScheduleJobs(d.schedules.map(s => s.jobId)); setWithoutJobs(d.without.map(w => w.jobId)); setPaymentsLoaded(true)
    })
    return () => { live = false }
  }, [customer.id, prices])
  // A schedule made on the Billing tab (the store says so): that job is no longer without one.
  const without = withoutJobs.filter(id => !scheduleOf(id))
  const scheduled = [...new Set([...scheduleJobs, ...withoutJobs.filter(id => !!scheduleOf(id))])]
  void version
  const balance = balanceDueCents(scheduled.map(id => scheduleOf(id)?.balanceCents ?? 0), prices ? getInvoicesForCustomer(customer.id) : [])
  const bal = balanceTile({ loaded: paymentsLoaded, balanceCents: balance, withoutSchedule: without.length })
  const open = openQuotesOf(quotes)
  const allQuotes = quotes.length + importedQuotes.length
  const totalRevenue = quotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + soldValueOf(q), 0) + importedQuotes.reduce((s, q) => s + q.quotedPrice, 0)
  const newestJob = [...jobs].sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))[0]
  const last = lastContactOf(history)
  const tile = 'rounded-xl bg-gray-50 hover:bg-orange-50 border border-transparent hover:border-orange-200 px-2 py-1.5 sm:px-2.5 sm:py-2 text-left min-w-0 transition-colors'
  const Label = ({ children }: { children: React.ReactNode }) => <span className="block text-[10px] sm:text-[11px] text-gray-500 truncate">{children}</span>
  // A phone lets a value take two short lines ("Not set up", "Mon 10:00 AM") rather than cutting it off.
  const Value = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <span className={`block text-[13px] sm:text-sm font-bold text-gray-900 leading-tight sm:leading-normal break-words sm:truncate ${className}`}>{children}</span>
  // The line under the number: on a computer only (a phone keeps the row to two lines of tiles).
  const Sub = ({ children }: { children: React.ReactNode }) => <span className="hidden sm:block text-[11px] text-gray-500 truncate">{children}</span>
  const sinceShort = (() => { const d = new Date(customer.createdAt); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) })()
  return (
    <div className="grid grid-cols-4 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-1.5 sm:gap-2" data-customer-summary>
      <button type="button" className={tile} onClick={() => onTab('quotes')} data-customer-summary-item="open-quotes">
        <Label>Open quotes</Label><Value>{open.count}</Value>
        <Sub>{prices && open.count ? fmt(open.cents / 100) : `${allQuotes} in all`}</Sub>
      </button>
      <button type="button" className={tile} onClick={() => onTab('jobs')} data-customer-summary-item="jobs">
        <Label>Jobs</Label><Value>{jobs.length}</Value>
        <Sub>{newestJob ? stageName(newestJob.stage) || 'Job' : 'None yet'}</Sub>
      </button>
      {prices && (
        <button type="button" className={tile} onClick={() => onTab('billing')} data-customer-summary-item="balance" data-balance-cents={balance}
          data-balance-state={bal.value === 'none' ? (without.length ? 'no-schedule' : 'unknown') : balance > 0 ? 'owed' : 'nothing'}
          title={bal.sub}>
          <Label>Balance due</Label><Value className={bal.attention ? 'text-orange-700' : ''}>{bal.value === 'money' ? money(balance) : bal.words}</Value>
          {/* On a phone too when there is no number: "Not set up" alone does not say what is missing. */}
          {bal.value === 'none' && bal.attention
            ? <span className="block text-[10px] sm:text-[11px] text-orange-700 leading-tight" data-balance-sub>{bal.sub}</span>
            : <Sub>{bal.sub}</Sub>}
        </button>
      )}
      <button type="button" className={tile} onClick={() => openBooking(next ? { appointmentId: next.id } : { customerId: customer.id })} data-customer-summary-item="next-appointment">
        <Label>Next appt</Label><Value>{next ? shortWhen(next) : 'None'}</Value>
        <Sub>{next ? TYPE_LABELS[next.type] : 'Tap to book'}</Sub>
      </button>
      <button type="button" className={tile} onClick={() => onTab('activity')} data-customer-summary-item="last-contact">
        <Label>Last contact</Label><Value>{history === null ? '…' : last ? dayWords(last.at) : 'None'}</Value>
        <Sub>{last ? last.title : 'Calls, texts, emails'}</Sub>
      </button>
      {prices && (
        <button type="button" className={tile} onClick={() => onTab('quotes')} data-customer-summary-item="revenue">
          <Label><span className="sm:hidden">Revenue</span><span className="hidden sm:inline">Total revenue</span></Label><Value>{fmt(totalRevenue)}</Value><Sub>Sold</Sub>
        </button>
      )}
      <div className={`${tile.replace(/hover:\S+/g, '')}`} data-customer-summary-item="since">
        <Label><span className="sm:hidden">Since</span><span className="hidden sm:inline">Customer since</span></Label><Value><span className="sm:hidden">{sinceShort || dayWords(customer.createdAt)}</span><span className="hidden sm:inline">{dayWords(customer.createdAt)}</span></Value>
      </div>
    </div>
  )
}

function CustomerDetail({
  customer, quotes, importedQuotes, jobs, files, roundTop = true,
  onEdit, onNewQuote, onDelete, onDeleteFile, onQuoteClick, onFileClick, initialTab, onTabConsumed, archived = false, onArchive,
}: {
  customer: Customer
  /** Archived: off the active list; still found by search, and Unarchive is right here. */
  archived?: boolean
  onArchive?: (on: boolean) => void
  quotes: Quote[]
  importedQuotes: ImportedQuote[]
  jobs: Job[]
  files: CustomerFile[]
  /** The header is the top of the card (no back bar above it). */
  roundTop?: boolean
  onEdit: () => void
  onNewQuote: (customer: Customer) => void
  onDelete: (id: string) => void
  onDeleteFile: (id: string) => void
  onQuoteClick?: (quoteId: string) => void
  onFileClick?: (f: CustomerFile) => void
  initialTab?: string | null
  onTabConsumed?: () => void
}) {
  // Lead source and tag names from Settings (a rename shows at once).
  useOptions('leadSources'); useOptions('customerTags')
  // A phone gets the action bar at the bottom; a wide screen keeps the actions in the header.
  const wide = useWide()
  // Wide enough for the details column beside the tabs; narrower, the details are a tab.
  const detailsColumn = useDetailsColumn()
  const tabs = customerTabsFor({ costs: can('costs.view'), detailsColumn })

  // The open tab: ?tab= in the address (a link, a reload), else the one open when Back returned here, else Activity.
  const rememberedTab = useScreenMemory<{ id: string; tab: string }>('customer-tab', (): { id: string; tab: string } => ({ id: customer.id, tab: activeTab }))
  const [activeTab, setActiveTab] = useState<CustomerTab>(() =>
    asCustomerTab(new URLSearchParams(window.location.search).get('tab'))
    ?? (rememberedTab?.id === customer.id ? asCustomerTab(rememberedTab.tab) : null)
    ?? 'activity')
  const shown = shownCustomerTab(activeTab, tabs)
  // A link to this same customer on another tab (the quote window's "Open the job's pull sheet"): that tab opens.
  const navTab = asCustomerTab(useNav().params.get('tab'))
  useEffect(() => { if (navTab) setActiveTab(navTab) }, [navTab])

  const headRef = useRef<HTMLElement | null>(null)
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [headH, setHeadH] = useState(0)
  // The page scrolls with padding at its top; a sticky top of 0 would leave that gap above the header.
  const [padTop, setPadTop] = useState(0)
  useEffect(() => {
    const el = headRef.current
    if (!el) return
    const sc = document.querySelector<HTMLElement>('[data-page-scroll]')
    const measure = () => { setHeadH(el.offsetHeight); setPadTop(sc ? parseFloat(getComputedStyle(sc).paddingTop) || 0 : 0) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scrolled down, the pinned header is one line (name and stage), so the tab's content gets the screen;
  // at the top of the page the address, phone, email and rep are back (customerPage.ts nextCompact).
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const sc = document.querySelector<HTMLElement>('[data-page-scroll]')
    if (!sc) return
    const on = () => setCompact(c => nextCompact(c, sc.scrollTop))
    on()
    sc.addEventListener('scroll', on, { passive: true })
    return () => sc.removeEventListener('scroll', on)
  }, [])

  // The tabs are one row; when they do not all fit, it scrolls sideways (a swipe, or the arrows on a computer).
  const [tabsOver, setTabsOver] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })
  useEffect(() => {
    const nav = tabsRef.current
    if (!nav) return
    const measure = () => setTabsOver(o => {
      const left = nav.scrollLeft > 2, right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2
      return o.left === left && o.right === right ? o : { left, right }
    })
    measure()
    nav.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(nav)
    return () => { nav.removeEventListener('scroll', measure); ro?.disconnect() }
  }, [])
  const scrollTabs = (dir: 1 | -1) => tabsRef.current?.scrollBy({ left: dir * Math.max(160, (tabsRef.current?.clientWidth ?? 400) * 0.6), behavior: 'smooth' })

  // Picking a tab while the tabs are stuck under the header: the new tab opens at its top, right under them.
  const realign = useRef(false)
  function pickTab(t: CustomerTab) {
    const sc = document.querySelector<HTMLElement>('[data-page-scroll]')
    const nav = tabsRef.current, panel = panelRef.current
    realign.current = !!(sc && nav && panel && panel.getBoundingClientRect().top < nav.getBoundingClientRect().bottom + 1)
    setActiveTab(t)
    replaceUrl(withTab(window.location.pathname + window.location.search, t))
  }
  useLayoutEffect(() => {
    const sc = document.querySelector<HTMLElement>('[data-page-scroll]')
    const nav = tabsRef.current, panel = panelRef.current
    if (realign.current && sc && nav && panel) {
      const gap = panel.getBoundingClientRect().top - nav.getBoundingClientRect().bottom
      if (gap < 0) sc.scrollTop += gap
    }
    realign.current = false
    // The open tab in view in the row of tabs (a phone shows a few at a time).
    const b = nav?.querySelector<HTMLElement>(`[data-customer-tab="${shown}"]`)
    if (nav && b) {
      const l = b.offsetLeft, r = l + b.offsetWidth
      // Clear of the arrows at the ends (a computer).
      if (l < nav.scrollLeft + 40) nav.scrollLeft = Math.max(0, l - 40)
      else if (r > nav.scrollLeft + nav.clientWidth - 40) nav.scrollLeft = r - nav.clientWidth + 40
    }
  }, [shown])

  // A tab asked for from elsewhere (the messages bell, search: "open this customer on Jobs").
  useEffect(() => {
    const t = asCustomerTab(initialTab)
    if (t) {
      setActiveTab(t)
      replaceUrl(withTab(window.location.pathname + window.location.search, t))
      onTabConsumed?.()
    }
  }, [initialTab, customer.id, onTabConsumed])

  // The customer's pipeline card, for its history (automation emails) and the follow up's "How'd it go?".
  const [, setPipelineTick] = useState(0)
  useEffect(() => {
    const bump = () => setPipelineTick(t => t + 1)
    window.addEventListener('fencepro:pipeline:updated', bump)
    return () => window.removeEventListener('fencepro:pipeline:updated', bump)
  }, [])
  const card = (getPipeline().leads || []).find((l: any) => l.customerId === customer.id) as { id: string } | undefined
  const history = useCustomerHistory(card?.id ?? null, customer.id, shown === 'activity')
  const activity = useMemo(() => history === null ? null : [...history, ...localActivityOf(customer.id)].sort((a, b) => b.at.localeCompare(a.at)), [history, customer.id])

  const name = `${customer.firstName} ${customer.lastName}`.trim()
  const address = fullAddress(customer)
  const allQuoteCount = quotes.length + importedQuotes.length
  const status = customerStatusWords(customer)
  const hasCard = !!card
  const [quoteLimit, setQuoteLimit] = useState(LIST_PAGE)
  const [importedLimit, setImportedLimit] = useState(LIST_PAGE)
  const [jobLimit, setJobLimit] = useState(LIST_PAGE)
  // A Jobs row: the job's window in Operations; for the Salesman (no Operations) the job page, read only
  // and without costs, never a bounce (customerPage.ts jobRowTarget, JobPage.tsx).
  function openJob(j: Job) {
    navigate(jobRowTarget({ jobId: j.id, canOpenOperations: canOpenOperations() }).path, { from: name || 'Customer' })
  }
  const pad = detailsColumn ? '' : 'px-4 lg:px-6'
  const sold = quotes.some(q => q.status === 'SOLD')
  // Phone (calls), email, rep and lead source, with a dot between.
  const contact = [
    customer.phone ? <PhoneLink key="phone" phone={customer.phone} customerId={customer.id} name={name} data-customer-header-phone /> : null,
    customer.email ? <a key="email" href={`mailto:${customer.email}`} className="text-blue-700 hover:underline" data-customer-email>{customer.email}</a> : null,
    customer.salesRep ? <span key="rep" className="whitespace-nowrap" data-customer-rep>Salesman: {customer.salesRep}</span> : null,
    customer.leadSource ? <span key="source" className="whitespace-nowrap text-orange-700" data-customer-source={customer.leadSource}>via {sourceLabel(customer.leadSource)}</span> : null,
  ].filter(Boolean).map((part, i) => <Fragment key={i}>{i > 0 && <span className="text-gray-300" aria-hidden="true"> · </span>}{part}</Fragment>)
  const stagePill = <span className="inline-block mr-1.5 align-[1px] text-[11px] font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full whitespace-nowrap" data-customer-status>{status}</span>
  // Sold or Quote Sent, and where they are (the job's stage when there is a job; on a phone the card's stage too).
  const badges = <>
    {sold && <span className="inline-block mr-1.5 align-[1px] text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full whitespace-nowrap">Signed / Sold</span>}
    {!sold && quotes.some(q => q.status === 'SENT') && <span className="inline-block mr-1.5 align-[1px] text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap">Quote Sent</span>}
    {status && stagePill}
  </>
  // Archive is the everyday way off the lists; Delete (owner, admin) lives behind "More" and typing the name.
  // On a computer Navigate is here too (less used at a desk; the address itself opens maps), so the actions fit one line.
  const navigateInMore = wide && !!address
  const moreMenu = (navigateInMore || can('records.archive') || can('records.delete')) && <PopMenu name="customer-more" label="More ▾" title="More actions" width={208}
    triggerClassName={`btn btn-quiet btn-sm${wide ? ' shrink-0' : ' shrink-0 ml-auto -mr-2'}`} triggerProps={{ 'aria-label': 'More actions', 'data-customer-more': true }}>
    {close => <>
      {navigateInMore && <PopItem onClick={() => { close(); window.open(directionsTo(address), '_blank', 'noopener') }} data-customer-action="navigate" data-href={directionsTo(address)}>Navigate (directions)</PopItem>}
      {can('records.archive') && onArchive && <PopItem onClick={() => { close(); onArchive(!archived) }} data-customer-archive={archived ? 'off' : 'on'}>{archived ? 'Unarchive customer' : 'Archive customer'}</PopItem>}
      {can('records.delete') && <PopItem danger onClick={() => { close(); onDelete(customer.id) }} data-customer-delete>Delete customer…</PopItem>}
    </>}
  </PopMenu>
  const more = (key: string, left: number, onClick: () => void) => (
    <button type="button" className="btn btn-quiet btn-sm w-full rounded-none border-t border-gray-100" data-show-more={key} onClick={onClick}>
      Show {Math.min(LIST_PAGE, left)} more
    </button>
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 max-lg:pb-[76px]" data-customer-detail>
      {/* Always at the top: who, where, how to reach them, and the main actions. Scrolled down it is one line
          (name and stage, and the actions on a computer), so the tab gets the screen; the rest is back at the top. */}
      <header ref={headRef} data-customer-header data-compact={compact ? 'yes' : 'no'} style={{ top: -padTop }}
        className={`sticky z-20 bg-white border-b border-gray-200 px-4 lg:px-6 ${compact ? 'py-1.5 lg:py-2' : 'py-2 lg:py-3'} ${roundTop ? 'rounded-t-2xl' : ''}`}>
        <div className={`flex gap-3 ${compact ? 'items-center' : 'items-start'}`}>
          {wide && !compact && (
            <div className="w-11 h-11 rounded-xl bg-orange-500 flex items-center justify-center text-white text-base font-black shrink-0" aria-hidden="true">
              {customer.firstName?.[0] ?? ''}{customer.lastName?.[0] ?? ''}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {/* One line, never wrapping: the badges give way first, the actions never move to a second line. */}
            <div className="flex items-center gap-x-2 min-w-0">
              <h2 className={`${compact ? 'text-base lg:text-lg' : 'text-lg lg:text-xl'} font-bold text-gray-900 truncate min-w-0 shrink lg:min-w-[9rem]`} data-customer-name>{name || 'Customer'}</h2>
              {/* "Saved" stays quiet on every screen (round 3: a chip on every customer said nothing); Saving and Not saved show. */}
              <SaveStatus keys={[`customer:${customer.id}`]} also={noteChangeFor(customer.id)} quietWhenSaved />
              {/* One row of pills: one that does not fit drops out of sight whole (never half a pill). Scrolled down, the stage alone. */}
              {(wide || compact) && <span className="min-w-0 flex-1 flex flex-wrap items-center h-6 overflow-hidden" data-customer-badges>{compact && status ? stagePill : badges}</span>}
              {/* A phone scrolled down keeps the line short; More is back at the top of the page. */}
              {!wide && !compact && moreMenu}
              {/* A wide screen: the main actions at the right of the name (a phone has the bar at the bottom). */}
              {wide && <div className="ml-auto flex flex-nowrap items-center justify-end gap-1.5 shrink-0" data-contact-actions>
                <button onClick={() => onNewQuote(customer)} className="btn btn-primary btn-sm" data-customer-action="new-quote"><FilePlus2 size={16} aria-hidden="true" /> New quote</button>
                {/* Under 1280 px the four smaller ones are icons (named for screen readers and on hover), so the name keeps its room. */}
                {customer.phone && <a href={telHref(customer.phone)} onClick={() => touchCustomer(customer, 'call')} className="btn btn-secondary btn-sm" title="Call" data-customer-action="call"><Phone size={16} aria-hidden="true" /><span className="sr-only xl:not-sr-only"> Call</span></a>}
                {customer.phone && <TextButton phone={customer.phone} firstName={customer.firstName} name={name} onTap={() => touchCustomer(customer, 'text')} className="btn btn-secondary btn-sm" data-customer-text data-customer-action="text"><MessageSquare size={16} aria-hidden="true" /><span className="sr-only xl:not-sr-only"> Text</span></TextButton>}
                <button onClick={() => openBooking({ customerId: customer.id })} data-book-appointment data-customer-action="book" title="Book appointment" className="btn btn-secondary btn-sm"><CalendarPlus size={16} aria-hidden="true" /><span className="sr-only xl:not-sr-only"> Book</span></button>
                <button onClick={onEdit} className="btn btn-quiet btn-sm" title="Edit customer" data-customer-action="edit"><Pencil size={16} aria-hidden="true" /><span className="sr-only xl:not-sr-only"> Edit</span></button>
                {moreMenu}
              </div>}
            </div>
            {/* Where and how to reach them: one line on a computer, the address on its own line on a phone. */}
            {!compact && (
              <p className="mt-0.5 text-sm leading-snug [overflow-wrap:anywhere]">
                {/* On a phone the badges lead the address line, so the name keeps the first line to itself. */}
                {!wide && badges}
                {/* On a phone the address is one box of its own (inline-block): beside the pills when it fits, else on
                    the next line whole, so a wrapped address never runs under a pill ("Job: Awaiting Locates" covered
                    it on an iPhone, Oct 26 2026) and its whole tap area opens maps. */}
                {address
                  ? <a href={mapsSearchUrl(address)} target="_blank" rel="noreferrer" className={`font-medium text-gray-900 hover:underline${wide ? '' : ' inline-block max-w-full align-top'}`} data-customer-address title="Open in maps">
                      <MapPin size={14} className="inline -mt-0.5 mr-1 text-orange-600" aria-hidden="true" />{address}
                    </a>
                  : <span className="text-gray-500" data-customer-address="">No property address yet</span>}
                {wide && contact.length > 0 && <span className="text-gray-300" aria-hidden="true"> · </span>}
                {wide && <span className="text-gray-600" data-customer-contact>{contact}</span>}
              </p>
            )}
            {!wide && !compact && <p className="mt-0.5 text-xs text-gray-600 leading-relaxed [overflow-wrap:anywhere]" data-customer-contact>{contact}</p>}
            {/* The pipeline stage on a computer without the details column (with it, the stage is at the top of the column). */}
            {wide && !detailsColumn && !compact && hasCard && <div className="mt-1 flex flex-wrap items-center gap-2" data-customer-header-stage><PipelineStageSelect customerId={customer.id} /></div>}
          </div>
        </div>
      </header>
      {!wide && <CustomerActionBar customer={customer} onNewQuote={() => onNewQuote(customer)} onEdit={onEdit} />}

      {/* What needs attention first: archived, a possible duplicate, a past customer's warranty. */}
      <div className="px-4 lg:px-6 pt-3 space-y-3 empty:hidden">
        {archived && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3" data-customer-archived>
            <p className="flex-1 min-w-[12rem] text-sm text-amber-900">Archived: off the customer list and the boards, still in search and reports.</p>
            {can('records.archive') && onArchive && <button className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => onArchive(false)} data-customer-unarchive>Unarchive</button>}
          </div>
        )}
        {/* A website or phone lead's possible match (Merge, Not the same person), "Merged into", and Undo merge. */}
        <div className="empty:hidden"><PossibleMatch customerId={customer.id} history onOpenCustomer={openCustomerPage} onMerged={openCustomerPage} /></div>
        <div className="empty:hidden"><PastCustomerBadge customerId={customer.id} /></div>
      </div>

      <div className="px-4 lg:px-6 pt-3">
        <CustomerSummary customer={customer} quotes={quotes} importedQuotes={importedQuotes} jobs={jobs} history={history} onTab={pickTab} />
      </div>

      <div className={detailsColumn ? 'grid grid-cols-[272px_minmax(0,1fr)] gap-6 px-6 pb-6 pt-4 items-start' : 'pt-3 pb-4'}>
        {detailsColumn && <aside className="min-w-0" data-customer-side><CustomerDetailsPanel customer={customer} showStage /></aside>}
        <section className="min-w-0">
          {/* The tabs stay under the header while the page scrolls: one row, sideways when they do not all fit. */}
          <div className="sticky z-10 bg-white" style={{ top: headH - padTop }} data-customer-tabs-bar>
          <div ref={tabsRef} role="tablist" aria-label="Customer" data-customer-tabs
            className={`border-b border-gray-200 flex gap-x-1 lg:gap-x-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${pad}`}>
            {tabs.map(t => (
              <button
                key={t} type="button" role="tab" aria-selected={shown === t}
                onClick={() => pickTab(t)} data-customer-tab={t}
                className={`px-3 lg:px-2 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${shown === t ? 'border-orange-500 text-orange-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
              >
                {CUSTOMER_TAB_LABEL[t]}
                {t === 'quotes' && allQuoteCount > 0 && <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 rounded-full px-1.5">{allQuoteCount}</span>}
                {t === 'jobs' && jobs.length > 0 && <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 rounded-full px-1.5">{jobs.length}</span>}
                {t === 'files' && files.length > 0 && <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 rounded-full px-1.5">{files.length}</span>}
              </button>
            ))}
          </div>
          {/* More tabs to the side: an arrow on a computer (a phone swipes). */}
          {wide && tabsOver.left && <button type="button" aria-label="Earlier tabs" onClick={() => scrollTabs(-1)} data-tabs-scroll="left"
            className="absolute left-0 top-0 bottom-px w-9 grid place-items-center bg-gradient-to-r from-white via-white to-transparent text-gray-700 hover:text-orange-700"><ChevronLeft size={18} aria-hidden="true" /></button>}
          {wide && tabsOver.right && <button type="button" aria-label="More tabs" onClick={() => scrollTabs(1)} data-tabs-scroll="right"
            className="absolute right-0 top-0 bottom-px w-9 grid place-items-center bg-gradient-to-l from-white via-white to-transparent text-gray-700 hover:text-orange-700"><ChevronRight size={18} aria-hidden="true" /></button>}
          </div>

          <div ref={panelRef} role="tabpanel" data-customer-tab-panel={shown} className={`min-h-[70vh] pt-4 ${pad}`}>
            {shown === 'activity' && (
              <div className="space-y-4">
                <HistoryList list={activity} first={LIST_PAGE} step={LIST_PAGE} title="Activity" />
                <ImportHistoryCard customerId={customer.id} />
              </div>
            )}

            {shown === 'overview' && <CustomerDetailsPanel customer={customer} showStage={!wide} />}

            {shown === 'appointments' && <CustomerAppointmentsTab customerId={customer.id} />}

            {shown === 'quotes' && (
              <div className="space-y-4">
                {importedQuotes.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500">Imported Quote History</p>
                      <p className="text-xs text-gray-400">{importedQuotes.length} records</p>
                    </div>
                    <table className="w-full text-sm table-responsive-cards">
                      <thead className="border-b border-gray-100">
                        <tr>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400">Type</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">Sections</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">Quoted</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">Labor</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">50% Dep</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">Tear out</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">Rep</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400">Sold</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importedQuotes.slice(0, importedLimit).map(q => (
                          <tr key={q.id} className="hover:bg-gray-50">
                            <td data-label="Type" className="px-5 py-2.5 font-medium text-gray-800">{q.projectType || '—'}</td>
                            <td data-label="Sections" className="px-4 py-2.5 text-right text-gray-600">{q.sections || '—'}</td>
                            <td data-label="Quoted" className="px-4 py-2.5 text-right font-bold text-gray-900">{q.quotedPrice > 0 ? fmt(q.quotedPrice) : '—'}</td>
                            <td data-label="Labor" className="px-4 py-2.5 text-right text-gray-600">{q.laborBid > 0 ? fmt(q.laborBid) : '—'}</td>
                            <td data-label="50% Dep" className="px-4 py-2.5 text-right text-gray-600">{q.depositAmt > 0 ? fmt(q.depositAmt) : '—'}</td>
                            <td data-label="Tear Out" className="px-4 py-2.5 text-right">
                              {q.tearOut ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Yes</span> : <span className="text-xs text-gray-300">No</span>}
                            </td>
                            <td data-label="Rep" className="px-4 py-2.5 text-right text-gray-500 text-xs">{q.salesRep || '—'}</td>
                            <td data-label="Sold" className="px-4 py-2.5 text-right text-gray-400 text-xs">{q.soldDate || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importedQuotes.length > importedLimit && more('imported-quotes', importedQuotes.length - importedLimit, () => setImportedLimit(n => n + LIST_PAGE))}
                  </div>
                )}

                {quotes.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                      <p className="text-sm font-semibold text-gray-600">Quotes from {getConfig().company.name || 'Getter Done Fence'}</p>
                    </div>
                    <table className="w-full text-sm table-responsive-cards">
                      <thead className="border-b border-gray-100">
                        <tr>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Type</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Sections</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Price</th>
                          {can('costs.view') && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Margin</th>}
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Date</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {quotes.slice(0, quoteLimit).map(q => (
                          <tr key={q.id} className="hover:bg-orange-50 cursor-pointer transition-colors" onClick={() => onQuoteClick?.(q.id)} data-customer-quote={q.id}>
                            <td data-label="Type" className="px-5 py-3 font-medium text-gray-800">{q.label || styleLabel(q.type) || q.type}</td>
                            <td data-label="Sections" className="px-4 py-3 text-right text-gray-600">{q.sections}</td>
                            <td data-label="Price" className="px-4 py-3 text-right font-bold text-gray-900">{fmt(q.price)}</td>
                            {can('costs.view') && <td data-label="Margin" className={`px-4 py-3 text-right font-semibold text-sm ${q.margin >= lowTarget() ? 'text-green-600' : q.margin >= lowTarget() - 0.05 ? 'text-yellow-600' : 'text-red-500'}`}>
                              {(q.margin * 100).toFixed(1)}%
                            </td>}
                            <td data-label="Date" className="px-4 py-3 text-right text-gray-400 text-xs">{dayWords(q.date)}</td>
                            <td data-label="Status" className="px-4 py-3 text-right">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status]}`}>{q.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {quotes.length > quoteLimit && more('quotes', quotes.length - quoteLimit, () => setQuoteLimit(n => n + LIST_PAGE))}
                  </div>
                )}

                {quotes.length === 0 && importedQuotes.length === 0 && (
                  <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
                    <p className="text-gray-400 text-sm mb-3">No quotes yet</p>
                    <button onClick={() => onNewQuote(customer)} className="text-orange-500 text-sm hover:underline">Create the first quote</button>
                  </div>
                )}
              </div>
            )}

            {shown === 'jobs' && (
              <div className="space-y-4">
                {/* Warranty and service requests on their fence (ServiceRequests.tsx). */}
                <div className="space-y-2 max-w-xl empty:hidden" data-customer-service><ServiceRequestButton customerId={customer.id} /><ServiceTicketList customerId={customer.id} /></div>
                {/* A change order on a signed job: the yard drawing or typed lines (ChangeOrders.tsx). */}
                <div className="empty:hidden"><CustomerChangeOrderButtons customerId={customer.id} customerName={name} /></div>
                {jobs.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
                    <p className="text-4xl mb-2">🏗</p>
                    <p className="text-gray-700 font-medium">No jobs yet</p>
                    <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">Jobs are created automatically when a quote is marked as Sold — either by dragging a pipeline card to {pipelineStageName(roleId('signed'))} or clicking Mark as Sold on a quote.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm table-responsive-cards">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Type</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Sections</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Value</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Scheduled</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Stage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {jobs.slice(0, jobLimit).map(j => (
                          // The row opens the job (Operations, its job window), like a quote row opens the quote (round 3).
                          <tr key={j.id} className="hover:bg-orange-50 cursor-pointer transition-colors" data-customer-job={j.id} tabIndex={0} role="link" aria-label={`Open the job: ${j.label || styleLabel(j.type) || 'job'}`}
                            onClick={() => openJob(j)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJob(j) } }}>
                            <td data-label="Type" className="px-5 py-3 font-medium text-gray-800">{j.label || styleLabel(j.type) || j.type}</td>
                            <td data-label="Sections" className="px-4 py-3 text-right text-gray-600">{j.sections}</td>
                            <td data-label="Value" className="px-4 py-3 text-right font-bold text-gray-900">{fmt(j.value)}</td>
                            <td data-label="Scheduled" className="px-4 py-3 text-right text-gray-400 text-xs">{j.scheduledDate ? dayWords(j.scheduledDate) : 'Not yet'}</td>
                            <td data-label="Stage" className="px-4 py-3 text-right">
                              <span className="text-xs px-2 py-1 rounded-full text-white font-semibold" style={{ backgroundColor: stageColor(j.stage) }} data-ops-stage-pill={j.stage}>
                                {stageName(j.stage)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {jobs.length > jobLimit && more('jobs', jobs.length - jobLimit, () => setJobLimit(n => n + LIST_PAGE))}
                  </div>
                )}
                <ArchivedOfCustomer customerId={customer.id} customerArchived={archived} />
              </div>
            )}

            {shown === 'costing' && can('costs.view') && (
              <CustomerJobCostingTab quotes={quotes} />
            )}

            {shown === 'billing' && (
              <CustomerBillingTab customerId={customer.id} customerName={name} customerEmail={customer.email} />
            )}

            {shown === 'notes' && (
              <div className="space-y-4">
                {customer.notes && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-4" data-customer-record-notes>
                    <h3 className="text-sm font-bold text-gray-900 mb-2">Notes on the customer record</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap [overflow-wrap:anywhere]">{customer.notes}</p>
                  </div>
                )}
                <CustomerNotesTab customerId={customer.id} />
              </div>
            )}

            {shown === 'pullsheets' && (
              <CustomerPullSheetsTab customerId={customer.id} />
            )}

            {shown === 'photos' && (
              <div className="space-y-6">
                {/* The one place to add photos (Camera, Choose from gallery), newest at the top; the older ones under it. */}
                <MediaGallery where={{ customerId: customer.id }} defaultCategory="Site walk" title="Photos and video" pageSize={60} newestFirst
                  hint="Add photos and video here. Newest first." />
                <CustomerPhotosTab customerId={customer.id} />
              </div>
            )}

            {shown === 'files' && (
              <CustomerFilesTab
                customerId={customer.id}
                uploadedBy="user"
                legacyFiles={files as any}
                onLegacyFileClick={(f) => onFileClick?.(f as any)}
                onLegacyFileDelete={can('ops.delete') ? (id) => onDeleteFile(id) : undefined}
              />
            )}

            {shown === 'portal' && (
              <div className="space-y-4">
                <PortalAccessSection customer={customer} />
                <CustomerMessagesTab customerId={customer.id} customerName={name} />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

/** Customers the list draws at first and per "Show more". */
const CUSTOMER_LIST_PAGE = 100

export default function CustomersPage({ onNewQuote }: {
  onNewQuote?: (customer?: Customer) => void
}) {
  // Lead source and tag names from Settings (a rename shows at once).
  useOptions('leadSources'); useOptions('customerTags')
  const [importedQuotes, setImportedQuotes] = useState<ImportedQuote[]>(() => {
    try {
      const raw = cloudStorage.getItem('fencepro_imported_quotes')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  const [customers, setCustomers] = useState<Customer[]>(() => getCustomers())
  // Pull real quotes from the API-backed cache. Empty state is honest now —
  // no SAMPLE_QUOTES fallback, fresh accounts simply see "no quotes yet".
  const readQuotes = (): Quote[] => {
    return getQuotes().map(q => ({
      id: q.id,
      customerId: q.customerId || '',
      type: q.fenceStyle || '',
      label: quoteStyleLabel(q as any),
      // A repair: its work, never "0" (round 2 review, Oct 26 2026).
      sections: sectionsCell(q.sections, q.work),
      price: q.finalPrice || 0,
      margin: shownMargin(q, seesCommission(signedInRole(), can('costs.view'))) || 0,
      status: q.status || 'DRAFT',
      date: q.date || '',
    })) as Quote[]
  }
  const readJobs = (): Job[] => {
    return getJobs().map(j => ({
      id: j.id,
      customerId: j.customerId || '',
      type: j.fenceStyle || '',
      label: soldStyleLabel(j.fenceStyle, j.quoteId ? getQuoteById(j.quoteId) as any : null),
      // A repair job: its quote's work, never "0".
      sections: sectionsCell(j.sections, j.quoteId ? getQuoteById(j.quoteId)?.work : null),
      value: j.contractValue || j.quotePrice || 0,
      // The Operations stage (Settings > Operations Stages), by id.
      stage: stageOf(j),
      scheduledDate: j.scheduledDate || '',
      quoteId: j.quoteId || '',
    })) as Job[]
  }
  const [quotes, setQuotes] = useState<Quote[]>(() => readQuotes())
  const [jobs, setJobs] = useState<Job[]>(() => readJobs())

  // Listen for quote/job/customer updates to keep the profile in sync without refresh
  useEffect(() => {
    const reload = () => { setQuotes(readQuotes()); setJobs(readJobs()) }
    const reloadCustomers = () => {
      // Always trust the cache once a store mutation has fired the event
      // (covers delete-last-customer where the new list is legitimately empty).
      // A new array each time: the archived list arriving (an archived or merged customer opened by its
      // address) leaves the active list as it was, and the page must still draw again to show them.
      setCustomers([...getCustomers()])
    }
    window.addEventListener('fencepro:quotes:updated', reload)
    window.addEventListener('fencepro:jobs:updated', reload)
    window.addEventListener(OPS_STAGES_UPDATED_EVENT, reload)
    window.addEventListener('fencepro:customers:updated', reloadCustomers)
    return () => {
      window.removeEventListener('fencepro:quotes:updated', reload)
      window.removeEventListener('fencepro:jobs:updated', reload)
      window.removeEventListener(OPS_STAGES_UPDATED_EVENT, reload)
      window.removeEventListener('fencepro:customers:updated', reloadCustomers)
    }
  }, [])

  const [files, setFiles] = useState<CustomerFile[]>(() => {
    try {
      const raw = cloudStorage.getItem('fencepro_files')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  // The customer on screen is in the address: /customers/<id>, /customers/new.
  const nav = useNav()
  const routeId = (() => { const seg = nav.path.split('/'); return seg[1] === 'customers' && seg[2] ? decodeURIComponent(seg[2]) : null })()
  const selectedId = routeId === 'new' ? null : routeId
  const [editing, setEditing] = useState(false)
  const mode: 'view' | 'new' | 'edit' = routeId === 'new' ? 'new' : editing && selectedId ? 'edit' : 'view'
  useEffect(() => { setEditing(false) }, [selectedId])
  type Memory = { search: string; filter?: string }
  const remembered = useScreenMemory<Memory>('customers', (): Memory => ({ search, filter: listFilter }))
  const [search, setSearch] = useState<string>(remembered?.search ?? '')
  // ?filter=missing-contact: the list narrowed (the Finish setup card links here). Kept in the address while a customer is open.
  const filterParam = nav.params.get('filter')
  const [listFilter, setListFilterState] = useState<CustomerFilter>(() => asCustomerFilter(filterParam ?? remembered?.filter))
  useEffect(() => { if (filterParam !== null) setListFilterState(asCustomerFilter(filterParam)) }, [filterParam])
  const filterQs = listFilter ? `?filter=${listFilter}` : ''
  function setListFilter(f: CustomerFilter) {
    setListFilterState(f)
    replaceUrl(window.location.pathname + (f ? `?filter=${f}` : ''))
  }
  const select = (id: string | null) => navigate(id ? `/customers/${encodeURIComponent(id)}${filterQs}` : `/customers${filterQs}`)
  const [drawerQuote, setDrawerQuote] = useState<SavedQuote | null>(null)
  const [viewerFile, setViewerFile] = useState<CustomerFile | null>(null)
  const [forcedTab, setForcedTab] = useState<string | null>(null)

  // A quote named in the address (?qv=<id>) opens: a reload, a link, or Back onto it.
  useEffect(() => {
    const qv = nav.params.get('qv') ?? takeOpenedParam('qv')
    if (!qv || drawerQuote?.id === qv) return
    const full = getQuotes().find(q => q.id === qv)
    if (full) setDrawerQuote(full as SavedQuote)
  }, [nav])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onSelect(e: any) {
      const id = e?.detail?.customerId
      const tab = e?.detail?.tab
      if (e?.detail?.newCustomer) { navigate('/customers/new'); return }
      if (typeof id === 'string') {
        if (!window.location.pathname.startsWith(`/customers/${encodeURIComponent(id)}`)) navigate(`/customers/${encodeURIComponent(id)}`)
        setEditing(false)
        if (typeof tab === 'string') setForcedTab(tab)
      }
    }
    window.addEventListener('fencepro:select-customer', onSelect as any)
    return () => window.removeEventListener('fencepro:select-customer', onSelect as any)
  }, [])

  const filtered = customers.filter(c => {
    if (listFilter && !CUSTOMER_FILTERS[listFilter].test(c)) return false
    const q = search.toLowerCase()
    return (
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.serviceAddress || '').toLowerCase().includes(q) ||
      // Tags too (their id and their name), so "MyBudgetQuote dropoff" finds those customers.
      (q.length > 2 && (c.tags || []).some(t => t.toLowerCase().includes(q) || tagLabel(t).toLowerCase().includes(q)))
    )
  })

  // Sold revenue per customer, worked out once per quote list (not one search of every quote per row).
  const soldRevenue = useMemo(() => {
    const m = new Map<string, number>()
    // The contract (signed price plus change orders, the job's contract value), not the signed price alone.
    for (const q of quotes) if (q.customerId && q.status === 'SOLD') m.set(q.customerId, (m.get(q.customerId) ?? 0) + soldValueOf(q))
    return m
  }, [quotes, jobs])
  // The list draws a page at a time: ~5,400 rows at once cost a phone seconds.
  const [listLimit, setListLimit] = useState(CUSTOMER_LIST_PAGE)
  useEffect(() => { setListLimit(CUSTOMER_LIST_PAGE) }, [search, listFilter])
  const listed = filtered.length > listLimit ? filtered.slice(0, listLimit) : filtered

  const archivedSelected = customers.some(c => c.id === selectedId) ? null : getArchivedCustomers().find(c => c.id === selectedId) ?? null
  const selected = customers.find(c => c.id === selectedId) ?? archivedSelected
  const customerQuotes = quotes.filter(q => q.customerId === selectedId)
  const customerImportedQuotes = importedQuotes.filter(q => q.customerId === selectedId)
  const customerJobs = jobs.filter(j => j.customerId === selectedId)
  const customerFiles = files.filter(f => f.customerId === selectedId)

  function handleSave(c: Customer, bookEstimate = false) {
    try {
      const isNew = !customers.find(x => x.id === c.id)
      // Route through the store: it dual writes to /api/crm-contacts, updates
      // the in memory cache, and fires `fencepro:customers:updated` (which
      // our reloadCustomers handler picks up to refresh local state).
      // For new customers the store also seeds the pipeline + fires the
      // customer_created automation, so we skip those here on the new path.
      const { customer } = upsertCustomer(c)
      // The Salesman gave the new customer to another Salesman: it leaves the Salesman's list once saved
      // (portal lib/salesScope.ts), so the screen goes back to the list rather than to a page that will close.
      const givenAway = isNew && signedInRole() === 'sales_rep' && !!c.salesRep.trim() && !isMyRep(c.salesRep)
      // "Book estimate now": the visit is with the customer's chosen Salesman to start ("With" can change it).
      const book = () => openBooking({ customerId: customer.id, type: 'estimate', withName: customer.salesRep || c.salesRep, customer })
      if (givenAway) {
        const rep = c.salesRep.trim()
        if (bookEstimate) {
          // Booked before they leave: the booking opens on the list (a window opened before the Back arrived
          // would close with it) and keeps the customer from this save once the list drops them. The Salesman
          // can book with anyone on the team (portal routes/appointments.ts); after closing, they are gone
          // from this phone, so closing without booking says so.
          goBackThen('/customers', () => openBooking({
            customerId: customer.id, type: 'estimate', withName: rep, customer,
            onCancel: () => toast.info('Estimate not booked', `${`${customer.firstName} ${customer.lastName}`.trim() || 'This customer'} is ${possessive(rep)} customer now and is off your list, so you cannot book it later. Ask ${rep} or the office to book the estimate.`),
          }))
          toast.info('Customer added', `${rep} is the Salesman and sees them as soon as they are saved. Book the estimate now: once you close the booking, they leave your list.`)
          return
        }
        goBack('/customers')
        toast.info('Customer added', `${rep} is the Salesman and sees them as soon as they are saved. They leave your list.`)
        return
      }
      // A new customer takes the place of the "new customer" screen in the history.
      if (isNew) navigate(`/customers/${encodeURIComponent(customer.id)}`, { replace: true })
      setEditing(false)
      if (isNew && bookEstimate) book()

      // Not "saved" yet: the status by their name says Saved once the server has it.
      if (isNew) toast.info('Customer added', `They are on the pipeline under ${pipelineStageName(roleId('first'))}.${c.salesRep.trim() && !isMyRep(c.salesRep) ? ` ${c.salesRep.trim()} is the Salesman and sees them as soon as they are saved.` : ''} The status by their name says Saved once the office has it.`)
    } catch (err: any) {
      toast.error('Could not save customer', err?.message || 'Unknown error.')
    }
  }

  // Deleting a customer asks for their name to be typed (see ConfirmByTyping).
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  function handleDelete(id: string) {
    const c = customers.find(x => x.id === id) ?? getArchivedCustomers().find(x => x.id === id)
    if (!c) return
    const name = `${c.firstName} ${c.lastName}`.trim().replace(/\s+/g, ' ') || c.phone || c.email || 'DELETE'
    setDeleting({ id, name })
  }
  async function confirmDelete() {
    if (!deleting) return
    const { id, name } = deleting
    setDeleting(null)
    // Straight to the server: the customer and everything of theirs go to Settings > Deleted Records together.
    const r = await deleteRecord('customer', id)
    if (!r.ok) { toast.error('Not deleted', r.error || 'Try again.'); return }
    toast.success(`${name} deleted`, 'With their quotes, jobs and pipeline card. The owner or an admin can restore them from Settings > Deleted Records.')
    if (selectedId === id) navigate('/customers', { replace: true })
  }
  async function setArchived(id: string, on: boolean) {
    const r = on ? await archiveRecord('customer', id) : await unarchiveRecord('customer', id)
    if (!r.ok) { toast.error(on ? 'Not archived' : 'Not unarchived', r.error || 'Try again.'); return }
    setCustomers([...getCustomers()])
    toast.success(on ? 'Customer archived' : 'Customer unarchived', on ? 'Off the customer list and the boards with their cards, quotes and jobs. Search still finds them; Unarchive is on their page.' : 'Back on the customer list, with what was archived with them.')
  }

  function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const text = ev.target?.result as string
      if (!text) return

      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 2) return

      function parseCSVLine(line: string): string[] {
        const cols: string[] = []
        let current = ''
        let inQuotes = false
        for (let ci = 0; ci < line.length; ci++) {
          const ch = line[ci]
          if (ch === '"') { inQuotes = !inQuotes; continue }
          if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue }
          current += ch
        }
        cols.push(current.trim())
        return cols.map(c => c.replace(/^"|"$/g, '').trim())
      }

      function parseMoney(s: string): number {
        return parseFloat(s.replace(/[$,\s]/g, '')) || 0
      }

      const headers = parseCSVLine(lines[0]).map(h =>
        h.toLowerCase().replace(/[\s_#$().]+/g, '')
      )

      function col(...keys: string[]): number {
        for (const k of keys) {
          const i = headers.indexOf(k)
          if (i !== -1) return i
        }
        return -1
      }

      const colMap = {
        leadSource:  col('leadsource', 'source', 'lead'),
        clientName:  col('clientname', 'name', 'fullname', 'customername', 'displayname'),
        firstName:   col('firstname', 'first', 'fname'),
        lastName:    col('lastname', 'last', 'lname'),
        address:     col('homeaddress', 'address', 'serviceaddress', 'streetaddress'),
        phone:       col('phone', 'phonenumber', 'mobile', 'cell'),
        phone2:      col('phonenumber1', 'phone2', 'mobilephone', 'cellphone'),
        email:       col('email', 'emailaddress'),
        projectType: col('projecttype', 'type', 'fencetype'),
        sections:    col('ofsections', 'sections', 'numberofsections'),
        mhQuoted:    col('mhquoted', 'mh', 'manhours'),
        tearOut:     col('tearout', 'tear'),
        quotedPrice: col('quoted', 'price', 'quoteamount'),
        laborBid:    col('laborbid', 'labor'),
        deposit:     col('50', 'deposit', '50amt'),
        salesRep:    col('salesrep', 'rep', 'salesperson'),
        soldDate:    col('solddate', 'sold', 'closedate'),
        firstAppt:   col('dateof1stappt', 'firstappt', 'appointmentdate', 'apptdate'),
        jobStatus:   col('jobstatus', 'status', 'stage'),
        city:        col('city'),
        state:       col('state'),
        zip:         col('zip'),
      }

      const importedCustomers: Customer[] = []
      const importedQuotesList: ImportedQuote[] = []

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i])
        const get = (idx: number) => (idx !== -1 && cols[idx] ? cols[idx] : '')

        let firstName = get(colMap.firstName)
        let lastName  = get(colMap.lastName)

        if (!firstName && !lastName) {
          const full = get(colMap.clientName).trim()
          if (!full) continue
          const spaceIdx = full.indexOf(' ')
          if (spaceIdx === -1) { firstName = full; lastName = '' }
          else { firstName = full.slice(0, spaceIdx); lastName = full.slice(spaceIdx + 1) }
        }

        if (!firstName) continue

        const custId = uid()
        const rawSource = get(colMap.leadSource)
        // An option's id or linked word as it is; an option's name in any capital letters becomes its id; anything else as typed.
        const matchedSource = wordToSave(getOptions('leadSources'), rawSource)

        let address = get(colMap.address)
        const city  = get(colMap.city)
        const state = get(colMap.state)
        const zip   = get(colMap.zip)
        if (city || state || zip) {
          address = [address, city, state, zip].filter(Boolean).join(', ')
        }

        const customer: Customer = {
          id: custId,
          firstName,
          lastName,
          phone: get(colMap.phone) || get(colMap.phone2),
          email: get(colMap.email),
          serviceAddress: address,
          billingAddress: '',
          billingDifferent: false,
          leadSource: matchedSource,
          notes: '',
          tags: [],
          createdAt: get(colMap.soldDate) || businessDate(new Date()),
          salesRep: get(colMap.salesRep),
          firstApptDate: get(colMap.firstAppt),
          jobStatus: get(colMap.jobStatus),
        }

        const projectType = get(colMap.projectType)
        const quotedPrice = parseMoney(get(colMap.quotedPrice))
        const soldDate    = get(colMap.soldDate)

        if (projectType || quotedPrice > 0 || soldDate) {
          importedQuotesList.push({
            id: uid(),
            customerId: custId,
            projectType,
            sections:     parseInt(get(colMap.sections)) || 0,
            mhQuoted:     parseFloat(get(colMap.mhQuoted)) || 0,
            tearOut:      get(colMap.tearOut).toLowerCase().startsWith('y'),
            quotedPrice,
            laborBid:     parseMoney(get(colMap.laborBid)),
            depositAmt:   parseMoney(get(colMap.deposit)),
            salesRep:     get(colMap.salesRep),
            soldDate,
            firstApptDate: get(colMap.firstAppt),
          })
        }

        importedCustomers.push(customer)
      }

      if (importedCustomers.length === 0) {
        alert('No customers could be parsed. Check that your CSV has a header row.')
        return
      }

      // Push fresh records to the API via the store. Existing rows are
      // matched by phone/email and skipped; new ones get pipeline lead +
      // automation seeded inside upsertCustomer.
      const result = await bulkImportCustomers(importedCustomers)
      const freshCount = result.created

      setImportedQuotes(prev => {
        const updated = [...importedQuotesList, ...prev]
        cloudStorage.setItem('fencepro_imported_quotes', JSON.stringify(updated))
        return updated
      })

      toast.success(`Imported ${freshCount} customers`, `${importedQuotesList.length} quote records attached · all added to pipeline.`)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Master / detail responsive: on <lg the rail and detail stack — when a
  // customer is selected, the rail hides and the detail takes the full width
  // (with a back button above it). Above lg the list and the new / edit form
  // show side by side. A customer's own page takes the whole width at every
  // size and scrolls with the page (no box of its own): its header and tabs
  // stay at the top while the rest scrolls (Jonathan, Oct 26 2026).
  // A customer named in the address shows on the phone too, also when it is not on this login's list: the
  // "not found" box says why (the Salesman's link to another person's customer went quietly to the list; review, Oct 28 2026).
  const detailVisible = mode !== 'view' || !!selected || !!selectedId
  const customerView = mode === 'view' && !!selected
  return (
    <div className={customerView
      ? 'flex flex-col bg-white rounded-2xl border border-gray-200'
      : 'flex flex-col lg:flex-row lg:h-full bg-white rounded-2xl border border-gray-200 lg:overflow-hidden lg:min-h-[calc(100vh-120px)]'}>
      <div className={`${detailVisible ? (customerView ? 'hidden' : 'hidden lg:flex') : 'flex'} w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-gray-200 flex-col shrink-0`}>
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900">Customers</h2>
            <button onClick={() => navigate('/customers/new')} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">+ New customer</button>
          </div>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select aria-label="Show" data-customer-filter value={listFilter} onChange={e => setListFilter(asCustomerFilter(e.target.value))}
            className={`mt-2 w-full border rounded-lg px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${listFilter ? 'border-orange-400 bg-orange-50 text-orange-900 font-semibold' : 'border-gray-200 text-gray-700'}`}>
            <option value="">All customers</option>
            {(Object.keys(CUSTOMER_FILTERS) as Array<Exclude<CustomerFilter, ''>>).map(k => (
              <option key={k} value={k}>{CUSTOMER_FILTERS[k].label} ({customers.filter(CUSTOMER_FILTERS[k].test).length})</option>
            ))}
          </select>
{can('records.import') && <label className="mt-2 flex items-center justify-center gap-1.5 w-full border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:border-orange-400 hover:text-orange-500 cursor-pointer transition-colors">
            📂 Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
          </label>}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No customers found</div>
          )}
          {listed.map(c => {
            const revenue = soldRevenue.get(c.id) ?? 0
            const isSelected = selectedId === c.id && mode !== 'new'
            return (
              <div
                key={c.id}
                onClick={() => { if (c.id !== selectedId) select(c.id) }}
                className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors group relative cursor-pointer ${isSelected ? 'bg-orange-50 border-r-2 border-orange-500' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${isSelected ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {c.firstName?.[0] ?? ''}{c.lastName?.[0] ?? ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-xs text-gray-400 truncate">{formatPhone(c.phone)}</p>
                  </div>
                  {revenue > 0 && <span className="text-xs font-semibold text-green-600 shrink-0">{fmt(revenue)}</span>}
                </div>
                {c.tags && c.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5 ml-12">
                    {c.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tagLabel(tag)}</span>
                    ))}
                    {c.tags.length > 2 && <span className="text-xs text-gray-400">+{c.tags.length - 2}</span>}
                  </div>
                )}
              </div>
            )
          })}
          {filtered.length > listed.length && (
            <button type="button" data-customer-list-more onClick={() => setListLimit(n => n + CUSTOMER_LIST_PAGE)}
              className="w-full px-4 py-3 text-sm font-semibold text-orange-700 hover:bg-orange-50">
              Show {Math.min(CUSTOMER_LIST_PAGE, filtered.length - listed.length)} more <span className="font-normal text-gray-400">({listed.length} of {filtered.length}; search finds them all)</span>
            </button>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400" data-customer-count={filtered.length}>
          {listFilter || search ? `${filtered.length} of ${customers.length}` : customers.length} customer{customers.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Detail pane: hidden on <lg unless something is selected. The mobile
          back button below the lg breakpoint takes the user back to the list. */}
      <div className={`${detailVisible ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}>
        {openedFrom() && detailVisible && (
          <button
            onClick={() => goBack('/customers')}
            className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 text-sm font-semibold text-orange-600 hover:bg-orange-50 rounded-t-2xl"
            data-back-to={openedFrom()}
          >
            <span aria-hidden>←</span>
            <span>{backLinkWords(openedFrom())}</span>
          </button>
        )}
        {detailVisible && !openedFrom() && (
          <button
            onClick={() => goBack('/customers')}
            className={`${customerView ? '' : 'lg:hidden '}flex items-center gap-2 px-4 py-2.5 lg:py-2 border-b border-gray-200 text-sm text-gray-600 hover:bg-gray-50 rounded-t-2xl`}
            aria-label="Back to customers list"
          >
            <span aria-hidden>←</span>
            <span>Back to customers</span>
          </button>
        )}
        {mode === 'new' && <CustomerForm onSave={handleSave} onCancel={() => goBack('/customers')} />}
        {mode === 'edit' && selected && <BackClose name="edit-customer" onClose={() => setEditing(false)} />}
        {mode === 'edit' && selected && <CustomerForm initial={selected} onSave={handleSave} onCancel={() => setEditing(false)} />}
        {mode === 'view' && !selected && selectedId && <CustomerNotHere key={selectedId} id={selectedId} />}
        {mode === 'view' && !selected && !selectedId && <EmptyState onNew={() => navigate('/customers/new')} />}
        {mode === 'view' && selected && (
          <CustomerDetail
            key={selected.id}
            roundTop={false}
            customer={selected}
            quotes={customerQuotes}
            importedQuotes={customerImportedQuotes}
            jobs={customerJobs}
            files={customerFiles}
            onEdit={() => setEditing(true)}
            onNewQuote={(c) => onNewQuote?.(c)}
            onDelete={handleDelete}
            archived={!!archivedSelected}
            onArchive={on => setArchived(selected.id, on)}
            onDeleteFile={id => setFiles(prev => {
              const updated = prev.filter(f => f.id !== id)
              cloudStorage.setItem('fencepro_files', JSON.stringify(updated))
              return updated
            })}
            onQuoteClick={(quoteId) => {
              const full = getQuotes().find(q => q.id === quoteId) || null
              setDrawerQuote(full as SavedQuote | null)
            }}
            onFileClick={(f) => setViewerFile(f)}
            initialTab={forcedTab}
            onTabConsumed={() => setForcedTab(null)}
          />
        )}
      </div>

      {deleting && (
        <ConfirmByTyping title={`Delete ${deleting.name}?`} name={deleting.name}
          body="Their quotes, jobs, pipeline card, appointments and invoices go with them. The owner or an admin can restore all of it from Settings > Deleted Records."
          action="Delete customer" onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
      )}

      {viewerFile && (
        <FileViewerModal
          file={viewerFile as unknown as CustomerFileShape}
          siblingImages={files.filter(f => /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name)) as unknown as CustomerFileShape[]}
          onClose={() => setViewerFile(null)}
          onDelete={!can('ops.delete') ? undefined : (id) => {
            setFiles(prev => {
              const next = prev.filter(f => f.id !== id)
              cloudStorage.setItem('fencepro_files', JSON.stringify(next))
              return next
            })
          }}
        />
      )}

      {drawerQuote && (
        <ScreenErrorBoundary name="Quote window" window onBack={() => setDrawerQuote(null)} resetKey={drawerQuote.id}><QuoteDetailDrawer
          quote={drawerQuote}
          onClose={() => setDrawerQuote(null)}
          onChange={() => {
            const updated = getQuotes().find(q => q.id === drawerQuote.id) || null
            setDrawerQuote(updated as SavedQuote | null)
            setQuotes(readQuotes())
            setJobs(readJobs())
          }}
        /></ScreenErrorBoundary>
      )}
    </div>
  )
}
// The customer's portal access (invite, resend, copy the link, open the
// portal), at the top of the customer page's Portal tab.
function PortalAccessSection({ customer }: { customer: Customer }) {
  const [bump, setBump] = useState(0)
  const [busy, setBusy] = useState(false)

  // Kick off a backend refresh on mount so the cached status is fresh
  useEffect(() => { loadAccountsSoon().then(() => setBump(b => b + 1)).catch(() => {}) }, [customer.id])
  void bump
  const status = getPortalAccessStatus(customer.id)

  function composeFallbackMailto(rawToken: string) {
    // Fallback used when the server couldn't send the email itself
    const link = buildActivationLink(rawToken)
    const tpl = getEmailTemplate('portal_welcome')
    const companyName = getConfig().company?.name || 'Getter Done Fence'
    const companyPhone = getConfig().company?.phone || ''
    const rendered = renderTemplate(tpl, {
      customer_first_name: customer.firstName || 'there',
      customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
      company_name: companyName,
      company_phone: companyPhone,
      portal_link: link,
    })
    const plainBody = rendered.body
      .replace(/<a[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const mailto = `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(rendered.subject)}&body=${encodeURIComponent(plainBody)}`
    navigator.clipboard?.writeText(link).catch(() => {})
    window.open(mailto, '_blank')
  }

  async function handleSend() {
    if (!customer.email) {
      toast.warning('No email on file', 'Add an email to this customer to send a portal invite.')
      return
    }
    setBusy(true)
    const r = await sendPortalInvite({
      id: customer.id, email: customer.email,
      firstName: customer.firstName, lastName: customer.lastName,
    })
    setBusy(false)
    if (!r.ok) {
      toast.error('Could not send portal invite', r.error || 'Unknown error')
      return
    }
    const { data } = r
    if (!data) return
    // Always copy link to clipboard as a safety net
    try { navigator.clipboard?.writeText(data.activationUrl) } catch {}
    if (data.emailSent) {
      toast.success('Portal invite sent', `Email delivered to ${customer.email}. Link also copied to clipboard.`)
      logCustomerActivity(customer.id, `Portal invite emailed to ${customer.email}`, { actor: 'user', kind: 'info' })
    } else {
      // Not sent by the server (email not set up, or the mail server refused it): hand off to the staff's email client.
      const tok = (data.activationUrl.match(/token=([a-f0-9]+)/i) || [])[1]
      if (tok) composeFallbackMailto(tok)
      const why = data.emailNotSetUp ? 'email is not set up' : (data.emailError || 'the email did not go')
      toast.warning(`Not sent: ${why}`,
        'Your email client opened with the invite filled in. Click Send there. The link is also copied to text it.')
      logCustomerActivity(customer.id, `Portal invite not sent by the server (${why}); opened in your email client`, { actor: 'user', kind: 'info' })
    }
    await loadAccountsSoon()
    setBump(b => b + 1)
  }

  async function handleResend() {
    setBusy(true)
    const r = await resendPortalInvite(customer.email)
    setBusy(false)
    if (r.ok && r.status === 'not_configured') {
      toast.warning('Not sent: email is not set up', 'Nothing went to the customer. Use Copy Link and text or email it yourself.')
    } else if (r.ok && r.status === 'failed') {
      toast.error('Not sent', 'The email did not go. Use Copy Link and text or email it yourself.')
    } else if (r.ok) {
      toast.success('New invite sent', 'The customer gets a fresh activation link by email.')
      await loadAccountsSoon()
      setBump(b => b + 1)
    } else if (r.error === 'RATE_LIMITED') {
      toast.warning('Too many requests', 'Resend limit reached for this email — try again in an hour.')
    } else {
      toast.error('Could not resend', r.error)
    }
  }

  async function handleCopyLink() {
    // Re-issue an invite to get a fresh token we can copy.
    setBusy(true)
    const r = await sendPortalInvite({
      id: customer.id, email: customer.email || '',
      firstName: customer.firstName, lastName: customer.lastName,
    })
    setBusy(false)
    if (r.ok && r.data) {
      try { await navigator.clipboard?.writeText(r.data.activationUrl) } catch {}
      toast.success('Activation link copied', 'A fresh link was issued and copied to your clipboard.')
    } else {
      toast.error('Could not issue a link', r.error)
    }
  }

  // Colors + copy vary by state
  let stateIcon = '👤', stateLabel = 'No Portal Access', bodyText = '', chipClass = 'bg-gray-100 text-gray-600'
  if (status.state === 'active') {
    stateIcon = '✓'; stateLabel = 'Portal Active'; chipClass = 'bg-green-100 text-green-700'
    bodyText = status.lastLogin
      ? `Last login ${new Date(status.lastLogin).toLocaleDateString()}.`
      : `Activated. Customer can sign in anytime.`
  } else if (status.state === 'invited') {
    stateIcon = '✉'; stateLabel = 'Invited'; chipClass = 'bg-blue-100 text-blue-700'
    bodyText = status.invitedAt
      ? `Invited ${new Date(status.invitedAt).toLocaleDateString()}. Customer hasn't activated yet.`
      : `Customer hasn't activated yet.`
  } else {
    bodyText = customer.email
      ? `Portal account is ready — click Send Invite to email the activation link.`
      : `Add an email address to enable the customer portal.`
  }

  return (
    <div className="bg-gradient-to-r from-orange-50 to-white border border-orange-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-portal-access>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-white border border-orange-200 flex items-center justify-center text-orange-500 text-xl shrink-0">
          {stateIcon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">Customer portal</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chipClass}`}>{stateLabel}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{bodyText}</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {status.state === 'none' && (
          <button onClick={handleSend} disabled={!customer.email}
            className="btn btn-secondary">
            Send portal invite
          </button>
        )}
        {status.state === 'invited' && (
          <>
            <button onClick={handleResend}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg whitespace-nowrap">
              Resend Invite
            </button>
            <button onClick={handleCopyLink}
              className="btn btn-secondary">
              Copy Link
            </button>
          </>
        )}
        {status.state === 'active' && (
          <a href={portalPageUrl('#/portal/login')} target="_blank" rel="noreferrer"
            className="btn btn-secondary">
            Open Portal
          </a>
        )}
      </div>
    </div>
  )
}
