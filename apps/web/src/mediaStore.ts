/**
 * Photos and video, offline first. Every capture is saved on the phone
 * (IndexedDB) the moment it is taken, then uploaded in the background when
 * there is signal, in 2 MB chunks so a big video that loses signal carries on
 * where it stopped instead of starting over. A capture is removed from the
 * phone only after the Mac has all of it.
 *
 * Like the voice outbox, this is browser storage by request: a capture must
 * survive no signal and the app being closed. It is one of the offline queues
 * Jonathan allowed (answer 1 of the sign in plan): encrypted at rest (vault.ts;
 * the file in 2 MB sealed pieces, its details sealed apart), holding only what
 * has not reached the server, each capture deleted once the server has it.
 * A capture belongs to the person who took it: it uploads only while that
 * person is signed in on this phone.
 */

import { fetchWithAuth, signedInUserId } from './crmAuth'
import { sealJson, openJson, sealBlob, openBlob, vaultAvailable, type SealedPiece } from './vault'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { refusalOf } from './uploadOutcome'

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

/**
 * A vendor invoice file (a PDF or a photo of a page), Inventory > Invoices.
 * It waits on the phone and uploads in the same queue as photos, but is never
 * shown with them.
 */
export interface InvoiceFileMeta {
  kind: 'invoice'
  mime: string
  takenAt: string
  /** The files of one invoice share a batch, in page order (seq). */
  invoiceBatch: string
  invoiceSeq: number
  invoicePages: number
  /** Optional job for a job lot order (apart from jobId, so it is not shown with the job's photos). */
  invoiceJobId?: string | null
  fileName?: string
}

