/**
 * Settings → Site plans, its values with the defaults filled in, and the
 * property line sources the office can add with one tap (SitePlanSettings.tsx).
 */

import type { AppConfig, ParcelSource, SitePlanSettings as Settings } from './configStore'

export const MARION_SOURCE: ParcelSource = {
  name: 'Marion County Property Appraiser',
  url: 'https://www.pa.marion.fl.us/arcgis/rest/services/MCPA_Services/Parcels/MapServer/0/query',
  idField: 'PARCEL',
}
const FDOR_URL = 'https://gis.fdacs.gov/mapping/rest/services/GIO_Parcels_for_OAWP_Optimized/FeatureServer/0/query'
/** Florida's statewide parcels (Dept. of Revenue, once a year) for one county, by its county number. */
export const fdorSource = (countyNo: number): ParcelSource => ({ name: 'Florida Dept. of Revenue (yearly)', url: FDOR_URL, idField: 'PARCEL_ID', where: `CO_NO=${countyNo}` })
/** The nearby counties, one tap each. */
export const NEARBY_COUNTIES: Array<{ county: string; source: ParcelSource }> = [
  { county: 'Marion', source: MARION_SOURCE },
  { county: 'Alachua', source: fdorSource(11) },
  { county: 'Lake', source: fdorSource(45) },
  { county: 'Sumter', source: fdorSource(70) },
  { county: 'Levy', source: fdorSource(48) },
  { county: 'Citrus', source: fdorSource(19) },
]

export const SITE_PLAN_DEFAULTS: Settings = { tolFt: 3, tolPct: 3, setbackFt: 0, parcelSources: { Marion: MARION_SOURCE } }
/** The settings with every default filled in (Marion's lines until the office changes the list). */
export function sitePlanSettings(cfg: Pick<AppConfig, 'sitePlan'>): Settings {
  const s = cfg.sitePlan
  return {
    tolFt: typeof s?.tolFt === 'number' && s.tolFt >= 0 ? s.tolFt : SITE_PLAN_DEFAULTS.tolFt,
    tolPct: typeof s?.tolPct === 'number' && s.tolPct >= 0 ? s.tolPct : SITE_PLAN_DEFAULTS.tolPct,
    setbackFt: typeof s?.setbackFt === 'number' && s.setbackFt >= 0 ? s.setbackFt : SITE_PLAN_DEFAULTS.setbackFt,
    parcelSources: s?.parcelSources && typeof s.parcelSources === 'object' ? s.parcelSources : SITE_PLAN_DEFAULTS.parcelSources,
  }
}

