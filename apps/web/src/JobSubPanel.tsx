/**
 * The job's sub, in the job window (Crew & Schedule; Jonathan, Nov 6 2026).
 * Assigning is the one thing done by hand, in 3 taps: Assign sub, the sub, Confirm
 * (the install day is the job's own, else the next crew day; tap to change).
 * After that it shows what follows by itself: their pay (edit or Reset), their
 * link (Copy, turn off, a new one), the notes they see, what they reported, what
 * does not add up, and the one tap "Installed, confirm".
 * Owner and office only (subs.view); the server refuses everyone else.
 */

import { useEffect, useState } from 'react'
import { toast } from './toast'
import { can, signedInRole } from './permissions'
import {
  listSubs, previewAssign, assignSub, jobSub, saveJobSub, unassign, confirmInstalled, money, centsOf, usDay,
  type SubRow, type AssignPreview, type JobSub,
} from './subsApi'
import { sendInstallPacket } from './installPacket'
import { getQuotes } from './quoteStore'
import { loadSchedule } from './scheduleStore'
import { nextCrewDay } from '../../portal/src/server/lib/installDays'

type RawJob = { id: string; fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number; quoteId?: string | null; scheduledDate?: string | null; customerName?: string }

const todayFl = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export default function JobSubPanel({ job, onChanged }: { job: RawJob; onChanged?: () => void }) {
  const [cur, setCur] = useState<JobSub | null | undefined>(undefined)
  const [picking, setPicking] = useState(false)
  const load = () => { void jobSub(job.id).then(r => setCur(r.ok ? r.data : null)) }
  useEffect(load, [job.id])
  if (!can('subs.view')) return null
  if (cur === undefined) return <p className="text-xs text-gray-500" data-job-sub-loading>Loading the sub…</p>
  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-3 space-y-2" data-job-sub>
      {cur && !picking
        ? <AssignedSub job={job} s={cur} onReload={load} onChange={() => setPicking(true)} onChanged={onChanged} />
        : picking || !cur
          ? <AssignFlow job={job} open={picking} onOpen={() => setPicking(true)} onDone={() => { setPicking(false); load(); onChanged?.() }} onCancel={() => setPicking(false)} />
          : null}
    </div>
  )
}

