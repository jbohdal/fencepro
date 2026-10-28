/**
 * The job's permit: status (Not needed, Needed, Applied, Approved, Inspection
 * scheduled, Passed), number, dates, parcel ID from the county, the county's
 * online permit portal, and the Permit packet PDF. Saved on the server.
 */

import { useEffect, useState } from 'react'
import { api, openPdf, type Permit } from './automationsApi'
import { toast } from './toast'
import { milestonesChanged } from './jobTruthApi'
import { can } from './permissions'
import { refreshJobs } from './jobStore'

const STATUSES: Array<[string, string]> = [['not_needed', 'Not needed'], ['needed', 'Needed'], ['applied', 'Applied'], ['approved', 'Approved'], ['inspection_scheduled', 'Inspection scheduled'], ['passed', 'Passed']]
type Portal = { name: string; url: string; info: string; note: string } | null
/** No permit record and not a repair: no status until the office picks one (shown "Not set", never saved). */
const NOT_SET = ''
const EMPTY = { status: 'needed', permitNumber: '', county: 'Marion', parcelId: '', appliedAt: '', approvedAt: '', inspectionAt: '', passedAt: '', notes: '' }

export default function PermitPanel({ jobId }: { jobId: string }) {
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)
  const [saved, setSaved] = useState<Permit | null>(null)
  const [portal, setPortal] = useState<Portal>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [startsAs, setStartsAs] = useState(EMPTY.status)

  useEffect(() => {
    let live = true
    api<{ permit: Permit | null; defaultStatus?: string | null; portal: Portal }>('GET', `/permits/${encodeURIComponent(jobId)}`)
      .then(d => {
        if (!live) return
        setSaved(d.permit); setPortal(d.portal)
        // No permit yet: as every screen reads it (portal lib/permitStatus.ts): Not needed for a repair (Oct 26 2026),
        // else Not set until the office picks one (review Oct 28 2026: it showed Needed, with Save greyed out).
        if (d.permit) setForm({ ...EMPTY, ...pickForm(d.permit) })
        else { setForm({ ...EMPTY, status: d.defaultStatus || NOT_SET }); setStartsAs(d.defaultStatus || NOT_SET) }
        setLoaded(true)
      })
      .catch(err => { if (live) { setError((err as Error).message); setLoaded(true) } })
    return () => { live = false }
  }, [jobId])

  const set = (k: keyof typeof EMPTY, v: string) => setForm(f => ({ ...f, [k]: v }))
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  function setStatus(v: string) {
    setForm(f => ({ ...f, status: v,
      appliedAt: v === 'applied' && !f.appliedAt ? today : f.appliedAt,
      approvedAt: v === 'approved' && !f.approvedAt ? today : f.approvedAt,
      passedAt: v === 'passed' && !f.passedAt ? today : f.passedAt }))
  }
  async function save() {
    setBusy('save'); setError('')
    try {
      const d = await api<{ permit: Permit; portal: Portal }>('PUT', `/permits/${encodeURIComponent(jobId)}`, form)
      setSaved(d.permit); setPortal(d.portal); toast.success('Permit saved')
      // The Permit Approved milestone follows the permit (portal lib/jobReadiness.ts).
      milestonesChanged()
      // A job waiting on its permit moves on by itself once it is issued (portal lib/waitingStageMove.ts): read the stage.
      void refreshJobs()
    } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }
  async function lookUp() {
    setBusy('parcel'); setError('')
    try {
      const d = await api<{ permit: Permit; parcel: { parcel: string; owner: string } }>('POST', `/permits/${encodeURIComponent(jobId)}/parcel`)
      setSaved(d.permit); set('parcelId', d.parcel.parcel); toast.success('Parcel found', `${d.parcel.parcel} · ${d.parcel.owner}`)
    } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }
  async function packet() {
    setBusy('packet'); setError('')
    try { await openPdf(`/api/automations/permits/${encodeURIComponent(jobId)}/packet.pdf`) } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }
  // Made by an automation (the Signed Contract permit step) and never saved by a person: Save confirms it as shown.
  const byAutomation = !!saved && saved.updatedBy === 'automation'
  const dirty = !saved || byAutomation || JSON.stringify(pickForm(saved)) !== JSON.stringify(form)
  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm bg-white'
  const label = 'block text-xs font-semibold text-gray-700 mb-1'

  if (!loaded) return <p className="text-sm text-gray-500">Loading the permit…</p>
  // Permits are the office's (and up) to change; others see them.
  const locked = !can('permits.change')
  return (
    <fieldset disabled={locked} className="space-y-3 min-w-0 border-0 p-0 m-0" data-permit-panel={jobId}>
      {!saved && (startsAs === 'not_needed'
        ? <p className="text-sm text-gray-600" data-permit-default="not_needed">A repair: no permit unless you set it to Needed and press Save. No permit reminders until then.</p>
        : <p className="text-sm text-gray-600" data-permit-default="not_set">No permit status yet (Not set). Pick one and press Save.</p>)}
      {byAutomation && <p className="text-sm text-gray-600" data-permit-by-automation>Set to {STATUSES.find(([k]) => k === saved!.status)?.[1] ?? saved!.status} by an automation when the contract was signed; nobody has saved it yet. Press Save to confirm it, or pick another status.</p>}
      <div>
        <label className={label} htmlFor={`permit-status-${jobId}`}>Status</label>
        <select id={`permit-status-${jobId}`} value={form.status} onChange={e => setStatus(e.target.value)} className={input} data-permit-status>
          {form.status === NOT_SET && <option value={NOT_SET}>Not set</option>}
          {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {form.status !== 'not_needed' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={label}>Permit number</label><input className={input} value={form.permitNumber} onChange={e => set('permitNumber', e.target.value)} data-permit-number /></div>
            <div><label className={label}>County</label><input className={input} value={form.county} onChange={e => set('county', e.target.value)} /></div>
          </div>
          <div>
            <label className={label}>Parcel ID</label>
            <div className="flex gap-2">
              <input className={input} value={form.parcelId} onChange={e => set('parcelId', e.target.value)} placeholder="From the county" />
              <button type="button" className="btn btn-secondary shrink-0" disabled={!!busy} onClick={lookUp}>{busy === 'parcel' ? 'Looking…' : 'Look up'}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={label}>Applied</label><input type="date" className={input} value={form.appliedAt} onChange={e => set('appliedAt', e.target.value)} /></div>
            <div><label className={label}>Approved</label><input type="date" className={input} value={form.approvedAt} onChange={e => set('approvedAt', e.target.value)} /></div>
            <div><label className={label}>Inspection</label><input type="date" className={input} value={form.inspectionAt} onChange={e => set('inspectionAt', e.target.value)} /></div>
            <div><label className={label}>Passed</label><input type="date" className={input} value={form.passedAt} onChange={e => set('passedAt', e.target.value)} /></div>
          </div>
        </>
      )}
      <div><label className={label}>Notes</label><textarea className={input} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={!!busy || !dirty || form.status === NOT_SET} onClick={save} data-permit-save>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={packet} data-permit-packet>{busy === 'packet' ? 'Making…' : 'Permit packet (PDF)'}</button>
        {portal && form.status !== 'not_needed' && <a className="btn btn-quiet" href={portal.url} target="_blank" rel="noreferrer">{portal.name}</a>}
      </div>
      {portal && form.status !== 'not_needed' && <p className="text-xs text-gray-500">{portal.note} Filing is done by you on the county site; nothing is filed automatically.</p>}
    </fieldset>
  )
}

function pickForm(p: Permit) {
  return { status: p.status, permitNumber: p.permitNumber, county: p.county, parcelId: p.parcelId, appliedAt: p.appliedAt, approvedAt: p.approvedAt, inspectionAt: p.inspectionAt, passedAt: p.passedAt, notes: p.notes }
}
