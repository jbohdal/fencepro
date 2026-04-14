export interface LatLng {
  lat: number
  lng: number
}

/** Calculate total distance of a polyline path in feet using Haversine formula */
export function calculateLinearFeet(path: LatLng[]): number {
  if (path.length < 2) return 0
  let totalMeters = 0
  for (let i = 0; i < path.length - 1; i++) {
    totalMeters += haversineDistance(path[i], path[i + 1])
  }
  return totalMeters * 3.28084
}

function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Calculate distance between two points in feet */
export function distanceFeet(a: LatLng, b: LatLng): number {
  return haversineDistance(a, b) * 3.28084
}

/** Calculate distance between two points in miles */
export function distanceMiles(a: LatLng, b: LatLng): number {
  return haversineDistance(a, b) / 1609.344
}

/** Simple greedy clustering: group points within radiusMiles of each other */
export function clusterByDistance<T>(
  items: T[],
  getCoords: (item: T) => LatLng | null,
  radiusMiles: number
): { centroid: LatLng; items: T[] }[] {
  const remaining = items.filter(i => getCoords(i) !== null)
  const clusters: { centroid: LatLng; items: T[] }[] = []

  while (remaining.length > 0) {
    const seed = remaining.shift()!
    const seedCoords = getCoords(seed)!
    const cluster: T[] = [seed]

    for (let i = remaining.length - 1; i >= 0; i--) {
      const coords = getCoords(remaining[i])!
      if (distanceMiles(seedCoords, coords) <= radiusMiles) {
        cluster.push(remaining.splice(i, 1)[0])
      }
    }

    // Calculate centroid
    const lats = cluster.map(c => getCoords(c)!.lat)
    const lngs = cluster.map(c => getCoords(c)!.lng)
    const centroid: LatLng = {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
    }

    clusters.push({ centroid, items: cluster })
  }

  return clusters.sort((a, b) => b.items.length - a.items.length)
}
