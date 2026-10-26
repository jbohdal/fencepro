/**
 * In the quote builder, for a customer who had a site visit: the visit's
 * footage, notes and photos (the photos the phone's "How did it go?" form
 * saved on the customer), so the salesman quotes from what was seen
 * instead of starting over (Oct 24, 2026 walkthrough). Read only here. Since
 * Oct 26, 2026 the visit's photos are the customer's photos and video, so they
 * are also under the quote's camera (and count toward a repair proposal's
 * photos); visits before that kept them on the customer's Photos tab, shown
 * here too.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getAppointments, APPOINTMENTS_UPDATED } from './appointmentsStore'
import { listCustomerPhotos, resolveFileUrl, type PortalPhotoRow } from './portalStaffApi'
import { floridaDate } from './appointmentLogic'
import { lastVisit, visitPhotos } from './quoteReuse'
import { listMedia, isCustomersOwn, MEDIA_EVENT, type ServerMedia } from './mediaStore'

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
  const [media, setMedia] = useState<ServerMedia[]>([])
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!customerId) { setPhotos([]); setMedia([]); return }
    let live = true
    listCustomerPhotos(customerId).then(p => { if (live) setPhotos(p) }).catch(() => {})
    const loadMedia = () => { listMedia({ customerId }).then(m => { if (live) setMedia(m) }).catch(() => {}) }
    loadMedia()
    // The visit's photos upload in the background after the form is saved: shown once they arrive.
    window.addEventListener(MEDIA_EVENT, loadMedia)
    return () => { live = false; window.removeEventListener(MEDIA_EVENT, loadMedia) }
  }, [customerId])
  if (!visit) return null
  const at = visit.completedAt || visit.startAt
  const day = at ? floridaDate(at) : null
  // The visit's photos: the form's (captioned "… visit"), else the customer's own taken that day; older visits' on the Photos tab.
  const own = media.filter(m => m.kind === 'photo' && !!customerId && isCustomersOwn(m, customerId))
  const fromForm = own.filter(m => /\bvisit$/i.test((m.caption || '').trim()))
  const ownShown = (fromForm.length ? fromForm : day ? own.filter(m => floridaDate(m.takenAt) === day) : [])
    .map(m => ({ id: m.id, src: m.thumbUrl || m.url, alt: m.caption || m.category || 'Visit photo', name: m.caption || 'photo', at: m.takenAt }))
  const legacy = visitPhotos(photos, day, iso => floridaDate(iso))
    .map(p => ({ id: p.id, src: resolveFileUrl(p.fileUrl), alt: p.caption || p.name, name: p.name, at: p.uploadedAt }))
  const shown = [...ownShown, ...legacy].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
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
              {shown.map(p => (
                <a key={p.id} href={p.src} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100" aria-label={`Open the visit photo ${p.name}`}>
                  {p.src ? <img src={p.src} alt={p.alt} className="w-full h-full object-cover" loading="lazy" /> : null}
                </a>
              ))}
            </div>
          ) : <p className="text-xs text-gray-500">No photos from the visit.</p>}
          <p className="text-xs text-gray-500">From the visit, as it was closed out. Its photos are also under the quote's camera button: mark the ones the customer should see as Customer there.</p>
        </div>
      )}
    </div>
  )
}
