/**
 * Inventory > Invoices: upload vendor invoices (PDFs or photos of paper) and
 * let them update Inventory prices.
 *
 *   Upload invoice   PDFs (each is one invoice) or photos (several pages are
 *                    one invoice). Saved on this phone first, like photos.
 *   Invoices         each one's state; tap to see the pages next to the lines.
 *   Needs a match    vendor items never seen before: pick the Inventory item
 *                    and the unit once, then it is automatic.
 *   Waiting for OK   a price that moved more than the limit (Settings).
 *   Price history    every landed cost applied, per item and vendor.
 *   Vendors          bills by vendor and month.
 *
 * Owner and office only (the server refuses everyone else). OK, Undo and
 * adding an Inventory item change prices: owner, admin or manager.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listInvoices, getInvoice, listWaiting, listNeedsMatch, priceHistory, vendorsByMonth, listJobs, editHeader, editLine, addLine,
  matchLine, okLine, rejectLine, undoInvoice, markOrdered, rereadInvoice, removeInvoice, pageImageUrl, openInvoiceFile, queueInvoice,
  isInvoicePdf, isInvoicePhoto, uploadOutcome, money, unitPrice, toCents, toHc, lineSuggestions, pctOfBp, isFuelFee,
  type InvoiceSummary, type InvoiceDetail, type InvoiceLine, type WaitingLine, type MatchLine, type HistoryRow, type VendorMonths, type Problem, type Box,
} from './vendorInvoicesApi'
import { localInvoiceFiles, uploadAll, uploadRefusedWhy, uploadedAs, discardLocal, MEDIA_EVENT } from './mediaStore'
import { getInventory, refreshInventory, INVENTORY_UPDATED_EVENT } from './inventoryStore'
import { getVendors, initVendors, refreshVendors } from './vendorStore'
import { unitPresets, startingPreset, unitPreview, packOfName } from './invoiceUnits'
import { useCan } from './permissions'
import { searchInventory } from './inventorySearch'
import { toast } from './toast'

type View = 'invoices' | 'match' | 'waiting' | 'history' | 'vendors'

const STATUS: Record<string, { label: string; cls: string }> = {
  receiving: { label: 'Uploading', cls: 'bg-gray-100 text-gray-600' },
  reading: { label: 'Reading…', cls: 'bg-blue-100 text-blue-700' },
  needs_review: { label: 'Needs review', cls: 'bg-red-100 text-red-700' },
  needs_match: { label: 'Needs a match', cls: 'bg-amber-100 text-amber-800' },
  applied: { label: 'Applied', cls: 'bg-green-100 text-green-700' },
  refused: { label: 'Refused', cls: 'bg-gray-200 text-gray-700' },
  undone: { label: 'Undone', cls: 'bg-gray-100 text-gray-600' },
  failed: { label: 'Could not read', cls: 'bg-red-100 text-red-700' },
  quote: { label: 'Vendor quote', cls: 'bg-purple-100 text-purple-800' },
  replaced: { label: 'Replaced by newer revision', cls: 'bg-gray-100 text-gray-600' },
}

const LINE_STATE: Record<string, { label: string; cls: string }> = {
  open: { label: '', cls: '' },
  needs_match: { label: 'Needs a match', cls: 'bg-amber-100 text-amber-800' },
  waiting_ok: { label: 'Waiting for OK', cls: 'bg-orange-100 text-orange-800' },
  applied: { label: 'Applied', cls: 'bg-green-100 text-green-700' },
  history_only: { label: 'Not applied: Inventory has a newer price', cls: 'bg-sky-100 text-sky-800' },
  rejected: { label: 'Turned down', cls: 'bg-gray-100 text-gray-600' },
  skipped: { label: 'Not priced', cls: 'bg-gray-100 text-gray-600' },
  undone: { label: 'Undone', cls: 'bg-gray-100 text-gray-600' },
  quoted: { label: 'Quote: not applied', cls: 'bg-purple-100 text-purple-800' },
}

/** A line's state as shown: one priced before Oct 26 with "Kept in price history only" was saved as applied, but was not. */
const shownState = (l: { state: string; stateNote: string }) =>
  l.state === 'applied' && /price history only/i.test(l.stateNote) && !/→/.test(l.stateNote) ? 'history_only' : l.state

const PROBLEM_WORDS: Record<string, string> = {
  math: 'Quantity × price is not the amount',
  unclear: 'Hard to read: check it against the picture',
  no_quantity: 'No quantity',
  no_price: 'No unit price',
  no_amount: 'No amount',
  credit: 'A credit line',
}

function problemText(p: Problem): string {
  switch (p.kind) {
    case 'unclear_lines': return `${p.lines.length} line${p.lines.length === 1 ? '' : 's'} unclear or not adding up (in red below).`
    case 'subtotal': return `The lines add up to ${money(p.linesCents)}, but the subtotal says ${money(p.subtotalCents)}.`
    case 'total': return `Subtotal + tax + freight + fees = ${money(p.computedCents)}, but the total says ${money(p.totalCents)}.`
    case 'no_total': return 'No total was found. Type it in below.'
    case 'no_lines': return 'No lines were found. Add them below, or read it again.'
    case 'no_vendor': return 'No vendor was found. Pick one below.'
    case 'new_vendor': return `"${p.name}" is not in Vendors yet. Pick the vendor or add it, once.`
    case 'no_number': return 'No invoice number was found. Type it in below.'
    case 'no_date': return 'No invoice date was found. Type it in below.'
    case 'no_tax': return 'No tax on this document: estimated tax is added (see above).'
  }
}

