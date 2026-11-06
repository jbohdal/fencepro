/**
 * Operations → Subcontractors (Jonathan, Nov 6 2026): every sub's info,
 * papers and history in one place, like a team member, with no login. Owner
 * and office only (subs.view); a W9 opens for the owner only.
 *
 *   Dashboard   this week by day, 811 not called or expiring before the
 *               install, material out not checked back in, waiting on the sub's
 *               sign off or on your confirm, papers expiring within 30 days
 *   Subs        the list; a sub's page: info, status, their rates over
 *               Settings' (Reset), papers with expiry, jobs, the agreement
 *   Settings    the Subcontractor Agreement (locked "Attorney review required"
 *               until the owner marks it reviewed), callback months, paper types
 */

import { useEffect, useState, type ReactNode } from 'react'
import { toast } from './toast'
import { can, signedInRole } from './permissions'
import {
  listSubs, getSub, addSub, saveSub, uploadDoc, removeDoc, docUrl, sendAgreement, subsDashboard, subSettings, saveSubSettings, markReviewed,
  lienList, lienSample, ytdCsvUrl, LIEN_KIND_LABEL, ADDENDUM_STATE_LABEL, addendumList, markAddendumReviewed,
  money, centsOf, usDay, usDate, SUB_STATUS_LABEL, TRADES, TRADE_LABEL,
  type SubRow, type SubDetail, type Sub, type SubRates, type SubsDashboard, type SubSettings, type SubStatus, type Trade, type DashJob,
} from './subsApi'
import { fetchWithAuth } from './crmAuth'
import SubTextsWaiting from './SubTextsWaiting'
import { navigate, pagePath } from './nav'

type Tab = 'dashboard' | 'subs' | 'settings'

