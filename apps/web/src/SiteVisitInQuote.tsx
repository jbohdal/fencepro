/**
 * In the quote builder, for a customer who had a site visit: the visit's
 * footage, notes and photos (the photos the phone's "How did it go?" form
 * uploaded to the customer), so the salesman quotes from what was seen
 * instead of starting over (Oct 24, 2026 walkthrough). Read only; the
 * photos stay on the customer's Photos tab.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getAppointments, APPOINTMENTS_UPDATED } from './appointmentsStore'
import { listCustomerPhotos, resolveFileUrl, type PortalPhotoRow } from './portalStaffApi'
import { floridaDate } from './appointmentLogic'
import { lastVisit, visitPhotos } from './quoteReuse'

const dayWords = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })

export default function SiteVisitInQuote({ customerId }: { customerId: string | null | undefined }) {
  const [appointments, setAppointments] = useState(getAppointments())
  useEffect(() => {
    const h = () => setAppointments(getAppointments())
    window.addEventListener(APPOINTMENTS_UPDATED, h)
    return () => window.removeEventListener(APPOINTMENTS_UPDATED, h)
  }, [])
  const visit = lastVisit(appointments, customerId)
  const [photos, setPhotos] = useState<PortalPhotoRow[]>([])
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!customerId) { setPhotos([]); return }
    let live = true
    listCustomerPhotos(customerId).then(p => { if (live) setPhotos(p) }).catch(() => {})
    return () => { live = false }
  }, [customerId])
  if (!visit) return null
  const at = visit.completedAt || visit.startAt
  const shown = visitPhotos(photos, at ? floridaDate(at) : null, iso => floridaDate(iso))
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden" data-site-visit={visit.id}>
      <button type="button" className="w-full min-h-[52px] flex items-center gap-2 px-3 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="flex-1 font-semibold text-gray-900">Site visit{at ? ` · ${dayWords(at)}` : ''}{visit.assignedTo ? ` · ${visit.assignedTo}` : ''}</span>
        {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {visit.measuredFeet ? <p className="text-sm text-gray-800" data-site-visit-feet={visit.measuredFeet}>Measured on site: about <span className="font-semibold">{visit.measuredFeet} ft</span></p> : null}
          {visit.outcomeNotes?.trim() ? <p className="text-sm text-gray-800 whitespace-pre-line" data-site-visit-notes>{visit.outcomeNotes.trim()}</p> : null}
          {shown.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-site-visit-photos={shown.length}>
              {shown.map(p => {
                const src = resolveFileUrl(p.fileUrl)
                return (
                  <a key={p.id} href={src} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100" aria-label={`Open the visit photo ${p.name}`}>
                    {src ? <img src={src} alt={p.caption || p.name} className="w-full h-full object-cover" loading="lazy" /> : null}
                  </a>
                )
              })}
            </div>
          ) : <p className="text-xs text-gray-500">No photos from the visit.</p>}
          <p className="text-xs text-gray-500">From the visit, as it was closed out. The photos are also on the customer's Photos tab.</p>
        </div>
      )}
    </div>
  )
}
