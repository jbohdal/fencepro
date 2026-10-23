/**
 * The outbox: nothing entered is lost or fails silently.
 *
 * Every create and edit (customer, pipeline card and stage, note, quote,
 * appointment) is written here on the phone first, then sent to the server
 * one at a time, and kept until the server confirms it. It survives closing
 * the app, losing signal and the phone sleeping: what is waiting is in the
 * phone's own storage (IndexedDB) and is sent again when the app is open and
 * there is signal. Photos and video have their own resumable queue
 * (mediaStore) and show in the same badge.
 *
 * What is kept is only changes the server has not confirmed yet; each one is
 * deleted the moment it is confirmed. The server stays the source of truth.
 * Each change is encrypted before it is written to the phone (vault.ts: a key
 * the browser keeps and no script can read out); only its random id is kept
 * in the clear, to find it again.
 *
 * Changes belong to the person who made them (`account`, their login id):
 * after a sign out they wait on the phone and go when that same person signs
 * in again here; another person signed in on the phone never sends them.
 *
 * Sending again never makes a duplicate: every new record carries the id it
 * was given on the phone, and the server treats a second create with the same
 * id as the first. Edits send the whole record, so sending one twice is the
 * same as once.
 *
 * Each kind of change registers how to send it and how to show it on screen
 * before it is confirmed (registerKind). Changes to one record go in order; a
 * change can wait for another record (a note waits for its new customer).
 */

import { plainError, plainThrown, type PlainError } from './plainError'
import { sealJson, openJson, vaultAvailable } from './vault'

export interface Op<P = any> {
  id: string
  /** The record: 'customer:<id>', 'quote:<id>', 'pipeline', ... */
  key: string
  kind: string
  payload: P
  /** Records that must be fully saved before this is sent. */
  after?: string[]
  /** For the waiting list: "Dave Diamond, new customer". */
  label: string
  createdAt: number
  attempts: number
  state: 'pending' | 'failed'
  /** Plain words, when the last try did not work. */
  error?: string
  errorKind?: PlainError['kind']
  nextAt?: number
  account?: string | null
}

/** What a send came to. */
export type SendResult =
  | { ok: true; data?: unknown }
  | { ok: false; status: number; error?: string; retryNow?: boolean; code?: string }

export interface KindHandler<P = any> {
  /** Send it. Resolve { ok: true } only once the server has confirmed it. */
  send: (op: Op<P>) => Promise<SendResult>
  /** The server confirmed it: take its answer (server set fields) into the screen's copy. */
  confirmed?: (op: Op<P>, data: unknown) => void
  /** Show it on screen before it is confirmed (after a reload, a pending change is put back on top of what the server sent). */
  apply?: (op: Op<P>) => void
  /** What the change is called in messages ("This customer"). */
  what?: (op: Op<P>) => string
  /**
   * The server refused it for this login's role (403). It is not sent again;
   * put the screen back to what the server has. Called after it left the outbox.
   */
  refused?: (op: Op<P>, message: string) => void
}

/** A window event, sent when a change was refused for the login's role: { message, label }. */
export const REFUSED_EVENT = 'ezbiz:refused'

export type RecordStatus = 'saved' | 'saving' | 'waiting' | 'failed'

// ── Storage ──────────────────────────────────────────────────────────────────

export interface OutboxStorage {
  all(): Promise<Op[]>
  put(op: Op): Promise<void>
  remove(id: string): Promise<void>
}

