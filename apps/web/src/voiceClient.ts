/**
 * Voice on the phone, using only what the browser has (free):
 *   listen   SpeechRecognition / webkitSpeechRecognition (Chrome on Android,
 *            Safari on iPhone; needs a connection)
 *   speak    speechSynthesis
 *   record   MediaRecorder, the fallback when live listening cannot work.
 *            Each clip waits on the phone (IndexedDB outbox) until there is
 *            signal, then uploads; the Mac transcribes it with whisper.cpp.
 *
 * The clip outbox is one of the offline queues Jonathan allowed (answer 1 of
 * the sign in plan): a recording must survive no signal and the app being
 * closed. It is encrypted at rest (vault.ts), holds a clip only until the
 * upload succeeds, and a clip goes only while the person who recorded it is
 * signed in on this phone.
 */

import { fetchWithAuth, signedInUserId } from './crmAuth'
import { sealJson, openJson, sealBytes, openBytes, vaultAvailable } from './vault'
import { LOCAL_API_ORIGIN } from './apiOrigin'

const API = (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/voice'

// ── What this browser can do ──────────────────────────────────────────────────

export interface VoiceSupport {
  recognition: boolean
  synthesis: boolean
  recorder: boolean
  recorderMime: string | null
  standalone: boolean
  ios: boolean
  android: boolean
}

const Rec = (): any => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null)

export function voiceSupport(): VoiceSupport {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const MR = typeof window !== 'undefined' ? (window as any).MediaRecorder : undefined
  const mime = MR ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(m => { try { return MR.isTypeSupported?.(m) } catch { return false } }) ?? null : null
  return {
    recognition: !!Rec(),
    synthesis: typeof window !== 'undefined' && 'speechSynthesis' in window,
    recorder: !!MR && !!navigator.mediaDevices?.getUserMedia,
    recorderMime: mime,
    standalone: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true),
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document),
    android: /Android/.test(ua),
  }
}

// ── Listen once ───────────────────────────────────────────────────────────────

export type ListenResult = { text: string } | { error: string }

/** Hears one phrase. Errors: no-speech, not-allowed, network, service-not-allowed, audio-capture, timeout, unsupported. */
export function listenOnce(timeoutMs = 15000): { result: Promise<ListenResult>; stop: () => void } {
  const R = Rec()
  if (!R) return { result: Promise.resolve({ error: 'unsupported' }), stop: () => {} }
  const rec = new R()
  rec.lang = 'en-US'
  rec.interimResults = false
  rec.maxAlternatives = 1
  rec.continuous = false
  let done = false
  let stop = () => {}
  const result = new Promise<ListenResult>(resolve => {
    const finish = (r: ListenResult) => { if (!done) { done = true; clearTimeout(t); try { rec.abort() } catch { /* already stopped */ } resolve(r) } }
    const t = setTimeout(() => finish({ error: 'timeout' }), timeoutMs)
    rec.onresult = (e: any) => finish({ text: String(e.results?.[0]?.[0]?.transcript ?? '').trim() })
    rec.onerror = (e: any) => finish({ error: String(e?.error || 'error') })
    rec.onend = () => finish({ error: 'no-speech' })
    stop = () => finish({ error: 'stopped' })
    try { rec.start() } catch (e) { finish({ error: String((e as Error)?.message || 'start') }) }
  })
  return { result, stop: () => stop() }
}

/** Errors that mean live listening will not work here, so record instead. */
export const FALL_BACK_ERRORS = new Set(['network', 'not-allowed', 'service-not-allowed', 'audio-capture', 'unsupported', 'language-not-supported'])

// ── Speak ─────────────────────────────────────────────────────────────────────

export function speak(text: string, rate = 1): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return Promise.resolve()
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = Math.min(1.6, Math.max(0.6, rate))
    u.lang = 'en-US'
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    u.onend = finish
    u.onerror = finish
    // Safety net: some phones never fire onend.
    setTimeout(finish, 1500 + text.length * 90 / u.rate)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  })
}

// ── Record ────────────────────────────────────────────────────────────────────

export async function startRecording(): Promise<{ stop: () => Promise<Blob>; mime: string }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mime = voiceSupport().recorderMime ?? ''
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  rec.start(1000)
  return {
    mime: rec.mimeType || mime || 'audio/webm',
    stop: () => new Promise(resolve => {
      rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })) }
      rec.stop()
    }),
  }
}

// ── Outbox: clips wait on the phone until they upload ─────────────────────────