export interface LocalMedia<M = MediaMeta> {
  clientId: string
  meta: M
  blob: Blob
  markupBlob?: Blob | null
  size: number
  sent: number
  createdAt: number
  /** Set once the Mac has it; the record is then removed. */
  serverId?: string | null
  error?: string | null
  /** The login that took it; it uploads only under that login. Older captures have none (anyone's). */
  owner?: string | null
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

// ── IndexedDB (sealed, vault.ts) ──────────────────────────────────────────────

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
type AnyMeta = MediaMeta | InvoiceFileMeta
/** Everything but the file, sealed together. */
type Head = Omit<LocalMedia<AnyMeta>, 'blob' | 'markupBlob'> & { type: string; markupType?: string | null }
/** As kept on the phone: only the id in the clear; the details and the file (in pieces) sealed. */
type SealedRow = { clientId: string; v: 2; head: ArrayBuffer; pieces: SealedPiece[]; markup?: SealedPiece[] | null }
/** Kept by a version before encryption: the photo as it is, or its bytes. Sealed on the next read. */
type PlainRow = LocalMedia<AnyMeta> & { bytes?: ArrayBuffer; type?: string; markupBytes?: ArrayBuffer; markupType?: string }
type Row = SealedRow | PlainRow
const isSealed = (r: Row): r is SealedRow => (r as SealedRow).v === 2

/** Opened files, for this visit only (in memory), so a big video is not opened again on every look. */
const opened = new Map<string, { blob: Blob; markupBlob: Blob | null }>()

async function seal(m: LocalMedia<AnyMeta>, keep?: SealedRow): Promise<SealedRow> {
  const { blob, markupBlob, ...rest } = m
  const head: Head = { ...rest, type: blob.type, markupType: markupBlob?.type ?? null }
  const sealHead = await sealJson(head)
  const pieces = keep?.pieces ?? await sealBlob(blob, CHUNK)
  const markup = markupBlob ? (keep && opened.get(m.clientId)?.markupBlob === markupBlob ? keep.markup ?? null : await sealBlob(markupBlob, CHUNK)) : null
  return { clientId: m.clientId, v: 2, head: sealHead, pieces, markup }
}

async function openRow(r: SealedRow, withFile: boolean): Promise<LocalMedia<AnyMeta>> {
  const head = await openJson<Head>(r.head)
  const { type, markupType, ...rest } = head
  let files = opened.get(r.clientId)
  if (!files && withFile) {
    files = { blob: await openBlob(r.pieces, type), markupBlob: r.markup?.length ? await openBlob(r.markup, markupType || 'image/jpeg') : null }
    opened.set(r.clientId, files)
  }
  return { ...rest, blob: files?.blob ?? new Blob([], { type }), markupBlob: files?.markupBlob ?? null } as LocalMedia<AnyMeta>
}

const revivePlain = (m: PlainRow): LocalMedia<AnyMeta> => ({
  ...m,
  blob: m.bytes ? new Blob([m.bytes], { type: m.type }) : m.blob,
  markupBlob: m.markupBytes ? new Blob([m.markupBytes], { type: m.markupType }) : m.markupBlob,
})

async function writeRow(row: SealedRow): Promise<void> {
  try {
    await store('readwrite', s => s.put(row))
  } catch {
    // Some phones (Safari in a private window) will not keep a Blob; they keep the sealed bytes.
    const flat = (list: SealedPiece[]) => Promise.all(list.map(p => (p instanceof Blob ? p.arrayBuffer() : p)))
    const bytes: SealedRow = { ...row, pieces: await flat(row.pieces), markup: row.markup ? await flat(row.markup) : null }
    await store('readwrite', s => s.put(bytes))
  }
}

/** Every capture waiting, with its file opened when asked (`withFile`). Old plain ones are sealed now. */
async function readAll(withFile: boolean): Promise<LocalMedia<AnyMeta>[]> {
  const rows = await store<Row[]>('readonly', s => s.getAll() as IDBRequest<Row[]>).catch(() => [] as Row[])
  const out: LocalMedia<AnyMeta>[] = []
  for (const r of rows) {
    try {
      if (isSealed(r)) out.push(await openRow(r, withFile))
      else {
        const m = revivePlain(r)
        await writeRow(await seal(m))
        opened.set(m.clientId, { blob: m.blob, markupBlob: m.markupBlob ?? null })
        out.push(m)
      }
    } catch { console.warn('[media] a waiting capture could not be opened on this phone') }
  }
  return out
}
const all = (withFile = true) => readAll(withFile).catch(() => [] as LocalMedia<AnyMeta>[])

async function put(m: LocalMedia<AnyMeta>): Promise<void> {
  if (!vaultAvailable()) throw new Error('This browser cannot keep photos safely on the phone. Upload with signal, or use the installed app.')
  await writeRow(await seal(m))
  opened.set(m.clientId, { blob: m.blob, markupBlob: m.markupBlob ?? null })
}
// A capture sent straight up (addOrSend) was never kept, and a browser with no storage cannot delete: neither fails the upload.
const remove = async (id: string) => { await store('readwrite', s => s.delete(id)).catch(() => {}); opened.delete(id) }
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(MEDIA_EVENT)) }

function newClientId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Save a capture on the phone right away, then upload in the background. */
export async function addCapture<M extends AnyMeta = MediaMeta>(blob: Blob, meta: M): Promise<LocalMedia<M>> {
  const m: LocalMedia<M> = { clientId: newClientId(), meta, blob, size: blob.size, sent: 0, createdAt: Date.now(), owner: signedInUserId() }
  await put(m)
  // Ask the phone not to clear this app's storage when it runs low.
  navigator.storage?.persist?.().catch(() => {})
  notify()
  uploadAll().catch(() => {})
  return m
}

/**
 * Save a photo now, or send it straight up when this browser cannot keep it
 * on the phone (no safe storage): the site visit's photos are never left out.
 */
export async function addOrSend(blob: Blob, meta: MediaMeta): Promise<'saved' | 'sent' | 'failed'> {
  try { await addCapture(blob, meta); return 'saved' } catch { /* no safe storage on this browser: send it now */ }
  const m: LocalMedia<MediaMeta> = { clientId: newClientId(), meta, blob, size: blob.size, sent: 0, createdAt: Date.now(), owner: signedInUserId() }
  const r = await uploadOne(m).catch(() => 'retry' as const)
  notify()
  return r === 'ok' ? 'sent' : 'failed'
}