const DB = 'ezbiz-outbox', STORE = 'ops'
/** As kept on the phone: the change sealed (vault.ts), and its id to find it. A change kept before encryption (no `sealed`) is sealed on the next start. */
type Row = { id: string; sealed: ArrayBuffer } | Op
function idb(): OutboxStorage | null {
  if (typeof indexedDB === 'undefined' || !vaultAvailable()) return null
  let dbp: Promise<IDBDatabase> | null = null
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open()
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => res(req ? (req as IDBRequest<T>).result : undefined)
      t.onerror = () => rej(t.error)
      t.onabort = () => rej(t.error)
    })
  }
  const put = async (op: Op) => { const row: Row = { id: op.id, sealed: await sealJson(op) }; await tx('readwrite', s => { s.put(row) }) }
  return {
    all: async () => {
      const rows = (await tx<Row[]>('readonly', s => s.getAll())) ?? []
      const out: Op[] = []
      for (const row of rows) {
        if ('sealed' in row && row.sealed) {
          // One that cannot be opened (sealed with a key this browser no longer has) is left as it is, never deleted.
          try { out.push(await openJson<Op>(row.sealed)) } catch { console.warn('[outbox] a waiting change could not be opened on this phone') }
        } else {
          // Kept before encryption: sealed now, in place.
          out.push(row as Op)
          await put(row as Op)
        }
      }
      return out
    },
    put,
    remove: async id => { await tx('readwrite', s => { s.delete(id) }) },
  }
}
/** When the phone's storage cannot be opened (a private window): kept for this visit only, and said so. */
function memoryStorage(): OutboxStorage {
  const m = new Map<string, Op>()
  return { all: async () => [...m.values()], put: async op => { m.set(op.id, op) }, remove: async id => { m.delete(id) } }
}

// ── State ────────────────────────────────────────────────────────────────────

let storage: OutboxStorage = memoryStorage()
let durable = false
const kinds = new Map<string, KindHandler>()
let ops: Op[] = []
let inFlight: string | null = null
let pumping = false
let timer: ReturnType<typeof setTimeout> | null = null
let account: string | null = null
let started = false
let lastNetworkFail = 0
let signedOut = false
const listeners = new Set<() => void>()
let version = 0

// Never more than 20 s between tries, so a phone back in signal sends soon even when the phone does not say so.
const BACKOFF_MS = [1_000, 3_000, 6_000, 10_000, 15_000, 20_000]
const SEND_TIMEOUT_MS = 30_000

function emit() { version += 1; listeners.forEach(f => { try { f() } catch { /* a screen that is going away */ } }) }

export function registerKind<P>(kind: string, handler: KindHandler<P>) { kinds.set(kind, handler as KindHandler) }

/** Order of changes: strictly increasing, even for two made in the same millisecond. */
let lastStamp = 0
function stamp(): number { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp }

function newOpId(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID() } catch { /* fall through */ }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Start sending. Call once signed in, with the company the user belongs to
 * (changes made under another login on this phone wait for that login).
 */
export async function startOutbox(accountId: string | null, opts: { storage?: OutboxStorage } = {}) {
  account = accountId
  signedOut = false
  if (!started) {
    started = true
    const s = opts.storage ?? idb()
    if (s) {
      try { await s.all(); storage = s; durable = true } catch { storage = memoryStorage(); durable = false }
    }
    try { ops = (await storage.all()).sort((a, b) => a.createdAt - b.createdAt) } catch { ops = [] }
    // The app was just opened: what waited goes now, not after its old wait.
    for (const op of ops) { op.nextAt = undefined; lastStamp = Math.max(lastStamp, op.createdAt) }
    if (typeof window !== 'undefined') {
      // Signal back: everything waiting goes now, not after its wait.
      window.addEventListener('online', () => { lastNetworkFail = 0; for (const op of ops) op.nextAt = undefined; emit(); kick() })
      // Losing signal changes what the screen says, even before anything is tried.
      window.addEventListener('offline', () => emit())
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick() })
      window.addEventListener('focus', () => kick())
      setInterval(() => kick(), 30_000)
    }
  }
  emit()
  kick()
}

/** True when what is waiting is kept in the phone's storage (not just in this page). */
export const isDurable = () => durable

/**
 * Put changes kept on the phone back on screen, on top of what the server
 * sent. Each store calls this once it has loaded, for its own kinds.
 */
export function reapply(kindPrefix: string) {
  for (const op of ops) if (op.kind.startsWith(kindPrefix) && mine(op)) kinds.get(op.kind)?.apply?.(op)
}

const mine = (op: Op) => !op.account || !account || op.account === account

