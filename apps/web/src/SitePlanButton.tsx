/**
 * The job's "Site plan" button (the job window in Operations, the Salesman's
 * job page): "Draw site plan" for a walked job with no plan yet (the walk list
 * laid out with square corners at the job's address), "Place on map" for an
 * older drawn quote (put where it was drawn on its photo, once; the price is
 * never changed), or "Open site plan". The installer never sees it; the
 * Salesman only opens a plan the office has drawn, read only.
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { getSitePlan, type SitePlanRecord } from './sitePlanApi'
import { planFromYard, type SitePlanData } from './sitePlanData'
import { walkToYard, type WalkList } from './walkList'
import { sitePlanNeeded, type YardLayout } from './yardLayout'
import { lookupPosition } from './appointmentsStore'
import { startOf } from './sitePlanEdit'
import { isCrewLogin } from './permissions'
const SitePlanEditor = lazy(() => import('./SitePlanEditor'))

export default function SitePlanButton({ jobId, className = '' }: { jobId: string; className?: string }) {
  const crew = isCrewLogin()
  const [rec, setRec] = useState<SitePlanRecord | null>(null)
  const [err, setErr] = useState<{ status: number; error: string } | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<{ record: SitePlanRecord; plan: SitePlanData; fresh: boolean } | null>(null)

  useEffect(() => {
    if (crew) return
    let live = true
    void getSitePlan(jobId).then(r => {
      if (!live) return
      if (r.ok) { setRec(r.data); setErr(null) } else setErr({ status: r.status, error: r.error })
    })
    return () => { live = false }
  }, [jobId, crew, tick])

  if (crew || err?.status === 403 || err?.status === 404) return null
  if (err) return <button type="button" className={`btn btn-secondary min-h-[44px] ${className}`} onClick={() => setTick(t => t + 1)} data-site-plan-button="retry">Site plan: try again</button>
  if (!rec) return <button type="button" className={`btn btn-secondary min-h-[44px] ${className}`} disabled data-site-plan-button="loading">Site plan…</button>

  async function openIt() {
    setNote('')
    // Read again: someone may have drawn it since this window opened.
    setBusy(true)
    const r = await getSitePlan(jobId)
    setBusy(false)
    if (!r.ok) { setNote(r.error); return }
    const fresh = r.data
    setRec(fresh)
    if (fresh.plan) { setEditing({ record: fresh, plan: fresh.plan, fresh: false }); return }
    if (!fresh.canEdit) { setNote('The office has not drawn the site plan yet.'); return }
    const layout = fresh.quote?.layout as { walk?: WalkList | null; yard?: YardLayout | null } | null
    const yard = layout?.walk ? walkToYard(layout.walk) : layout?.yard ?? null
    // Placed on the drawing's photo when it has one; else at the job's address.
    let where: { lat: number; lng: number } | null = null
    if (!yard?.plan?.aerial) {
      setBusy(true)
      where = await lookupPosition(fresh.job.address)
      setBusy(false)
      if (!where) { setNote(`"${fresh.job.address || 'No address'}" was not found on the map. Check the job's address, then try again.`); return }
    }
    const plan: SitePlanData | null = yard
      ? planFromYard(yard, where, layout?.walk ?? null)
      : where ? { v: 1, origin: where, posts: [], sides: [], house: [], startPostId: null, notes: '', parcel: null, survey: null, answers: {} } : null
    if (!plan) { setNote('The plan could not be placed on the map. Check the job\'s address, then try again.'); return }
    setEditing({ record: fresh, plan, fresh: true })
  }

  const start = startOf(rec.quote?.layout)
  const label = rec.plan ? 'Open site plan' : rec.canEdit ? start.label : null
  const needed = sitePlanNeeded(rec.quote?.layout as { walk?: unknown; planDone?: boolean } | null)
  return (
    <>
      {label ? (
        <span className="inline-flex flex-col items-start gap-1">
          <button type="button" className={`btn btn-secondary min-h-[44px] ${className}`} disabled={busy} onClick={() => void openIt()} data-site-plan-button={rec.plan ? 'open' : start.what}>
            {busy ? 'Opening…' : label}{rec.plan ? (rec.doneAt ? ' (done)' : needed ? ' (not done)' : '') : ''}
          </button>
        </span>
      ) : <span className="text-sm text-gray-600" data-site-plan-none>No site plan yet.</span>}
      {note && <p className="text-sm text-red-800 mt-1" data-site-plan-button-note>{note}</p>}
      {editing && <Suspense fallback={null}><SitePlanEditor jobId={jobId} record={editing.record} plan={editing.plan} fresh={editing.fresh} onClose={() => { setEditing(null); setTick(t => t + 1) }} /></Suspense>}
    </>
  )
}
