/**
 * Photos and video, offline first. Every capture is saved on the phone
 * (IndexedDB) the moment it is taken, then uploaded in the background when
 * there is signal, in 2 MB chunks so a big video that loses signal carries on
 * where it stopped instead of starting over. A capture is removed from the
 * phone only after the Mac has all of it.
 *
 * Like the voice outbox, this is browser storage by request: a capture must
 * survive no signal and the app being closed.
 */

import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'

const ORIGIN = typeof window !== 'undefined' && window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
const API = ORIGIN + '/api/media'
const CHUNK = 2 * 1024 * 1024

export const CATEGORIES = ['Site walk', 'Before', 'Gate location', 'Utilities and obstacles', 'HOA', 'Existing damage', 'Progress', 'Completed'] as const
export type Category = typeof CATEGORIES[number]
export type Visibility = 'internal' | 'crew' | 'customer'
export const VISIBILITY_LABEL: Record<Visibility, string> = { internal: 'Internal', crew: 'Crew', customer: 'Customer' }

export interface MediaPin { x: number; y: number; angle?: number | null }

export interface MediaMeta {
  kind: 'photo' | 'video'
  mime: string
  quoteKey?: string | null
  jobId?: string | null
  customerId?: string | null
  takenAt: string
  lat?: number | null
  lng?: number | null
  accuracyM?: number | null
  heading?: number | null
  caption?: string
  category?: Category
  visibility?: Visibility
  pin?: MediaPin | null
}

export interface LocalMedia {
  clientId: string
  meta: MediaMeta
  blob: Blob
  markupBlob?: Blob | null
  size: number
  sent: number
  createdAt: number
  /** Set once the Mac has it; the record is then removed. */
  serverId?: string | null
  error?: string | null
}

export interface ServerMedia extends Omit<MediaMeta, 'takenAt'> {
  id: string
  clientId: string
  takenAt: string
  takenBy: string | null
  bytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  status: 'processing' | 'ready' | 'failed'
  source: string
  url: string
  markupUrl: string | null
  previewUrl: string | null
  thumbUrl: string | null
}

export const MEDIA_EVENT = 'ezbiz:media-outbox'

// ── IndexedDB ─────────────────────────────────────────────────────────────────

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ezbiz-media', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('items', { keyPath: 'clientId' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction('items', mode)
    const r = fn(t.objectStore('items'))
    // Kept once the phone has written it, not when it was asked to (Safari refuses some writes only at the end).
    t.oncomplete = () => resolve(r.result)
    t.onabort = t.onerror = () => reject(t.error ?? r.error ?? new Error('The phone did not keep it.'))
  })
}
/** As kept on the phone: a photo as it is, or (where the phone refuses that) its bytes. */
type Stored = LocalMedia & { bytes?: ArrayBuffer; type?: string; markupBytes?: ArrayBuffer; markupType?: string }
const revive = (m: Stored): LocalMedia => ({
  ...m,
  blob: m.bytes ? new Blob([m.bytes], { type: m.type }) : m.blob,
  markupBlob: m.markupBytes ? new Blob([m.markupBytes], { type: m.markupType }) : m.markupBlob,
})
const all = () => store<Stored[]>('readonly', s => s.getAll() as IDBRequest<Stored[]>).then(l => l.map(revive)).catch(() => [] as LocalMedia[])
async function put(m: LocalMedia): Promise<void> {
  try {
    await store('readwrite', s => s.put(m))
  } catch {
    // Some phones (Safari in a private window) will not keep a photo as it is; they keep its bytes.
    const flat: Stored = {
      ...m, blob: null as unknown as Blob, bytes: await m.blob.arrayBuffer(), type: m.blob.type,
      ...(m.markupBlob ? { markupBlob: null, markupBytes: await m.markupBlob.arrayBuffer(), markupType: m.markupBlob.type } : {}),
    }
    await store('readwrite', s => s.put(flat))
  }
}
const remove = (id: string) => store('readwrite', s => s.delete(id))
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(MEDIA_EVENT)) }

function newClientId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Save a capture on the phone right away, then upload in the background. */
export async function addCapture(blob: Blob, meta: MediaMeta): Promise<LocalMedia> {
  const m: LocalMedia = { clientId: newClientId(), meta, blob, size: blob.size, sent: 0, createdAt: Date.now() }
  await put(m)
  // Ask the phone not to clear this app's storage when it runs low.
  navigator.storage?.persist?.().catch(() => {})
  notify()
  uploadAll().catch(() => {})
  return m
}

/** Change a capture still on the phone (caption, pin, markup …). */
export async function updateLocal(clientId: string, patch: Partial<Pick<LocalMedia, 'meta' | 'markupBlob'>>): Promise<void> {
  const raw = await store<Stored | undefined>('readonly', s => s.get(clientId) as IDBRequest<Stored | undefined>).catch(() => undefined)
  const m = raw ? revive(raw) : undefined
  if (!m) return
  await put({ ...m, ...patch, meta: { ...m.meta, ...(patch.meta ?? {}) } })
  notify()
}

/** Captures still on the phone for a quote, job or customer. */
export async function localMedia(where: { quoteKey?: string; jobId?: string; customerId?: string } = {}): Promise<LocalMedia[]> {
  return (await all()).filter(m => !m.serverId && (
    (!where.quoteKey && !where.jobId && !where.customerId)
    || (where.quoteKey && m.meta.quoteKey === where.quoteKey)
    || (where.jobId && m.meta.jobId === where.jobId)
    || (where.customerId && m.meta.customerId === where.customerId)))
}