const dayText = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '—'
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const pctText = (p: number | null | undefined) => (p == null ? '' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`)

const btn = 'inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg text-sm font-medium transition disabled:opacity-50'
const primary = `${btn} bg-orange-600 text-white hover:bg-orange-700`
const secondary = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`
const danger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`
const input = 'w-full min-w-0 border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'

function errText(e: unknown) { return (e as Error)?.message || 'Something went wrong' }

export default function VendorInvoicesTab() {
  const [view, setView] = useState<View>('invoices')
  // Opened from a voided bill in Vendors (?tab=invoices&invoice=…): that document.
  const [openId, setOpenId] = useState<string | null>(() => { try { return new URLSearchParams(window.location.search).get('invoice') } catch { return null } })
  const [list, setList] = useState<InvoiceSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [onPhone, setOnPhone] = useState<OnPhoneFile[]>([])
  const [matchCount, setMatchCount] = useState(0)
  const [waitCount, setWaitCount] = useState(0)

  const load = useCallback(async () => {
    try {
      const [l, m, w] = await Promise.all([listInvoices(), listNeedsMatch(), listWaiting()])
      setList(l); setMatchCount(m.length); setWaitCount(w.length); setError('')
    } catch (e) { setError(errText(e)) }
    setLoaded(true)
  }, [])

  useEffect(() => { void load(); initVendors().catch(() => {}) }, [load])
  // Files still on this phone (no signal yet), like photos.
  useEffect(() => {
    const read = () => { localInvoiceFiles().then(f => setOnPhone(f.map(x => ({ clientId: x.clientId, name: x.meta.fileName || 'Invoice file', why: uploadRefusedWhy(x.clientId) })))).catch(() => {}) }
    read()
    window.addEventListener(MEDIA_EVENT, read)
    return () => window.removeEventListener(MEDIA_EVENT, read)
  }, [])
  // While something is uploading or being read, look again every few seconds.
  const busy = onPhone.some(f => !f.why) || list.some(i => i.status === 'receiving' || i.status === 'reading')
  const wasBusy = useRef(false)
  useEffect(() => {
    // Only the list while waiting (light on the server); the counts once it is done.
    if (busy) { wasBusy.current = true; const t = setInterval(() => { listInvoices().then(setList).catch(() => {}) }, 3000); return () => clearInterval(t) }
    if (wasBusy.current) { wasBusy.current = false; void load(); void refreshInventory(); void refreshVendors() }
  }, [busy, load])

  // Accounts Payable and Vendors show a bill the server made or voided now, not after a reload.
  const afterChange = useCallback(async () => { await load(); await refreshInventory(); await refreshVendors() }, [load])

  if (openId) return <InvoiceView id={openId} onBack={() => { setOpenId(null); void load() }} onChanged={afterChange} />

  const tabs: Array<[View, string]> = [
    ['invoices', 'Invoices'],
    ['match', `Needs a match${matchCount ? ` (${matchCount})` : ''}`],
    ['waiting', `Waiting for OK${waitCount ? ` (${waitCount})` : ''}`],
    ['history', 'Price history'],
    ['vendors', 'Vendors by month'],
  ]

  return (
    <div className="space-y-4 min-w-0" data-invoices-tab>
      <UploadCard onPhone={onPhone} onQueued={() => { void load() }} />
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} data-invoice-view={k} onClick={() => setView(k)}
            className={`min-h-[36px] px-3 rounded-full text-sm font-medium border ${view === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`}>
            {l}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{error}</p>}
      {view === 'invoices' && <InvoiceList list={list} loaded={loaded} onOpen={setOpenId} />}
      {view === 'match' && <NeedsMatchList onChanged={afterChange} onOpen={setOpenId} />}
      {view === 'waiting' && <WaitingList onChanged={afterChange} onOpen={setOpenId} />}
      {view === 'history' && <HistoryView />}
      {view === 'vendors' && <VendorsView />}
    </div>
  )
}

// ── Upload ────────────────────────────────────────────────────────────────────

interface OnPhoneFile { clientId: string; name: string; why: string | null }

/** The invoice the Mac made of files just uploaded, once it is past Uploading and Reading (up to about 20 seconds). */
async function readOutcome(ids: string[]): Promise<{ status: string; message: string } | null> {
  const invoiceId = ids.map(uploadedAs).find((x): x is string => !!x)
  if (!invoiceId) return null
  for (let i = 0; i < 20; i++) {
    const inv = await getInvoice(invoiceId).catch(() => null)
    if (inv && inv.status !== 'receiving' && inv.status !== 'reading') return { status: inv.status, message: inv.message || '' }
    await new Promise(r => setTimeout(r, 1000))
  }
  return null
}

/** Sends the files just saved, then says in plain words what happened to them. */
async function sendAndTell(ids: string[], what: string): Promise<void> {
  // A run already going does not include files added after it started: one more run sends them.
  await uploadAll().catch(() => {})
  await uploadAll().catch(() => {})
  const out = uploadOutcome(ids, await localInvoiceFiles().catch(() => []), uploadRefusedWhy, typeof navigator === 'undefined' || navigator.onLine !== false)
  if (out.kind === 'uploaded') {
    // What the Mac then made of it: an "already uploaded" refusal is not a success.
    const outcome = await readOutcome(ids)
    if (outcome?.status === 'refused') toast.error(`${what} was not added`, outcome.message || 'This file was already uploaded. Nothing was changed.')
    else if (outcome?.status === 'needs_review' && outcome.message) toast.warning(`${what} uploaded: it needs review`, outcome.message)
    else toast.success(`${what} uploaded`, 'It is being read now and shows in the list below.')
  }
  else if (out.kind === 'refused') toast.error(`${what} was not uploaded`, out.why)
  else toast.warning(`${what} is not uploaded yet`, out.why)
}

function UploadCard({ onPhone, onQueued }: { onPhone: OnPhoneFile[]; onQueued: () => void }) {
  const [pages, setPages] = useState<File[]>([])
  const [forJob, setForJob] = useState(false)
  const [jobId, setJobId] = useState('')
  const [jobs, setJobs] = useState<Array<{ id: string; customerName: string; fenceStyle: string }>>([])
  const [saving, setSaving] = useState(false)
  const pdfRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const picRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (forJob && !jobs.length) listJobs().then(setJobs).catch(e => toast.error('Could not load the jobs', errText(e))) }, [forJob, jobs.length])
  const job = forJob && jobId ? jobId : null

  async function sendPdfs(files: FileList | null) {
    if (!files?.length) return
    const all = [...files]
    const pdfs = all.filter(isInvoicePdf)
    const other = all.filter(f => !isInvoicePdf(f))
    if (other.length) toast.error(`${other.map(f => f.name || 'A file').join(', ')} ${other.length === 1 ? 'is' : 'are'} not a PDF`, 'Use Pick photos for pictures of a paper invoice.')
    // Named .pdf but not one inside (a photo renamed): said now, not uploaded.
    const heads = await Promise.all(pdfs.map(f => f.slice(0, 5).text().catch(() => '')))
    const fake = pdfs.filter((_, i) => heads[i] && !heads[i].startsWith('%PDF'))
    if (fake.length) toast.error(`${fake.map(f => f.name).join(', ')} ${fake.length === 1 ? 'is' : 'are'} named .pdf but ${fake.length === 1 ? 'is not a PDF' : 'are not PDFs'}`, 'If it is a photo of the invoice, use Pick photos.')
    const real = pdfs.filter(f => !fake.includes(f))
    if (!real.length) return
    pdfs.length = 0; pdfs.push(...real)
    setSaving(true)
    try {
      // Each PDF is its own invoice (all its pages are in the one file).
      const ids: string[] = []
      for (const f of pdfs) ids.push(...await queueInvoice([f], [f.name], job))
      onQueued()
      await sendAndTell(ids, pdfs.length === 1 ? 'The invoice' : `${pdfs.length} invoices`)
      onQueued()
    } catch (e) { toast.error('Not saved', `${errText(e)}. Nothing was uploaded; try again.`) }
    setSaving(false)
  }

  function addPages(files: FileList | null) {
    const all = [...(files ?? [])]
    const ok = all.filter(isInvoicePhoto)
    const other = all.filter(f => !isInvoicePhoto(f))
    if (other.length) toast.error(`${other.map(f => f.name || 'A file').join(', ')} ${other.length === 1 ? 'is' : 'are'} not a photo the app takes`, isInvoicePdf(other[0]) ? 'Use PDF files for a PDF.' : 'Use a JPEG, PNG or HEIC photo.')
    if (ok.length) setPages(p => [...p, ...ok])
  }

  async function sendPages() {
    if (!pages.length) return
    setSaving(true)
    try {
      const ids = await queueInvoice(pages, pages.map(p => p.name), job)
      setPages([])
      onQueued()
      await sendAndTell(ids, `The invoice (${ids.length} page${ids.length === 1 ? '' : 's'})`)
      onQueued()
    } catch (e) { toast.error('Not saved', `${errText(e)}. Nothing was uploaded; try again.`) }
    setSaving(false)
  }

  const refused = onPhone.filter(f => f.why)
  const waiting = onPhone.length - refused.length

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-invoice-upload>
      <div>
        <h2 className="text-base font-semibold text-gray-900">Upload invoice</h2>
        <p className="text-xs text-gray-500 mt-0.5">Prices update by themselves once the invoice adds up and each item is matched. Nothing is applied if it does not add up.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button className={primary} onClick={() => pdfRef.current?.click()} disabled={saving} data-upload-pdf>{saving ? 'Uploading…' : 'PDF files'}</button>
        <button className={secondary} onClick={() => camRef.current?.click()} disabled={saving} data-take-photo>Take photo of a page</button>
        <button className={secondary} onClick={() => picRef.current?.click()} disabled={saving} data-pick-photos>Pick photos</button>
      </div>
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" data-pdf-input
        onChange={e => { void sendPdfs(e.target.files); e.target.value = '' }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" data-camera-input
        onChange={e => { addPages(e.target.files); e.target.value = '' }} />
      <input ref={picRef} type="file" accept="image/*" multiple className="hidden" data-photos-input
        onChange={e => { addPages(e.target.files); e.target.value = '' }} />
      {pages.length > 0 && (
        <div className="rounded-xl bg-orange-50 border border-orange-200 p-3 space-y-2" data-pages-tray>
          <p className="text-sm font-medium text-gray-900">{pages.length} page{pages.length === 1 ? '' : 's'} of one invoice</p>
          <p className="text-xs text-gray-700" data-pages-hint>Not uploaded yet. Add every page of this invoice, then tap {pages.length === 1 ? 'Upload page' : `Upload ${pages.length} pages`}.</p>
          <ol className="text-xs text-gray-600 space-y-1">
            {pages.map((p, i) => (
              <li key={i} className="flex items-center gap-2 min-w-0">
                <span className="shrink-0">Page {i + 1}</span>
                <span className="truncate flex-1 min-w-0">{p.name}</span>
                <button className="text-red-600 underline shrink-0 min-h-[32px]" onClick={() => setPages(ps => ps.filter((_, k) => k !== i))}>Remove</button>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-2 gap-2">
            <button className={secondary} onClick={() => picRef.current?.click()} disabled={saving}>Add a page</button>
            <button className={primary} onClick={() => void sendPages()} disabled={saving} data-send-pages>{saving ? 'Uploading…' : `Upload ${pages.length === 1 ? 'page' : `${pages.length} pages`}`}</button>
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[36px]">
        <input type="checkbox" checked={forJob} onChange={e => setForJob(e.target.checked)} data-for-job />
        This is for a job (job lot order)
      </label>
      {forJob && (
        <select className={input} value={jobId} onChange={e => setJobId(e.target.value)} data-job-select>
          <option value="">Pick the job…</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{[j.customerName, j.fenceStyle].filter(Boolean).join(' · ') || j.id}</option>)}
        </select>
      )}
      {waiting > 0 && (
        <p className="text-xs text-blue-700 bg-blue-50 rounded-lg p-2 flex flex-wrap items-center gap-2" data-on-phone>
          {waiting} file{waiting === 1 ? '' : 's'} saved on this device, waiting to upload.
          <button className="underline min-h-[32px]" onClick={() => { void uploadAll().then(() => uploadAll()).catch(() => {}) }}>Try now</button>
        </p>
      )}
      {refused.map(f => (
        <div key={f.clientId} className="text-xs text-red-800 bg-red-50 rounded-lg p-2 flex flex-wrap items-center gap-2" data-upload-refused={f.clientId}>
          <span className="min-w-0 break-words"><span className="font-semibold">{f.name}</span> was not uploaded: {f.why}</span>
          <button className="underline min-h-[32px]" onClick={() => { void discardLocal(f.clientId) }} data-upload-refused-remove>Remove it from this device</button>
        </div>
      ))}
    </div>
  )
}

// ── Lists ─────────────────────────────────────────────────────────────────────

function InvoiceList({ list, loaded, onOpen }: { list: InvoiceSummary[]; loaded: boolean; onOpen: (id: string) => void }) {
  if (!loaded) return <p className="text-sm text-gray-500">Loading…</p>
  if (!list.length) return <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-200 p-6 text-center">No invoices yet. Upload one above.</p>
  return (
    <ul className="space-y-2" data-invoice-list>
      {list.map(i => {
        const s = STATUS[i.status] ?? STATUS.receiving
        return (
          <li key={i.id}>
            <button className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 hover:border-orange-300 min-w-0" onClick={() => onOpen(i.id)} data-invoice-row={i.invoiceNumber || i.id}>
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{i.vendorName || 'Vendor not read yet'}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {i.invoiceNumber ? `#${i.invoiceNumber}` : 'No number yet'} · {dayText(i.invoiceDate)}{i.jobName ? ` · ${i.jobName}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
                  <p className="text-sm font-semibold text-gray-900 mt-1">{money(i.totalCents)}</p>
                </div>
              </div>
              {(i.counts.needsMatch > 0 || i.counts.waitingOk > 0) && (
                <p className="text-xs text-amber-800 mt-1">
                  {[i.counts.needsMatch ? `${i.counts.needsMatch} need a match` : '', i.counts.waitingOk ? `${i.counts.waitingOk} waiting for OK` : ''].filter(Boolean).join(' · ')}
                </p>
              )}
              {i.message && <p className="text-xs text-gray-600 mt-1 break-words">{i.message}</p>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function NeedsMatchList({ onChanged, onOpen }: { onChanged: () => Promise<void>; onOpen: (id: string) => void }) {
  const [lines, setLines] = useState<MatchLine[] | null>(null)
  const load = useCallback(() => { listNeedsMatch().then(setLines).catch(e => toast.error('Could not load', errText(e))) }, [])
  useEffect(() => { load() }, [load])
  if (!lines) return <p className="text-sm text-gray-500">Loading…</p>
  if (!lines.length) return <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-200 p-6 text-center">Every vendor item is matched.</p>
  return (
    <ul className="space-y-3" data-needs-match-list>
      {lines.map(l => (
        <li key={l.id} className="bg-white rounded-xl border border-amber-300 p-3 space-y-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 break-words">{l.itemNumber ? `${l.itemNumber} · ` : ''}{l.description}</p>
            <p className="text-xs text-gray-500">
              {l.invoice.vendorName} ·{' '}
              <button className="underline" onClick={() => onOpen(l.invoice.id)}>#{l.invoice.invoiceNumber}</button> · {l.qty} {l.unit} × {unitPrice(l.unitPriceHc)} = {money(l.totalCents)}
            </p>
          </div>
          <Matcher line={l} suggestions={l.suggestions} onDone={async () => { load(); await onChanged() }} />
        </li>
      ))}
    </ul>
  )
}

function WaitingList({ onChanged, onOpen }: { onChanged: () => Promise<void>; onOpen: (id: string) => void }) {
  const [lines, setLines] = useState<WaitingLine[] | null>(null)
  const mayOk = useCan('prices.change')
  const load = useCallback(() => { listWaiting().then(setLines).catch(e => toast.error('Could not load', errText(e))) }, [])
  useEffect(() => { load() }, [load])
  async function decide(l: WaitingLine, ok: boolean) {
    try {
      if (ok) await okLine(l.id); else await rejectLine(l.id)
      toast.success(ok ? `${l.inventoryName}: ${money(l.unitLandedCents)}` : `${l.inventoryName}: price kept`)
      load(); await onChanged()
    } catch (e) { toast.error('Not saved', errText(e)) }
  }
  if (!lines) return <p className="text-sm text-gray-500">Loading…</p>
  if (!lines.length) return <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-200 p-6 text-center">No price is waiting for an OK.</p>
  return (
    <ul className="space-y-2" data-waiting-list>
      {lines.map(l => (
        <li key={l.id} className="bg-white rounded-xl border border-orange-300 p-3 space-y-2" data-waiting-line={l.itemNumber}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 break-words">{l.inventoryName}</p>
            <p className="text-xs text-gray-500 break-words">
              {l.invoice.vendorName} · <button className="underline" onClick={() => onOpen(l.invoice.id)}>#{l.invoice.invoiceNumber}</button> · {dayText(l.invoice.invoiceDate)}
            </p>
            <p className="text-sm mt-1">
              <span className="text-gray-500">{money(l.prevUnitCents)}</span> → <span className="font-semibold text-gray-900">{money(l.unitLandedCents)}</span>{' '}
              <span className={`font-semibold ${(l.changePct ?? 0) > 0 ? 'text-red-700' : 'text-green-700'}`}>{pctText(l.changePct)}</span>
            </p>
          </div>
          {mayOk ? (
            <div className="grid grid-cols-2 gap-2">
              <button className={secondary} onClick={() => void decide(l, false)} data-reject>Keep old price</button>
              <button className={primary} onClick={() => void decide(l, true)} data-ok>OK, use new price</button>
            </div>
          ) : <p className="text-xs text-gray-500">Waits for Jonathan's OK.</p>}
        </li>
      ))}
    </ul>
  )
}

function HistoryView() {
  const [q, setQ] = useState('')
  const [itemId, setItemId] = useState<string>('')
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const items = getInventory()
  const names = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items])
  const found = useMemo(() => {
    // Every word, in any order, punctuation left out ("bolt 3/8").
    return searchInventory(items, q)
  }, [q, items])
  useEffect(() => { setRows(null); priceHistory(itemId || undefined).then(setRows).catch(e => toast.error('Could not load', errText(e))) }, [itemId])
  return (
    <div className="space-y-3" data-price-history>
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
        <label className="text-xs text-gray-500 block">Item</label>
        <input className={input} value={q} placeholder="Search Inventory…" onChange={e => setQ(e.target.value)} data-history-search />
        {found.length > 0 && (
          <ul className="border border-gray-200 rounded-lg divide-y">
            {found.map(i => (
              <li key={i.id}><button className="w-full text-left text-sm px-3 py-2 min-h-[40px] hover:bg-orange-50 break-words" onClick={() => { setItemId(i.id); setQ('') }}>{i.name}</button></li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-600">
          {itemId ? <>Showing <b>{names.get(itemId) ?? itemId}</b> · <button className="underline" onClick={() => setItemId('')}>show all items</button></> : 'Showing the latest changes for every item.'}
        </p>
      </div>
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <p className="text-sm text-gray-500 text-center p-6 bg-white rounded-xl border">No prices from invoices yet.</p> : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.id} className={`bg-white rounded-xl border border-gray-200 p-3 ${r.undoneAt ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  {!itemId && <p className="text-sm font-semibold text-gray-900 break-words">{names.get(r.inventoryItemId) ?? r.inventoryItemId}</p>}
                  <p className="text-xs text-gray-500 break-words">{dayText(r.day)} · {r.vendorName}{r.invoiceNumber ? ` · #${r.invoiceNumber}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-gray-900">{money(r.unitLandedCents)}</p>
                  <p className="text-[11px] text-gray-500">was {money(r.prevUnitCents)}</p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {[r.undoneAt ? 'Undone' : '', !r.changedInventory ? 'History only (Inventory had a newer price)' : '', r.approved ? 'OK’d' : '', r.appliedBy].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function VendorsView() {
  const [months, setMonths] = useState(6)
  const [data, setData] = useState<VendorMonths | null>(null)
  useEffect(() => { setData(null); vendorsByMonth(months).then(setData).catch(e => toast.error('Could not load', errText(e))) }, [months])
  const label = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) }
  return (
    <div className="space-y-3" data-vendors-by-month>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">Last</span>
        {[3, 6, 12].map(n => (
          <button key={n} onClick={() => setMonths(n)} className={`min-h-[36px] px-3 rounded-full text-sm border ${months === n ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>{n} months</button>
        ))}
      </div>
      {!data ? <p className="text-sm text-gray-500">Loading…</p> : !data.rows.length ? <p className="text-sm text-gray-500 p-6 text-center bg-white rounded-xl border">No vendors yet.</p> : (
        <ul className="space-y-2">
          {data.rows.map(r => (
            <li key={r.vendorId} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <p className="text-sm font-semibold text-gray-900 break-words min-w-0">{r.name}</p>
                <p className="text-sm font-semibold text-gray-900 shrink-0">{money(r.totalCents)}</p>
              </div>
              <p className="text-[11px] text-gray-500 mb-2">{r.bills} bill{r.bills === 1 ? '' : 's'}</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {data.months.map(m => (
                  <div key={m} className={`rounded-lg px-2 py-1.5 ${r.byMonth[m] ? 'bg-orange-50' : 'bg-gray-50'}`}>
                    <p className="text-[10px] text-gray-500">{label(m)}</p>
                    <p className="text-xs font-medium text-gray-900 truncate">{r.byMonth[m] ? money(r.byMonth[m]) : '—'}</p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Matching ──────────────────────────────────────────────────────────────────

// Unit choices (both ways, in words with the units) live in invoiceUnits.ts.

function Matcher({ line, suggestions, onDone, onCancel }: { line: InvoiceLine; suggestions: Array<{ id: string; name: string; why: string }>; onDone: () => Promise<void> | void; onCancel?: () => void }) {
  const mayAdd = useCan('prices.change')
  const items = getInventory()
  const [picked, setPicked] = useState<string>('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState(line.description)
  // Starts on the unit the description prints ("50ft/rll" → 50 ft = 1 roll), else same unit.
  const [vendorPer, setVendorPer] = useState(() => String(startingPreset(line).vendorPer))
  const [invPer, setInvPer] = useState(() => String(startingPreset(line).invPer))
  // Once the unit is tapped or typed, picking an item no longer changes it.
  const [unitTouched, setUnitTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const pickedItem = items.find(i => i.id === picked)
  const found = useMemo(() => {
    // Every word, in any order, punctuation left out ("bolt 3/8").
    return searchInventory(items, q)
  }, [q, items])
  const vp = Number(vendorPer), ip = Number(invPer)
  const unitOk = vp > 0 && ip > 0
  const view = unitOk ? unitPreview(line, vp, ip) : null
  const pack = packOfName(pickedItem?.name)
  const invUnit = adding ? 'each' : pickedItem?.unitOfMeasure || (pack ? `box of ${pack}` : 'each')
  const presets = unitPresets(line, adding ? null : pickedItem?.name)

  function pick(id: string) {
    setPicked(id)
    // An item sold by the box ("Hook Ties ... (100)") starts on "100 EA = 1 box" unless the unit was already chosen.
    if (!unitTouched) {
      const p = startingPreset(line, items.find(i => i.id === id)?.name)
      setVendorPer(String(p.vendorPer)); setInvPer(String(p.invPer))
    }
  }

  async function save(choice: Record<string, unknown>) {
    setBusy(true)
    try {
      await matchLine(line.id, { ...choice, vendorPer: vp, invPer: ip })
      toast.success('Matched', 'Remembered for this vendor: next time it is automatic.')
      await onDone()
    } catch (e) { toast.error('Not saved', errText(e)) }
    setBusy(false)
  }

  return (
    <div className="space-y-2 min-w-0" data-matcher>
      {!adding && (
        <>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(s => (
                <button key={s.id} onClick={() => pick(s.id)} data-suggestion={s.id}
                  className={`text-left text-xs px-2.5 py-1.5 rounded-lg border min-h-[36px] max-w-full break-words ${picked === s.id ? 'bg-orange-600 text-white border-orange-600' : 'bg-white border-gray-300 text-gray-800'}`}>
                  {items.find(i => i.id === s.id)?.name ?? s.name}{s.why ? <span className="opacity-70"> · {s.why}</span> : null}
                </button>
              ))}
            </div>
          )}
          <input className={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Or search Inventory…" data-match-search />
          {found.length > 0 && (
            <ul className="border border-gray-200 rounded-lg divide-y bg-white">
              {found.map(i => <li key={i.id}><button className="w-full text-left text-sm px-3 py-2 min-h-[40px] hover:bg-orange-50 break-words" onClick={() => { pick(i.id); setQ('') }}>{i.name}</button></li>)}
            </ul>
          )}
          {pickedItem && <p className="text-xs text-gray-700">Inventory item: <b className="break-words">{pickedItem.name}</b></p>}
        </>
      )}
      {adding && (
        <div className="space-y-1">
          <label className="text-xs text-gray-500 block">New Inventory item name</label>
          <input className={input} value={newName} onChange={e => setNewName(e.target.value)} data-new-item-name />
        </div>
      )}
      <div className="rounded-lg bg-gray-50 p-2 space-y-1.5">
        <p className="text-xs text-gray-600">Unit: how the vendor's <b>{line.unit}</b> turns into Inventory units ({invUnit}).</p>
        <div className="flex flex-wrap gap-1.5">
          {presets.map(p => (
            <button key={p.label} onClick={() => { setUnitTouched(true); setVendorPer(String(p.vendorPer)); setInvPer(String(p.invPer)) }} data-unit-preset={p.label}
              aria-pressed={vp === p.vendorPer && ip === p.invPer}
              className={`text-xs px-2.5 py-1.5 rounded-full border min-h-[32px] ${vp === p.vendorPer && ip === p.invPer ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <input className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" inputMode="decimal" value={vendorPer} onChange={e => { setUnitTouched(true); setVendorPer(e.target.value) }} aria-label="Vendor units" data-vendor-per />
          <span>{line.unit} =</span>
          <input className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" inputMode="decimal" value={invPer} onChange={e => { setUnitTouched(true); setInvPer(e.target.value) }} aria-label="Inventory units" data-inv-per />
          <span>{invUnit}</span>
        </div>
        {view && !view.zero && <p className="text-xs text-gray-700" data-unit-preview>{line.qty} {line.unit} = {view.invQty.toLocaleString('en-US', { maximumFractionDigits: 3 })} {invUnit}. Landed: {money(line.landedCents ?? line.totalCents)} = <b>{money(view.cents)}</b> per {invUnit}</p>}
        {view?.zero && <p className="text-xs font-semibold text-red-700 bg-red-50 rounded p-1.5" data-unit-zero>That makes {line.qty} {line.unit} into {view.invQty.toLocaleString('en-US', { maximumFractionDigits: 3 })} {invUnit} at $0.00 each, which cannot be right. Pick the other way round (for example {`100 ${line.unit} = 1 box`}).</p>}
      </div>
      <div className={`grid grid-cols-1 gap-2 ${onCancel ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {!adding ? (
          <button className={primary} disabled={busy || !picked || !unitOk || !!view?.zero} onClick={() => void save({ inventoryItemId: picked })} data-save-match>Use this item</button>
        ) : (
          <button className={primary} disabled={busy || newName.trim().length < 2 || !unitOk || !!view?.zero} onClick={() => void save({ newItem: { name: newName.trim() } })} data-save-new-item>Add to Inventory</button>
        )}
        {mayAdd && <button className={secondary} onClick={() => setAdding(a => !a)} data-add-new>{adding ? 'Pick an existing item' : 'New Inventory item'}</button>}
        <button className={secondary} disabled={busy} onClick={() => void save({ notInventory: true })} data-not-inventory>Not an Inventory item</button>
        {onCancel && <button className={secondary} disabled={busy} onClick={onCancel} data-cancel-match>Cancel</button>}
      </div>
    </div>
  )
}

// ── One invoice ───────────────────────────────────────────────────────────────

function PageImage({ id, page, boxes, focus }: { id: string; page: number; boxes: Array<{ box: Box; bad: boolean; key: string }>; focus: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true, made: string | null = null
    pageImageUrl(id, page).then(u => { made = u; if (live) setUrl(u) })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [id, page])
  useEffect(() => {
    if (!focus || !wrap.current) return
    const el = wrap.current.querySelector(`[data-box="${focus}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])
  return (
    <div ref={wrap} className="relative w-full bg-gray-100 rounded-lg overflow-hidden border border-gray-200" data-page-image={page}>
      {url ? <img src={url} alt={`Page ${page}`} className="block w-full h-auto" /> : <div className="aspect-[8.5/11] flex items-center justify-center text-xs text-gray-500">Loading page {page}…</div>}
      {url && boxes.map(b => (
        <div key={b.key} data-box={b.key}
          className={`absolute pointer-events-none rounded-sm ${b.key === focus ? 'ring-4 ring-blue-500 bg-blue-300/30' : b.bad ? 'ring-2 ring-red-500 bg-red-400/25' : 'bg-green-400/10'}`}
          style={{ left: `${b.box.x * 100 - 0.5}%`, top: `${b.box.y * 100 - 0.4}%`, width: `${b.box.w * 100 + 1}%`, height: `${b.box.h * 100 + 0.8}%` }} />
      ))}
    </div>
  )
}

function InvoiceView({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const [inv, setInv] = useState<InvoiceDetail | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [matching, setMatching] = useState<string | null>(null)
  const [hints, setHints] = useState<Array<{ id: string; name: string; why: string }>>([])
  useEffect(() => {
    setHints([])
    if (matching) lineSuggestions(matching).then(setHints).catch(() => {})
  }, [matching])
  const mayPrices = useCan('prices.change')
  const [, setTick] = useState(0)
  useEffect(() => { const f = () => setTick(t => t + 1); window.addEventListener(INVENTORY_UPDATED_EVENT, f); return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, f) }, [])

  const load = useCallback(async () => {
    try { setInv(await getInvoice(id)) } catch (e) { toast.error('Could not load the invoice', errText(e)) }
  }, [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (inv?.status !== 'reading' && inv?.status !== 'receiving') return
    const t = setInterval(() => { void load() }, 2000)
    return () => clearInterval(t)
  }, [inv?.status, load])

  const refresh = async () => { await load(); await onChanged() }
  async function act(fn: () => Promise<unknown>, done?: string) {
    try { await fn(); if (done) toast.success(done); await refresh() } catch (e) { toast.error('Not saved', errText(e)) }
  }

  if (!inv) return <div className="space-y-3"><button className={secondary} onClick={onBack}>← Invoices</button><p className="text-sm text-gray-500">Loading…</p></div>

  const s = STATUS[inv.status] ?? STATUS.receiving
  const review = inv.status === 'needs_review'
  const inventoryNames = new Map(getInventory().map(i => [i.id, i.name]))
  const unclear = new Set(inv.problems.flatMap(p => (p.kind === 'unclear_lines' ? p.lines : [])))
  const active = inv.lines.filter(l => !l.ignored)
  const boxesFor = (page: number) => [
    ...inv.lines.filter(l => l.page === page && l.box).map(l => ({ key: l.id, box: l.box!, bad: !l.ignored && (l.problems.length > 0 || unclear.has(active.indexOf(l))) || l.state === 'needs_match' })),
    ...inv.fees.filter(f => f.page === page && f.box).map((f, k) => ({ key: `fee-${k}`, box: f.box!, bad: false })),
  ]
  const totalBad = inv.problems.some(p => p.kind === 'total' || p.kind === 'subtotal' || p.kind === 'no_total')

  return (
    <div className="space-y-4 min-w-0" data-invoice-detail={inv.invoiceNumber || inv.id}>
      <div className="flex flex-wrap items-center gap-2">
        <button className={secondary} onClick={onBack} data-back>← Invoices</button>
        <span className={`text-xs px-2 py-1 rounded-full ${s.cls}`} data-status={inv.status}>{s.label}</span>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-1">
        <h2 className="text-lg font-semibold text-gray-900 break-words">{inv.vendorName || 'Vendor not read'}</h2>
        <p className="text-sm text-gray-600 break-words">{inv.invoiceNumber ? `${inv.docType === 'quote' ? 'Quote' : 'Invoice'} #${inv.invoiceNumber}` : 'No number'} · {dayText(inv.invoiceDate)} · {inv.pageCount} page{inv.pageCount === 1 ? '' : 's'}{inv.engine ? ` · read from ${inv.engine === 'pdf-text' ? 'the PDF text' : 'the picture'}` : ''}</p>
        {inv.docType === 'quote' && <p className="text-sm text-purple-800 break-words">Quotation{inv.revision ? ` · revision ${inv.revision}` : ''}{inv.ordered ? ` · ordered${inv.orderedBy ? ` by ${inv.orderedBy}` : ''}: treated as the invoice` : ''}</p>}
        {inv.skipped?.length > 0 && <p className="text-xs text-gray-500 break-words">Left out: {inv.skipped.map(x => x.text.slice(0, 30)).join(' · ')}</p>}
        {inv.jobName && <p className="text-sm text-gray-600 break-words">For job: {inv.jobName}</p>}
        {inv.message && <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-2 mt-2 break-words" data-message>{inv.message}</p>}
        {inv.status === 'reading' && <p className="text-sm text-blue-700">Reading on the Mac…</p>}
        {review && inv.problems.length > 0 && (
          <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-3" data-problems>
            <p className="text-sm font-semibold text-red-800">Nothing has been applied. Fix these by tapping below:</p>
            <ul className="list-disc pl-5 text-sm text-red-800 mt-1 space-y-0.5">{inv.problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>
          </div>
        )}
        {!inv.taxFound && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2" data-est-tax>
            {inv.taxOk
              ? <p className="text-sm text-amber-900">No tax line on this document, and no tax is right: nothing is added for tax.</p>
              : <p className="text-sm text-amber-900"><b>Estimated tax.</b> No tax line on this document, so {inv.estTaxBp != null ? pctOfBp(inv.estTaxBp) : 'the estimated tax rate (Settings)'}{inv.estTaxCents ? ` (${money(inv.estTaxCents)})` : ''} is added to the landed cost of its items. It is not added to the vendor bill.</p>}
            {(inv.status === 'needs_review' || inv.status === 'quote') && (
              <button className={secondary} onClick={() => void act(() => editHeader(inv.id, { taxOk: !inv.taxOk }), inv.taxOk ? 'Estimated tax added' : 'No tax: estimated tax taken off')} data-tax-ok>
                {inv.taxOk ? 'Add the estimated tax' : 'No tax is right (take it off)'}
              </button>
            )}
          </div>
        )}
        {inv.status === 'quote' && (
          <div className="mt-2 rounded-lg bg-purple-50 border border-purple-200 p-3 space-y-2" data-quote-banner>
            <p className="text-sm text-purple-900">A vendor quote: saved, and it changes no Inventory price. Match its items now if you like; the prices below show what they would be.{inv.counts.needsMatch ? ` ${inv.counts.needsMatch} item${inv.counts.needsMatch === 1 ? '' : 's'} not matched yet.` : ''}</p>
            {mayPrices ? (
              <button className={`${primary} w-full sm:w-auto`} data-we-ordered onClick={() => {
                if (!confirm('Treat this quote as the invoice? Its matched items update Inventory prices (big changes still wait for your OK), and a bill is added in Vendors.')) return
                void act(() => markOrdered(inv.id), 'Ordered: applied as the invoice')
              }}>We ordered this</button>
            ) : (
              <p className="text-sm text-purple-900 font-medium" data-ordered-who>If this was ordered, ask Jonathan to tap <b>We ordered this</b>: it changes Inventory prices, so the owner does it.</p>
            )}
          </div>
        )}
        {inv.status === 'undone' && inv.docType === 'quote' && inv.ordered && (
          <div className="mt-2 rounded-lg bg-purple-50 border border-purple-200 p-3 space-y-2" data-order-again>
            <p className="text-sm text-purple-900">The order was undone: its prices were put back and its bill is off Accounts Payable. If it was ordered after all, order it again: its prices go in again and the same bill comes back (never a second one).</p>
            {mayPrices ? (
              <button className={`${primary} w-full sm:w-auto`} data-we-ordered onClick={() => {
                if (!confirm('Order this quote again? Its matched items update Inventory prices again (big changes still wait for your OK), and its bill is back in Accounts Payable.')) return
                void act(() => markOrdered(inv.id), 'Ordered again: prices and bill back')
              }}>We ordered this</button>
            ) : (
              <p className="text-sm text-purple-900 font-medium" data-ordered-who>If it was ordered after all, ask Jonathan to tap <b>We ordered this</b>: it changes Inventory prices, so the owner does it.</p>
            )}
          </div>
        )}
        {inv.status === 'needs_match' && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-2 mt-2">It adds up. Lines already matched are applied; match the rest below (once per vendor item).</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-2 lg:sticky lg:top-2 min-w-0" data-pages>
          {inv.pages.map(p => <PageImage key={p.page} id={inv.id} page={p.page} boxes={boxesFor(p.page)} focus={focus} />)}
          {inv.files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {inv.files.map(f => <button key={f.id} className="text-xs underline text-gray-600 min-h-[32px]" onClick={() => void openInvoiceFile(inv.id, f.id)}>Open {f.fileName || 'file'}</button>)}
            </div>
          )}
        </div>

        <div className="space-y-3 min-w-0">
          {review && <HeaderEditor inv={inv} onSaved={refresh} />}

          <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-2" data-lines>
            <h3 className="text-sm font-semibold text-gray-900">Lines</h3>
            {inv.lines.map(l => {
              const bad = !l.ignored && (l.problems.length > 0 || unclear.has(active.indexOf(l)))
              const st = LINE_STATE[shownState(l)]
              // The Inventory item's name now (it may have been renamed since the match).
              const itemName = (l.inventoryItemId && inventoryNames.get(l.inventoryItemId)) || l.inventoryName
              return (
                <div key={l.id} data-line={l.itemNumber || l.description} data-bad={bad ? '1' : '0'}
                  className={`rounded-xl border p-2.5 ${l.ignored ? 'opacity-50 border-gray-200' : bad ? 'border-red-400 bg-red-50' : l.state === 'needs_match' ? 'border-amber-300' : 'border-gray-200'} ${focus === l.id ? 'ring-2 ring-blue-500' : ''}`}>
                  <button className="w-full text-left min-w-0" onClick={() => { setFocus(l.id); if (review) setEditing(e => (e === l.id ? null : l.id)); setMatching(m => (m === l.id ? null : m)) }}>
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <p className="text-sm text-gray-900 min-w-0 break-words"><b>{l.itemNumber || '—'}</b> {l.description}</p>
                      <p className="text-sm font-semibold shrink-0">{money(l.totalCents)}</p>
                    </div>
                    <p className="text-xs text-gray-600">{l.qty ?? '?'} {l.unit} × {unitPrice(l.unitPriceHc)}{l.ignored ? ' · not a line' : ''}</p>
                    {bad && <p className="text-xs text-red-700 font-medium mt-0.5">{l.problems.map(p => PROBLEM_WORDS[p] ?? p).join(' · ') || 'Check this line'}{review ? ' — tap to fix' : ''}</p>}
                    {st?.label && <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full mt-1 ${st.cls}`}>{st.label}</span>}
                    {itemName && <p className="text-xs text-gray-700 mt-0.5 break-words">→ {itemName}{l.unitLandedCents != null ? `: landed ${money(l.unitLandedCents)} each${l.prevUnitCents != null ? ` (was ${money(l.prevUnitCents)}, ${pctText(l.changePct)})` : ''}` : ''}</p>}
                    {l.extraCents != null && l.extraCents !== 0 && <p className="text-[11px] text-gray-500">Tax, freight and fees share: {money(l.extraCents)}{l.estTaxCents ? ` (estimated tax ${money(l.estTaxCents)})` : ''}{inv.fees.some(f => isFuelFee(f.label)) ? ' · fuel charge not included' : ''}</p>}
                    {l.estTaxCents > 0 && <span className="inline-block text-[11px] px-2 py-0.5 rounded-full mt-1 ml-1 bg-amber-100 text-amber-800" data-line-est-tax>Estimated tax</span>}
                    {l.stateNote && <p className="text-[11px] text-gray-500 break-words">{l.stateNote}</p>}
                  </button>
                  {review && editing === l.id && <LineEditor inv={inv} line={l} onSaved={async () => { setEditing(null); await refresh() }} />}
                  {(l.state === 'needs_match' || (inv.status === 'quote' && (l.state === 'quoted' || l.state === 'skipped'))) && (
                    matching === l.id
                      ? <div className="mt-2"><Matcher line={l} suggestions={hints} onDone={async () => { setMatching(null); await refresh() }} onCancel={() => setMatching(null)} /></div>
                      : l.state === 'needs_match'
                        ? <button className={`${primary} mt-2 w-full sm:w-auto`} onClick={() => setMatching(l.id)} data-match-line>Match to Inventory</button>
                        : <button className={`${secondary} mt-2 w-full sm:w-auto`} onClick={() => setMatching(l.id)} data-change-match>Change match</button>
                  )}
                  {l.state === 'waiting_ok' && mayPrices && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button className={secondary} onClick={() => void act(() => rejectLine(l.id), 'Old price kept')}>Keep old price</button>
                      <button className={primary} onClick={() => void act(() => okLine(l.id), 'New price applied')}>OK, use new price</button>
                    </div>
                  )}
                </div>
              )
            })}
            {review && <AddLine inv={inv} onSaved={refresh} />}
          </div>

          <div className={`bg-white rounded-2xl border p-3 text-sm space-y-1 ${totalBad ? 'border-red-400' : 'border-gray-200'}`} data-totals>
            <Row k="Lines" v={money(active.reduce((s2, l) => s2 + (l.totalCents ?? 0), 0))} />
            <Row k="Subtotal" v={inv.subtotalCents == null ? 'not printed' : money(inv.subtotalCents)} />
            <Row k="Tax" v={inv.taxFound ? money(inv.taxCents) : 'none printed'} />
            <Row k="Freight / delivery" v={money(inv.freightCents)} />
            {inv.fees.map((f, i) => <Row key={i} k={isFuelFee(f.label) ? `${f.label} (bill only, not in item prices)` : f.label} v={money(f.cents)} />)}
            <Row k="Total" v={money(inv.totalCents)} bold />
            {inv.estTaxCents > 0 && <p className="text-xs text-amber-800 pt-1" data-est-tax-row>Estimated tax {inv.estTaxBp != null ? pctOfBp(inv.estTaxBp) : ''} added to item landed costs: {money(inv.estTaxCents)} (not on the document or the bill)</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {(inv.status === 'applied' || inv.status === 'needs_match') && mayPrices && (
              <button className={danger} data-undo onClick={() => {
                const orderedQuote = inv.docType === 'quote' && inv.ordered
                if (!confirm(orderedQuote
                  ? 'Undo this order? Every price it changed goes back (items changed since by something newer are left as they are), and its bill comes off Accounts Payable (voided, unless something was paid on it).'
                  : 'Put back every price this invoice changed? Items changed since by something newer are left as they are.')) return
                void act(async () => {
                  const r = await undoInvoice(inv.id)
                  const bill = r.bill?.outcome === 'voided' ? `Bill ${r.bill.billNumber} is off Accounts Payable (voided). If it was ordered after all, tap We ordered this here.`
                    : r.bill?.outcome === 'kept_paid' ? `Bill ${r.bill.billNumber} stays: ${money(r.bill.paidCents)} was already paid on it.` : ''
                  const skipped = r.skipped.length ? `${r.skipped.length} left as they are (changed since).` : ''
                  toast.success(`Undone: ${r.restored.length} price${r.restored.length === 1 ? '' : 's'} put back`, [skipped, bill].filter(Boolean).join(' ') || undefined)
                })
              }}>{inv.docType === 'quote' && inv.ordered ? 'Undo the order' : 'Undo prices'}</button>
            )}
            {(inv.status === 'failed' || inv.status === 'needs_review') && <button className={secondary} onClick={() => void act(() => rereadInvoice(inv.id), 'Reading again')}>Read again</button>}
            {['refused', 'failed', 'needs_review', 'undone', 'quote', 'replaced'].includes(inv.status) && (
              <button className={danger} data-remove onClick={() => {
                if (!confirm('Remove this invoice? Its bill in Vendors goes too (unless it has payments).')) return
                // It is gone: back to the list (which loads again), never a read of the removed document.
                void (async () => {
                  try { await removeInvoice(inv.id); toast.success('Removed'); onBack(); await onChanged() } catch (e) { toast.error('Not removed', errText(e)) }
                })()
              }}>Remove</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between gap-2 ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}><span className="min-w-0 break-words">{k}</span><span className="shrink-0">{v}</span></div>
}

function HeaderEditor({ inv, onSaved }: { inv: InvoiceDetail; onSaved: () => Promise<void> }) {
  const vendors = getVendors()
  const [vendorId, setVendorId] = useState(inv.vendorId ?? '')
  // A name printed in capitals is offered as "Gulf Coast Fence Supply" (it can be changed before adding).
  const [newVendor, setNewVendor] = useState(() => (inv.vendorName === inv.vendorName.toUpperCase() ? inv.vendorName.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : inv.vendorName))
  const [number, setNumber] = useState(inv.invoiceNumber)
  const [date, setDate] = useState(inv.invoiceDate)
  const [subtotal, setSubtotal] = useState(inv.subtotalCents == null ? '' : (inv.subtotalCents / 100).toFixed(2))
  const [tax, setTax] = useState((inv.taxCents / 100).toFixed(2))
  const [freight, setFreight] = useState((inv.freightCents / 100).toFixed(2))
  const [total, setTotal] = useState(inv.totalCents == null ? '' : (inv.totalCents / 100).toFixed(2))
  const [busy, setBusy] = useState(false)
  const needsVendor = inv.problems.some(p => p.kind === 'new_vendor' || p.kind === 'no_vendor')

  async function save(patch: Record<string, unknown>) {
    setBusy(true)
    try { await editHeader(inv.id, patch); await onSaved() } catch (e) { toast.error('Not saved', errText(e)) }
    setBusy(false)
  }
  function saveTotals() {
    const st = subtotal.trim() === '' ? null : toCents(subtotal), t = toCents(tax), f = toCents(freight), to = total.trim() === '' ? null : toCents(total)
    if ((subtotal.trim() !== '' && st == null) || t == null || f == null || (total.trim() !== '' && to == null)) { toast.error('Amounts must be like 12.34'); return }
    void save({ invoiceNumber: number.trim(), invoiceDate: date, subtotalCents: st, taxCents: t, freightCents: f, totalCents: to })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-3" data-header-editor>
      {needsVendor && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-2.5" data-vendor-pick>
          <p className="text-sm font-medium text-gray-900">Vendor</p>
          <select className={input} value={vendorId} onChange={e => setVendorId(e.target.value)} data-vendor-select>
            <option value="">Pick a vendor…</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button className={primary} disabled={busy || !vendorId} onClick={() => void save({ vendorId })}>Use this vendor</button>
          <div className="flex flex-col sm:flex-row gap-2">
            <input className={input} value={newVendor} onChange={e => setNewVendor(e.target.value)} aria-label="New vendor name" data-new-vendor-name />
            <button className={secondary} disabled={busy || newVendor.trim().length < 2} onClick={() => void save({ newVendorName: newVendor.trim() })} data-add-vendor>Add as a new vendor</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 min-w-0">Invoice #<input className={input} value={number} onChange={e => setNumber(e.target.value)} data-field="number" /></label>
        <label className="text-xs text-gray-500 min-w-0">Date<input type="date" className={input} value={date} onChange={e => setDate(e.target.value)} data-field="date" /></label>
        <label className="text-xs text-gray-500 min-w-0">Subtotal<input className={input} inputMode="decimal" value={subtotal} onChange={e => setSubtotal(e.target.value)} data-field="subtotal" /></label>
        <label className="text-xs text-gray-500 min-w-0">Tax<input className={input} inputMode="decimal" value={tax} onChange={e => setTax(e.target.value)} data-field="tax" /></label>
        <label className="text-xs text-gray-500 min-w-0">Freight<input className={input} inputMode="decimal" value={freight} onChange={e => setFreight(e.target.value)} data-field="freight" /></label>
        <label className="text-xs text-gray-500 min-w-0">Total<input className={input} inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} data-field="total" /></label>
      </div>
      <button className={`${primary} w-full sm:w-auto`} disabled={busy} onClick={saveTotals} data-save-header>Save and check again</button>
    </div>
  )
}

function LineEditor({ inv, line, onSaved }: { inv: InvoiceDetail; line: InvoiceLine; onSaved: () => Promise<void> }) {
  const [itemNumber, setItemNumber] = useState(line.itemNumber)
  const [description, setDescription] = useState(line.description)
  const [qty, setQty] = useState(line.qty == null ? '' : String(line.qty))
  const [unit, setUnit] = useState(line.unit)
  const [price, setPrice] = useState(line.unitPriceHc == null ? '' : (line.unitPriceHc / 10000).toFixed(4).replace(/0{1,2}$/, ''))
  const [amount, setAmount] = useState(line.totalCents == null ? '' : (line.totalCents / 100).toFixed(2))
  const [busy, setBusy] = useState(false)
  async function save(extra: Record<string, unknown> = {}) {
    const q = qty.trim() === '' ? null : Number(qty), p = price.trim() === '' ? null : toHc(price), a = amount.trim() === '' ? null : toCents(amount)
    if ((q != null && !(q > 0)) || (price.trim() !== '' && p == null) || (amount.trim() !== '' && a == null)) { toast.error('Check the numbers', 'Quantity above 0, price like 2.80, amount like 560.00'); return }
    setBusy(true)
    const patch = { itemNumber, description, qty: q, unit, unitPriceHc: p, totalCents: a, ...extra }
    try {
      if (line.id) await editLine(inv.id, line.id, patch)
      else await addLine(inv.id, patch)
      await onSaved()
    } catch (e) { toast.error('Not saved', errText(e)) }
    setBusy(false)
  }
  return (
    <div className="mt-2 space-y-2 border-t border-gray-200 pt-2" data-line-editor>
      {line.raw && <p className="text-[11px] text-gray-500 break-words">Read as: {line.raw}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 min-w-0">Item #<input className={input} value={itemNumber} onChange={e => setItemNumber(e.target.value)} /></label>
        <label className="text-xs text-gray-500 min-w-0">Unit<input className={input} value={unit} onChange={e => setUnit(e.target.value)} /></label>
        <label className="text-xs text-gray-500 col-span-2 min-w-0">Description<input className={input} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label className="text-xs text-gray-500 min-w-0">Quantity<input className={input} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} data-edit="qty" /></label>
        <label className="text-xs text-gray-500 min-w-0">Unit price<input className={input} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} data-edit="price" /></label>
        <label className="text-xs text-gray-500 col-span-2 min-w-0">Amount<input className={input} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} data-edit="amount" /></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button className={primary} disabled={busy} onClick={() => void save()} data-save-line>Save</button>
        <button className={secondary} disabled={busy} onClick={() => void save({ confirm: true })} data-confirm-line>Matches the paper</button>
        <button className={secondary} disabled={busy} onClick={() => void save({ ignored: !line.ignored })}>{line.ignored ? 'It is a line' : 'Not a line'}</button>
      </div>
    </div>
  )
}

function AddLine({ inv, onSaved }: { inv: InvoiceDetail; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!open) return <button className={`${secondary} w-full`} onClick={() => setOpen(true)}>Add a line that was missed</button>
  return (
    <div className="rounded-xl border border-gray-300 p-2.5">
      <LineEditor inv={inv} line={{ id: '', seq: 0, page: 1, row: 0, box: null, raw: '', itemNumber: '', description: '', qty: null, unit: 'EA', unitPriceHc: null, totalCents: null, conf: 1, problems: [], ignored: false, edited: true, inventoryItemId: null, inventoryName: '', vendorPer: null, invPer: null, invQty: null, extraCents: null, estTaxCents: 0, landedCents: null, unitLandedCents: null, prevUnitCents: null, changePct: null, state: 'open', stateNote: '' }}
        onSaved={async () => { setOpen(false); await onSaved() }} />
      <button className="text-xs underline text-gray-600 mt-2" disabled={busy} onClick={() => { setBusy(false); setOpen(false) }}>Cancel</button>
    </div>
  )
}
