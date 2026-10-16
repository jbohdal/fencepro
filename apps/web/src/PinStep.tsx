/**
 * After a capture: "Where were you standing?" One tap on the site plan, or
 * Skip. When the plan is lined up on the aerial photo and the phone knows its
 * position, a suggested pin is shown there to confirm or move; it is never
 * placed from GPS alone. The pin points the way the camera faced when that
 * is known: from the aerial photo's north, or from the one time setting
 * "stand at the house, point the phone at the back fence".
 */

import { useEffect, useRef, useState } from 'react'
import SitePlan from './SitePlan'
import { aerialUrl, aerialFtPerPx, AERIAL_PX } from './sitePlanGeometry'
import { deriveLayout, type YardLayout, type PlanPoint } from './yardLayout'
import { feetFrom, watchHeading, askForCompass } from './sensors'
import type { MediaPin } from './mediaStore'

/** Which way a compass heading points on this plan (0 = up the page), or null. */
export function planAngle(layout: YardLayout, heading: number | null | undefined): number | null {
  if (heading == null || !Number.isFinite(heading)) return null
  if (layout.plan?.aerial) return ((heading % 360) + 360) % 360
  const ref = layout.plan?.facingRef
  return ref == null ? null : (((heading - ref) % 360) + 360) % 360
}

export default function PinStep({ layout, onLayout, count, gps, heading, existing, onPin, onSkip }: {
  layout: YardLayout
  onLayout: (l: YardLayout) => void
  count: number
  gps: { lat: number; lng: number; accuracyM?: number | null } | null
  heading: number | null
  /** Pins already on the plan, for reference. */
  existing: Array<{ id: string; x: number; y: number; angle?: number | null }>
  onPin: (pin: MediaPin) => void
  onSkip: () => void
}) {
  const aerial = layout.plan?.aerial
  const suggested = aerial && gps ? feetFrom(aerial, gps) : null
  const [spot, setSpot] = useState<PlanPoint | null>(suggested)
  const [setting, setSetting] = useState(false)
  const live = useRef<number | null>(heading)
  useEffect(() => (setting ? watchHeading(h => { live.current = h }) : undefined), [setting])
  const angle = planAngle(layout, heading)
  const result = deriveLayout(layout)

  async function setDirection() {
    if (!setting) { await askForCompass(); setSetting(true); return }
    if (live.current == null) { alert('The phone has not reported a direction. Move it in a figure eight and try again.'); return }
    onLayout({ ...layout, plan: { ...(layout.plan ?? {}), facingRef: Math.round(live.current) } })
    setSetting(false)
  }

  return (
    <div className="fixed inset-0 z-[86] bg-black/50 flex items-end md:items-center justify-center" data-pin-step>
      <div className="bg-white w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl p-4 pb-[max(16px,env(safe-area-inset-bottom))] max-h-[94vh] overflow-y-auto">
        <p className="text-lg font-bold text-gray-900">Where were you standing?</p>
        <p className="text-sm text-gray-600 mb-2">
          {count} {count === 1 ? 'capture' : 'captures'}. Tap the spot on the plan.
          {suggested ? ' The pin is where the phone thinks you were (GPS is good to about 10 to 30 ft); move it if it is off.' : ''}
        </p>
        <SitePlan
          layout={layout} result={result}
          aerial={aerial ? { href: aerialUrl(aerial.lat, aerial.lng, aerial.halfM), ftPerPx: aerialFtPerPx(aerial.halfM), sizePx: AERIAL_PX } : null}
          pins={[...existing, ...(spot ? [{ id: 'new', x: spot.x, y: spot.y, angle, highlight: true }] : [])]}
          onPlanTap={pt => setSpot(pt)}
        />
        {!aerial && heading != null && layout.plan?.facingRef == null && (
          <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-2 text-sm" data-facing-setup>
            {setting ? <p>Stand at the house, point the phone at the back fence, and tap OK.</p> : <p>To draw which way each photo faces, set the direction once for this quote.</p>}
            <button type="button" className="btn btn-secondary btn-sm mt-1" onClick={setDirection}>{setting ? 'OK' : 'Set the direction'}</button>
          </div>
        )}
        {angle == null && <p className="text-xs text-gray-500 mt-1">No facing direction for this one, so the pin is a dot.</p>}
        <div className="flex gap-2 mt-3">
          <button type="button" className="btn btn-secondary flex-1" onClick={onSkip} data-pin-skip>Skip</button>
          <button type="button" className="btn btn-primary flex-1" disabled={!spot} onClick={() => spot && onPin({ x: Math.round(spot.x * 10) / 10, y: Math.round(spot.y * 10) / 10, angle })} data-pin-save>Pin here</button>
        </div>
      </div>
    </div>
  )
}
