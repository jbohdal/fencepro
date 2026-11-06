/**
 * The job's lien clock, in the job window (Jonathan, Nov 6 2026; the owner only, liens.manage). Day 0 is the final
 * furnishing date; the Claim of Lien must be recorded by day 90. One tap papers (a payment reminder, a notice of
 * intent, the Claim of Lien, the Contractor's Final Payment Affidavit, the Release of Lien), each kept here with its
 * day and how it was sent; the Claim of Lien's checklist (notarized, recorded, served within 15 days) and the time to
 * sue. Every paper is locked "Attorney review required" until the owner marks it reviewed (Subcontractors → Settings).
 * Server: routes/liens.ts, lib/liens.ts.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { toast } from './toast'
import { can } from './permissions'
import { fetchWithAuth } from './crmAuth'
import { lienOf, saveLien, makeLienPaper, lienPaperUrl, money, usDate, LIEN_KIND_LABEL, type LienView, type LienKind, type LienCaseView } from './subsApi'

const HOW = ['Certified mail', 'Mail', 'Email', 'Handed to them', 'Recorded with the clerk', 'Printed']
const todayFl = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const daysTo = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayFl()}T00:00:00Z`)) / 86_400_000)

export default function JobLienPanel({ jobId, wrap = c => c }: { jobId: string; wrap?: (children: ReactNode) => ReactNode }) {
  const [v, setV] = useState<LienView | null>(null)
  const [f, setF] = useState<Partial<LienCaseView>>({})
  const [how, setHow] = useState('Certified mail')
  const [busy, setBusy] = useState('')
  const [ffd, setFfd] = useState('')
  const load = () => { void lienOf(jobId).then(r => { if (r.ok) { setV(r.data); setF(r.data.case) } }) }
  useEffect(load, [jobId])
  // Shown while money is owed after the work, or once a lien paper was made (nothing to do on a paid job).
  if (!can('liens.manage') || !v || !v.clock.finalFurnishingDate || (!v.clock.open && !v.case.actions.length && !v.case.recordedOn)) return null
  const k = v.clock
  const urgent = k.open && (k.daysLeft ?? 99) <= 15
  async function paper(kind: LienKind) {
    setBusy(kind)
    const r = await makeLienPaper(jobId, kind, how)
    setBusy('')
    if (!r.ok) { toast.error('Not made', r.error); return }
    setV(r.data.view)
    await open(r.data.action.id)
  }
  async function open(actionId: string) {
    const res = await fetchWithAuth(lienPaperUrl(jobId, actionId)).catch(() => null)
    if (!res?.ok) { toast.error('Could not open the PDF'); return }
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener')
  }
  async function save(b: Partial<LienCaseView> & { finalFurnishingDate?: string }) {
    setBusy('save')
    const r = await saveLien(jobId, b)
    setBusy('')
    if (!r.ok) { toast.error('Not saved', r.error); return }
    setV(r.data); setF(r.data.case); toast.success('Saved')
  }
  const field = (k2: keyof LienCaseView, label: string, type = 'text') => (
    <label className="block text-xs text-gray-800">{label}
      <input type={type} className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={String(f[k2] ?? '')} max={type === 'date' ? todayFl() : undefined} onChange={e => setF(x => ({ ...x, [k2]: e.target.value }))} data-lien-field={k2} />
    </label>
  )
  return wrap(
    <div className={`rounded-xl border p-3 space-y-3 min-w-0 ${urgent ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} data-job-lien>
      <div>
        <p className="text-sm font-semibold text-gray-900" data-lien-clock>
          {k.open ? `Lien clock: day ${k.day} of 90` : k.owedCents ? 'Lien clock' : 'Paid: no lien needed'}
        </p>
        <p className="text-xs text-gray-700">Final furnishing date {usDate(k.finalFurnishingDate)}{v.job.ffdSet ? '' : ' (the day the job was completed)'}. {k.open ? `Owed ${money(k.owedCents)} (cleared ${money(k.clearedCents)} of ${money(k.contractCents)}). Claim of Lien must be recorded by ${usDate(k.deadline)} (${k.daysLeft} day${k.daysLeft === 1 ? '' : 's'} left).` : ''}</p>
        {k.serveBy && <p className="text-xs font-semibold text-red-700" data-lien-serve-by>Serve the owner by {usDate(k.serveBy)} ({daysTo(k.serveBy)} days).</p>}
        {k.suitBy && <p className="text-xs font-semibold text-amber-800" data-lien-suit-by>Suit to enforce must be filed by {usDate(k.suitBy)} ({daysTo(k.suitBy)} days){f.contestOn ? ': a Notice of Contest shortens it to 60 days' : ''}.</p>}
      </div>
      <label className="block text-xs text-gray-800">How it is sent
        <select className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={how} onChange={e => setHow(e.target.value)} data-lien-how>{HOW.map(h => <option key={h}>{h}</option>)}</select>
      </label>
      <div className="grid gap-2">
        {(Object.keys(LIEN_KIND_LABEL) as LienKind[]).map(kind => (
          <button key={kind} type="button" className="btn btn-secondary w-full !min-h-[48px] !h-auto !whitespace-normal py-2 text-left" disabled={!!busy || !v.reviewed[kind]} onClick={() => void paper(kind)} data-lien-paper={kind}>
            {busy === kind ? 'Making…' : LIEN_KIND_LABEL[kind]}{v.reviewed[kind] ? '' : ' (attorney review required)'}
          </button>
        ))}
      </div>
      {v.case.actions.length > 0 && (
        <ul className="text-xs text-gray-700 space-y-1" data-lien-actions>
          {v.case.actions.slice().reverse().map(a => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span>{usDate(a.day)}: {LIEN_KIND_LABEL[a.kind]} · {a.how} · {a.by}</span>
              <button type="button" className="underline min-h-[44px] min-w-[44px]" onClick={() => void open(a.id)}>PDF</button>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="text-xs font-semibold text-gray-800 min-h-[44px] flex items-center">For the Claim of Lien, and its checklist</summary>
        <div className="grid gap-2 mt-1">
          <label className="block text-xs text-gray-800">Legal description (from the deed or the Property Appraiser)
            <textarea className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-base mt-1" rows={3} value={f.legalDescription ?? ''} onChange={e => setF(x => ({ ...x, legalDescription: e.target.value }))} data-lien-field="legalDescription" />
          </label>
          <label className="block text-xs text-gray-800">Final furnishing date (the last day work was done)
            <input type="date" className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" max={todayFl()} defaultValue={k.finalFurnishingDate ?? ''} onChange={e => setFfd(e.target.value)} data-lien-ffd />
          </label>
          {field('parcelId', 'Parcel ID')}
          {field('furnished', 'What was furnished (blank: fence installation: labor, services and materials)')}
          {field('notarizedOn', 'Notarized on', 'date')}
          {field('recordedOn', 'Recorded with the clerk on', 'date')}
          {field('instrumentNumber', 'Instrument number')}
          {field('servedOn', 'Served on the owner on', 'date')}
          {field('serveMethod', 'How it was served')}
          {field('serveTracking', 'Tracking number')}
          {field('contestOn', 'Notice of Contest filed on', 'date')}
          {field('suitFiledOn', 'Suit filed on', 'date')}
          <button type="button" className="btn btn-primary !min-h-[48px]" disabled={!!busy} onClick={() => void save({
            ...(ffd ? { finalFurnishingDate: ffd } : {}),
            legalDescription: f.legalDescription, parcelId: f.parcelId, furnished: f.furnished, notarizedOn: f.notarizedOn || null, recordedOn: f.recordedOn || null,
            instrumentNumber: f.instrumentNumber, servedOn: f.servedOn || null, serveMethod: f.serveMethod, serveTracking: f.serveTracking, contestOn: f.contestOn || null, suitFiledOn: f.suitFiledOn || null,
          })} data-lien-save>Save</button>
        </div>
      </details>
    </div>
  )
}
