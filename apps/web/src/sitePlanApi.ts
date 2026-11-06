/**
 * The office site plan on the server (portal routes/site-plans.ts): one plan
 * per job, every save a revision. Nothing is kept in the browser: the editor
 * reads the plan here and saves it here.
 */

import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'
import type { LatLng, SitePlanData, SiteParcel } from './sitePlanData'
import type { QuoteLayoutRecord, YardLayout } from './yardLayout'

export interface SitePlanRevision { revision: number; by: string; at: string; note: string }
export interface SitePlanRecord {
  plan: SitePlanData | null
  revision: number
  doneAt: string | null
  doneBy: string | null
  updatedAt: string | null
  revisions: SitePlanRevision[]
  job: { id: string; quoteId: string | null; address: string; county: string | null; customerName: string; lat?: number | null; lng?: number | null }
  quote: { id: string; status: string; signed: boolean; layout: (Partial<QuoteLayoutRecord> & Record<string, unknown>) | null } | null
  settings: { tolFt: number; tolPct: number; setbackFt: number }
  canEdit: boolean
  /** The job's fence now: the signed quote with its approved and signed change orders (the plan is checked against it). */
  current?: { fenceStyle?: string; yard: YardLayout | null; runs?: number[]; runSections?: number[]; runRails?: string[] | null; changeOrders?: number[] } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the server's error body, read field by field
export type Got<T> = { ok: true; data: T } | { ok: false; status: number; error: string; json?: any }

const base = (jobId: string) => `/api/site-plans/${encodeURIComponent(jobId)}`
const errorOf = (r: { result: { ok: boolean; error?: string }; status: number }, fallback: string) =>
  r.status === 0 ? 'No signal: nothing was sent. Try again when you have signal.' : r.result.error || fallback

export async function getSitePlan(jobId: string): Promise<Got<SitePlanRecord>> {
  const r = await sendJson('GET', base(jobId))
  if (r.result.ok) return { ok: true, data: (r.json?.data ?? r.json) as SitePlanRecord }
  return { ok: false, status: r.status, error: r.status === 403 ? 'This site plan is not open to your login.' : errorOf(r, 'The site plan did not load.'), json: r.json }
}

/** A save: the new revision, or 409 with what someone else saved since (`current`). */
export async function saveSitePlan(jobId: string, plan: SitePlanData, baseRevision: number, note: string): Promise<Got<{ revision: number; updatedAt: string }>> {
  // The place is its latitude and longitude only (a looked up address also says where it came from).
  const clean = { ...plan, origin: { lat: plan.origin.lat, lng: plan.origin.lng } }
  const r = await sendJson('PUT', base(jobId), { plan: clean, baseRevision, ...(note.trim() ? { note: note.trim() } : {}) })
  if (r.result.ok) return { ok: true, data: (r.json?.data ?? r.json) as { revision: number; updatedAt: string } }
  return { ok: false, status: r.status, error: errorOf(r, 'The site plan was not saved.'), json: r.json }
}

/** Mark the plan done at a saved revision (refused with the open questions while any is open). */
export async function markSitePlanDone(jobId: string, revision: number): Promise<Got<unknown>> {
  const r = await sendJson('POST', `${base(jobId)}/done`, { revision })
  if (r.result.ok) return { ok: true, data: r.json?.data ?? null }
  return { ok: false, status: r.status, error: errorOf(r, 'The plan was not marked done.'), json: r.json }
}

export async function reopenSitePlan(jobId: string): Promise<Got<unknown>> {
  const r = await sendJson('DELETE', `${base(jobId)}/done`)
  if (r.result.ok) return { ok: true, data: r.json?.data ?? null }
  return { ok: false, status: r.status, error: errorOf(r, 'The plan was not reopened.'), json: r.json }
}

export interface ParcelAnswer { parcel: SiteParcel | null; neighbors: LatLng[][][]; source: string; note: string }
export async function fetchParcel(at: LatLng, county: string | null): Promise<Got<ParcelAnswer>> {
  const q = new URLSearchParams({ lat: String(at.lat), lng: String(at.lng), county: county ?? '' })
  const r = await sendJson('GET', `/api/parcels?${q}`)
  if (r.result.ok) return { ok: true, data: (r.json?.data ?? r.json) as ParcelAnswer }
  return { ok: false, status: r.status, error: errorOf(r, 'The property lines did not load.'), json: r.json }
}

/** The survey's picture (a photo, or a PDF's first page made into one by the server). */
export async function uploadSurvey(jobId: string, file: File): Promise<Got<{ url: string; w: number; h: number }>> {
  try {
    const res = await fetchWithAuth(`${API_ORIGIN}${base(jobId)}/survey`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json?.success !== false) return { ok: true, data: (json?.data ?? json) as { url: string; w: number; h: number } }
    return { ok: false, status: res.status, error: json?.error || 'The survey was not uploaded.' }
  } catch {
    return { ok: false, status: 0, error: 'No signal: the survey was not uploaded. Try again when you have signal.' }
  }
}

export async function makePermitSheet(jobId: string, size: 'letter' | 'tabloid', aerial: boolean): Promise<Got<{ url: string }>> {
  const r = await sendJson('POST', `${base(jobId)}/permit-sheet`, { size, aerial }, 60_000)
  if (r.result.ok) return { ok: true, data: (r.json?.data ?? r.json) as { url: string } }
  return { ok: false, status: r.status, error: errorOf(r, 'The permit sheet was not made.'), json: r.json }
}

/** A server address (/api/..., /p/...) as the browser opens it. */
export const serverUrl = (u: string) => (/^https?:/.test(u) ? u : `${API_ORIGIN}${u}`)
