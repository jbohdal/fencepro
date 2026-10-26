/**
 * Payments on a job (paymentsStore.ts; server lib/contractBilling.ts), the
 * same on the job page, the pipeline card window and the customer's Billing:
 *
 *   The schedule: contract total, each invoice (Deposit, Final ...) with what
 *   is due, paid and left, and a big "Payment received" on every open one,
 *   filled in with what is due. Phone first: amount, how (check and its
 *   number, cash, Zelle, card, other), the day (today), an optional photo of
 *   the check, Save. Under 30 seconds.
 *   The receipt, full screen, right after Save, with no signal too: big
 *   enough to hand the phone to the customer. Text (the phone's own texting
 *   app with the link), Email, or both, to the saved phone and email (both
 *   can be changed). The final payment says Paid in full with the warranty,
 *   and can carry a Final Release of Lien (DRAFT wording, for Jonathan's
 *   lawyer to check; off unless ticked).
 *   Payments, each with its receipt; owner and office confirm a Salesman's
 *   payment and void one (its receipt is void too); the owner changes an
 *   invoice amount or adjusts the contract amount. Every change is in History.
 */

import { jobStyleOrWork } from './jobWork'
import { getJob } from './jobStore'
import { customerText } from '../../portal/src/server/lib/customerText'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useBackLayer } from './nav'
import { can } from './permissions'
import { toast } from './toast'
import { canTextHere } from './textingDevice'
import { smsLink } from './appointmentLogic'
import { invoiceDue } from '../../portal/src/server/lib/jobReadiness'
import { businessDate } from './businessDate'
import { hasSignal } from './outbox'
import {
  METHODS, money, centsOf, todayOcala, loadJob, loadCustomer, makeSchedule, scheduleOf, subscribe, paymentsVersion,
  recordPayment, shownReceipt, emailReceipt, emailResultOf, noteTexted, waitingPayments, paymentWaiting, recorderName,
  confirmPayment, voidPayment, editInvoiceAmount, adjustContract, loadToConfirm, openStaffFile, receiptUrl,
  type Schedule, type InvoiceRow, type Method, type WithoutSchedule, type ToConfirm, type ReceiptSnapshot,
} from './paymentsStore'