interface OutboxClip { id: string; quoteKey: string; hint?: string; mime: string; blob: Blob; createdAt: number; owner?: string | null }
type ClipHead = Omit<OutboxClip, 'blob'>
/** As kept: the id in the clear; the details and the sound sealed. A clip kept before encryption has `blob` and is sealed on the next read. */
type ClipRow = { id: string; v: 2; head: ArrayBuffer; audio: ArrayBuffer } | OutboxClip
const sealedRow = (r: ClipRow): r is { id: string; v: 2; head: ArrayBuffer; audio: ArrayBuffer } => (r as any).v === 2

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ezbiz-voice', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('outbox', { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction('outbox', mode).objectStore('outbox'))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function sealClip(c: OutboxClip): Promise<ClipRow> {
  const { blob, ...head } = c
  return { id: c.id, v: 2, head: await sealJson(head), audio: await sealBytes(await blob.arrayBuffer()) }
}

/** Every clip waiting (with its sound when asked). Clips kept before encryption are sealed now. */
async function readClips(withAudio: boolean): Promise<OutboxClip[]> {
  const rows = await tx<ClipRow[]>('readonly', s => s.getAll() as IDBRequest<ClipRow[]>).catch(() => [] as ClipRow[])
  const out: OutboxClip[] = []
  for (const r of rows) {
    try {
      if (sealedRow(r)) {
        const head = await openJson<ClipHead>(r.head)
        out.push({ ...head, blob: withAudio ? new Blob([await openBytes(r.audio)], { type: head.mime }) : new Blob([], { type: head.mime }) })
      } else {
        const sealed = await sealClip(r)
        await tx('readwrite', s => s.put(sealed))
        out.push(r)
      }
    } catch { console.warn('[voice] a waiting clip could not be opened on this phone') }
  }
  return out
}

export async function keepClip(quoteKey: string, blob: Blob, mime: string, hint?: string): Promise<void> {
  if (!vaultAvailable()) throw new Error('This browser cannot keep a recording safely on the phone.')
  const clip: OutboxClip = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, quoteKey, hint, mime, blob, createdAt: Date.now(), owner: signedInUserId() }
  const row = await sealClip(clip)
  await tx('readwrite', s => s.put(row))
  window.dispatchEvent(new Event(OUTBOX_EVENT))
  uploadWaitingClips().catch(() => {})
}

export async function waitingClips(quoteKey?: string, owner?: string | null): Promise<Array<Omit<OutboxClip, 'blob'>>> {
  const all = await readClips(false)
  return all.filter(c => (!quoteKey || c.quoteKey === quoteKey) && (!owner || !c.owner || c.owner === owner)).map(({ blob, ...c }) => { void blob; return c })
}

export const OUTBOX_EVENT = 'ezbiz:voice-outbox'
let uploading = false

/** Sends every waiting clip; each is removed from the phone only once the Mac has it. */
export async function uploadWaitingClips(): Promise<number> {
  if (uploading || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0
  uploading = true
  let sent = 0
  try {
    // Only while someone is signed in, and only that person's clips (and older ones with no owner).
    const me = signedInUserId()
    if (!me) return 0
    const all = (await readClips(true)).filter(c => !c.owner || c.owner === me)
    for (const c of all) {
      const form = new FormData()
      form.append('quoteKey', c.quoteKey)
      // The clip's own id: sent again after a lost answer, the Mac keeps one copy.
      form.append('id', c.id)
      if (c.hint) form.append('hint', c.hint)
      form.append('audio', c.blob, `clip.${/mp4/.test(c.mime) ? 'm4a' : 'webm'}`)
      const r = await fetchWithAuth(`${API}/clips`, { method: 'POST', body: form }).catch(() => null)
      if (!r?.ok) break
      await tx('readwrite', s => s.delete(c.id))
      sent += 1
    }
  } finally {
    uploading = false
    if (sent) window.dispatchEvent(new Event(OUTBOX_EVENT))
  }
  return sent
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { uploadWaitingClips().catch(() => {}) })
  setInterval(() => { uploadWaitingClips().catch(() => {}) }, 60_000)
}

// ── Server ────────────────────────────────────────────────────────────────────

export interface ServerClip { id: string; quoteKey: string; hint?: string | null; status: 'waiting' | 'transcribing' | 'done' | 'failed'; transcript: string | null; error: string | null; appliedAt: string | null; createdAt: string }

async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const r = await fetchWithAuth(`${API}${path}`, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } }).catch(() => null)
  if (!r?.ok) return null
  const j = await r.json().catch(() => null)
  return (j?.data ?? null) as T | null
}
export const listClips = (quoteKey: string) => call<ServerClip[]>(`/clips?quoteKey=${encodeURIComponent(quoteKey)}`).then(x => x ?? [])
export const markClipApplied = (id: string) => call(`/clips/${id}/applied`, { method: 'POST' })
export const deleteClip = (id: string) => call(`/clips/${id}`, { method: 'DELETE' })
export const voiceServerStatus = () => call<{ ready: boolean; missing: string[] }>('/status')
export const saveVoiceCheck = (results: Record<string, unknown>) => call('/checks', { method: 'POST', body: JSON.stringify({ results }) })
export const listVoiceChecks = () => call<Array<{ id: string; userAgent: string; results: any; createdAt: string }>>('/checks').then(x => x ?? [])
