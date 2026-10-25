/**
 * The Pullsheets tab on the customer page: every quote's and job's pull sheet
 * of this customer, read from the server (GET /api/pull-sheets/customer/<id>,
 * lib/customerPullSheets.ts) by the customer's id. Newest first, each with its
 * style, footage, status and date; a tap opens it. A sold job shows the pull
 * sheet frozen at signing, a note when an approved change order changed the
 * work, and the Final takeoff beside it once it was sent.
 *
 * The owner and office see unit costs and totals; a Salesman or Installer gets
 * quantities only from the server (the costs never reach the phone).
 * Print / PDF downloads the server's PDF; Share to crew makes (or refreshes) the
 * job's install packet link /p/i/<link> (installPacket.tsx).
 */

import { useEffect, useState } from 'react'
import { Printer, Users, Copy, ExternalLink } from 'lucide-react'
import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { getQuotes } from './quoteStore'
import { getJobs, getArchivedJobs } from './jobStore'
import { getConfig } from './configStore'
import { can } from './permissions'
import { toast } from './toast'
import RunSpacingTable from './RunSpacingTable'
import QuotePlan, { quoteHasPlan } from './QuotePlan'
import { sendInstallPacket, packetUrl } from './installPacket'
import { refreshChangeOrders, quoteWithChanges, CO_EVENT } from './ChangeOrders'
import { partWithPair } from '../../portal/src/server/lib/partNames'

