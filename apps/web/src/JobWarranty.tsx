/**
 * The job page's warranty (server routes/warranties.ts): which warranty the
 * job was signed with, the day it starts (the install date) and how long it
 * covers, the words, and the signed contract PDF. Below it, the service and
 * warranty calls on this job, each "Covered by warranty" or "Not covered"
 * from the warranty's dates; staff can set one the other way with a reason.
 * "Book a service call" makes a Service appointment on this job.
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchWithAuth } from './crmAuth'
import { API_ORIGIN, sendJson } from './syncHttp'
import { createAppointment } from './appointmentsStore'
import { dayText } from './warranties'
import { toast } from './toast'
import type { Job } from './jobStore'

interface Coverage { covered: boolean | null; label: string; why: string; overridden: boolean }
interface ServiceCall { id: string; type: string; status: string; day: string; notes: string; coverage: Coverage; override: { covered: boolean; reason: string; by: string; at: string } | null }
interface JobWarrantyView {
  jobId: string; quoteId: string | null
  warranty: { id: string | null; name: string; text: string; term: 'lifetime' | 'years' | 'unknown'; years?: number } | null
  from: 'option' | 'proposal' | 'settings' | null
  signed: boolean; start: string | null; end: string | null; endText: string; contract: boolean
  serviceCalls: ServiceCall[]
}

const FROM: Record<string, string> = {
  option: 'As signed on the accepted proposal option.',
  proposal: 'As written on the signed proposal (one warranty for every option, before Oct 20, 2026).',
  settings: 'No signed proposal on file: today\'s Settings → Warranties for this fence style.',
}

async function load(jobId: string): Promise<JobWarrantyView | null> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/warranties/job/${encodeURIComponent(jobId)}`).catch(() => null)
  if (!r?.ok) return null
  return (await r.json())?.data ?? null
}

export default function JobWarranty({ job }: { job: Job }) {
  const [w, setW] = useState<JobWarrantyView | null | undefined>(undefined)
  const [showText, setShowText] = useState(false)
  const [booking, setBooking] = useState(false)
  const [day, setDay] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [notes, setNotes] = useState('')
  const [deciding, setDeciding] = useState<{ id: string; covered: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const reload = useCallback(() => { load(job.id).then(setW) }, [job.id])
  useEffect(() => { reload() }, [reload])

  async function openContract() {
    if (!w?.quoteId) return
    const tab = window.open('', '_blank')
    const r = await fetchWithAuth(`${API_ORIGIN}/api/warranties/quote/${encodeURIComponent(w.quoteId)}/contract.pdf`).catch(() => null)
    if (!r?.ok) { tab?.close(); toast.error('Could not open the contract', 'Check the connection and try again.'); return }
    const u = URL.createObjectURL(await r.blob())
    if (tab) tab.location.href = u; else window.location.href = u
  }

  async function book() {
    if (!job.customerId) { toast.error('This job has no customer', 'Link the job to a customer first.'); return }
    const start = new Date(`${day}T09:00:00`)
    const a = await createAppointment({ crmContactId: job.customerId, type: 'service', startAt: start.toISOString(), endAt: new Date(start.getTime() + 90 * 60_000).toISOString(), jobId: job.id, quoteId: job.quoteId ?? null, address: job.customerAddress, notes: notes.trim() })
    if (!a) return
    setBooking(false); setNotes('')
    toast.success('Service call booked', a.pending ? 'Saved on this phone; it goes to the server when there is signal.' : dayText(day))
    // The server works out the coverage once it has the booking.
    setTimeout(reload, a.pending ? 3000 : 300)
  }

  async function decide(id: string, covered: boolean | null, why: string) {
    const r = await sendJson('POST', `/api/warranties/service/${encodeURIComponent(id)}/override`, { covered, reason: why })
    if (!r.result.ok) { toast.error('Not saved', r.result.error || 'Check the connection and try again.'); return }
    setDeciding(null); setReason('')
    setW(r.result.data as JobWarrantyView)
  }

  if (w === undefined) return <Box><p className="text-xs text-gray-500">Loading the warranty…</p></Box>
  if (w === null) return <Box><p className="text-xs text-red-700">Could not load the warranty. Check the connection.</p></Box>
  const wr = w.warranty
  return (
    <Box>
      <div data-job-warranty={wr?.id ?? (wr ? 'text' : 'none')}>
        {wr ? (
          <>
            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200" data-job-warranty-name>{wr.name}</span>
            <div className="mt-2 space-y-1 text-sm">
              <Row label="Starts" value={w.start ? dayText(w.start) : 'On the install date (not installed yet)'} attr="start" />
              <Row label="Ends" value={w.endText} attr="end" />
            </div>
            <p className="text-xs text-gray-500 mt-1">{w.from ? FROM[w.from] : ''}</p>
            <button type="button" className="text-sm text-purple-700 underline min-h-[48px]" onClick={() => setShowText(s => !s)} data-job-warranty-toggle>{showText ? 'Hide the words' : 'Show the words'}</button>
            {showText && <p className="text-sm text-gray-700 whitespace-pre-line border-l-2 border-purple-200 pl-3" data-job-warranty-text>{wr.text}</p>}
          </>
        ) : <p className="text-sm text-gray-600">No warranty on file for this job.</p>}
        {w.contract && <div><button type="button" className="btn btn-secondary min-h-[48px] mt-1" onClick={openContract} data-job-contract-pdf>Signed contract (PDF)</button></div>}
      </div>

      <div className="border-t border-gray-100 pt-3 mt-3 space-y-2" data-service-calls>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-sm font-semibold text-gray-900">Service calls</h4>
          {!booking && <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => setBooking(true)} data-book-service>Book a service call</button>}
        </div>
        {booking && (
          <div className="rounded-lg border border-gray-200 p-2 space-y-2" data-book-service-form>
            <label className="block text-xs text-gray-600">Day
              <input type="date" className="block w-full border border-gray-300 rounded-lg px-2 h-11 text-sm mt-1" value={day} onChange={e => setDay(e.target.value)} data-service-day />
            </label>
            <label className="block text-xs text-gray-600">What is wrong
              <input className="block w-full border border-gray-300 rounded-lg px-2 h-11 text-sm mt-1" value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} data-service-notes />
            </label>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary min-h-[48px] flex-1" onClick={book} disabled={!day} data-service-save>Book</button>
              <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => setBooking(false)}>Cancel</button>
            </div>
          </div>
        )}
        {w.serviceCalls.length === 0 && !booking && <p className="text-xs text-gray-500">None on this job. Service and Warranty appointments booked on this job show here.</p>}
        {w.serviceCalls.map(c => (
          <div key={c.id} className="rounded-lg border border-gray-200 p-2" data-service-call={c.id}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm text-gray-800">{dayText(c.day)} · {c.type === 'warranty' ? 'Warranty call' : 'Service call'}{c.status !== 'scheduled' ? ` · ${c.status.replace(/_/g, ' ')}` : ''}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.coverage.covered === true ? 'bg-green-100 text-green-800' : c.coverage.covered === false ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`} data-coverage={c.coverage.covered === true ? 'covered' : c.coverage.covered === false ? 'not-covered' : 'unknown'}>{c.coverage.label}</span>
            </div>
            {c.notes && <p className="text-xs text-gray-600 mt-1">{c.notes}</p>}
            <p className="text-xs text-gray-500 mt-1">{c.coverage.why}</p>
            {deciding?.id === c.id ? (
              <div className="mt-2 space-y-2">
                <label className="block text-xs text-gray-600">Why is it {deciding.covered ? 'covered' : 'not covered'}?
                  <input className="block w-full border border-gray-300 rounded-lg px-2 h-11 text-sm mt-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} data-override-reason />
                </label>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary min-h-[48px] flex-1" disabled={!reason.trim()} onClick={() => decide(c.id, deciding.covered, reason.trim())} data-override-save>Save</button>
                  <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => { setDeciding(null); setReason('') }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-x-3">
                {c.coverage.covered !== true && <button type="button" className="text-xs text-purple-700 underline min-h-[48px]" onClick={() => setDeciding({ id: c.id, covered: true })} data-override-covered>Mark covered</button>}
                {c.coverage.covered !== false && <button type="button" className="text-xs text-purple-700 underline min-h-[48px]" onClick={() => setDeciding({ id: c.id, covered: false })} data-override-not-covered>Mark not covered</button>}
                {c.override && <button type="button" className="text-xs text-gray-600 underline min-h-[48px]" onClick={() => decide(c.id, null, '')} data-override-clear>Go by the warranty dates</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Box>
  )
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3" data-job-warranty-box>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Warranty</h3>
      {children}
    </div>
  )
}

function Row({ label, value, attr }: { label: string; value: string; attr: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right" data-job-warranty-row={attr}>{value}</span>
    </div>
  )
}