const useVersion = () => useSyncExternalStore(subscribe, paymentsVersion, paymentsVersion)
const dueText = (i: InvoiceRow) => i.dueOn === 'completion' ? (i.dueDate ? `Due ${fmtDay(i.dueDate)} (installed)` : 'Due on completion') : i.dueDate ? `Due ${fmtDay(i.dueDate)}` : 'Due at signing'
function fmtDay(d: string): string { const t = new Date(`${d}T12:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
function wordsDay(d: string): string { const t = new Date(`${d}T12:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }

// ── The panel ───────────────────────────────────────────────────────────────

/** A job's payments (jobId), or every job of a customer (customerId). */
export default function PaymentsPanel({ jobId, customerId, compact }: { jobId?: string; customerId?: string; compact?: boolean }) {
  useVersion()
  const [jobs, setJobs] = useState<string[]>(jobId ? [jobId] : [])
  const [without, setWithout] = useState<WithoutSchedule[]>([])
  const [canMake, setCanMake] = useState(false)
  const [loaded, setLoaded] = useState<boolean | null>(null)
  const reload = useCallback(async () => {
    if (jobId) {
      const d = await loadJob(jobId)
      if (d === undefined) { setLoaded(l => l ?? false); return }
      setCanMake(d.canMake); setLoaded(true)
    } else if (customerId) {
      const d = await loadCustomer(customerId)
      if (d === undefined) { setLoaded(l => l ?? false); return }
      setJobs(d.schedules.map(s => s.jobId)); setWithout(d.without); setLoaded(true)
    }
  }, [jobId, customerId])
  useEffect(() => { void reload() }, [reload])

  const list = jobs.map(scheduleOf).filter((s): s is Schedule => !!s)
  if (loaded === null && !list.length) return <p className="text-xs text-gray-400" data-payments-loading>Loading payments…</p>
  if (loaded === false && !list.length) return <p className="text-xs text-gray-500">Payments need signal to load. They show again when the phone has signal.</p>
  const makeFor = jobId ? (canMake && !list.length ? [{ jobId, fenceStyle: '', address: '', contractCents: 0 }] : []) : without
  if (!list.length && !makeFor.length) return compact ? null : <p className="text-xs text-gray-500" data-payments-none>No signed contract yet, so no payment schedule.</p>
  return (
    <div className="space-y-4" data-payments-panel>
      {list.map(s => <ScheduleCard key={s.jobId} s={s} showJob={!jobId} compact={compact} />)}
      {makeFor.map(w => (
        <div key={w.jobId} className="rounded-xl border border-dashed border-gray-300 p-3 text-sm" data-payments-make={w.jobId}>
          <p className="text-gray-700">{w.fenceStyle ? `${w.fenceStyle}: ` : ''}signed before payment schedules. Make its schedule from the contract (deposit and final).</p>
          {can('payments.record') && (
            <button className="btn btn-primary mt-2 min-h-[44px]" data-payments-make-button onClick={async () => {
              const r = await makeSchedule(w.jobId)
              if (!r.ok) { toast.error('Could not make the schedule', r.error); return }
              setJobs(j => j.includes(w.jobId) ? j : [...j, w.jobId]); setWithout(x => x.filter(y => y.jobId !== w.jobId)); setCanMake(false)
            }}>Make the payment schedule</button>
          )}
        </div>
      ))}
    </div>
  )
}

function ScheduleCard({ s, showJob, compact }: { s: Schedule; showJob: boolean; compact?: boolean }) {
  const [paying, setPaying] = useState<InvoiceRow | null>(null)
  const [receiptFor, setReceiptFor] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState<InvoiceRow | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const waiting = waitingPayments(s.jobId)
  const waitingCents = waiting.reduce((t, w) => t + w.snapshot.amountCents, 0)
  const balance = s.balanceCents - waitingCents
  // Payments waiting on this phone are counted on the invoices they go to, oldest first.
  let carry = waitingCents
  const invoices = s.invoices.map(i => { const take = Math.min(Math.max(0, i.balanceCents), carry); carry -= take; return { ...i, shownBalance: i.balanceCents - take } })
  const recorder = can('payments.record')
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3" data-payment-schedule={s.jobId}>
      <div className="flex items-start justify-between gap-2">
        <div>
          {/* A repair or a move: its work ("Repair: 1 × Rehang a gate…"), not the fence style. */}
          {showJob && <p className="text-xs text-gray-500" data-payment-schedule-work>{jobStyleOrWork({ fenceStyle: s.fenceStyle, quoteId: getJob(s.jobId)?.quoteId })}{s.address ? ` · ${s.address}` : ''}</p>}
          <p className="text-sm text-gray-700">Contract <b data-contract-total>{money(s.contractCents)}</b>{s.changeOrderCents || s.adjustmentCents ? <span className="text-xs text-gray-500"> (signed {money(s.signedCents)}{s.changeOrderCents ? `, change orders ${money(s.changeOrderCents)}` : ''}{s.adjustmentCents ? `, adjustments ${money(s.adjustmentCents)}` : ''})</span> : null}</p>
          <p className="text-sm text-gray-700">Paid <b className="text-green-700" data-paid-total>{money(s.paidCents + waitingCents)}</b> · {balance < 0 ? <>Credit <b className="text-blue-700" data-balance>{money(-balance)}</b></> : <>Balance <b className={balance > 0 ? 'text-orange-700' : 'text-green-700'} data-balance>{money(balance)}</b></>}</p>
        </div>
        {balance <= 0 && s.invoices.some(i => i.kind === 'final') && <span className="rounded-full bg-green-100 text-green-800 text-xs font-semibold px-2 py-1" data-paid-in-full>Paid in full</span>}
      </div>

      <div className="divide-y divide-gray-100 border-y border-gray-100">
        {invoices.map(i => (
          <div key={i.id} className="py-2 space-y-2" data-invoice={i.kind} data-invoice-id={i.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{i.label}{i.legacyNumber ? <span className="text-xs text-gray-500 font-normal"> ({i.legacyNumber}, typed in Billing)</span> : null}</p>
                <p className="text-xs text-gray-500">{dueText(i)}</p>
                {(() => { const d = invoiceDue({ balanceCents: i.shownBalance, dueOn: i.dueOn, dueDate: i.dueDate }, s.completedDate, businessDate(new Date())); return d.state === 'overdue' ? <p className="text-xs font-semibold text-red-700" data-invoice-overdue={d.daysOver}>Overdue {d.daysOver} day{d.daysOver === 1 ? '' : 's'}</p> : null })()}
                {i.amountCents !== i.originalCents && <p className="text-xs text-gray-500">Was {money(i.originalCents)}; see History.</p>}
              </div>
              <div className="text-right text-sm shrink-0">
                <p className="font-semibold" data-invoice-amount>{money(i.amountCents)}</p>
                <p className="text-xs text-gray-500">Paid {money(i.amountCents - i.shownBalance)}</p>
                <p className={`text-xs font-semibold ${i.shownBalance > 0 ? 'text-orange-700' : 'text-green-700'}`} data-invoice-balance={i.shownBalance}>{i.shownBalance > 0 ? `Left ${money(i.shownBalance)}` : 'Paid'}</p>
              </div>
            </div>
            {recorder && i.shownBalance > 0 && (
              <button className="w-full min-h-[56px] rounded-xl bg-green-600 hover:bg-green-700 text-white text-lg font-bold" data-payment-received={i.kind} onClick={() => setPaying({ ...i, balanceCents: i.shownBalance })}>
                Payment received · {money(i.shownBalance)}
              </button>
            )}
            {can('billing.amounts') && i.kind !== 'final' && <button className="text-xs text-gray-500 underline min-h-[32px]" onClick={() => setEditing(i)} data-edit-amount>Change amount</button>}
          </div>
        ))}
      </div>
      {!compact || s.payments.length || waiting.length ? (
        <div className="space-y-2" data-payments-list>
          <p className="text-xs font-semibold text-gray-400">Payments</p>
          {!s.payments.length && !waiting.length && <p className="text-xs text-gray-500">None yet.</p>}
          {waiting.map(w => (
            <div key={w.paymentId} className="flex items-center justify-between text-sm rounded-lg bg-amber-50 px-2 py-2" data-payment-waiting={w.paymentId}>
              <span>{money(w.snapshot.amountCents)} · {w.snapshot.methodText} · {fmtDay(w.snapshot.paidOn)}<br /><span className="text-xs text-amber-800">Saved on this phone; goes to the office when there is signal</span></span>
              <button className="text-sm font-semibold text-violet-700 min-h-[44px] px-2" onClick={() => setReceiptFor(w.paymentId)}>Receipt</button>
            </div>
          ))}
          {s.payments.map(p => <PaymentLine key={p.id} p={p} onReceipt={() => setReceiptFor(p.id)} />)}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs">
        <button className="text-gray-500 underline min-h-[32px]" onClick={() => setShowHistory(v => !v)} data-billing-history-toggle>{showHistory ? 'Hide history' : 'History'}</button>
        {can('billing.amounts') && <button className="text-gray-500 underline min-h-[32px]" onClick={() => setAdjusting(true)} data-adjust-contract>Adjust contract amount</button>}
      </div>
      {showHistory && (
        <ul className="text-xs text-gray-600 space-y-1" data-billing-history>
          {s.adjustments.map(a => <li key={a.id}>Adjustment {money(a.amountCents)}: {a.reason} ({a.byName}, {new Date(a.at).toLocaleString()})</li>)}
          {s.log.map(l => <li key={l.id}>{new Date(l.at).toLocaleString()}: {l.text}{l.byName ? ` (${l.byName})` : ''}</li>)}
        </ul>
      )}

      {paying && <PaymentSheet s={s} invoice={paying} onClose={() => setPaying(null)} onSaved={id => { setPaying(null); setReceiptFor(id) }} />}
      {receiptFor && <ReceiptScreen paymentId={receiptFor} jobId={s.jobId} onClose={() => setReceiptFor(null)} />}
      {editing && <AmountSheet title={`Change the ${editing.label} amount`} start={editing.amountCents} allowNegative={false} note="The Final follows: it is what is left of the contract." onClose={() => setEditing(null)} onSave={async (c, why) => { const r = await editInvoiceAmount(editing.id, c, why); if (!r.ok) toast.error('Not changed', r.error); else setEditing(null) }} />}
      {adjusting && <AmountSheet title="Adjust the contract amount" start={0} allowNegative note={`The signed ${money(s.signedCents)} stays as signed; this line changes the contract total and the Final. A minus for less (-0.27 takes 27 cents off).`} onClose={() => setAdjusting(false)} onSave={async (c, why) => { const r = await adjustContract(s.jobId, c, why); if (!r.ok) toast.error('Not changed', r.error); else setAdjusting(false) }} />}
    </div>
  )
}

function PaymentLine({ p, onReceipt }: { p: Schedule['payments'][number]; onReceipt: () => void }) {
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const office = can('billing.change')
  return (
    <div className={`rounded-lg px-2 py-2 text-sm ${p.voidedAt ? 'bg-gray-50 text-gray-400' : 'bg-gray-50'}`} data-payment={p.id}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={p.voidedAt ? 'line-through' : 'font-semibold text-gray-900'}>{money(p.amountCents)} · {p.methodText}</p>
          <p className="text-xs text-gray-500">{fmtDay(p.paidOn)} · {p.recordedBy}{p.receipt ? ` · Receipt ${p.receipt.number}` : ''}{p.source === 'adopted' ? ' · typed in Billing' : ''}</p>
          {p.voidedAt && <p className="text-xs text-red-700" data-payment-void>Void: {p.voidReason} ({p.voidedBy})</p>}
          {!p.voidedAt && p.needsConfirm && !p.confirmedAt && <p className="text-xs font-semibold text-amber-700" data-payment-unconfirmed>Recorded by a Salesman: to confirm</p>}
          {p.confirmedAt && p.needsConfirm && <p className="text-xs text-gray-500">Confirmed by {p.confirmedBy}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {p.receipt && <button className="text-sm font-semibold text-violet-700 min-h-[40px] px-2" onClick={onReceipt} data-open-receipt>Receipt</button>}
          {p.hasPhoto && <button className="text-xs text-gray-500 underline" onClick={async () => { if (!(await openStaffFile(`/api/payments/${encodeURIComponent(p.id)}/photo`))) toast.error('Could not open the photo') }}>Check photo</button>}
        </div>
      </div>
      {office && !p.voidedAt && (
        <div className="flex gap-3 mt-1">
          {p.needsConfirm && !p.confirmedAt && <button className="text-xs font-semibold text-green-700 min-h-[36px]" data-confirm-payment onClick={async () => { const r = await confirmPayment(p.id); if (!r.ok) toast.error('Not confirmed', r.error) }}>Confirm</button>}
          <button className="text-xs text-red-700 min-h-[36px]" data-void-payment onClick={() => setVoiding(v => !v)}>Void</button>
        </div>
      )}
      {voiding && (
        <div className="mt-2 space-y-2">
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Why it is voided (bounced, typed wrong ...)" value={reason} onChange={e => setReason(e.target.value)} data-void-reason />
          <button className="btn min-h-[44px] bg-red-600 text-white" disabled={!reason.trim()} data-void-confirm onClick={async () => {
            const r = await voidPayment(p.id, reason.trim())
            if (!r.ok) { toast.error('Not voided', r.error); return }
            setVoiding(false); toast.success('Payment voided', p.receipt ? `Receipt ${p.receipt.number} is void too.` : undefined)
          }}>Void this payment{p.receipt ? ` and Receipt ${p.receipt.number}` : ''}</button>
        </div>
      )}
    </div>
  )
}

// ── Payment received ────────────────────────────────────────────────────────

/** A photo, made smaller on the phone (longest side 1600 px, JPEG): a data URL. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const k = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.72)
  } finally { URL.revokeObjectURL(url) }
}

function PaymentSheet({ s, invoice, onClose, onSaved }: { s: Schedule; invoice: InvoiceRow; onClose: () => void; onSaved: (paymentId: string) => void }) {
  useBackLayer(onClose, { key: 'payment-received' })
  const [amount, setAmount] = useState((Math.max(0, invoice.balanceCents) / 100).toFixed(2))
  const [method, setMethod] = useState<Method>('check')
  const [checkNumber, setCheckNumber] = useState('')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(todayOcala())
  const [photo, setPhoto] = useState<string | null>(null)
  const [lien, setLien] = useState(false)
  const [busy, setBusy] = useState(false)
  const cents = centsOf(amount)
  const waiting = waitingPayments(s.jobId).reduce((t, w) => t + w.snapshot.amountCents, 0)
  const paysInFull = cents !== null && s.contractCents - s.paidCents - waiting - cents <= 0
  async function save() {
    if (busy || cents === null || cents <= 0) return
    setBusy(true)
    try {
      const r = await recordPayment({ jobId: s.jobId, amountCents: cents, method, checkNumber: method === 'check' ? checkNumber.trim() : undefined, reference: reference.trim() || undefined, paidOn, photo, lienRelease: paysInFull && lien }, recorderName())
      onSaved(r.paymentId)
    } catch (e) {
      setBusy(false)
      toast.error('Payment not saved', (e as Error).message)
    }
  }
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl max-h-[95vh] overflow-y-auto p-4 space-y-4" onClick={e => e.stopPropagation()} data-payment-sheet>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Payment received</h2>
            <p className="text-xs text-gray-500">{s.customerName} · {invoice.label} left {money(Math.max(0, invoice.balanceCents))}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] text-2xl text-gray-400">×</button>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Amount</span>
          <div className="flex items-center gap-1 mt-1 border-2 border-gray-300 rounded-xl px-3 focus-within:border-green-600">
            <span className="text-2xl text-gray-500">$</span>
            <input inputMode="decimal" className="w-full py-3 text-3xl font-bold outline-none" value={amount} onChange={e => setAmount(e.target.value)} data-payment-amount />
          </div>
          {cents === null && <span className="text-xs text-red-600">Type the amount like 4457.00</span>}
        </label>
        <div>
          <span className="text-xs font-semibold text-gray-600">Paid by</span>
          <div className="grid grid-cols-5 gap-1 mt-1">
            {METHODS.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)} data-payment-method={m.id}
                className={`min-h-[48px] rounded-lg text-sm font-semibold ${method === m.id ? 'bg-violet-700 text-white' : 'bg-gray-100 text-gray-700'}`}>{m.label}</button>
            ))}
          </div>
        </div>
        {method === 'check' && (
          <label className="block"><span className="text-xs font-semibold text-gray-600">Check number</span>
            <input inputMode="numeric" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-3 text-lg" value={checkNumber} onChange={e => setCheckNumber(e.target.value)} data-payment-check-number />
          </label>
        )}
        <label className="block"><span className="text-xs font-semibold text-gray-600">{method === 'check' ? 'Note (cashier\'s check, bank ...)' : 'Reference (optional)'}</span>
          <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" value={reference} onChange={e => setReference(e.target.value)} data-payment-reference />
        </label>
        <div className="flex gap-3">
          <label className="flex-1"><span className="text-xs font-semibold text-gray-600">Date</span>
            <input type="date" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" value={paidOn} onChange={e => setPaidOn(e.target.value || todayOcala())} data-payment-date />
          </label>
          <label className="flex-1"><span className="text-xs font-semibold text-gray-600">Photo of the check</span>
            <input type="file" accept="image/*" capture="environment" className="mt-1 w-full text-xs" data-payment-photo onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await shrinkPhoto(f).catch(() => null)) }} />
            {photo && <span className="text-xs text-green-700">Photo added</span>}
          </label>
        </div>
        {paysInFull && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm" data-lien-release>
            <input type="checkbox" className="mt-1 w-5 h-5" checked={lien} onChange={e => setLien(e.target.checked)} data-lien-release-tick />
            <span>Add a Final Release of Lien to the receipt. <b>DRAFT wording</b>: have your lawyer check it before relying on it.</span>
          </label>
        )}
        <button className="w-full min-h-[60px] rounded-xl bg-green-600 hover:bg-green-700 text-white text-xl font-bold disabled:opacity-40" disabled={busy || cents === null || cents <= 0} onClick={save} data-payment-save>
          Save {cents ? money(cents) : ''} and show receipt
        </button>
      </div>
    </div>
  )
}

// ── The receipt ─────────────────────────────────────────────────────────────

export function ReceiptScreen({ paymentId, jobId, onClose }: { paymentId: string; jobId: string; onClose: () => void }) {
  useBackLayer(onClose, { key: 'receipt' })
  useVersion()
  const s = scheduleOf(jobId)
  const fromServer = s?.payments.find(p => p.id === paymentId)?.receipt ?? null
  const local = shownReceipt(paymentId)
  const snap: ReceiptSnapshot | null = fromServer?.says ?? local?.snapshot ?? null
  const number = fromServer?.number ?? snap?.number ?? null
  const token = fromServer?.token ?? local?.token ?? ''
  const link = token ? receiptUrl(token) : ''
  const waiting = paymentWaiting(paymentId)
  const voided = !!fromServer?.voided
  const [phone, setPhone] = useState(snap?.phone || s?.phone || '')
  const [email, setEmail] = useState(snap?.email || s?.email || '')
  const emailed = emailResultOf(paymentId)
  // On a computer: the number "Did you send it?" is asked about (nothing is recorded until Yes).
  const [ask, setAsk] = useState<string | null>(null)
  if (!snap) return null
  // "Company: ... Reply STOP to opt out." (lib/customerText.ts).
  const body = customerText(`Receipt for your ${money(snap.amountCents)} payment (${snap.forText.toLowerCase()}). Thank you! ${link}`, snap.company.name)
  return (
    <div className="fixed inset-0 z-[95] bg-white overflow-y-auto" data-receipt-screen>
      <div className="max-w-lg mx-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold text-violet-800">{snap.company.name}</p>
          <button onClick={onClose} className="btn min-h-[48px]" data-receipt-done>Done</button>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm text-gray-500 uppercase tracking-wide">Payment receipt</p>
          <p className="text-xl font-semibold text-gray-800" data-receipt-number={number ?? ''}>{number ? `Receipt ${number}` : hasSignal() ? 'Getting the receipt number…' : 'Receipt number comes when the phone has signal'}</p>
          {voided && <p className="text-2xl font-bold text-red-700" data-receipt-void>VOID</p>}
          <p className={`text-5xl font-extrabold ${voided ? 'text-gray-400 line-through' : 'text-green-700'}`} data-receipt-amount={snap.amountCents}>{money(snap.amountCents)}</p>
          <p className="text-lg text-gray-800" data-receipt-method>{snap.methodText}</p>
          <p className="text-base text-gray-600">{wordsDay(snap.paidOn)} · for <span data-receipt-for>{snap.forText}</span></p>
        </div>
        <div className="rounded-xl bg-gray-50 p-4 text-base space-y-1">
          <p className="font-semibold text-gray-900">{snap.customerName}</p>
          <p className="text-gray-600">{snap.address}</p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4 text-base space-y-1">
          <Row k="Contract total" v={money(snap.contractCents)} attr="data-receipt-contract" />
          <Row k="Paid to date" v={money(snap.paidToDateCents)} attr="data-receipt-paid" />
          <Row k={snap.balanceCents < 0 ? 'Credit (over the total)' : 'Balance remaining'} v={money(Math.abs(snap.balanceCents))} attr="data-receipt-balance" bold />
        </div>
        {snap.paidInFull && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center" data-receipt-paid-in-full>
            <p className="text-2xl font-bold text-green-800">Paid in full</p>
            <p className="text-base text-gray-800" data-receipt-warranty>Warranty: {snap.warrantyName || 'as written on your contract'}</p>
            <p className="text-sm text-gray-600">{s?.completedDate ? `It starts on the install date: ${wordsDay(s.completedDate)}.` : 'It starts on the install date.'}</p>
            {snap.lienRelease && <p className="text-xs text-amber-800 mt-2" data-receipt-lien>Final Release of Lien is on the PDF (DRAFT wording, for your lawyer to check).</p>}
          </div>
        )}
        <p className={`text-sm text-center ${waiting ? 'text-amber-700' : 'text-green-700'}`} data-receipt-status={waiting ? 'waiting' : 'saved'}>
          {waiting ? 'Saved on this phone. It goes to the office, and the link starts working, as soon as there is signal.' : `Saved. Received by ${snap.recordedBy || 'us'}.`}
        </p>

        {!voided && (
          <div className="rounded-xl border border-gray-200 p-4 space-y-3" data-receipt-send>
            <p className="text-sm font-semibold text-gray-700">Send the receipt</p>
            <label className="block"><span className="text-xs text-gray-500">Phone</span>
              <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} data-receipt-phone />
            </label>
            {/* A phone hands the text to its Messages app: that is recorded as texted. A computer asks "Did you send it?" first. */}
            <a href={phone && link ? smsLink(phone, body) : undefined} onClick={() => { if (!phone) return; if (canTextHere()) { noteTexted(paymentId, phone); setAsk(null) } else setAsk(phone) }}
              className={`block text-center min-h-[52px] leading-[52px] rounded-xl font-bold text-white ${phone ? 'bg-violet-700' : 'bg-gray-300 pointer-events-none'}`} data-receipt-text>Text the receipt</a>
            {ask && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2" data-receipt-text-ask>
                <p className="text-sm text-gray-800">This computer may not send texts. Send this from your phone if it did not open:</p>
                <p className="text-xs text-gray-700 bg-white rounded border border-gray-200 p-2 break-words select-all" data-receipt-text-body>{body}</p>
                <button type="button" className="text-sm text-violet-700 underline min-h-[36px]" onClick={() => { navigator.clipboard?.writeText(body).then(() => toast.success('Copied'), () => toast.error('Could not copy', 'Select the words and copy them.')) }} data-receipt-text-copy>Copy the text</button>
                <p className="text-sm font-semibold text-gray-900">Did you send it to {ask}?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="min-h-[48px] rounded-xl font-bold bg-violet-700 text-white" onClick={() => { noteTexted(paymentId, ask); setAsk(null); toast.success('Saved as texted') }} data-receipt-text-sent>Yes, I sent it</button>
                  <button type="button" className="min-h-[48px] rounded-xl font-bold border-2 border-gray-300 text-gray-700" onClick={() => setAsk(null)} data-receipt-text-not-sent>No</button>
                </div>
              </div>
            )}
            <label className="block"><span className="text-xs text-gray-500">Email</span>
              <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} data-receipt-email />
            </label>
            <button className="w-full min-h-[52px] rounded-xl font-bold border-2 border-violet-700 text-violet-800 disabled:opacity-40" disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !link}
              data-receipt-email-send onClick={async () => { await emailReceipt(paymentId, email.trim(), link); toast.success(waiting ? 'Email waiting for signal' : 'Sending the email', waiting ? 'It goes as soon as the payment is saved.' : undefined) }}>Email the receipt</button>
            {emailed && <p className="text-xs text-center text-gray-600" data-receipt-email-status={emailed.status}>{emailed.status === 'waiting' ? `Email to ${emailed.to} goes when there is signal.` : emailed.status === 'sent' ? `Emailed to ${emailed.to}.` : emailed.status === 'not_configured' ? 'Email is not set up on this server; nothing was sent. Text the link instead.' : `Email to ${emailed.to} did not go: ${emailed.error ?? 'try again'}.`}</p>}
            {fromServer && (
              <div className="flex justify-center gap-4 text-sm">
                <a href={link} target="_blank" rel="noreferrer" className="text-violet-700 underline" data-receipt-link>Open the link</a>
                <button className="text-violet-700 underline" onClick={async () => { if (!(await openStaffFile(`/api/payments/receipts/${encodeURIComponent(fromServer.id)}/pdf`))) toast.error('Could not open the PDF') }} data-receipt-pdf>PDF</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v, bold, attr }: { k: string; v: string; bold?: boolean; attr: string }) {
  return <div className="flex justify-between"><span className={bold ? 'font-bold' : 'text-gray-600'}>{k}</span><span className={bold ? 'font-bold' : ''} {...{ [attr]: v }}>{v}</span></div>
}