export async function waitingCount(): Promise<number> {
  return (await all()).filter(m => !m.serverId).length
}

// ── Upload ────────────────────────────────────────────────────────────────────

let running = false
const progress = new Map<string, number>()
export const uploadProgress = (clientId: string) => progress.get(clientId) ?? 0

async function json<T>(r: Response | null): Promise<T | null> {
  if (!r) return null
  const j = await r.json().catch(() => null)
  return r.ok ? (j?.data ?? null) : null
}

/** Sends everything waiting, oldest first, resuming each where it stopped. */
export async function uploadAll(): Promise<void> {
  if (running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  running = true
  try {
    for (const m of (await all()).filter(x => !x.serverId).sort((a, b) => a.createdAt - b.createdAt)) {
      if (!(await uploadOne(m))) break
    }
  } finally {
    running = false
    notify()
  }
}

async function uploadOne(m: LocalMedia): Promise<boolean> {
  const start = await json<{ received?: number; done?: boolean; item?: ServerMedia }>(await fetchWithAuth(`${API}/uploads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: m.clientId, size: m.size, meta: m.meta }),
  }).catch(() => null))
  if (!start) return false
  let item: ServerMedia | null = start.item ?? null
  if (!start.done) {
    let at = start.received ?? 0
    while (at < m.size) {
      const chunk = m.blob.slice(at, Math.min(m.size, at + CHUNK))
      const r = await fetchWithAuth(`${API}/uploads/${m.clientId}?offset=${at}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }).catch(() => null)
      if (!r) return false // lost signal: try again later from here
      const j = await r.json().catch(() => null)
      const received = j?.data?.received
      if (typeof received !== 'number') return false
      at = received
      progress.set(m.clientId, at / m.size)
      notify()
    }
    item = await json<ServerMedia>(await fetchWithAuth(`${API}/uploads/${m.clientId}/finish`, { method: 'POST' }).catch(() => null))
    if (!item) return false
  }
  // Settings changed on the phone after the upload started go along too.
  if (item && m.markupBlob) { const ok = await uploadMarkup(item.id, m.markupBlob); if (!ok) return false }
  if (item && (m.meta.caption || m.meta.pin || m.meta.category || m.meta.visibility)) {
    await patchMedia(item.id, { caption: m.meta.caption, pin: m.meta.pin ?? null, category: m.meta.category, visibility: m.meta.visibility })
  }
  await remove(m.clientId)
  progress.delete(m.clientId)
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { uploadAll().catch(() => {}) })
  setInterval(() => { uploadAll().catch(() => {}) }, 30_000)
  setTimeout(() => { uploadAll().catch(() => {}) }, 3000)
}

/** Warn when the phone is close to full (a capture that cannot be saved is lost). */
export async function storageWarning(): Promise<string | null> {
  const est = await navigator.storage?.estimate?.().catch(() => null)
  if (!est?.quota) return null
  const free = est.quota - (est.usage ?? 0)
  if (free < 300 * 1024 * 1024) return `The phone has about ${Math.round(free / 1024 / 1024)} MB left for this app. Upload what is waiting, or free up space, before recording more video.`
  if ((est.usage ?? 0) / est.quota > 0.85) return 'This app is using most of the space the phone allows it. Upload what is waiting before taking more.'
  return null
}

// ── Server ────────────────────────────────────────────────────────────────────

export async function listMedia(where: { quoteKey?: string; jobId?: string; customerId?: string }): Promise<ServerMedia[]> {
  const q = new URLSearchParams(Object.entries(where).filter(([, v]) => v) as Array<[string, string]>)
  const items = await json<ServerMedia[]>(await fetchWithAuth(`${API}?${q}`).catch(() => null))
  return (items ?? []).map(i => ({ ...i, url: ORIGIN + i.url, markupUrl: i.markupUrl && ORIGIN + i.markupUrl, previewUrl: i.previewUrl && ORIGIN + i.previewUrl, thumbUrl: i.thumbUrl && ORIGIN + i.thumbUrl }))
}

export async function patchMedia(id: string, patch: Partial<Pick<MediaMeta, 'caption' | 'category' | 'visibility' | 'pin' | 'quoteKey' | 'jobId' | 'customerId'>>): Promise<boolean> {
  const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  return !!(await fetchWithAuth(`${API}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null))?.ok
}

export async function uploadMarkup(id: string, blob: Blob): Promise<boolean> {
  const form = new FormData()
  form.append('image', blob, 'markup.jpg')
  return !!(await fetchWithAuth(`${API}/${id}/markup`, { method: 'POST', body: form }).catch(() => null))?.ok
}

export async function deleteMedia(id: string): Promise<boolean> {
  return !!(await fetchWithAuth(`${API}/${id}`, { method: 'DELETE' }).catch(() => null))?.ok
}

/** A capture still on the phone, removed (it was never uploaded). */
export async function discardLocal(clientId: string): Promise<void> { await remove(clientId); notify() }

export async function mediaStorage(): Promise<{ items: number; bytes: number; freeBytes: number | null } | null> {
  return json(await fetchWithAuth(`${API}/storage`).catch(() => null))
}
