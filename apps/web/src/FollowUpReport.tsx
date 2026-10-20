/**
 * Reports > Sales Performance > Follow ups: follow ups done vs missed per
 * rep, average touches (calls and texts logged) to close, and the dollars
 * sitting in Estimating and Pending Signature cards with no follow up set.
 *
 *   Done     answered on or before the day it was due
 *   Missed   answered after that day, plus the ones overdue now
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { today as todayFL } from './followUpStore'
import { addDays } from './followUpRules'

interface Rep { repId: string | null; rep: string; onTime: number; late: number; overdueNow: number; done: number; missed: number; calls: number; signed: number; touchesToClose: number | null; noFollowUpCents: number; noFollowUpCards: number }
interface Report { from: string; to: string; reps: Rep[]; totals: { done: number; missed: number; calls: number; signed: number; touchesToClose: number | null; noFollowUpCents: number; noFollowUpCards: number } }

const fmtUSD = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)

export default function FollowUpReport() {
  const [days, setDays] = useState(30)
  const [r, setR] = useState<Report | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const to = todayFL(), from = addDays(to, -(days - 1))
    setError('')
    sendJson('GET', `/api/follow-ups/report?from=${from}&to=${to}`).then(x => { if (x.result.ok) setR(x.json.data); else setError('Could not load the follow up report. Check the connection.') })
  }, [days])
  const pct = (a: number, b: number) => (a + b ? `${Math.round((a / (a + b)) * 100)}%` : '—')
  return (
    <div className="space-y-4" data-follow-up-report>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-gray-900">Follow ups</h3>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-gray-300 rounded-lg h-10 px-2 text-sm bg-white" aria-label="Period">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Done on time" value={String(r.totals.done)} sub={`${pct(r.totals.done, r.totals.missed)} of follow ups`} />
            <Tile label="Missed" value={String(r.totals.missed)} sub="late or overdue now" tone={r.totals.missed ? 'red' : undefined} />
            <Tile label="Average touches to close" value={r.totals.touchesToClose === null ? '—' : String(r.totals.touchesToClose)} sub={`${r.totals.signed} signed`} />
            <Tile label="No follow up set" value={fmtUSD(r.totals.noFollowUpCents)} sub={`${r.totals.noFollowUpCards} open cards`} tone={r.totals.noFollowUpCards ? 'orange' : undefined} />
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs font-semibold text-gray-600">
                  <th className="px-3 py-2">Rep</th><th className="px-3 py-2 text-right">Done</th><th className="px-3 py-2 text-right">Late</th><th className="px-3 py-2 text-right">Overdue now</th>
                  <th className="px-3 py-2 text-right">Calls and texts</th><th className="px-3 py-2 text-right">Signed</th><th className="px-3 py-2 text-right">Touches to close</th><th className="px-3 py-2 text-right">No follow up set</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.reps.map(x => (
                  <tr key={x.repId ?? 'none'} data-report-rep={x.rep}>
                    <td className="px-3 py-2 font-medium text-gray-900">{x.rep}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.done}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.late}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${x.overdueNow ? 'text-red-700 font-semibold' : ''}`}>{x.overdueNow}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.calls}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.signed}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.touchesToClose ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(x.noFollowUpCents)} <span className="text-gray-500">({x.noFollowUpCards})</span></td>
                  </tr>
                ))}
                {r.reps.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No follow ups in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">Done: answered on or before the day it was due. Missed: answered later, or overdue now. Touches: calls and texts logged on a card up to its signing. {r.from} to {r.to}.</p>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'red' | 'orange' }) {
  return (
    <div className={`bg-white rounded-2xl border p-4 ${tone === 'red' ? 'border-red-200' : tone === 'orange' ? 'border-orange-200' : 'border-gray-200'}`}>
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === 'red' ? 'text-red-700' : tone === 'orange' ? 'text-orange-700' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  )
}