/**
 * Add a change. It is in the phone's storage before this resolves. A later
 * edit to the same record replaces an earlier one still waiting (only the
 * newest copy needs to go), unless the earlier one is a create.
 */
export async function enqueue<P>(o: { key: string; kind: string; payload: P; label: string; after?: string[]; coalesce?: boolean }): Promise<Op<P>> {
  if (o.coalesce !== false) {
    const same = ops.find(x => x.key === o.key && x.kind === o.kind && x.id !== inFlight && x.state === 'pending' && !/\.create$/.test(x.kind))
    if (same) {
      same.payload = o.payload
      same.label = o.label
      same.after = o.after
      same.attempts = 0
      same.nextAt = undefined
      await persist(same)
      emit(); kick()
      return same as Op<P>
    }
  }
  const op: Op<P> = { id: newOpId(), key: o.key, kind: o.kind, payload: o.payload, after: o.after, label: o.label, createdAt: stamp(), attempts: 0, state: 'pending', account }
  ops.push(op as Op)
  await persist(op as Op)
  emit(); kick()
  return op
}

async function persist(op: Op) { try { await storage.put(op) } catch { durable = false } }
async function drop(op: Op) { ops = ops.filter(x => x.id !== op.id); try { await storage.remove(op.id) } catch { /* gone from the screen's list anyway */ } }

/** Send what is waiting, now. */
export function kick() {
  if (timer) { clearTimeout(timer); timer = null }
  void pump()
}

function isReady(op: Op, now: number): boolean {
  if (op.state !== 'pending' || !mine(op)) return false
  if (op.nextAt && op.nextAt > now) return false
  // Earlier changes to the same record go first.
  const earlier = ops.find(x => x.key === op.key && x.createdAt < op.createdAt)
  if (earlier) return false
  // Records this one depends on must be fully on the server.
  if (op.after?.some(k => k !== op.key && ops.some(x => x.key === k && mine(x)))) return false
  return true
}

async function pump() {
  if (pumping || !started || signedOut) return
  pumping = true
  try {
    for (;;) {
      const now = Date.now()
      // A kind whose sender has not loaded yet waits; the others go.
      const op = ops.find(x => isReady(x, now) && kinds.has(x.kind))
      if (!op) break
      const handler = kinds.get(op.kind)!
      inFlight = op.id
      emit()
      let r: SendResult
      try {
        r = await withTimeout(handler.send(op), SEND_TIMEOUT_MS)
      } catch (err) {
        const p = plainThrown(err, handler.what?.(op))
        r = { ok: false, status: p.kind === 'offline' ? 0 : 500, error: String((err as Error)?.message ?? err) }
      }
      inFlight = null
      if (r.ok) {
        await drop(op)
        lastNetworkFail = 0
        try { handler.confirmed?.(op, r.data) } catch { /* the screen copy is refreshed on the next load */ }
        emit()
        continue
      }
      if (r.retryNow && op.attempts < 5) { op.attempts += 1; await persist(op); continue }
      // Refused for this login's role: never sent again. The change leaves the
      // phone, the screen goes back to the server's copy, and the reason is shown.
      // Or a signed quote's price (409 QUOTE_LOCKED): it stays as signed; the change goes on a change order.
      if ((r.status === 403 && r.code === 'NOT_ALLOWED') || (r.status === 409 && r.code === 'QUOTE_LOCKED')) {
        const message = r.status === 409 && r.error ? r.error : plainError(403, r.error, handler.what?.(op) ?? 'This change').message
        await drop(op)
        try { handler.refused?.(op, message) } catch { /* the next load shows the server's copy */ }
        try { window.dispatchEvent(new CustomEvent(REFUSED_EVENT, { detail: { message, label: op.label } })) } catch { /* no window (tests) */ }
        try { window.dispatchEvent(new CustomEvent('ezbiz:reload-page-data')) } catch { /* no window (tests) */ }
        emit()
        continue
      }
      // A newer copy of this same edit was made while this one was on its way: only the newer one needs to go.
      if (!/\.create$/.test(op.kind) && ops.some(x => x.key === op.key && x.kind === op.kind && x.createdAt > op.createdAt)) { await drop(op); emit(); continue }
      const p = plainError(r.status, r.error, handler.what?.(op) ?? 'This change')
      op.attempts += 1
      op.error = p.message
      op.errorKind = p.kind
      if (p.kind === 'offline') lastNetworkFail = Date.now()
      if (p.kind === 'signed-out') { signedOut = true; await persist(op); emit(); break }
      if (p.retry) op.nextAt = Date.now() + BACKOFF_MS[Math.min(op.attempts - 1, BACKOFF_MS.length - 1)]
      else op.state = 'failed'
      await persist(op)
      emit()
    }
  } finally {
    pumping = false
    inFlight = null
  }
  const next = ops.filter(x => x.state === 'pending' && x.nextAt && mine(x)).map(x => x.nextAt!).sort((a, b) => a - b)[0]
  if (next && !timer) timer = setTimeout(() => { timer = null; void pump() }, Math.max(250, next - Date.now()))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timed out')), ms)
    p.then(v => { clearTimeout(t); res(v) }, e => { clearTimeout(t); rej(e) })
  })
}