export default function SubcontractorsPage() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('subcontractor') ? 'subs' : 'dashboard'))
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('subcontractor'))
  if (!can('subs.view')) return <p className="text-sm text-gray-700">Only the owner and the office can see subcontractors.</p>
  return (
    <div className="space-y-4" data-subs-page>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subcontractors</h1>
        <p className="text-sm text-gray-600 mt-1">Subs, their papers, jobs and pay. Assign a sub from the job window; the rest follows by itself.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {(['dashboard', 'subs', 'settings'] as Tab[]).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); if (t !== 'subs') setOpenId(null) }} data-subs-tab={t}
            className={`px-4 min-h-[48px] rounded-full text-sm font-semibold ${tab === t ? 'bg-orange-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
            {t === 'dashboard' ? 'Dashboard' : t === 'subs' ? 'Subs' : 'Settings'}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <Dashboard onOpenSub={id => { setOpenId(id); setTab('subs') }} />}
      {tab === 'subs' && (openId ? <SubPage id={openId} onBack={() => setOpenId(null)} /> : <SubList onOpen={setOpenId} />)}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

const openJob = (jobId: string) => navigate(`${pagePath('Operations')}?job=${encodeURIComponent(jobId)}`)

// ── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ onOpenSub }: { onOpenSub: (id: string) => void }) {
  const [d, setD] = useState<SubsDashboard | null>(null)
  const [err, setErr] = useState('')
  const [liens, setLiens] = useState<Awaited<ReturnType<typeof lienList>> | null>(null)
  useEffect(() => { void subsDashboard().then(r => (r.ok ? setD(r.data) : setErr(r.error))) }, [])
  // The lien clocks are the owner's only.
  useEffect(() => { if (can('liens.manage')) void lienList().then(setLiens) }, [])
  if (err) return <p className="text-sm text-red-700">{err}</p>
  if (!d) return <p className="text-sm text-gray-500">Loading…</p>
  const row = (j: DashJob, extra?: string) => (
    <button key={j.jobId + (extra ?? '')} type="button" onClick={() => openJob(j.jobId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50" data-dash-job={j.jobId}>
      <span className="block text-sm font-semibold text-gray-900">{j.customerName} <span className="font-normal text-gray-600">· {j.sub}</span></span>
      <span className="block text-xs text-gray-600">{j.address}{j.installDate ? ` · ${usDay(j.installDate)}` : ''}{extra ? ` · ${extra}` : ''}</span>
    </button>
  )
  const box = (title: string, key: string, items: ReactNode[], empty: string) => (
    <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden" data-dash={key}>
      <h2 className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b border-gray-100">{title} ({items.length})</h2>
      {items.length ? <div className="divide-y divide-gray-100">{items}</div> : <p className="px-3 py-3 text-sm text-gray-500">{empty}</p>}
    </section>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Texts to subs, ready to send from the phone (no Twilio; SubTextsWaiting.tsx). */}
      <div className="lg:col-span-2 empty:hidden"><SubTextsWaiting onOpenJob={openJob} /></div>
      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden lg:col-span-2" data-dash="week">
        <h2 className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b border-gray-100">The next 7 days</h2>
        <div className="divide-y divide-gray-100">
          {d.week.map(day => (
            <div key={day.date} className="px-3 py-2">
              <p className="text-xs font-semibold text-gray-700">{usDay(day.date)}</p>
              {day.jobs.length ? day.jobs.map(j => row(j)) : <p className="text-xs text-gray-400">No sub jobs</p>}
            </div>
          ))}
        </div>
      </section>
      {box(`Ready to pay sub (${money(d.owedCents)} owed)`, 'ready', d.readyToPay.map(j => row(j, money(j.netCents))), 'No sub is waiting to be paid.')}
      {box('Installed, final payment not cleared', 'notcleared', d.finalNotCleared.map(j => row(j, `${money(j.clearedCents)} of ${money(j.contractCents)} cleared${j.receivedCents ? `, ${money(j.receivedCents)} received` : ''}${j.lienDay != null ? ` · lien clock day ${j.lienDay}` : ''}`)), 'Every installed sub job is paid and cleared.')}
      {liens?.ok && box('Lien clocks (owner only)', 'liens', liens.data.clocks.map(c => (
        <button key={c.jobId} type="button" onClick={() => openJob(c.jobId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50" data-dash-lien={c.jobId}>
          <span className="block text-sm font-semibold text-gray-900">{c.customerName} <span className={`font-normal ${(c.daysLeft ?? 99) <= 15 ? 'text-red-700' : 'text-gray-600'}`}>· day {c.day} of 90</span></span>
          <span className="block text-xs text-gray-600">{money(c.owedCents)} owed · record by {usDate(c.deadline)}{c.recordedOn ? ` · recorded ${usDate(c.recordedOn)}` : ''}</span>
        </button>
      )), 'No unpaid job is on the lien clock.')}
      {liens?.ok && (liens.data.noNotice.length > 0 || liens.data.noNoticeOlder > 0) && box("Not installed yet, signed over $2,500 without Florida's lien notice (713.015)", 'nonotice', [
        // Each one's notice addendum (JobLienNoticeAddendum.tsx on the job): locked until you mark it reviewed (Settings tab).
        ...liens.data.noNotice.map(q => (
          <button key={q.quoteId} type="button" onClick={() => openJob(q.jobId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50 text-sm text-gray-800" data-dash-no-notice={q.addendum}>{q.customerName} · {money(q.priceCents)}{q.signedOn ? ` · signed ${usDate(q.signedOn)}` : ''}
            <span className="block text-xs text-gray-600">{q.address} · addendum: {ADDENDUM_STATE_LABEL[q.addendum].toLowerCase()}</span></button>
        )),
        ...(liens.data.noNoticeSigned > 0 ? [<p key="signed" className="px-3 py-2 text-xs text-green-800" data-dash-no-notice-signed>{liens.data.noNoticeSigned} more signed the notice addendum: the notice is given.</p>] : []),
        ...(liens.data.noNoticeOlder > 0 && liens.data.noNotice.length > 0 ? [<p key="older" className="px-3 py-2 text-xs text-gray-600" data-dash-no-notice-older>Also {liens.data.noNoticeOlder} older contracts, already installed, signed before the notice.</p>] : []),
      ], `None still to install. ${liens.data.noNoticeOlder} older contracts, already installed, were signed before the notice.`)}
      {box('Open callbacks by sub', 'callbacks', d.callbacks.map(c => (
        <button key={c.subId} type="button" onClick={() => onOpenSub(c.subId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50"><span className="text-sm font-semibold text-gray-900">{c.sub}</span> <span className="text-sm text-gray-600">· {c.open} open</span></button>
      )), 'No open callbacks.')}
      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden" data-dash="ytd">
        <h2 className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b border-gray-100 flex items-center justify-between">Paid this year
          <button type="button" className="underline min-h-[44px] min-w-[44px]" data-dash-ytd-csv onClick={async () => {
            const res = await fetchWithAuth(ytdCsvUrl(new Date().getFullYear())).catch(() => null)
            if (!res?.ok) { toast.error('Could not make the CSV'); return }
            const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `subs-paid-${new Date().getFullYear()}.csv`; a.click()
          }}>CSV</button></h2>
        {d.ytd.length ? <div className="divide-y divide-gray-100">{d.ytd.map(y => (
          <button key={y.subId} type="button" onClick={() => onOpenSub(y.subId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50">
            <span className="block text-sm font-semibold text-gray-900">{y.businessName} · {money(y.paidCents)}</span>
            <span className={`block text-xs ${y.form1099 ? 'text-amber-800 font-semibold' : 'text-gray-600'}`}>{y.jobs} job{y.jobs === 1 ? '' : 's'}{y.form1099 ? ' · 1099-NEC: $2,000 or more' : ''}</span>
          </button>
        ))}</div> : <p className="px-3 py-3 text-sm text-gray-500">No sub paid yet this year.</p>}
      </section>
      {box('811 not called or expiring', 'locate', d.locate.map(j => row(j, j.problem)), 'Every booked sub job has its 811 ticket.')}
      {box('Waiting on your confirm', 'you', d.waitingOnYou.map(j => row(j, j.flags ? `${j.flags} thing${j.flags === 1 ? '' : 's'} do not add up` : 'signed off')), 'Nothing to confirm.')}
      {box('Waiting on the sub to sign off', 'sub', d.waitingOnSub.map(j => row(j)), 'No sub is late signing off.')}
      {box('Material out, not checked back in', 'material', d.materialOut.map(j => row(j)), 'All material is back.')}
      {box('Papers expired or expiring in 30 days', 'papers', d.papers.map(p => (
        <button key={p.subId + p.label} type="button" onClick={() => onOpenSub(p.subId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50" data-dash-paper>
          <span className="block text-sm font-semibold text-gray-900">{p.sub}</span>
          <span className={`block text-xs ${p.days < 0 ? 'text-red-700' : 'text-amber-800'}`}>{p.label} {p.days < 0 ? `expired ${usDate(p.expiresOn)}` : `expires ${usDate(p.expiresOn)} (${p.days} day${p.days === 1 ? '' : 's'})`}</span>
        </button>
      )), 'No paper expired or expiring in the next 30 days.')}
    </div>
  )
}

// ── The list ─────────────────────────────────────────────────────────────────

function SubList({ onOpen }: { onOpen: (id: string) => void }) {
  const [subs, setSubs] = useState<SubRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const load = () => { void listSubs().then(r => setSubs(r.ok ? r.data : [])) }
  useEffect(load, [])
  if (adding) return <SubForm onDone={id => { setAdding(false); if (id) onOpen(id); else load() }} />
  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-primary !min-h-[48px]" onClick={() => setAdding(true)} data-sub-add>+ Add sub</button>
      {subs === null ? <p className="text-sm text-gray-500">Loading…</p> : subs.length === 0 ? <p className="text-sm text-gray-600">No subs yet.</p> : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {subs.map(s => (
            <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="w-full text-left px-3 py-2 min-h-[64px] hover:bg-orange-50" data-sub-row={s.businessName}>
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900">{s.businessName}</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${s.status === 'active' ? 'bg-green-100 text-green-800' : s.status === 'do_not_use' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>{SUB_STATUS_LABEL[s.status]}</span>
              </span>
              <span className="block text-xs text-gray-600">{s.contactName}{s.phone ? ` · ${s.phone}` : ''} · {s.jobs} job{s.jobs === 1 ? '' : 's'}</span>
              {(s.insuranceProblems.length > 0 || s.expiring.length > 0 || s.missing.length > 0) && (
                <span className="block text-xs text-red-700">{[...s.insuranceProblems, ...s.expiring.map(e => `${e.label} expires ${usDate(e.expiresOn)}`), ...s.missing.filter(m => !/liability|workers/i.test(m)).map(m => `No ${m}`)].join(' · ')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add or change a sub ──────────────────────────────────────────────────────

const blank: Partial<Sub> = { businessName: '', contactName: '', phone: '', email: '', address: '', payMethod: '', notes: '', trades: [], crewSize: null, status: 'active', statusReason: '' }

function SubForm({ sub, onDone }: { sub?: Sub; onDone: (id: string | null) => void }) {
  const [f, setF] = useState<Partial<Sub>>(sub ?? blank)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Sub, v: unknown) => setF(x => ({ ...x, [k]: v }))
  const input = (k: keyof Sub, label: string, type = 'text', more: Record<string, unknown> = {}) => (
    <label className="block text-sm text-gray-800">{label}
      <input type={type} className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={String(f[k] ?? '')} onChange={e => set(k, e.target.value)} data-sub-field={k} {...more} />
    </label>
  )
  async function save() {
    setBusy(true)
    const body = { ...f, crewSize: f.crewSize ? Number(f.crewSize) : null }
    const r = sub ? await saveSub(sub.id, body) : await addSub(body)
    setBusy(false)
    if (!r.ok) { toast.error('Not saved', r.error); return }
    toast.success(sub ? 'Saved' : 'Sub added', r.data.businessName)
    onDone(r.data.id)
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-sub-form>
      <h2 className="text-lg font-semibold text-gray-900">{sub ? `Change ${sub.businessName}` : 'Add a sub'}</h2>
      {input('businessName', 'Business name')}
      {input('contactName', 'Contact name', 'text', { autoComplete: 'name' })}
      <div className="grid gap-3 sm:grid-cols-2">{input('phone', 'Phone', 'tel')}{input('email', 'Email', 'email')}</div>
      {input('address', 'Address')}
      {input('payMethod', 'How you pay them (check, Zelle…)')}
      <fieldset>
        <legend className="text-sm text-gray-800">Trades</legend>
        <div className="flex flex-wrap gap-2 mt-1">
          {TRADES.map(t => {
            const on = (f.trades ?? []).includes(t)
            return <button key={t} type="button" aria-pressed={on} onClick={() => set('trades', on ? (f.trades ?? []).filter(x => x !== t) : [...(f.trades ?? []), t])} data-sub-trade={t}
              className={`px-3 min-h-[44px] rounded-full text-sm border ${on ? 'bg-orange-50 border-orange-500 text-orange-800 font-semibold' : 'border-gray-300 text-gray-700'}`}>{TRADE_LABEL[t as Trade]}</button>
          })}
        </div>
      </fieldset>
      {input('crewSize', 'Crew size', 'number', { inputMode: 'numeric', min: 1 })}
      <label className="block text-sm text-gray-800">Status
        <select className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={f.status} onChange={e => set('status', e.target.value as SubStatus)} data-sub-field="status">
          {(['active', 'inactive', 'do_not_use'] as SubStatus[]).map(s => <option key={s} value={s}>{SUB_STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      {f.status === 'do_not_use' && input('statusReason', 'Why not use them')}
      <label className="block text-sm text-gray-800">Notes
        <textarea className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-base mt-1" rows={3} value={f.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={() => void save()} data-sub-save>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-secondary !min-h-[48px]" onClick={() => onDone(sub?.id ?? null)}>Cancel</button>
      </div>
    </div>
  )
}

// ── One sub ──────────────────────────────────────────────────────────────────

function SubPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<SubDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const load = () => { void getSub(id).then(r => (r.ok ? setD(r.data) : toast.error('Could not open the sub', r.error))) }
  useEffect(load, [id])
  if (!d) return <p className="text-sm text-gray-500">Loading…</p>
  if (editing) return <SubForm sub={d.sub} onDone={() => { setEditing(false); load() }} />
  const s = d.sub
  return (
    <div className="space-y-4" data-sub-page={s.businessName}>
      <button type="button" className="text-sm underline text-gray-700 min-h-[44px]" onClick={onBack}>← All subs</button>
      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-900">{s.businessName}</h2>
          <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => setEditing(true)} data-sub-edit>Edit</button>
        </div>
        <p className="text-sm text-gray-700"><b>{SUB_STATUS_LABEL[s.status]}</b>{s.statusReason ? `: ${s.statusReason}` : ''}</p>
        <p className="text-sm text-gray-700">{s.contactName}{s.phone ? <> · <a className="underline" href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>{s.phone}</a></> : null}{s.email ? ` · ${s.email}` : ''}</p>
        {s.address && <p className="text-sm text-gray-700">{s.address}</p>}
        <p className="text-sm text-gray-700">{s.trades.map(t => TRADE_LABEL[t]).join(', ') || 'No trades set'}{s.crewSize ? ` · crew of ${s.crewSize}` : ''}{s.payMethod ? ` · paid by ${s.payMethod}` : ''}</p>
        {s.notes && <p className="text-sm text-gray-600 whitespace-pre-wrap">{s.notes}</p>}
      </section>
      <section className="bg-white rounded-2xl border border-gray-200 p-4" data-sub-stats>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Their numbers</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {([
            ['Jobs', `${d.stats.jobs} (${d.stats.done} signed off)`], ['Feet installed', `${d.stats.feet} ft`],
            ['Callbacks', `${d.stats.callbacks}${d.stats.callbackRate != null ? ` (${d.stats.callbackRate}% of jobs)` : ''}${d.stats.openCallbacks ? `, ${d.stats.openCallbacks} open` : ''}`],
            ['Inspections passed first time', d.stats.firstPassRate != null ? `${d.stats.firstPassRate}% of ${d.stats.inspected}` : 'None inspected yet'],
            ['On time', d.stats.onTimeRate != null ? `${d.stats.onTimeRate}%` : '—'], ['Problems reported', String(d.stats.problems)],
            ['Material shortages', String(d.stats.shortages)], ['Paid this year', money(d.stats.paidYear)], ['Paid all time', money(d.stats.paidAll)],
          ] as Array<[string, string]>).map(([k, v]) => <div key={k} className="contents"><dt className="text-gray-600">{k}</dt><dd className="text-gray-900 font-medium">{v}</dd></div>)}
        </dl>
      </section>
      <Papers d={d} onChanged={load} />
      <Rates d={d} onSaved={load} />
      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden" data-sub-jobs>
        <h3 className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border-b border-gray-100">Jobs ({d.jobs.length})</h3>
        {d.jobs.length === 0 ? <p className="px-3 py-3 text-sm text-gray-500">No jobs yet. Assign them from a job's window.</p> : (
          <div className="divide-y divide-gray-100">{d.jobs.map(j => (
            <button key={j.jobId} type="button" onClick={() => openJob(j.jobId)} className="w-full text-left px-3 py-2 min-h-[56px] hover:bg-orange-50">
              <span className="block text-sm font-semibold text-gray-900">{j.customerName}</span>
              <span className="block text-xs text-gray-600">{j.address}{j.installDate ? ` · ${usDay(j.installDate)}` : ''} · {money(j.payCents)} · {j.confirmedAt ? 'installed' : j.submittedAt ? 'signed off' : 'booked'}</span>
            </button>
          ))}</div>
        )}
      </section>
    </div>
  )
}

function Papers({ d, onChanged }: { d: SubDetail; onChanged: () => void }) {
  const owner = can('subs.w9')
  const kinds = d.kinds.filter(k => k.kind !== 'w9' || owner)
  const [kind, setKind] = useState(kinds.find(k => k.kind === 'liability')?.kind ?? kinds[0]?.kind ?? '')
  const [exp, setExp] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  // A new file box after each filing, so the same file picked again is seen.
  const [boxKey, setBoxKey] = useState(0)
  const k = d.kinds.find(x => x.kind === kind)
  async function upload() {
    if (!file) { toast.error('Not filed', 'Pick the PDF or photo.'); return }
    setBusy(true)
    const r = await uploadDoc(d.sub.id, { kind, expiresOn: k?.expires ? exp : undefined, file })
    setBusy(false)
    if (!r.ok) { toast.error('Not filed', r.error); return }
    toast.success('Filed', r.data.label)
    setFile(null); setExp(''); setBoxKey(n => n + 1); onChanged()
  }
  async function open(docId: string) {
    const res = await fetchWithAuth(docUrl(d.sub.id, docId)).catch(() => null)
    if (!res?.ok) { toast.error('Could not open', 'Try again.'); return }
    const url = URL.createObjectURL(await res.blob())
    window.open(url, '_blank', 'noopener')
  }
  const p = d.papers
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-sub-papers>
      <h3 className="text-sm font-semibold text-gray-900">Papers</h3>
      {(p.insuranceProblems.length > 0 || p.missing.length > 0) && <p className="text-sm text-red-700" data-sub-missing>{[...p.insuranceProblems, ...p.missing.filter(m => !/liability|workers/i.test(m)).map(m => `No ${m}`)].join(' · ')}</p>}
      {p.expiring.map(e => <p key={e.kind} className="text-sm text-amber-800" data-sub-expiring>{e.label} expires {usDate(e.expiresOn)} ({e.days} day{e.days === 1 ? '' : 's'}).</p>)}
      <ul className="divide-y divide-gray-100">
        {d.documents.map(doc => {
          const lapsed = doc.expiresOn && doc.expiresOn < new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
          return (
            <li key={doc.id} className="py-2 flex items-center justify-between gap-2" data-sub-doc={doc.kind}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{doc.label}{doc.version ? ` ${doc.version}` : ''}</span>
                <span className={`block text-xs ${lapsed ? 'text-red-700' : 'text-gray-600'}`}>{doc.expiresOn ? `${lapsed ? 'Expired' : 'Expires'} ${usDate(doc.expiresOn)}` : doc.signedOn ? `Signed ${usDate(doc.signedOn)}` : 'No expiry'} · {doc.uploadedBy}</span>
              </span>
              <span className="flex gap-2 shrink-0">
                {doc.canOpen ? <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => void open(doc.id)}>Open</button> : <span className="text-xs text-gray-500">Owner only</span>}
                {(doc.kind !== 'w9' || owner) && <button type="button" className="text-xs underline text-gray-600 min-h-[44px]" onClick={async () => { if (!window.confirm(`Take off ${doc.label}?`)) return; const r = await removeDoc(d.sub.id, doc.id); if (!r.ok) toast.error('Not changed', r.error); onChanged() }}>Remove</button>}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="grid gap-2 sm:grid-cols-3 items-end" data-sub-upload>
        <label className="block text-sm text-gray-800">Paper
          <select className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={kind} onChange={e => setKind(e.target.value)} data-sub-doc-kind>
            {kinds.map(x => <option key={x.kind} value={x.kind}>{x.label}</option>)}
          </select>
        </label>
        {k?.expires && <label className="block text-sm text-gray-800">Expires
          <input type="date" className="block w-full border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" value={exp} onChange={e => setExp(e.target.value)} data-sub-doc-exp />
        </label>}
        <label className="btn btn-secondary !min-h-[48px] cursor-pointer">{file ? file.name.slice(0, 24) : 'PDF or photo'}
          <input key={boxKey} type="file" accept="application/pdf,image/*" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} data-sub-doc-file />
        </label>
      </div>
      <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={() => void upload()} data-sub-doc-upload>{busy ? 'Filing…' : 'File the paper'}</button>
      <button type="button" className="btn btn-secondary !min-h-[48px] ml-2" onClick={async () => {
        const r = await sendAgreement(d.sub.id)
        if (!r.ok) { toast.error('Not sent', r.error); return }
        // Emailed, or not: the link to copy either way (a text from your phone, or the email again).
        if (r.data.sent) toast.success('Agreement emailed', d.sub.email)
        else toast.error('Not emailed', `${r.data.how}. Copy the link and send it yourself.`)
        try { await navigator.clipboard.writeText(r.data.link); toast.success('Sign link copied', 'Paste it in a text or email to the sub.') } catch { window.prompt('The sign link:', r.data.link) }
      }} data-sub-send-agreement>Send the agreement to sign</button>
      <p className="text-xs text-gray-500">Never write an SSN or EIN anywhere here: the W9 file holds it, for the owner only.</p>
    </section>
  )
}

const RATE_KEYS: Array<{ k: keyof Omit<SubRates, 'perUnit'>; label: string }> = [
  { k: 'walkGate', label: 'Walk gate' }, { k: 'dblGate', label: 'Double gate' }, { k: 'tearOutSection', label: 'Tear out, per section' },
  { k: 'tearOutGate', label: 'Tear out, per gate' }, { k: 'extraHour', label: 'Extra hour' },
]

/** Their rates beside Settings', each blank to follow Settings; Reset takes their own off (as fence rate overrides). */
function Rates({ d, onSaved }: { d: SubDetail; onSaved: () => void }) {
  const st = d.rates.settings
  const unit = st.unit === 'section' ? 'section' : 'foot'
  const init = () => {
    const t: Record<string, string> = {}
    for (const c of d.rates.categories) t[`u:${c}`] = d.rates.own.perUnit?.[c] != null ? (d.rates.own.perUnit[c] / 100).toFixed(2) : ''
    for (const r of RATE_KEYS) t[r.k] = d.rates.own[r.k] != null ? (d.rates.own[r.k]! / 100).toFixed(2) : ''
    return t
  }
  const [t, setT] = useState(init)
  const [busy, setBusy] = useState(false)
  useEffect(() => setT(init()), [d])  // eslint-disable-line react-hooks/exhaustive-deps
  async function save(next = t) {
    const rates: SubRates = { perUnit: {} }
    for (const c of d.rates.categories) { const v = centsOf(next[`u:${c}`] ?? ''); if (v !== null) rates.perUnit![c] = v }
    for (const r of RATE_KEYS) { const v = centsOf(next[r.k] ?? ''); if (v !== null) rates[r.k] = v }
    setBusy(true)
    const r = await saveSub(d.sub.id, { ...d.sub, rates })
    setBusy(false)
    if (!r.ok) { toast.error('Not saved', r.error); return }
    toast.success('Rates saved', 'New jobs use them; Reset a job\'s pay to use them there.')
    onSaved()
  }
  const row = (key: string, label: string, settings: number) => (
    <div key={key} className="flex items-center gap-2" data-sub-rate={key}>
      <span className="flex-1 text-sm text-gray-800">{label}<span className="block text-xs text-gray-500">Settings: {money(settings)}</span></span>
      <input className="w-28 border border-gray-300 rounded-lg px-2 h-12 text-base" inputMode="decimal" placeholder={(settings / 100).toFixed(2)} value={t[key] ?? ''} onChange={e => setT(x => ({ ...x, [key]: e.target.value }))} aria-label={`${label}, their rate`} />
      {t[key] ? <button type="button" className="text-xs underline text-gray-600 min-h-[44px] min-w-[44px] px-2" onClick={() => { const n = { ...t, [key]: '' }; setT(n); void save(n) }}>Reset</button> : <span className="w-10" />}
    </div>
  )
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-sub-rates>
      <h3 className="text-sm font-semibold text-gray-900">Their rates</h3>
      <p className="text-xs text-gray-600">Blank follows Settings → Pricing → Subcontractor rates. Their own rate is used on jobs assigned from now on.</p>
      {d.rates.categories.map(c => row(`u:${c}`, `${c}, per ${unit}`, st.perUnit[c] || st.perUnitDefault))}
      {RATE_KEYS.map(r => row(r.k, r.label, st[r.k]))}
      <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={() => void save()} data-sub-rates-save>{busy ? 'Saving…' : 'Save rates'}</button>
    </section>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab() {
  const [s, setS] = useState<SubSettings | null>(null)
  const [text, setText] = useState('')
  const [months, setMonths] = useState('')
  const [types, setTypes] = useState<SubSettings['docTypes']>([])
  const [newType, setNewType] = useState('')
  const [busy, setBusy] = useState(false)
  const canChange = can('settings.change')
  const owner = signedInRole() === 'super_admin'
  const take = (v: SubSettings) => { setS(v); setText(v.agreement.text); setMonths(v.agreement.callbackMonths ? String(v.agreement.callbackMonths) : ''); setTypes(v.docTypes) }
  useEffect(() => { void subSettings().then(r => r.ok && take(r.data)) }, [])
  if (!s) return <p className="text-sm text-gray-500">Loading…</p>
  const a = s.agreement
  const changed = text !== a.text || months !== (a.callbackMonths ? String(a.callbackMonths) : '')
  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-subs-agreement>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Subcontractor Agreement v{a.version}</h2>
          <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${a.reviewedAt ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`} data-subs-review-state>{a.reviewedAt ? `Reviewed by ${a.reviewedBy}` : 'Attorney review required'}</span>
        </div>
        <p className="text-xs text-gray-600">It cannot be sent to a sub until you mark it reviewed. Changing the words or the months takes the review off.</p>
        <label className="block text-sm text-gray-800">Months the sub fixes their own workmanship callbacks at no charge
          <input className="block w-32 border border-gray-300 rounded-lg px-3 h-12 text-base mt-1" inputMode="numeric" value={months} onChange={e => setMonths(e.target.value.replace(/\D/g, ''))} disabled={!canChange} data-subs-months />
        </label>
        <textarea className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" rows={18} value={text} onChange={e => setText(e.target.value)} disabled={!canChange} data-subs-agreement-text />
        <div className="flex flex-wrap gap-2">
          {canChange && changed && <button type="button" className="btn btn-primary !min-h-[48px]" disabled={busy} onClick={async () => {
            setBusy(true)
            const r = await saveSubSettings({ agreement: { text, callbackMonths: months ? Number(months) : null } })
            setBusy(false)
            if (!r.ok) { toast.error('Not saved', r.error); return }
            take(r.data); toast.success('Saved', 'Mark it reviewed again before it is sent.')
          }} data-subs-agreement-save>Save the words</button>}
          {owner && !changed && <button type="button" className="btn btn-secondary !min-h-[48px]" onClick={async () => {
            if (!a.reviewedAt && !window.confirm('Mark the agreement reviewed by your attorney? Subs can then be sent it to sign.')) return
            const r = await markReviewed(!a.reviewedAt)
            if (!r.ok) { toast.error('Not changed', r.error); return }
            take(r.data)
          }} data-subs-mark-reviewed>{a.reviewedAt ? 'Take the review mark off' : 'Mark reviewed by attorney'}</button>}
        </div>
      </section>
      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-subs-lien-release-template>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Sub's final release of lien</h2>
          <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${s.reviews?.sub_lien_release ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`} data-subs-release-review>{s.reviews?.sub_lien_release ? `Reviewed by ${s.reviews.sub_lien_release.by}` : 'Attorney review required'}</span>
        </div>
        <p className="text-xs text-gray-600">Florida's statutory "Waiver and release of lien upon final payment" (s. 713.20(5)). The sub signs it on their link before you mark them paid; it cannot be sent until you mark it reviewed.</p>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{`WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT

The undersigned lienor, in consideration of the final payment in the amount of $(their pay), hereby waives and releases its lien and right to claim a lien for labor, services, or materials furnished to (your company) on the job of (the customer) to the following described property:

(the job's address)

DATED on (the day).

Lienor: (the sub)`}</pre>
        {owner && <button type="button" className="btn btn-secondary !min-h-[48px]" data-subs-release-mark onClick={async () => {
          const on = !s.reviews?.sub_lien_release
          if (on && !window.confirm('Mark the sub lien release reviewed by your attorney?')) return
          const r = await markReviewed(on, 'sub_lien_release')
          if (!r.ok) { toast.error('Not changed', r.error); return }
          take(r.data)
        }}>{s.reviews?.sub_lien_release ? 'Take the review mark off' : 'Mark reviewed by attorney'}</button>}
      </section>
      {/* Florida's lien notice addendum for contracts signed before the notice, not installed yet (Jonathan, Nov 6 2026): its own mark. */}
      {can('billing.change') && <AddendumReview owner={owner} />}
      {owner && (
        <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-subs-lien-templates>
          <h2 className="text-lg font-semibold text-gray-900">Lien papers (owner only)</h2>
          <p className="text-xs text-gray-600">Each is made from the job's facts when you tap it on the job (the lien clock). They cannot be made until your attorney has read them and you mark them reviewed.</p>
          {([['payment_reminder', 'reminder'], ['notice_of_intent', 'notice_of_intent'], ['claim_of_lien', 'claim_of_lien'], ['final_affidavit', 'final_affidavit'], ['owner_release', 'release']] as const).map(([key, kind]) => (
            <div key={key} className="py-1 border-b border-gray-100" data-subs-lien-template={key}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-900">{LIEN_KIND_LABEL[kind]}<span className={`block text-xs ${s.reviews?.[key] ? 'text-green-800' : 'text-red-700'}`}>{s.reviews?.[key] ? `Reviewed by ${s.reviews[key]!.by}` : 'Attorney review required'}</span></span>
              <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={async () => {
                const on = !s.reviews?.[key]
                if (on && !window.confirm(`Mark the ${LIEN_KIND_LABEL[kind]} reviewed by your attorney?`)) return
                const r = await markReviewed(on, key)
                if (!r.ok) { toast.error('Not changed', r.error); return }
                take(r.data)
              }}>{s.reviews?.[key] ? 'Take the mark off' : 'Mark reviewed'}</button>
            </div>
            <SampleWords kind={kind} />
            </div>
          ))}
        </section>
      )}
      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-subs-doc-types>
        <h2 className="text-lg font-semibold text-gray-900">Your own paper types</h2>
        <p className="text-xs text-gray-600">Besides W9, liability, workers' comp or the Florida exemption, the agreement and a license.</p>
        {types.map((t, i) => (
          <div key={t.key + i} className="flex items-center gap-2">
            <span className="flex-1 text-sm">{t.label}</span>
            <label className="text-xs text-gray-700 flex items-center gap-1 min-h-[44px]"><input type="checkbox" checked={t.expires} disabled={!canChange} onChange={e => setTypes(x => x.map((y, j) => (j === i ? { ...y, expires: e.target.checked } : y)))} />Expires</label>
            {canChange && <button type="button" className="text-xs underline text-gray-600 min-h-[44px]" onClick={() => setTypes(x => x.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        {canChange && <>
          <div className="flex gap-2"><input className="flex-1 border border-gray-300 rounded-lg px-3 h-12 text-base" placeholder="A new type, e.g. City of Ocala license" value={newType} onChange={e => setNewType(e.target.value)} />
            <button type="button" className="btn btn-secondary !min-h-[48px]" onClick={() => { if (newType.trim()) { setTypes(x => [...x, { key: newType.trim(), label: newType.trim(), expires: true }]); setNewType('') } }}>Add</button></div>
          <button type="button" className="btn btn-primary !min-h-[48px]" onClick={async () => {
            const r = await saveSubSettings({ docTypes: types })
            if (!r.ok) { toast.error('Not saved', r.error); return }
            take(r.data); toast.success('Saved', 'Paper types')
          }}>Save paper types</button>
        </>}
      </section>
    </div>
  )
}

/**
 * The customer lien notice addendum (713.015) for contracts signed before the notice and not installed yet: its own
 * attorney review mark (the owner's), and how many are prepared. Server: routes/lienAddenda.ts.
 */
function AddendumReview({ owner }: { owner: boolean }) {
  const [d, setD] = useState<{ reviewed: { at: string; by: string } | null; count: number; signed: number } | null>(null)
  const load = () => { void addendumList().then(r => r.ok && setD({ reviewed: r.data.reviewed, count: r.data.list.length, signed: r.data.list.filter(x => x.state === 'signed').length })) }
  useEffect(load, [])
  if (!d) return null
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" data-subs-addendum-template>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Customer lien notice addendum (713.015)</h2>
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${d.reviewed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`} data-subs-addendum-review>{d.reviewed ? `Reviewed by ${d.reviewed.by}` : 'Attorney review required'}</span>
      </div>
      <p className="text-xs text-gray-600">Prepared for {d.count} contract{d.count === 1 ? '' : 's'} signed over $2,500 without Florida's lien notice whose job is not installed yet{d.signed ? ` (${d.signed} signed)` : ''}: one page with the notice word for word, as on new contracts, naming the original contract, for the customer to sign on their link. It cannot be sent, and its links show nothing, until you mark it reviewed. Read it on any of those jobs (Lien notice); the list is on the Dashboard.</p>
      {owner && <button type="button" className="btn btn-secondary !min-h-[48px]" data-subs-addendum-mark onClick={async () => {
        const on = !d.reviewed
        if (on && !window.confirm('Mark the lien notice addendum reviewed by your attorney? The office can then send it to each customer on the list to sign.')) return
        if (!on && !window.confirm('Take the review mark off? Nothing can be sent, and the customer links show nothing, until you mark it again.')) return
        const r = await markAddendumReviewed(on)
        if (!r.ok) { toast.error('Not changed', r.error); return }
        load()
      }}>{d.reviewed ? 'Take the review mark off' : 'Mark reviewed by attorney'}</button>}
    </section>
  )
}

/** A lien paper's words with blanks, for the attorney to read before it is marked reviewed. */
function SampleWords({ kind }: { kind: Parameters<typeof lienSample>[0] }) {
  const [w, setW] = useState<{ title: string; text: string } | null>(null)
  return (
    <details onToggle={e => { if ((e.target as HTMLDetailsElement).open && !w) void lienSample(kind).then(r => r.ok && setW(r.data)) }}>
      <summary className="text-xs text-gray-700 underline min-h-[44px] flex items-center">Read the words</summary>
      {w ? <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded-lg p-3" data-subs-lien-words={kind}><b>{w.title}</b>{'\n\n'}{w.text}</pre> : <p className="text-xs text-gray-500">Loading…</p>}
    </details>
  )
}
