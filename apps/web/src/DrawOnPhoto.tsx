/**
 * Draw on photo, in the quote builder: the website quote's own drawing tool
 * (widget/DrawMap.tsx: tap the corners on the aerial photo, true ground
 * lengths, the magnifier, straight and square snapping, gates) to start the
 * yard. "Use this drawing" fills the side list: a side per drawn side with
 * the length the photo measured (or the one typed on it), the angles as
 * drawn and the plan placed on the photo (widgetDraw.ts toYardLayout). The
 * salesman can still type exact lengths after: the typed length wins and the
 * angles stay (yardChain.ts).
 */

import { useEffect, useState } from 'react'
import DrawMap from './widget/DrawMap'
import { lookupPosition } from './appointmentsStore'
import { prefetchAerial } from './aerialTiles'
import { drawingProblem, toYardLayout, totalFt, type LatLng, type WidgetDrawing } from './widgetDraw'
import type { YardLayout } from './yardLayout'

export default function DrawOnPhoto({ address, onUse, onClose }: {
  address: string
  onUse: (yard: YardLayout) => void
  onClose: () => void
}) {
  const [at, setAt] = useState<LatLng | null>(null)
  const [msg, setMsg] = useState('Finding the address…')
  const [drawing, setDrawing] = useState<WidgetDrawing | null>(null)
  const [snap, setSnap] = useState(true)
  const [drawingRun, setDrawingRun] = useState(false)

  useEffect(() => {
    let live = true
    if (!address.trim()) { setMsg('Type the property address first (the aerial photo opens on it).'); return }
    lookupPosition(address.trim()).then(p => {
      if (!live) return
      if (!p) { setMsg('That address was not found. Check it, or add the city and ZIP.'); return }
      prefetchAerial(p.lat, p.lng, { w: 900, h: 600 })
      setAt({ lat: p.lat, lng: p.lng })
      setDrawing({ v: 1, address: address.trim(), at: { lat: p.lat, lng: p.lng }, runs: [] })
      setMsg('')
    }).catch(() => { if (live) setMsg('That address was not found. Check it, or add the city and ZIP.') })
    return () => { live = false }
  }, [address])

  const problem = drawing ? drawingProblem(drawing) : 'Draw the fence on the photo first.'
  function use() {
    if (!drawing || problem) return
    // The corners stay exactly where they were tapped on the photo until the drawing is edited.
    onUse(toYardLayout(drawing))
  }

  return (
    <div className="rounded-2xl border-2 border-orange-300 bg-white p-3 space-y-3" data-draw-on-photo>
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-gray-900">Draw on photo</p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} data-draw-on-photo-cancel>Cancel</button>
      </div>
      {msg && <p className="text-sm text-amber-800" data-draw-on-photo-msg>{msg}</p>}
      {at && drawing && (
        <DrawMap at={at} drawing={drawing} onChange={setDrawing} snap={snap} onSnap={setSnap} parcel={null} houseAt={null} onActiveChange={setDrawingRun} />
      )}
      {drawing && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">Lengths are measured on the photo. You can type exact lengths on the sides after; the angles stay as drawn.</p>
          <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={!!problem || drawingRun} onClick={use} data-draw-on-photo-use>
            Use this drawing{drawing.runs.length ? ` (${totalFt(drawing).toLocaleString('en-US')} ft)` : ''}
          </button>
          {drawingRun && <p className="text-xs text-gray-600">Tap Done on the photo to finish the run first.</p>}
        </div>
      )}
    </div>
  )
}
