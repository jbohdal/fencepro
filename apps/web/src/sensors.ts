/**
 * Where the phone is and which way its camera faces, when the person allows
 * it. GPS is good to roughly 10 to 30 ft on a phone, so a position is only
 * ever a suggestion for a pin, never placed without the salesman confirming.
 */

export interface Fix { lat: number; lng: number; accuracyM: number }

export function watchLocation(onFix: (f: Fix) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return () => {}
  const id = navigator.geolocation.watchPosition(
    p => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

/** iPhone asks once for motion and orientation; call from a tap. */
export async function askForCompass(): Promise<boolean> {
  const D: any = typeof window !== 'undefined' ? (window as any).DeviceOrientationEvent : undefined
  if (D && typeof D.requestPermission === 'function') {
    try { return (await D.requestPermission()) === 'granted' } catch { return false }
  }
  return !!D
}

/**
 * Compass direction the back camera points (degrees from north), from the
 * phone's orientation: Safari gives it directly; Chrome on Android gives
 * absolute angles, turned into the camera's direction (W3C formula).
 */
export function watchHeading(onHeading: (deg: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onAbs = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    onHeading(cameraHeading(e.alpha, e.beta, e.gamma))
  }
  const onIos = (e: any) => {
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) onHeading(e.webkitCompassHeading)
  }
  window.addEventListener('deviceorientationabsolute', onAbs as EventListener)
  window.addEventListener('deviceorientation', onIos)
  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbs as EventListener)
    window.removeEventListener('deviceorientation', onIos)
  }
}

export function cameraHeading(alpha: number, beta: number, gamma: number): number {
  const r = Math.PI / 180
  const x = beta * r, y = gamma * r, z = alpha * r
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z)
  const vx = -cZ * sY - sZ * sX * cY
  const vy = -sZ * sY + cZ * sX * cY
  let h = Math.atan(vx / vy)
  if (vy < 0) h += Math.PI
  else if (vx < 0) h += 2 * Math.PI
  return (h * 180) / Math.PI
}

/** Feet east and north of an aerial photo's center, for a suggested pin. */
export function feetFrom(center: { lat: number; lng: number }, at: { lat: number; lng: number }): { x: number; y: number } {
  const m = 111_320
  return {
    x: ((at.lng - center.lng) * m * Math.cos((center.lat * Math.PI) / 180)) / 0.3048,
    y: ((at.lat - center.lat) * m) / 0.3048,
  }
}