/** Change a capture still on the phone (caption, pin, markup …). */
export async function updateLocal(clientId: string, patch: Partial<Pick<LocalMedia, 'meta' | 'markupBlob'>>): Promise<void> {
  const raw = await store<Row | undefined>('readonly', s => s.get(clientId) as IDBRequest<Row | undefined>).catch(() => undefined)
  if (!raw) return
  const m = isSealed(raw) ? await openRow(raw, !!patch.markupBlob) : revivePlain(raw)
  if (m.meta.kind === 'invoice') return
  const next = { ...m, ...patch, meta: { ...m.meta, ...(patch.meta ?? {}) } as MediaMeta }
  // The file's sealed pieces are kept as they are: only the details (and a new markup) are sealed again.
  await writeRow(await seal(next, isSealed(raw) ? raw : undefined))
  const files = opened.get(clientId)
  if (files && patch.markupBlob !== undefined) opened.set(clientId, { ...files, markupBlob: patch.markupBlob ?? null })
  notify()
}

/** Captures still on the phone for a quote, job or customer. */
const isPhotoOrVideo = (m: LocalMedia<AnyMeta>): m is LocalMedia<MediaMeta> => m.meta.kind !== 'invoice'

export async function localMedia(where: { quoteKey?: string; jobId?: string; customerId?: string; quoteCustomerId?: string | null } = {}): Promise<LocalMedia[]> {
  return (await all()).filter(isPhotoOrVideo).filter(m => !m.serverId && (
    (!where.quoteKey && !where.jobId && !where.customerId)
    || (where.quoteKey && m.meta.quoteKey === where.quoteKey)
    // A quote's customer's own (visit) photos still on this phone, as the server counts them once they arrive.
    || (where.quoteKey && where.quoteCustomerId && isCustomersOwn(m.meta, where.quoteCustomerId))
    || (where.jobId && m.meta.jobId === where.jobId)
    || (where.customerId && m.meta.customerId === where.customerId)))
}

/** A photo taken on the customer (the visit, the customer page), not on a quote or a job: it shows on their quotes too (portal lib/quoteMedia.ts). */
export const isCustomersOwn = (m: Pick<MediaMeta, 'quoteKey' | 'jobId' | 'customerId'>, customerId: string) => m.customerId === customerId && !m.quoteKey && !m.jobId

/** Vendor invoice files still on the phone (Inventory > Invoices). */
export async function localInvoiceFiles(): Promise<LocalMedia<InvoiceFileMeta>[]> {
  return (await all()).filter((m): m is LocalMedia<InvoiceFileMeta> => !m.serverId && m.meta.kind === 'invoice')
}

/** Captures waiting on this phone (for one person, or anyone's). */
export async function waitingCount(owner?: string | null): Promise<number> {
  return (await all(false)).filter(m => !m.serverId && (!owner || !m.owner || m.owner === owner)).length
}

// ── Upload ────────────────────────────────────────────────────────────────────

let current: Promise<void> | null = null
/** Asked again while a run was going: one more run right after it, for what was added since. */
let again = false
const progress = new Map<string, number>()
export const uploadProgress = (clientId: string) => progress.get(clientId) ?? 0
/** Why the server turned a capture down (it stays on the phone until it is removed); kept for this visit. */
const refused = new Map<string, string>()
export const uploadRefusedWhy = (clientId: string) => refused.get(clientId) ?? null
/** What the server made of a capture sent on this visit (its media id, or a vendor invoice's id). */
const sentAs = new Map<string, string>()
export const uploadedAs = (clientId: string) => sentAs.get(clientId) ?? null

async function json<T>(r: Response | null): Promise<T | null> {
  if (!r) return null
  const j = await r.json().catch(() => null)
  return r.ok ? (j?.data ?? null) : null
}