// ── Owner: amounts ──────────────────────────────────────────────────────────

function AmountSheet({ title, start, allowNegative, note, onClose, onSave }: { title: string; start: number; allowNegative: boolean; note: string; onClose: () => void; onSave: (cents: number, why: string) => Promise<void> }) {
  useBackLayer(onClose, { key: 'billing-amount' })
  const [typed, setTyped] = useState(start ? (start / 100).toFixed(2) : '')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const neg = allowNegative && typed.trim().startsWith('-')
  const abs = centsOf(typed.trim().replace(/^-/, ''))
  const cents = abs === null ? null : neg ? -abs : abs
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()} data-amount-sheet>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-xs text-gray-500">{note}</p>
        <input className="w-full border-2 border-gray-300 rounded-xl px-3 py-3 text-2xl font-bold" inputMode="decimal" value={typed} onChange={e => setTyped(e.target.value)} placeholder={allowNegative ? '-0.27' : '0.00'} data-amount-input />
        <input className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Why (kept in History)" value={why} onChange={e => setWhy(e.target.value)} data-amount-reason />
        <div className="flex gap-2 justify-end">
          <button className="btn min-h-[44px]" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary min-h-[44px]" disabled={busy || cents === null || (allowNegative && cents === 0) || !why.trim()} data-amount-save
            onClick={async () => { setBusy(true); await onSave(cents!, why.trim()); setBusy(false) }}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Payments to confirm (owner and office) ──────────────────────────────────

