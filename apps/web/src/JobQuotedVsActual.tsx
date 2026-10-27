/**
 * Job cost on the job's page, owner and office only: the quoted cost (as
 * signed) next to the actual cost (the approved takeoff on the install date's
 * landed costs), line by line with the differences, and the actual profit and
 * margin. A job with no takeoff says "No takeoff"; a quote signed before job
 * costing says it has no quoted cost. Nothing is guessed.
 *
 * Nothing renders for a Salesman or Installer, and the server refuses them
 * (routes/job-costing.ts).
 */

import { useEffect, useState, useCallback } from 'react'
import { partWithPair } from '../../portal/src/server/lib/partNames'
import { useCan } from './permissions'
import { loadJobCost, usd, TAKEOFF_EVENT, type JobCost, type CompareRow } from './takeoffStore'
import { CO_EVENT } from './ChangeOrders'

const pct = (n: number) => `${n.toFixed(1)}%`
const q2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')
const signed = (c: number) => (c > 0 ? `+${usd(c)}` : usd(c))
const SOURCE: Record<string, string> = { invoice: 'invoice', job_lot: 'job lot invoice', inventory: 'Inventory', quote: 'as quoted', none: 'no cost found' }

export default function JobQuotedVsActual({ jobId }: { jobId: string }) {
  const allowed = useCan('costs.view')
  const [data, setData] = useState<JobCost | null | undefined>(undefined)
  const load = useCallback(() => { loadJobCost(jobId).then(setData).catch(() => setData(null)) }, [jobId])
  useEffect(() => {
    if (!allowed) return
    load()
    // A takeoff approved or changed on this screen: look again.
    let t: ReturnType<typeof setTimeout> | null = null
    const again = () => { if (t) clearTimeout(t); t = setTimeout(load, 800) }
    window.addEventListener(TAKEOFF_EVENT, again)
    // A change order signed, approved or voided on this screen changes the quoted cost and the price: look again
    // (round 3 recheck: it showed the cost before the customer signed until the page was reloaded).
    window.addEventListener(CO_EVENT, again)
    return () => { window.removeEventListener(TAKEOFF_EVENT, again); window.removeEventListener(CO_EVENT, again); if (t) clearTimeout(t) }
  }, [allowed, load])
  if (!allowed) return null

  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-3" data-job-cost={data === undefined ? 'loading' : data ? (data.takeoff?.status ?? 'none') : 'error'}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">Job cost: quoted vs actual</h3>
        {data?.takeoff && <span className="text-xs text-gray-500">Install {data.takeoff.installDate}</span>}
      </div>
      {data === undefined && <p className="text-xs text-gray-500">Loading…</p>}
      {data === null && <p className="text-xs text-red-700">Could not load the job cost. Check the connection.</p>}
      {data && <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: JobCost }) {
  const c = d.comparison
  const status = d.takeoff?.status
  return (
    <>
      {!d.hasQuoted && <p className="text-xs text-gray-600" data-no-quoted>No quoted cost: this quote was signed before job costing started.</p>}
      {!d.takeoff && <p className="text-sm font-semibold text-gray-700" data-no-takeoff>No takeoff</p>}
      {d.takeoff && status !== 'approved' && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5" data-cost-preview>Takeoff {status === 'submitted' ? 'sent, waiting for approval' : 'in progress'}: the actual cost below is a preview from the landed costs on the install date. It is frozen when approved.</p>}
      {status === 'approved' && <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5">Approved{d.takeoff?.approvedBy ? ` by ${d.takeoff.approvedBy}` : ''}. The actual cost is frozen.</p>}

      <div className="grid grid-cols-2 gap-2" data-cost-summary>
        <Tile label="Quoted cost" value={c.quoted ? usd(c.quoted.totalCents) : '—'} sub={c.quoted ? `Price ${usd(c.quoted.priceCents)}` : 'No quoted cost'} />
        <Tile label="Actual cost" value={c.actual ? usd(c.actual.totalCents) : 'No takeoff'} sub={c.actual ? `Price ${usd(c.actual.priceCents)}` : ''} testId="actual-total" />
        <Tile label="Quoted profit" value={c.quoted ? usd(c.quoted.profitCents) : '—'} sub={c.quoted ? `${pct(c.quoted.marginPct)} margin` : ''} />
        <Tile label="Actual profit" value={c.actual ? usd(c.actual.profitCents) : '—'} sub={c.actual ? `${pct(c.actual.marginPct)} margin` : ''} tone={c.actual && c.quoted ? (c.actual.profitCents < c.quoted.profitCents ? 'bad' : 'good') : undefined} testId="actual-profit" />
      </div>
      {c.diffCents != null && (
        <p className={`text-sm font-semibold ${c.diffCents > 0 ? 'text-red-700' : 'text-green-700'}`} data-cost-diff={c.diffCents}>
          Actual is {usd(Math.abs(c.diffCents))} {c.diffCents > 0 ? 'over' : 'under'} the quote{c.quoted && c.actual ? ` · margin ${pct(c.quoted.marginPct)} → ${pct(c.actual.marginPct)}` : ''}
        </p>
      )}

      {(c.rows.length > 0 || c.quoted || c.actual) && (
        <div className="space-y-1.5" data-cost-lines>
          <p className="text-xs font-semibold text-gray-500">Line by line</p>
          {c.rows.map((r, i) => <Row key={`${r.part}:${i}`} r={r} hasActual={!!c.actual} />)}
          <Totals label="Labor" quoted={c.quoted?.laborCents} actual={c.actual?.laborCents} note={c.actual?.laborMath} />
          {(c.quoted?.tearOutCents || 0) > 0 && <Totals label="Tear out (as quoted)" quoted={c.quoted?.tearOutCents} actual={c.actual?.tearOutCents} />}
          {(c.quoted?.otherMaterialCents || 0) > 0 && <Totals label="Other material on the quote (as quoted)" quoted={c.quoted?.otherMaterialCents} actual={c.actual?.otherMaterialCents} />}
          <Totals label="Total" quoted={c.quoted?.totalCents} actual={c.actual?.totalCents} bold />
        </div>
      )}
    </>
  )
}

function Tile({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad'; testId?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 p-2 min-w-0" data-cost-tile={testId}>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-base font-bold tabular-nums truncate ${tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-green-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
    </div>
  )
}

function Row({ r, hasActual }: { r: CompareRow; hasActual: boolean }) {
  const off = hasActual && (r.qtyDiff !== 0 || r.diffCostCents !== 0)
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-xs ${r.extra ? 'border-orange-300 bg-orange-50' : off ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`} data-cost-row={r.part} data-cost-row-diff={r.diffCostCents}>
      <p className="font-medium text-gray-900 break-words">{partWithPair(r.part)}{r.extra ? ' (added on the job)' : ''}</p>
      <div className="grid grid-cols-3 gap-1 mt-0.5 tabular-nums">
        <span className="text-gray-600">Qty {q2(r.plannedQty)} → {hasActual ? q2(r.usedQty) : '—'}{hasActual && r.qtyDiff !== 0 ? <b className={r.qtyDiff > 0 ? ' text-red-700' : ' text-green-700'}> ({r.qtyDiff > 0 ? '+' : ''}{q2(r.qtyDiff)})</b> : null}</span>
        <span className="text-gray-600 text-right">{usd(r.quotedCostCents)} → {hasActual ? usd(r.actualCostCents) : '—'}</span>
        <span className={`text-right font-semibold ${r.diffCostCents > 0 ? 'text-red-700' : r.diffCostCents < 0 ? 'text-green-700' : 'text-gray-500'}`}>{hasActual ? signed(r.diffCostCents) : ''}</span>
      </div>
      {hasActual && (r.shopReturnQty > 0 || r.vendorReturnQty > 0 || (r.costSource && r.costSource !== 'inventory')) && (
        <p className="text-[11px] text-gray-500 mt-0.5">
          {r.shopReturnQty > 0 ? `${q2(r.shopReturnQty)} back to shop · ` : ''}{r.vendorReturnQty > 0 ? `${q2(r.vendorReturnQty)} back to vendor · ` : ''}{r.costSource ? `cost from ${SOURCE[r.costSource] ?? r.costSource}` : ''}{r.actualUnitCostCents ? ` (${usd(r.actualUnitCostCents)} each)` : ''}
        </p>
      )}
    </div>
  )
}

function Totals({ label, quoted, actual, note, bold }: { label: string; quoted?: number; actual?: number; note?: string; bold?: boolean }) {
  const diff = quoted != null && actual != null ? actual - quoted : null
  return (
    <div className={`rounded-lg border border-gray-200 px-2 py-1.5 text-xs ${bold ? 'bg-gray-100 font-semibold' : ''}`} data-cost-total={label}>
      <div className="grid grid-cols-3 gap-1 tabular-nums">
        <span className="text-gray-900">{label}</span>
        <span className="text-right text-gray-700">{quoted != null ? usd(quoted) : '—'} → {actual != null ? usd(actual) : '—'}</span>
        <span className={`text-right ${diff && diff > 0 ? 'text-red-700' : diff && diff < 0 ? 'text-green-700' : 'text-gray-500'}`}>{diff != null ? signed(diff) : ''}</span>
      </div>
      {note && <p className="text-[11px] text-gray-500 mt-0.5">{note}</p>}
    </div>
  )
}