/**
 * Sends everything waiting, oldest first, resuming each where it stopped.
 * Called while it is already running, it returns that run and runs once more
 * right after it, so a capture saved while a run was going goes up too
 * (review Oct 27 2026: two photos picked at once, the first one's run had
 * already read the list before the second was saved, and the second waited
 * for "Upload now" or the 30 second retry). A capture the server turns down
 * is skipped (its reason in uploadRefusedWhy) so the ones after it still go.
 */
export function uploadAll(): Promise<void> {
  if (current) { again = true; return current }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve()
  current = (async () => {
    // Only while someone is signed in, and only that person's captures (and older ones with no owner).
    const me = signedInUserId()
    if (!me) return
    for (const m of (await all()).filter(x => !x.serverId && (!x.owner || x.owner === me)).sort((a, b) => a.createdAt - b.createdAt)) {
      if (refused.has(m.clientId)) continue
      const r = await uploadOne(m)
      if (r === 'retry') break
    }
  })().finally(() => {
    current = null
    notify()
    if (again) { again = false; uploadAll().catch(() => {}) }
  })
  return current
}

async function startUpload(m: LocalMedia<AnyMeta>): Promise<{ received?: number; done?: boolean; item?: ServerMedia } | 'retry' | 'refused'> {
  const r = await fetchWithAuth(`${API}/uploads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: m.clientId, size: m.size, meta: m.meta }),
  }).catch(() => null)
  if (!r) return 'retry'
  const j = await r.json().catch(() => null)
  const no = refusalOf(r.status, j)
  if (no) { refused.set(m.clientId, no); return 'refused' }
  return r.ok && j?.data ? j.data : 'retry'
}

async function uploadOne(m: LocalMedia<AnyMeta>): Promise<'ok' | 'retry' | 'refused'> {
  const start = await startUpload(m)
  if (start === 'retry' || start === 'refused') return start
  let item: ServerMedia | null = start.item ?? null
  if (!start.done) {
    let at = start.received ?? 0
    while (at < m.size) {
      const chunk = m.blob.slice(at, Math.min(m.size, at + CHUNK))
      const r = await fetchWithAuth(`${API}/uploads/${m.clientId}?offset=${at}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }).catch(() => null)
      if (!r) return 'retry' // lost signal: try again later from here
      const j = await r.json().catch(() => null)
      const no = refusalOf(r.status, j)
      if (no) { refused.set(m.clientId, no); return 'refused' }
      const received = j?.data?.received
      if (typeof received !== 'number') return 'retry'
      at = received
      progress.set(m.clientId, at / m.size)
      notify()
    }
    const fin = await fetchWithAuth(`${API}/uploads/${m.clientId}/finish`, { method: 'POST' }).catch(() => null)
    if (!fin) return 'retry'
    const fj = await fin.json().catch(() => null)
    const no = refusalOf(fin.status, fj)
    if (no) { refused.set(m.clientId, no); return 'refused' }
    item = fin.ok ? (fj?.data ?? null) : null
    if (!item) return 'retry'
  }
  // Settings changed on the phone after the upload started go along too.
  if (item && m.markupBlob) { const ok = await uploadMarkup(item.id, m.markupBlob); if (!ok) return 'retry' }
  if (item && m.meta.kind !== 'invoice' && (m.meta.caption || m.meta.pin || m.meta.category || m.meta.visibility)) {
    await patchMedia(item.id, { caption: m.meta.caption, pin: m.meta.pin ?? null, category: m.meta.category, visibility: m.meta.visibility })
  }
  await remove(m.clientId)
  progress.delete(m.clientId)
  if (item?.id) sentAs.set(m.clientId, item.id)
  return 'ok'
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

/** A quote's list includes its customer's visit photos; quoteCustomerId names the customer of a draft not saved yet. */
export async function listMedia(where: { quoteKey?: string; jobId?: string; customerId?: string; quoteCustomerId?: string | null }): Promise<ServerMedia[]> {
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
export async function discardLocal(clientId: string): Promise<void> { await remove(clientId); refused.delete(clientId); notify() }

export async function mediaStorage(): Promise<{ items: number; bytes: number; freeBytes: number | null } | null> {
  return json(await fetchWithAuth(`${API}/storage`).catch(() => null))
}
