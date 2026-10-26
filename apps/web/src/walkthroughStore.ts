/**
 * Final walkthrough on a job, offline first through the save queue (outbox).
 *
 * Every change is shown at once and queued: the start (with the id this
 * phone chose, so a repeat is one walkthrough), each checklist item, each
 * required photo, each punch item fixed, each signature. Changes wait for
 * the start to be on the server. The photos themselves go through the media
 * queue (mediaStore); the walkthrough holds each photo's phone id.
 *
 * The server is the record (routes/walkthroughs.ts); what is kept here is
 * only the screen's copy and what has not been confirmed yet.
 */

import { registerKind, enqueue, allOps, type Op } from './outbox'
import { sendJson, API_ORIGIN } from './syncHttp'
import { fetchWithAuth } from './crmAuth'
import { getConfig } from './configStore'
import { refreshJobs } from './jobStore'
import {
  templatesFrom, categoryForStyle, itemsFromTemplate, photoSlots, mergeSlots, missingToFinish,
  type WalkItem, type PhotoSlot, type Signature, type WalkCategory, type ItemResult, type LayoutSides,
  workChecklist,
} from '../../portal/src/server/lib/walkthroughRules'
import type { WorkWordsInput } from '../../portal/src/server/lib/workWords'

export * from '../../portal/src/server/lib/walkthroughRules'

export interface PunchItem {
  id: string
  itemId: string
  label: string
  note: string
  photoClientId: string | null
  status: 'open' | 'fixed'
  fixPhotoClientId: string | null
  fixNote: string
  fixedAt: string | null
  fixedBy: string | null
}

export interface ServerPhoto { id: string; url: string; thumbUrl: string | null; markupUrl: string | null; visibility: string }

export interface Walkthrough {
  id: string
  jobId: string
  category: WalkCategory
  status: 'open' | 'completed'
  items: WalkItem[]
  photos: PhotoSlot[]
  homeownerSig: Signature | null
  repSig: Signature | null
  signedAt: string | null
  link: { token: string; expiresAt: string | null; disabledAt: string | null; state: 'off' | 'expired' | null } | null
  completedAt: string | null
  completedBy: string | null
  hasCertificate: boolean
  startedBy: string | null
  punch: PunchItem[]
  /** Photos on the server, by the phone's id. */
  media: Record<string, ServerPhoto>
  /** What the server said is missing (the screen works it out again from what is here). */
  missing: string[]
}

export const WALKTHROUGH_EVENT = 'ezbiz:walkthrough'
const byJob = new Map<string, Walkthrough | null>()
let version = 0
const emit = () => { version += 1; try { window.dispatchEvent(new Event(WALKTHROUGH_EVENT)) } catch { /* not in a browser */ } }
/** Goes up on every change to any walkthrough on this screen. */
export const walkVersion = () => version

export const walkKey = (id: string) => `walkthrough:${id}`
/** Every change to one walkthrough (for its save status). */
export const isWalkOp = (id: string) => (op: Op) => op.key === walkKey(id) || op.key.startsWith(walkKey(id) + ':')

export function getWalkthrough(jobId: string): Walkthrough | null | undefined { return byJob.get(jobId) }