export function PaymentsToConfirm() {
  const [rows, setRows] = useState<ToConfirm[] | null>(null)
  const reload = useCallback(() => { void loadToConfirm().then(setRows) }, [])
  useEffect(() => { if (can('billing.change')) reload() }, [reload])
  if (!can('billing.change') || !rows || !rows.length) return null
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2" data-payments-to-confirm>
      <h3 className="text-sm font-bold text-amber-900">Payments to confirm ({rows.length})</h3>
      <p className="text-xs text-amber-800">Recorded by a Salesman in the field. The customer already has the receipt; confirming does not change it.</p>
      {rows.map(p => (
        <div key={p.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-2 text-sm" data-to-confirm={p.id}>
          <div className="min-w-0">
            <p className="font-semibold">{p.customerName}: {money(p.amountCents)} · {p.method === 'check' && p.checkNumber ? `Check #${p.checkNumber}` : p.method}</p>
            <p className="text-xs text-gray-500">{fmtDay(p.paidOn)} · {p.recordedBy}{p.receipt ? ` · Receipt ${p.receipt.number}` : ''}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            {p.hasPhoto && <button className="text-xs underline" onClick={() => void openStaffFile(`/api/payments/${encodeURIComponent(p.id)}/photo`)}>Photo</button>}
            <button className="btn btn-primary min-h-[40px]" data-to-confirm-button onClick={async () => { const r = await confirmPayment(p.id); if (!r.ok) toast.error('Not confirmed', r.error); else reload() }}>Confirm</button>
          </div>
        </div>
      ))}
    </div>
  )
}
