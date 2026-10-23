/**
 * The customer page's "MyBudgetQuote history": what the old online quote tool
 * knew about this customer (GET /api/crm-contacts/:id/import-history, one row
 * per request in Jonathan's import file). The flags the file carried (staff
 * entered the contact, contact cleared, several addresses, old status) show
 * in amber. Nothing shows for a customer no import touched.
 */
import { useEffect, useState } from 'react'
import { listImportHistory, type ImportHistoryRecord } from './crmContactsApi'

const SOURCE_NAME: Record<string, string> = { mybudgetquote: 'MyBudgetQuote' }
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const dollars = (cents: unknown) => (typeof cents === 'number' ? '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '')

function estimate(d: Record<string, unknown>): string {
  const lo = dollars(d.lowEstimateCents), hi = dollars(d.highEstimateCents)
  if (!lo && !hi) return 'none (the quote was not finished)'
  return `${lo && hi && lo !== hi ? `${lo} to ${hi}` : lo || hi}${str(d.estimate_date) ? ` (${str(d.estimate_date)})` : ''}`
}

export default function ImportHistoryCard({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<ImportHistoryRecord[] | null>(null)
  useEffect(() => {
    let live = true
    setRows(null)
    void listImportHistory(customerId).then(r => { if (live) setRows(r) })
    return () => { live = false }
  }, [customerId])
  if (!rows?.length) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4" data-import-history>
      <h3 className="font-bold text-gray-900">{SOURCE_NAME[rows[0].source] ?? rows[0].source} history</h3>
      {rows.map(r => {
        const d = r.data
        const flags = Array.isArray(d.flagList) ? (d.flagList as unknown[]).map(str).filter(Boolean) : []
        const lines: Array<[string, string]> = [
          ['Old online estimate', estimate(d)],
          ['Old tool status', str(d.old_tool_status)],
          ['Furthest step', str(d.furthest_step)],
          ['Finished the quote', str(d.finished_quote)],
          ['Requests', `${str(d.request_count) || '1'}${str(d.first_request_date) ? `, first ${str(d.first_request_date)}` : ''}${str(d.latest_date) ? `, latest ${str(d.latest_date)}` : ''}`],
          ['Lead source there', `${str(d.lead_source)}${str(d.source_other) ? ` ("${str(d.source_other)}")` : ''}`],
          ['Best time to contact', str(d.best_time_to_contact)],
          ['Their notes', str(d.customer_notes)],
          ['Attachments', str(d.has_attachments) === 'yes' ? 'yes (in the old tool, not copied)' : ''],
          ['As the old tool had them', r.matched ? [`${str(d.first_name)} ${str(d.last_name)}`.trim(), str(d.phone), str(d.email), str(d.address)].filter(Boolean).join(', ') : ''],
          ['Matched by', r.matched ? str(r.matchedBy) : ''],
          ['Card', d.card ? str(d.card) : `none, ${str(d.cardWhy)}`],
          ['Old tool ids', Array.isArray(d.oldToolIdList) ? (d.oldToolIdList as unknown[]).map(str).join(', ') : r.sourceKey],
        ]
        return (
          <div key={r.id} className="space-y-1.5" data-import-history-row={r.sourceKey}>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-import-flags>
                {flags.map(f => <span key={f} className="text-xs bg-amber-50 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">{f}</span>)}
              </div>
            )}
            {lines.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex gap-4">
                <span className="text-xs text-gray-400 w-28 sm:w-32 shrink-0 pt-0.5">{k}</span>
                <span className="text-sm text-gray-800 min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">{v}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