function newId(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID() } catch { /* below */ }
  return `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
export const newPunchId = newId

/** What is still needed before it can be finished, from what is on this screen. */
export function missingNow(w: Walkthrough): string[] {
  if (w.status === 'completed') return []
  return missingToFinish(w, w.punch.map(p => ({ id: p.id, label: p.label, status: p.status, fixPhotoClientId: p.fixPhotoClientId })), id => !!w.media[id])
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** Load a job's walkthrough from the server, then put this phone's unconfirmed changes on top. */
export async function loadWalkthrough(jobId: string): Promise<Walkthrough | null> {
  try {
    const r = await fetchWithAuth(`${API_ORIGIN}/api/walkthroughs?jobId=${encodeURIComponent(jobId)}`)
    if (r.ok) {
      const j = await r.json()
      byJob.set(jobId, j?.data ?? null)
    }
  } catch { /* no signal: what this phone has */ }
  // Not known (no signal): none yet as far as this phone knows. One started here
  // while another phone also started it is the same walkthrough on the server.
  if (!byJob.has(jobId)) byJob.set(jobId, null)
  reapplyFor(jobId)
  emit()
  return byJob.get(jobId) ?? null
}

function reapplyFor(jobId: string) {
  for (const op of allOps()) if (op.kind.startsWith('walkthrough.') && op.payload?.jobId === jobId) handlers[op.kind]?.apply?.(op)
}

function update(jobId: string, fn: (w: Walkthrough) => Walkthrough) {
  const w = byJob.get(jobId)
  if (!w) return
  byJob.set(jobId, fn(w))
  emit()
}

/** The server's answer becomes the screen's copy, with changes still waiting put back on top. */
function took(op: Op, data: unknown) {
  const w = data as Walkthrough | null
  if (!w?.jobId) return
  byJob.set(w.jobId, w)
  reapplyFor(w.jobId)
  emit()
  // Both signatures in can close the job out on the server: an open job window reads it again.
  if (op.kind === 'walkthrough.sign') void refreshJobs()
}

// ── Changes (each queued) ────────────────────────────────────────────────────

interface Base { walkthroughId: string; jobId: string }
type CreateP = Base & { category: WalkCategory; items: WalkItem[]; photos: PhotoSlot[]; startedBy: string | null }
type ItemP = Base & { itemId: string; result: ItemResult; note: string; photoClientId: string | null; punchId: string | null }
type SlotsP = Base & { slots: PhotoSlot[] }
type PhotoP = Base & { key: string; label: string; kind: PhotoSlot['kind']; clientId: string | null }
type PunchP = Base & { punchId: string; itemId: string; fixPhotoClientId: string; fixNote: string; by: string | null }
type SignP = Base & { who: 'homeowner' | 'rep'; sig: Signature }

// With its job: a walkthrough started on two phones with no signal is one on the server (see routes/walkthroughs.ts).
const path = (p: Base, rest = '') => `/api/walkthroughs/${encodeURIComponent(p.walkthroughId)}${rest}?jobId=${encodeURIComponent(p.jobId)}`

const handlers: Record<string, { apply?: (op: Op) => void }> = {}
function kind<P extends Base>(name: string, h: { send: (op: Op<P>) => Promise<any>; apply: (op: Op<P>) => void; what: string }) {
  const handler = { what: () => h.what, send: h.send, confirmed: took, apply: h.apply }
  registerKind<P>(name, handler)
  handlers[name] = handler as any
}

kind<CreateP>('walkthrough.create', {
  what: 'This walkthrough',
  send: op => sendJson('POST', '/api/walkthroughs', { id: op.payload.walkthroughId, jobId: op.payload.jobId, category: op.payload.category, items: op.payload.items, photos: op.payload.photos }).then(r => r.result),
  apply: op => {
    const p = op.payload
    if (byJob.get(p.jobId)) return
    byJob.set(p.jobId, {
      id: p.walkthroughId, jobId: p.jobId, category: p.category, status: 'open', items: p.items, photos: p.photos, homeownerSig: null, repSig: null, signedAt: null,
      link: null, completedAt: null, completedBy: null, hasCertificate: false, startedBy: p.startedBy, punch: [], media: {}, missing: [],
    })
  },
})

kind<ItemP>('walkthrough.item', {
  what: 'This checklist item',
  send: op => sendJson('PUT', path(op.payload, `/items/${encodeURIComponent(op.payload.itemId)}`), { result: op.payload.result, note: op.payload.note, photoClientId: op.payload.photoClientId, punchId: op.payload.punchId }).then(r => r.result),
  apply: op => update(op.payload.jobId, w => {
    const p = op.payload
    const item = w.items.find(i => i.id === p.itemId)
    if (!item) return w
    const items = w.items.map(i => i.id === p.itemId ? { ...i, result: p.result, note: p.note, photoClientId: p.photoClientId, punchId: p.result === 'fix' ? p.punchId : null } : i)
    let punch = w.punch
    if (p.result === 'fix') {
      const open = punch.find(x => x.itemId === p.itemId && x.status === 'open')
      punch = open ? punch.map(x => x === open ? { ...x, note: p.note, photoClientId: p.photoClientId } : x)
        : [...punch, { id: p.punchId ?? newId(), itemId: p.itemId, label: item.label, note: p.note, photoClientId: p.photoClientId, status: 'open', fixPhotoClientId: null, fixNote: '', fixedAt: null, fixedBy: null }]
    } else punch = punch.filter(x => !(x.itemId === p.itemId && x.status === 'open'))
    return { ...w, items, punch }
  }),
})

kind<SlotsP>('walkthrough.slots', {
  what: 'The photo list',
  send: op => sendJson('PUT', path(op.payload, '/photos'), { slots: op.payload.slots }).then(r => r.result),
  apply: op => update(op.payload.jobId, w => ({ ...w, photos: mergeSlots(op.payload.slots, w.photos) })),
})

kind<PhotoP>('walkthrough.photo', {
  what: 'This photo',
  send: op => sendJson('PUT', path(op.payload, `/photos/${encodeURIComponent(op.payload.key)}`), { clientId: op.payload.clientId, label: op.payload.label, kind: op.payload.kind }).then(r => r.result),
  apply: op => update(op.payload.jobId, w => {
    const p = op.payload
    const has = w.photos.some(s => s.key === p.key)
    const photos = has ? w.photos.map(s => s.key === p.key ? { ...s, clientId: p.clientId } : s) : [...w.photos.slice(0, -1), { key: p.key, label: p.label, kind: p.kind, clientId: p.clientId }, ...w.photos.slice(-1)]
    return { ...w, photos }
  }),
})

kind<PunchP>('walkthrough.punch', {
  what: 'This fix',
  send: op => sendJson('PUT', path(op.payload, `/punch/${encodeURIComponent(op.payload.punchId)}`), { fixPhotoClientId: op.payload.fixPhotoClientId, fixNote: op.payload.fixNote }).then(r => r.result),
  apply: op => update(op.payload.jobId, w => ({
    ...w, punch: w.punch.map(x => x.id === op.payload.punchId ? { ...x, status: 'fixed', fixPhotoClientId: op.payload.fixPhotoClientId, fixNote: op.payload.fixNote, fixedAt: x.fixedAt ?? new Date(op.createdAt).toISOString(), fixedBy: x.fixedBy ?? op.payload.by } : x),
  })),
})

kind<SignP>('walkthrough.sign', {
  what: 'This signature',
  send: op => sendJson('PUT', path(op.payload, `/signatures/${op.payload.who}`), op.payload.sig).then(r => r.result),
  apply: op => update(op.payload.jobId, w => (op.payload.who === 'rep' ? { ...w, repSig: op.payload.sig } : { ...w, homeownerSig: op.payload.sig })),
})


// ── What the screens call ────────────────────────────────────────────────────

export interface JobForWalk { id: string; fenceStyle: string; walkGates: number; dblGates: number }

/** Start the job's walkthrough on this phone (queued; works with no signal). */
export async function startWalkthrough(job: JobForWalk, opts: { layout?: LayoutSides | null; runCount?: number; by?: string | null; repairGates?: number; work?: WorkWordsInput | null } = {}): Promise<Walkthrough> {
  const existing = byJob.get(job.id)
  if (existing) return existing
  const category = categoryForStyle(job.fenceStyle)
  const templates = templatesFrom((getConfig() as any).walkthroughTemplates)
  // A repair: its own checklist from the repair items; a move: the style's plus the old line.
  const items = itemsFromTemplate(workChecklist(opts.work, templates[category]))
  const photos = opts.layout?.sides?.some(s => s.on) ? photoSlots({ layout: opts.layout, repairGates: opts.repairGates }) : photoSlots({ sideCount: Math.max(1, opts.runCount ?? 1), gateCount: (job.walkGates || 0) + (job.dblGates || 0), repairGates: opts.repairGates, repair: (opts.work as { type?: string } | null | undefined)?.type === 'repair' })
  const id = newId()
  await queue<CreateP>('walkthrough.create', walkKey(id), { walkthroughId: id, jobId: job.id, category, items, photos, startedBy: opts.by ?? null }, 'Final walkthrough started')
  return byJob.get(job.id)!
}

/**
 * Show a change at once, then queue it. Shown first, so a second tap right
 * after (before the phone's storage answers) builds on the first.
 */
async function queue<P extends Base>(kind: string, key: string, payload: P, label: string, afterKeys: string[] = []) {
  handlers[kind].apply!({ id: '', key, kind, payload, label, createdAt: Date.now(), attempts: 0, state: 'pending' } as Op<P>)
  emit()
  await enqueue<P>({ key, kind, payload, label, after: afterKeys.length ? afterKeys : undefined })
}

/** The screen's current copy (a caller may hold an older one). */
const fresh = (w: Walkthrough) => byJob.get(w.jobId) ?? w
const after = (w: Walkthrough) => [walkKey(w.id)]

export async function setItem(w0: Walkthrough, itemId: string, change: { result: ItemResult; note: string; photoClientId: string | null }) {
  const w = fresh(w0)
  const cur = w.items.find(i => i.id === itemId)
  if (!cur) return
  // A Needs fixing keeps one punch item id while it stays Needs fixing (a repeat makes one).
  const openPunch = w.punch.find(p => p.itemId === itemId && p.status === 'open')
  const punchId = change.result === 'fix' ? (openPunch?.id || (cur.result === 'fix' ? cur.punchId : null) || newId()) : null
  await queue<ItemP>('walkthrough.item', `${walkKey(w.id)}:item:${itemId}`, { walkthroughId: w.id, jobId: w.jobId, itemId, ...change, punchId }, `Walkthrough: ${cur.label}`, after(w))
}

export async function setCounts(w0: Walkthrough, sides: number, gates: number) {
  const w = fresh(w0)
  const slots = mergeSlots(photoSlots({ sideCount: sides, gateCount: gates }), w.photos)
  await queue<SlotsP>('walkthrough.slots', `${walkKey(w.id)}:slots`, { walkthroughId: w.id, jobId: w.jobId, slots }, 'Walkthrough: photo list', after(w))
}

export async function setSlotPhoto(w0: Walkthrough, slot: PhotoSlot, clientId: string | null) {
  const w = fresh(w0)
  await queue<PhotoP>('walkthrough.photo', `${walkKey(w.id)}:photo:${slot.key}`, { walkthroughId: w.id, jobId: w.jobId, key: slot.key, label: slot.label, kind: slot.kind, clientId }, `Walkthrough photo: ${slot.label}`, [...after(w), `${walkKey(w.id)}:slots`])
}

export async function fixPunch(w0: Walkthrough, p: PunchItem, fixPhotoClientId: string, fixNote: string, by: string | null) {
  const w = fresh(w0)
  await queue<PunchP>('walkthrough.punch', `${walkKey(w.id)}:punch:${p.id}`, { walkthroughId: w.id, jobId: w.jobId, punchId: p.id, itemId: p.itemId, fixPhotoClientId, fixNote, by }, `Walkthrough fix: ${p.label}`, [...after(w), `${walkKey(w.id)}:item:${p.itemId}`])
}

export async function sign(w0: Walkthrough, who: 'homeowner' | 'rep', sig: Signature) {
  const w = fresh(w0)
  await queue<SignP>('walkthrough.sign', `${walkKey(w.id)}:sign:${who}`, { walkthroughId: w.id, jobId: w.jobId, who, sig }, `Walkthrough: ${who === 'rep' ? 'our' : "homeowner's"} signature`, after(w))
}

/** True while any change to this walkthrough is still waiting to be saved. */
export const walkPending = (w: Walkthrough) => allOps().some(isWalkOp(w.id))

// ── Needs signal (the office's actions, and finishing) ───────────────────────

async function call(method: string, rest: string, w: Walkthrough): Promise<{ ok: boolean; data: any; error?: string }> {
  const r = await sendJson(method, `/api/walkthroughs/${encodeURIComponent(w.id)}${rest}${rest.includes('?') ? '&' : '?'}jobId=${encodeURIComponent(w.jobId)}`)
  return { ok: r.result.ok, data: r.json?.data, error: r.json?.error }
}

/** Finish: the server makes the certificate, or says what is missing. */
export async function finishWalkthrough(w: Walkthrough): Promise<{ ok: boolean; missing?: string[]; error?: string }> {
  const r = await call('POST', '/finish', w)
  if (r.ok && r.data) { byJob.set(w.jobId, r.data); reapplyFor(w.jobId); emit(); void refreshJobs(); return { ok: true } }
  return { ok: false, missing: r.data?.missing, error: r.error }
}

export async function homeownerLink(w: Walkthrough, fresh = false): Promise<{ token: string; expiresAt: string } | null> {
  const r = await call('POST', `/link${fresh ? '?new=1' : ''}`, w)
  if (!r.ok) return null
  update(w.jobId, x => ({ ...x, link: { token: r.data.token, expiresAt: r.data.expiresAt, disabledAt: null, state: null } }))
  return r.data
}

export async function turnOffLink(w: Walkthrough): Promise<boolean> {
  const r = await call('POST', '/link-off', w)
  if (r.ok) update(w.jobId, x => ({ ...x, link: x.link ? { ...x.link, disabledAt: new Date().toISOString(), state: 'off' } : null }))
  return r.ok
}

/** The certificate as a file on this device (opened in a new tab by the caller). */
export async function certificateBlob(w: Walkthrough): Promise<Blob | null> {
  const r = await fetchWithAuth(`${API_ORIGIN}/api/walkthroughs/${encodeURIComponent(w.id)}/certificate.pdf`).catch(() => null)
  return r?.ok ? r.blob() : null
}

/** The homeowner's page: the public door on a Tailscale address, the app's own address otherwise (as proposals). */
export function walkthroughUrl(token: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/w/${token}` : `${origin}/p/w/${token}`
}

/** A server photo's address for this app (the API may be on another port in dev). */
export const photoSrc = (m: ServerPhoto) => API_ORIGIN + (m.markupUrl ?? m.thumbUrl ?? m.url)
