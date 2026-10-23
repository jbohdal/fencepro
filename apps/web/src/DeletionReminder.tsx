/**
 * Dashboard reminder for a deletion Jonathan scheduled (e.g. the duplicates
 * merged on Oct 17, kept 30 days): shown from the day before, with "Keep
 * them" to cancel. Owner and admins only (others get nothing back).
 */

import { useEffect, useState } from 'react'
import { isSignedIn, fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { toast } from './toast'

const API = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''

interface Scheduled { id: string; what: string; labels: string[]; count: number; remindOn: string; deleteOn: string }

const day = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function DeletionReminder() {
  const [rows, setRows] = useState<Scheduled[]>([])
  const [today, setToday] = useState('')

  useEffect(() => {
    let live = true
    if (!isSignedIn()) return
    fetchWithAuth(`${API}/api/scheduled-deletions`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live && j?.success) { setRows(j.data); setToday(j.today) } })
      .catch(() => { /* the reminder simply does not show */ })
    return () => { live = false }
  }, [])

  async function keep(id: string) {
    const r = await fetchWithAuth(`${API}/api/scheduled-deletions/${id}/cancel`, { method: 'POST' }).catch(() => null)
    if (r?.ok) { setRows(rs => rs.filter(x => x.id !== id)); toast.success('Kept', 'Nothing will be deleted.') }
    else toast.error('Could not cancel', 'Check the connection and try again.')
  }

  const due = rows.filter(r => today && today >= r.remindOn)
  if (!due.length) return null
  return (
    <div className="space-y-3" data-deletion-reminder>
      {due.map(r => (
        <div key={r.id} className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[16rem]">
            <p className="text-sm font-semibold text-amber-900">
              {today >= r.deleteOn ? 'Today' : `Tomorrow (${day(r.deleteOn)})`}: {r.count} record{r.count === 1 ? '' : 's'} will be deleted
            </p>
            <p className="text-sm text-amber-900">{r.what}{r.labels.length ? `: ${r.labels.join(', ')}` : ''}. A backup is taken first.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => keep(r.id)} data-deletion-keep>Keep them</button>
        </div>
      ))}
    </div>
  )
}