function AssignFlow({ job, open, onOpen, onDone, onCancel }: { job: RawJob; open: boolean; onOpen: () => void; onDone: () => void; onCancel: () => void }) {
  const [subs, setSubs] = useState<SubRow[] | null>(null)
  const [pick, setPick] = useState<SubRow | null>(null)
  const [start, setStart] = useState(() => {
    const s = job.scheduledDate && job.scheduledDate >= todayFl() ? job.scheduledDate : nextCrewDay(todayFl(), loadSchedule().settings.workDays ?? [1, 2, 3, 4])
    return s
  })
  const [pre, setPre] = useState<AssignPreview | null>(null)
  const [busy, setBusy] = useState(false)
  // The date as picked by hand; until then it moves to the first day the 811 call still fits before.
  const [picked, setPicked] = useState(!!job.scheduledDate && job.scheduledDate >= todayFl())
  useEffect(() => { if (open && !subs) void listSubs().then(r => setSubs(r.ok ? r.data.filter(s => s.status === 'active') : [])) }, [open, subs])
  useEffect(() => {
    if (!pick) { setPre(null); return }
    let live = true
    void previewAssign(job.id, pick.id, start).then(r => {
      if (!live) return
      if (r.ok && !picked && r.data.earliestStart > start) { setStart(r.data.earliestStart); return }
      setPre(r.ok ? r.data : null)
    })
    return () => { live = false }
  }, [pick, start, job.id])

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-700">No sub on this job.</p>
        {can('schedule.change') && <button type="button" className="btn btn-primary !min-h-[48px]" onClick={onOpen} data-assign-sub>Assign sub</button>}
      </div>
    )
  }

  async function confirm(override = false) {
    if (!pick) return
    setBusy(true)
    const r = await assignSub(job.id, pick.id, start, override)
    if (!r.ok) {
      setBusy(false)
      if (r.json?.code === 'SUB_PAPERS' && r.json?.ownerCanOverride && window.confirm(`${r.error}\n\nAssign anyway? Your override is recorded on the job.`)) { void confirm(true); return }
      toast.error('Not assigned', r.error)
      return
    }
    // The job sheet the sub's link shows: the packet, made or brought up to date (installPacket.tsx).
    const quote = job.quoteId ? getQuotes().find(q => q.id === job.quoteId) : undefined
    await sendInstallPacket(job.id, job, quote).catch(() => null)
    setBusy(false)
    toast.success(`${pick.businessName} assigned`, `${r.data.days.length > 1 ? `${usDay(r.data.days[0])} to ${usDay(r.data.days[r.data.days.length - 1])}` : usDay(r.data.days[0])} · their pay ${money(r.data.payCents)}`)
    onDone()
  }

  return (
    <div className="space-y-2" data-assign-flow>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Assign a sub</p>
        <button type="button" className="text-sm text-gray-600 underline min-h-[44px]" onClick={onCancel}>Cancel</button>
      </div>
      {subs === null ? <p className="text-xs text-gray-500">Loading subs…</p> : subs.length === 0
        ? <p className="text-sm text-gray-700">No active subs yet. Add one under Operations → Subcontractors.</p>
        : (
          <div className="grid gap-2" data-assign-subs>
            {subs.map(s => (
              <button key={s.id} type="button" onClick={() => setPick(s)} data-assign-pick={s.businessName}
                className={`text-left rounded-xl border-2 px-3 py-2 min-h-[56px] ${pick?.id === s.id ? 'border-orange-500 bg-orange-50' : 'border-gray-200 bg-white'}`}>
                <span className="block text-sm font-semibold text-gray-900">{s.businessName}</span>
                <span className={`block text-xs ${s.insuranceProblems.length ? 'text-red-700' : 'text-gray-600'}`}>
                  {s.insuranceProblems.length ? s.insuranceProblems.join(' · ') : `${s.trades.length ? s.trades.join(', ') : 'Papers on file'}${s.crewSize ? ` · crew of ${s.crewSize}` : ''}`}
                </span>
              </button>
            ))}
          </div>
        )}
      {pick && (
        <div className="space-y-2" data-assign-confirm-box>
          <label className="block text-sm text-gray-800">Install starts
            <input type="date" className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={start} onChange={e => { if (e.target.value) { setPicked(true); setStart(e.target.value) } }} data-assign-date />
          </label>
          {pre && (
            <div className="text-sm text-gray-800 space-y-1">
              <p data-assign-days>{pre.days.length > 1 ? `${pre.days.length} crew days: ${pre.days.map(usDay).join(', ')}` : usDay(pre.days[0])}</p>
              {pre.locate.map(w => <p key={w} className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1" data-assign-811>{w}</p>)}
              {pre.clashes.length > 0 && <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1" data-assign-clash>Already booked: {pre.clashes.map(c => `${usDay(c.date)} (${c.clientName})`).join(', ')}</p>}
              {pre.insuranceProblems.length > 0 && <p className="text-red-800 bg-red-50 border border-red-200 rounded-lg px-2 py-1" data-assign-papers>{pre.insuranceProblems.join('. ')}.{signedInRole() === 'super_admin' ? ' You can assign anyway; it is recorded.' : ' Only the owner can assign anyway.'}</p>}
              <p data-assign-pay>Their pay: <b>{money(pre.payCents)}</b></p>
              {pre.payLines.length > 0 && <ul className="text-xs text-gray-600">{pre.payLines.map(l => <li key={l.key}>{l.label}: {money(l.cents)}</li>)}</ul>}
            </div>
          )}
          <button type="button" className="btn btn-primary w-full !min-h-[56px]" disabled={busy || !pre} onClick={() => void confirm(false)} data-assign-confirm>{busy ? 'Assigning…' : `Confirm ${pick.businessName}`}</button>
        </div>
      )}
    </div>
  )
}

function AssignedSub({ job, s, onReload, onChange, onChanged }: { job: RawJob; s: JobSub; onReload: () => void; onChange: () => void; onChanged?: () => void }) {
  const [payText, setPayText] = useState<string | null>(null)
  const [notes, setNotes] = useState(s.subNotes)
  const [ffd, setFfd] = useState(s.report?.finishedOn ?? todayFl())
  const [busy, setBusy] = useState('')
  useEffect(() => { setNotes(s.subNotes); setFfd(s.report?.finishedOn ?? todayFl()) }, [s])

  async function save(b: Parameters<typeof saveJobSub>[1], word: string) {
    setBusy(word)
    const r = await saveJobSub(job.id, b)
    setBusy('')
    if (!r.ok) { toast.error('Not saved', r.error); return null }
    onReload()
    return r.data
  }
  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); toast.success('Link copied', 'Paste it in a text or email to the sub.') } catch { window.prompt('Copy the link:', link) }
  }
  const status = s.confirmedAt ? 'Installed, confirmed' : s.submittedAt ? 'Installed, confirm' : s.checkout ? 'Material checked out' : 'Assigned'

  return (
    <div className="space-y-3" data-job-sub-assigned={s.businessName}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Sub: {s.businessName}</p>
          <p className="text-xs text-gray-600" data-job-sub-status>{status}{s.lastOpenedAt ? ` · link opened ${new Date(s.lastOpenedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' · link not opened yet'}</p>
          {s.docOverride && <p className="text-xs text-red-700" data-job-sub-override>Assigned without: {s.docOverride.missing.join('; ')} (override by {s.docOverride.by})</p>}
        </div>
        {can('schedule.change') && !s.confirmedAt && <button type="button" className="text-sm underline text-gray-700 min-h-[44px]" onClick={onChange}>Change sub</button>}
      </div>

      {s.submittedAt && !s.confirmedAt && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-3 space-y-2" data-job-sub-confirm-box>
          <p className="text-sm font-semibold text-green-900">Installed, confirm</p>
          <p className="text-xs text-green-900">{s.report?.footage} ft, {s.report?.gates} gates, signed by {s.report?.signName}.</p>
          <label className="block text-xs text-gray-800">Final furnishing date
            <input type="date" className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={ffd} max={todayFl()} onChange={e => setFfd(e.target.value)} data-job-sub-ffd />
          </label>
          <button type="button" className="btn btn-primary w-full !min-h-[56px]" disabled={!!busy} data-job-sub-confirm onClick={async () => {
            setBusy('confirm')
            const r = await confirmInstalled(job.id, ffd || null)
            setBusy('')
            if (!r.ok) { toast.error('Not confirmed', r.error); return }
            toast.success('Installed', `Final furnishing date ${usDay(r.data.finalFurnishingDate)}`)
            onReload(); onChanged?.()
          }}>{busy === 'confirm' ? 'Confirming…' : 'Confirm: installed'}</button>
        </div>
      )}

      {s.flags.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3" data-job-sub-flags>
          <p className="text-sm font-semibold text-amber-900">Does not add up</p>
          <ul className="text-xs text-amber-900 list-disc pl-4">{s.flags.map(f => <li key={f.key}>{f.text}</li>)}</ul>
        </div>
      )}

      <div data-job-sub-pay>
        <p className="text-xs font-semibold text-gray-500">Their pay {s.payEdited ? '(set by hand)' : '(from their rates)'}</p>
        {payText === null ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-lg font-bold text-gray-900" data-job-sub-pay-total>{money(s.payCents)}</p>
            <div className="flex gap-2">
              {!s.confirmedAt && <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => setPayText((s.payCents / 100).toFixed(2))} data-job-sub-pay-edit>Edit</button>}
              {s.payEdited && <button type="button" className="btn btn-secondary !min-h-[44px]" disabled={!!busy} onClick={() => void save({ payReset: true }, 'reset')} data-job-sub-pay-reset>Reset</button>}
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input className="flex-1 border border-gray-300 rounded-lg px-3 h-12 text-base" inputMode="decimal" value={payText} onChange={e => setPayText(e.target.value)} aria-label="Their pay" data-job-sub-pay-input />
            <button type="button" className="btn btn-primary !min-h-[48px]" disabled={!!busy} onClick={async () => {
              const c = centsOf(payText)
              if (c === null) { toast.error('Not saved', 'Type the pay in dollars.'); return }
              if (await save({ payCents: c }, 'pay')) setPayText(null)
            }}>Save</button>
            <button type="button" className="btn btn-secondary !min-h-[48px]" onClick={() => setPayText(null)}>Cancel</button>
          </div>
        )}
        {!s.payEdited && s.payLines.length > 0 && (
          <ul className="text-xs text-gray-600 mt-1">{s.payLines.map(l => <li key={l.key}>{l.label}: {l.unit === 'job' ? '' : `${l.qty} × ${money(l.rateCents)} = `}{money(l.cents)}{l.own ? ' (their rate)' : ''}</li>)}</ul>
        )}
      </div>

      <div data-job-sub-link>
        <p className="text-xs font-semibold text-gray-500">Their link (no login)</p>
        {s.linkOff
          ? <div className="flex items-center justify-between gap-2"><p className="text-sm text-gray-700">Turned off.</p><button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => void save({ linkOff: false }, 'on')}>Turn on</button></div>
          : s.link && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => void copy(s.link!)} data-job-sub-copy>Copy link</button>
              <a className="btn btn-secondary !min-h-[44px]" href={s.link} target="_blank" rel="noreferrer">Open</a>
              <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => { if (window.confirm('Turn the link off? The sub can no longer open the job.')) void save({ linkOff: true }, 'off') }} data-job-sub-off>Turn off</button>
              <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={async () => {
                if (!window.confirm('Make a new link? The old one stops working.')) return
                const d = await save({ newLink: true }, 'new')
                if (d?.link) void copy(d.link)
              }}>New link</button>
            </div>
          )}
        <p className="text-xs text-gray-600 mt-1">Emailed to them the day before the install{s.email ? ` (${s.email})` : ': add their email on their page'}.</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500">Gate codes and notes the sub sees
          <textarea className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-base mt-1" rows={3} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} data-job-sub-notes />
        </label>
        {notes !== s.subNotes && <button type="button" className="btn btn-primary mt-1 !min-h-[44px]" disabled={!!busy} onClick={() => void save({ subNotes: notes }, 'notes')}>Save notes</button>}
      </div>

      {(s.report || s.checkout || s.checkin) && (
        <div className="text-xs text-gray-700 space-y-1" data-job-sub-report>
          {s.checkout && <p>Checked out {new Date(s.checkout.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: {s.checkout.lines.map(l => `${l.item} ${l.taken}`).join(', ')}</p>}
          {s.report?.startedOn && <p>Started {usDay(s.report.startedOn)}{s.report.finishedOn ? `, finished ${usDay(s.report.finishedOn)}` : ''}{s.report.footage != null ? ` · ${s.report.footage} ft` : ''}{s.report.gates != null ? ` · ${s.report.gates} gates` : ''}</p>}
          {s.report?.problemsFound && <p>Problems found: {s.report.problemsFound}</p>}
          {(s.report?.problems ?? []).map(p => <p key={p.at} className="text-red-700">{p.kind === 'damage' ? 'Property damage' : 'Site issue'}: {p.text}</p>)}
          {s.checkin && <p>Checked in: {s.checkin.lines.filter(l => l.back > 0).map(l => `${l.item} ${l.back}`).join(', ') || 'nothing back'}</p>}
        </div>
      )}

      <details className="text-xs text-gray-600">
        <summary className="min-h-[44px] flex items-center">History ({s.events.length})</summary>
        <ul className="space-y-0.5">{s.events.slice().reverse().map((e, i) => <li key={i}>{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: {e.what} ({e.how})</li>)}</ul>
      </details>

      {can('schedule.change') && !s.submittedAt && (
        <button type="button" className="text-xs underline text-gray-600 min-h-[44px]" onClick={async () => {
          if (!window.confirm(`Take ${s.businessName} off this job? Their link stops working. The install stays booked.`)) return
          const r = await unassign(job.id)
          if (!r.ok) { toast.error('Not changed', r.error); return }
          onReload(); onChanged?.()
        }}>Take the sub off</button>
      )}
    </div>
  )
}