/** Signed in again: send what waited. */
export function resumeAfterSignIn() { signedOut = false; for (const op of ops) if (op.errorKind === 'signed-out') { op.nextAt = undefined } kick() }

/** Try a change that could not be saved again (or everything waiting). */
export async function retry(opId?: string) {
  for (const op of ops) {
    if (opId && op.id !== opId) continue
    op.state = 'pending'; op.nextAt = undefined; op.attempts = 0
    await persist(op)
  }
  signedOut = false
  emit(); kick()
}

/** Throw a change away. Only on the user's say so: it is not on the server. */
export async function discard(opId: string) {
  const op = ops.find(x => x.id === opId)
  if (op) { await drop(op); emit() }
}

// ── Status ───────────────────────────────────────────────────────────────────

/** Is there signal, as far as the app can tell. */
export function hasSignal(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return !lastNetworkFail || Date.now() - lastNetworkFail > 60_000 ? true : false
}

/** Saved, Saving, Waiting for signal, or Couldn't save, for the records given. */
export function statusOf(keys: string[], also?: (op: Op) => boolean): { status: RecordStatus; error?: string; ops: Op[] } {
  const mineOps = ops.filter(o => keys.includes(o.key) || (also ? also(o) : false))
  if (!mineOps.length) return { status: 'saved', ops: [] }
  const failed = mineOps.find(o => o.state === 'failed')
  if (failed) return { status: 'failed', error: failed.error, ops: mineOps }
  const waiting = mineOps.some(o => o.errorKind === 'offline' || o.errorKind === 'signed-out' || o.errorKind === 'server') || !hasSignal()
  return { status: waiting ? 'waiting' : 'saving', error: mineOps.find(o => o.error)?.error, ops: mineOps }
}

export function pendingFor(keyPrefix: string): Op[] { return ops.filter(o => o.key.startsWith(keyPrefix)) }
export function hasPending(key: string): boolean { return ops.some(o => o.key === key) }
export function allOps(): Op[] { return [...ops] }

/** Resolves true once everything for the record is confirmed, false if that takes longer than `ms`. */
export function whenSaved(key: string, ms: number): Promise<boolean> {
  return new Promise(res => {
    if (!hasPending(key)) { res(true); return }
    const off = subscribe(() => { if (!hasPending(key)) { off(); clearTimeout(t); res(true) } })
    const t = setTimeout(() => { off(); res(!hasPending(key)) }, ms)
  })
}

export function subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f) } }
export function outboxVersion() { return version }

/** Changes waiting on this phone for this person (or, with no one given, for anyone). */
export function waitingFor(userId: string | null): number {
  return ops.filter(o => !userId || !o.account || o.account === userId).length
}

/** For tests: forget everything. */
export function _resetForTests() {
  ops = []; inFlight = null; pumping = false; started = false; account = null; signedOut = false; lastNetworkFail = 0
  kinds.clear(); listeners.clear(); storage = memoryStorage(); durable = false
  if (timer) { clearTimeout(timer); timer = null }
}
