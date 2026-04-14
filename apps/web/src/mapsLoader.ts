import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

let initialized = false

function initMaps() {
  if (initialized) return
  initialized = true
  setOptions({
    key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    v: 'weekly',
    libraries: ['places', 'drawing', 'marker', 'geometry'],
  })
}

export async function loadMaps(): Promise<google.maps.MapsLibrary> {
  initMaps()
  return (await importLibrary('maps')) as google.maps.MapsLibrary
}

export async function loadPlaces(): Promise<google.maps.PlacesLibrary> {
  initMaps()
  return (await importLibrary('places')) as google.maps.PlacesLibrary
}

export async function loadMarker(): Promise<google.maps.MarkerLibrary> {
  initMaps()
  return (await importLibrary('marker')) as google.maps.MarkerLibrary
}

export async function loadGeometry(): Promise<google.maps.GeometryLibrary> {
  initMaps()
  return (await importLibrary('geometry')) as google.maps.GeometryLibrary
}