const API = (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/pull-sheets'

interface Line { item: string; qty: number; moneyOnly?: boolean; unitCostCents?: number; totalCostCents?: number }
interface LineChange { item: string; was: number; now: number }
interface TakeoffLine { item: string; plannedQty: number; usedQty: number; shopReturnQty: number; vendorReturnQty: number; extra: boolean; note: string; unitCostCents?: number; totalCostCents?: number }
export interface PullSheetEntry {
  id: string; kind: 'quote' | 'job' | 'hand'; quoteId: string | null; jobId: string | null
  style: string; footageFt: number; sections: number; status: string; archived: boolean; date: string; source: string
  lines: Line[]; totalCostCents?: number; changeNote: string | null; packetToken: string | null
  /** Revised by approved change orders (from the yard drawing): this revision, what it changed, and every revision newest first. */
  revision?: number; changes?: LineChange[]; revisions?: Array<{ rev: number; title: string; date: string; source: string; lines: Line[]; totalCostCents?: number; changes: LineChange[] }>
  finalTakeoff: null | { status: 'submitted' | 'approved'; installDate: string; submittedBy: string | null; approvedBy: string | null; lines: TakeoffLine[]; materialCostCents?: number; costFrozen?: boolean }
}

const usd = (c: number | undefined) => (c == null ? '' : (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dayText = (d: string) => {
  const t = new Date(`${d.slice(0, 10)}T12:00:00`)
  return d && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
const STATUS_STYLE: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700', Sent: 'bg-blue-100 text-blue-800', Signed: 'bg-green-100 text-green-800', Sold: 'bg-green-100 text-green-800',
  Lost: 'bg-gray-100 text-gray-600', 'Linked by hand': 'bg-amber-100 text-amber-900',
}

export default function CustomerPullSheetsTab({ customerId }: { customerId: string }) {
  const [data, setData] = useState<{ quantitiesOnly: boolean; entries: PullSheetEntry[] } | null | 'error'>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = () => {
    fetchWithAuth(`${API}/customer/${encodeURIComponent(customerId)}`)
      .then(async r => { const j = await r.json().catch(() => null); setData(r.ok && j?.success ? j.data : 'error') })
      .catch(() => setData('error'))
  }
  useEffect(() => { setData(null); setOpenId(null); load() }, [customerId])

  if (data === null) return <p className="text-sm text-gray-500 py-6 text-center">Loading pull sheets…</p>
  if (data === 'error') return (
    <div className="text-center py-8 text-gray-600" data-pull-sheets-error>
      <p className="font-medium">Could not load the pull sheets.</p>
      <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => { setData(null); load() }}>Try again</button>
    </div>
  )
  const { entries } = data
  const costs = !data.quantitiesOnly
  const open = entries.find(e => e.id === openId) ?? null
  return (
    <div className="space-y-4" data-pull-sheets data-pull-sheets-costs={costs ? '1' : '0'}>
      {entries.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="font-medium">No pull sheets yet</p>
          <p className="text-sm mt-1">A pull sheet shows here as soon as a quote for this customer is saved.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {entries.map(e => (
            <button type="button" key={e.id} onClick={() => setOpenId(e.id === openId ? null : e.id)} data-pull-sheet={e.id}
              className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 ${e.id === openId ? 'bg-orange-50' : ''}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">{e.style || 'Fence'}</p>
                <p className="text-xs text-gray-500">
                  {[e.footageFt > 0 ? `${e.footageFt} ft` : '', e.kind === 'job' ? 'Job' : '', dayText(e.date), e.archived ? 'Archived' : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[e.status] ?? 'bg-gray-100 text-gray-700'}`} data-pull-sheet-status>{e.status}</span>
            </button>
          ))}
        </div>
      )}
      {open && <PullSheetView key={open.id} entry={open} costs={costs} customerId={customerId} onChanged={load} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function PullSheetView({ entry: e, costs, customerId, onChanged, onClose }: { entry: PullSheetEntry; costs: boolean; customerId: string; onChanged: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState<'' | 'pdf' | 'crew'>('')
  const [crewUrl, setCrewUrl] = useState(e.packetToken ? packetUrl(e.packetToken) : '')
  const signedQ = e.quoteId ? getQuotes().find(x => x.id === e.quoteId) : undefined
  // Revised by a change order: the plan and runs of the work now (ChangeOrders.tsx quoteWithChanges).
  const [coTick, setCoTick] = useState(0)
  useEffect(() => {
    if (!e.revision || !e.quoteId) return
    const h = () => setCoTick(t => t + 1)
    window.addEventListener(CO_EVENT, h)
    void refreshChangeOrders(e.quoteId)
    return () => window.removeEventListener(CO_EVENT, h)
  }, [e.revision, e.quoteId])
  void coTick
  const q = signedQ && e.revision ? quoteWithChanges(signedQ) : signedQ
  const lines = costs ? e.lines : e.lines.filter(l => !l.moneyOnly)
  const changedBy = new Map((e.changes ?? []).map(c => [c.item, c]))
  const removed = (e.changes ?? []).filter(c => c.now === 0)

  async function pdf() {
    setBusy('pdf')
    try {
      const r = await fetchWithAuth(`${API}/customer/${encodeURIComponent(customerId)}/${encodeURIComponent(e.id)}.pdf`)
      if (!r.ok) throw new Error(String(r.status))
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `Pull sheet - ${e.style || 'fence'}.pdf`.replace(/[\\/:*?"<>|]/g, '')
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      toast.error('Could not make the PDF. Check your connection and try again.')
    } finally { setBusy('') }
  }

  async function shareToCrew() {
    if (!e.jobId) return
    setBusy('crew')
    const job = [...getJobs(), ...getArchivedJobs()].find(j => j.id === e.jobId)
    const p = await sendInstallPacket(e.jobId, { fenceStyle: job?.fenceStyle ?? q?.fenceStyle, notes: job?.notes, walkGates: job?.walkGates, dblGates: job?.dblGates }, q)
    setBusy('')
    if (!p) { toast.error('Could not make the install packet. Try again.'); return }
    const url = packetUrl(p.token)
    setCrewUrl(url)
    navigator.clipboard?.writeText(url).then(() => toast.success('Crew link copied'), () => toast.success('Crew link ready'))
    onChanged()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4" data-pull-sheet-view={e.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 [overflow-wrap:anywhere]">{e.style || 'Fence'}</h3>
          <p className="text-xs text-gray-600">{[e.status, e.footageFt > 0 ? `${e.footageFt} ft` : '', e.sections ? `${e.sections} sections` : '', dayText(e.date)].filter(Boolean).join(' · ')}</p>
          <p className="text-xs text-gray-500 mt-0.5" data-pull-sheet-source>{e.source}</p>
        </div>
        <button type="button" onClick={onClose} className="btn btn-quiet btn-sm shrink-0">Close</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={pdf} disabled={busy !== ''} data-pull-sheet-pdf>
          <Printer size={16} aria-hidden="true" /> {busy === 'pdf' ? 'Making the PDF…' : 'Print / PDF'}
        </button>
        {e.kind === 'job' && e.jobId && can('packets.change') && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={shareToCrew} disabled={busy !== ''} data-pull-sheet-crew>
            <Users size={16} aria-hidden="true" /> {busy === 'crew' ? 'Making the link…' : 'Share to crew'}
          </button>
        )}
      </div>
      {crewUrl && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-pull-sheet-crew-link>
          <span className="text-gray-600">Crew link (install packet, no prices):</span>
          <span className="text-gray-800 break-all" data-pull-sheet-crew-url>{crewUrl}</span>
          <a className="btn btn-quiet btn-sm" href={crewUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open</a>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard?.writeText(crewUrl).then(() => toast.success('Link copied'))}><Copy size={14} aria-hidden="true" /> Copy</button>
        </div>
      )}
      {e.changeNote && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-pull-sheet-change>{e.changeNote}</p>}
      {q && q.runs?.length ? (
        <div className="space-y-3">
          {quoteHasPlan(q) && <QuotePlan quote={q} style={getConfig().fenceStyles.find(s => s.name === q.fenceStyle)} />}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">Runs and post spacing</p>
            <RunSpacingTable quote={q} />
          </div>
        </div>
      ) : null}
      <div className={e.finalTakeoff ? 'grid gap-4 xl:grid-cols-2' : ''}>
        <section>
          <h4 className="text-sm font-semibold text-gray-800 mb-1" data-pull-sheet-rev={e.revision ?? 1}>{e.kind === 'job' ? (e.revision ? `Pull sheet rev ${e.revision} (changes marked)` : 'Pull sheet as signed') : 'Pull sheet'}</h4>
          {lines.length === 0 ? <p className="text-sm text-gray-500">No pull sheet lines.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-pull-sheet-lines>
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-2 py-2 text-xs text-gray-500">Material</th>
                    <th className="text-right px-2 py-2 text-xs text-gray-500">Qty</th>
                    {costs && <th className="text-right px-2 py-2 text-xs text-gray-500">Unit cost</th>}
                    {costs && <th className="text-right px-2 py-2 text-xs text-gray-500">Total</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${changedBy.has(l.item) ? 'bg-amber-50' : ''}`} {...(changedBy.has(l.item) ? { 'data-pull-sheet-changed': l.item } : {})}>
                      <td className="px-2 py-1.5 [overflow-wrap:anywhere]">{partWithPair(l.item)}{l.moneyOnly && <span className="text-xs text-gray-500"> (money only, not pulled)</span>}{changedBy.has(l.item) && <span className="text-xs font-semibold text-amber-900"> {changedBy.get(l.item)!.was ? `(was ${qtyText(changedBy.get(l.item)!.was)})` : '(new)'}</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyText(l.qty)}</td>
                      {costs && <td className="px-2 py-1.5 text-right tabular-nums">{usd(l.unitCostCents)}</td>}
                      {costs && <td className="px-2 py-1.5 text-right tabular-nums font-medium">{usd(l.totalCostCents)}</td>}
                    </tr>
                  ))}
                </tbody>
                {costs && <tfoot><tr className="font-semibold"><td colSpan={3} className="px-2 py-2 text-right">Total</td><td className="px-2 py-2 text-right tabular-nums" data-pull-sheet-total>{usd(e.totalCostCents)}</td></tr></tfoot>}
              </table>
            </div>
          )}
          {removed.length > 0 && <p className="text-xs text-amber-900 mt-1" data-pull-sheet-removed>Taken off by the change: {removed.map(c => `${c.item} (was ${qtyText(c.was)})`).join(', ')}.</p>}
          {e.revisions && e.revisions.length > 1 && (
            <details className="mt-2" data-pull-sheet-history>
              <summary className="text-xs font-semibold text-gray-700 min-h-[44px] flex items-center cursor-pointer">Earlier revisions ({e.revisions.length - 1})</summary>
              <div className="space-y-3 mt-1">
                {e.revisions.slice(1).map(r => (
                  <div key={r.rev} className="border border-gray-100 rounded-lg p-2" data-pull-sheet-old-rev={r.rev}>
                    <p className="text-xs font-semibold text-gray-700">{r.title} · {dayText(r.date)}</p>
                    <ul className="text-xs text-gray-600 mt-1">{(costs ? r.lines : r.lines.filter(l => !l.moneyOnly)).map((l, i) => <li key={i}>{qtyText(l.qty)} × {partWithPair(l.item)}</li>)}</ul>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
        {e.finalTakeoff && (
          <section data-pull-sheet-takeoff>
            <h4 className="text-sm font-semibold text-gray-800 mb-1">Final takeoff</h4>
            <p className="text-xs text-gray-600 mb-1">
              {e.finalTakeoff.status === 'approved' ? `Approved${e.finalTakeoff.approvedBy ? ` by ${e.finalTakeoff.approvedBy}` : ''}` : `Sent${e.finalTakeoff.submittedBy ? ` by ${e.finalTakeoff.submittedBy}` : ''}, not approved yet`}
              {e.finalTakeoff.installDate ? ` · installed ${dayText(e.finalTakeoff.installDate)}` : ''}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-2 py-2 text-xs text-gray-500">Material</th>
                    <th className="text-right px-2 py-2 text-xs text-gray-500">Planned</th>
                    <th className="text-right px-2 py-2 text-xs text-gray-500">Used</th>
                    <th className="text-right px-2 py-2 text-xs text-gray-500">To shop</th>
                    <th className="text-right px-2 py-2 text-xs text-gray-500">To vendor</th>
                    {costs && <th className="text-right px-2 py-2 text-xs text-gray-500">Cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {e.finalTakeoff.lines.map((l, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-2 py-1.5 [overflow-wrap:anywhere]">{partWithPair(l.item)}{l.extra && <span className="text-xs text-gray-500"> (added on the job)</span>}{l.note && <span className="block text-xs text-gray-500">{l.note}</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyText(l.plannedQty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyText(l.usedQty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyText(l.shopReturnQty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{qtyText(l.vendorReturnQty)}</td>
                      {costs && <td className="px-2 py-1.5 text-right tabular-nums">{usd(l.totalCostCents)}</td>}
                    </tr>
                  ))}
                </tbody>
                {costs && e.finalTakeoff.materialCostCents != null && (
                  <tfoot><tr className="font-semibold"><td colSpan={5} className="px-2 py-2 text-right">{e.finalTakeoff.costFrozen ? 'Actual material cost' : 'Actual material cost (preview until approved)'}</td><td className="px-2 py-2 text-right tabular-nums">{usd(e.finalTakeoff.materialCostCents)}</td></tr></tfoot>
                )}
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
