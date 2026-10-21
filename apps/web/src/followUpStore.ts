/**
 * Follow ups in the app: what the server says about each card's next follow
 * up, answers to "How'd it go?", one tap date changes, and the call that was
 * just started from a Call or Text tap.
 *
 * Nothing here is kept in the browser's storage. Answers and date changes go
 * through the outbox (outbox.ts), which holds them until the server confirms,
 * so an answer given with no signal saves when the signal returns; until then
 * the screens show the next date it will get (worked out with the same rules
 * as the server, followUpRules.ts). A call started from the app is kept in
 * memory and on the server (/api/follow-ups/pending), so a phone that reloaded
 * the app during the call still asks how it went.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { sendJson } from './syncHttp'
import { getAccessToken } from './crmAuth'
import { registerKind, enqueue, allOps, reapply, subscribe as onOutbox } from './outbox'
import { newId } from './recordSync'
import { getPipeline, PIPELINE_UPDATED_EVENT } from './pipelineStore'
import type { Opened } from './proposalOpened'
import {
  applyAnswer, badgeFor, defaultConfig, dueStatus, floridaDay, keepGoing, setNext, reconcile, OUTCOME_LABEL, stopsSteps, MUST_HAVE_FOLLOW_UP,
  type Channel, type DueKind, type FollowUpConfig, type FollowUpState, type LostReason, type Outcome, type DueStatus,
} from './followUpRules'

export interface BoardCard {
  dueOn: string | null
  dueKind: DueKind
  status: DueStatus
  days: number
  badge: { text: string; tone: 'red' | 'orange' | 'gray' } | null
  stepIndex: number
  stepCount: number
  lastOutcome: Outcome | null
  lastContactAt: string | null
  ownerName: string
  state: FollowUpState | null
  /** Customer opens of the proposal sent (null: none sent). */
  opened?: Opened | null
}

export interface ListRow extends BoardCard {
  cardId: string
  customerId: string | null
  name: string
  firstName: string
  stage: string
  phone: string
  address: string
  valueCents: number
  ownerId: string | null
  daysSinceContact: number | null
  touches: number
}

/** A card whose customer opened the proposal in the last day: the latest open. */
export interface OpenedRow extends ListRow {
  openedAt: string
  openedDevice: string
  /** "Better ($8,200)", or '' (one option, or none looked at). */
  openedLongest: string
  openedTimes: number
}

export interface FollowUpList {
  today: string
  seesEveryone: boolean
  rep: string | null
  /** Opened in the last 24h (customers only), newest first. */
  opened24h?: OpenedRow[]
  overdue: ListRow[]
  dueToday: ListRow[]
  upcoming: ListRow[]
  notSet: ListRow[]
  reps: Array<{ id: string; name: string }>
}

// ── State ────────────────────────────────────────────────────────────────────

let config: FollowUpConfig = defaultConfig()
let configVersion = 0
let configLoaded = false
let board: { today: string; cards: Record<string, BoardCard> } | null = null
/** Cards whose follow up this phone changed and the server has not shown back yet. */
const overrides = new Map<string, FollowUpState>()
const listeners = new Set<() => void>()
let tick = 0
function emit() { tick++; listeners.forEach(f => { try { f() } catch { /* a screen going away */ } }) }
export const CHANGED_EVENT = 'ezbiz:followups:changed'
function changed() { emit(); try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT)) } catch { /* no window */ } }

export function subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f) } }
export const today = () => floridaDay(new Date())

/** Re-renders when follow ups change here or on the server. */
export function useFollowUps(): number {
  return useSyncExternalStore(subscribe, () => tick, () => tick)
}

const cardOf = (cardId: string): any | null => (getPipeline().leads || []).find((l: any) => l?.id === cardId) ?? null

function shown(cardId: string, base: BoardCard | undefined): BoardCard | null {
  const o = overrides.get(cardId)
  if (!o) return base ?? null
  const card = cardOf(cardId)
  const stage = card?.stage ?? o.stage
  const t = today()
  const s = dueStatus(o, t)
  const steps = config.steps[stage] ?? []
  return {
    dueOn: o.dueOn, dueKind: o.dueKind, status: s.status, days: s.days, badge: badgeFor(o, stage, t),
    stepIndex: o.stepIndex, stepCount: steps.length, lastOutcome: o.lastOutcome, lastContactAt: o.lastContactAt,
    ownerName: base?.ownerName ?? '', state: o,
  }
}

/** A card's follow up, as this phone knows it (null: not loaded yet). */
export function followUpOf(cardId: string): BoardCard | null {
  return shown(cardId, board?.cards[cardId])
}

/** How often the card's customer opened the proposal sent, as the server last said (null: none sent, or not loaded). */
export function openedOf(cardId: string): Opened | null {
  return board?.cards[cardId]?.opened ?? null
}

/** The badge for a card on the pipeline, or null (nothing to show). Worked out from the card as this phone has it, so a card just moved shows its new stage's follow up. */
export function badgeOf(card: { id: string; stage: string; lastMoved?: string; createdAt?: string }): BoardCard['badge'] {
  if (!board && !overrides.has(card.id)) return null
  const t = today()
  const s = overrides.get(card.id) ?? board?.cards[card.id]?.state ?? null
  return badgeFor(reconcile(s, card, config, t), card.stage, t)
}

/** Needs a follow up now (the pipeline filter): overdue, due today, or Estimating or Pending Signature with none. */
export function needsFollowUpNow(card: { id: string; stage: string; lastMoved?: string; createdAt?: string }): boolean {
  return !!badgeOf(card)
}

export function getConfig(): FollowUpConfig { return config }
export function getConfigVersion(): number { return configVersion }

// ── Reading ──────────────────────────────────────────────────────────────────

let loadingBoard: Promise<void> | null = null
export function refreshBoard(): Promise<void> {
  if (loadingBoard) return loadingBoard
  loadingBoard = (async () => {
    const [b, c] = await Promise.all([sendJson('GET', '/api/follow-ups/board'), configLoaded ? null : sendJson('GET', '/api/follow-ups/settings')])
    if (c?.result.ok && c.json?.data) { config = c.json.data; configVersion = Number(c.json.version) || 0; configLoaded = true }
    if (b.result.ok && b.json?.data) {
      board = b.json.data
      // What the server now shows replaces this phone's own copy, once nothing is still on its way.
      for (const id of [...overrides.keys()]) if (!pendingFor(id)) overrides.delete(id)
      changed()
    }
  })().finally(() => { loadingBoard = null })
  return loadingBoard
}

export async function loadConfig(): Promise<{ config: FollowUpConfig; version: number } | null> {
  const r = await sendJson('GET', '/api/follow-ups/settings')
  if (!r.result.ok || !r.json?.data) return null
  config = r.json.data; configVersion = Number(r.json.version) || 0; configLoaded = true
  emit()
  return { config, version: configVersion }
}

/** Settings > Follow ups: save on the version it was built on. */
export async function saveConfig(next: FollowUpConfig, baseVersion: number): Promise<{ ok: true; version: number } | { ok: false; error: string; stale?: boolean }> {
  const r = await sendJson('PUT', '/api/follow-ups/settings', { ...next, baseVersion })
  if (r.result.ok) { config = r.json.data; configVersion = Number(r.json.version) || 0; changed(); void refreshBoard(); return { ok: true, version: configVersion } }
  if (r.status === 409 && r.json?.data) { config = r.json.data; configVersion = Number(r.json.version) || 0; emit(); return { ok: false, error: r.json.error, stale: true } }
  return { ok: false, error: (r.result as any).error || 'Could not save. Check the connection and try again.' }
}

/** Keep the badges current while a screen that shows them is open. */
export function useFollowUpBoard(): number {
  const t = useFollowUps()
  useEffect(() => {
    void refreshBoard()
    const again = () => { if (document.visibilityState === 'visible') void refreshBoard() }
    const iv = setInterval(again, 60_000)
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    // A card moved: its stage's steps start again (the server does it with the move).
    let wait: ReturnType<typeof setTimeout> | null = null
    const moved = () => { if (wait) clearTimeout(wait); wait = setTimeout(() => void refreshBoard(), 2500) }
    window.addEventListener(PIPELINE_UPDATED_EVENT, moved)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); window.removeEventListener(PIPELINE_UPDATED_EVENT, moved); if (wait) clearTimeout(wait) }
  }, [])
  return t
}

/** The Follow ups screen's lists (the server decides whose cards). With no signal, the last ones loaded, with this phone's answers on top. */
let lastList = new Map<string, FollowUpList>()
export function useFollowUpList(rep: string): { list: FollowUpList | null; loading: boolean; offline: boolean; reload: () => void } {
  const t = useFollowUps()
  const [raw, setRaw] = useState<FollowUpList | null>(lastList.get(rep) ?? null)
  const [loading, setLoading] = useState(!lastList.has(rep))
  const [offline, setOffline] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(!lastList.has(rep))
    sendJson('GET', `/api/follow-ups/list${rep ? `?rep=${encodeURIComponent(rep)}` : ''}`).then(r => {
      if (!live) return
      if (r.result.ok && r.json?.data) { lastList.set(rep, r.json.data); setRaw(r.json.data); setOffline(false) } else setOffline(r.status === 0)
      setLoading(false)
    })
    return () => { live = false }
  }, [rep, n])
  useEffect(() => {
    const h = () => setN(x => x + 1)
    window.addEventListener(CHANGED_EVENT, h)
    const again = () => { if (document.visibilityState === 'visible') h() }
    document.addEventListener('visibilitychange', again)
    return () => { window.removeEventListener(CHANGED_EVENT, h); document.removeEventListener('visibilitychange', again) }
  }, [])
  void t // re-render when an answer is given here
  return { list: raw ? withOverrides(raw) : null, loading, offline, reload: () => setN(x => x + 1) }
}

/** Rows this phone answered for, moved to where their new date puts them. */
function withOverrides(l: FollowUpList): FollowUpList {
  if (!overrides.size) return l
  const all = [...l.overdue, ...l.dueToday, ...l.upcoming, ...l.notSet].map(r => {
    const f = overrides.has(r.cardId) ? shown(r.cardId, r) : null
    return f ? { ...r, ...f, stage: cardOf(r.cardId)?.stage ?? r.stage } : r
  })
  const open = all.filter(r => !stopsSteps(r.stage))
  const by = (a: ListRow, b: ListRow) => (a.dueOn || '').localeCompare(b.dueOn || '')
  return {
    ...l,
    overdue: open.filter(r => r.status === 'overdue').sort(by),
    dueToday: open.filter(r => r.status === 'today').sort(by),
    upcoming: open.filter(r => r.status === 'upcoming').sort(by),
    notSet: open.filter(r => r.status === 'none' && MUST_HAVE_FOLLOW_UP.includes(r.stage)),
  }
}

// ── Answers and date changes (through the outbox) ───────────────────────────

interface CallOp { id: string; cardId: string; customerId: string | null; name: string; channel: Channel; outcome: Outcome; lostReason: LostReason | null; note: string; pickedOn: string | null; at: string }
interface NextOp { cardId: string; dueOn: string | null; keep: boolean; at: string }

/** Is an answer or date change for this card still on its way? */
export function pendingFor(cardId: string): boolean {
  return allOps().some(o => (o.kind === 'callLog.create' || o.kind === 'followup.next') && (o.payload as any)?.cardId === cardId)
}

/** Answers still on their way, for a card's history ("Saving…"). */
export function pendingCalls(cardId: string | null, customerId: string | null): CallOp[] {
  return allOps().filter(o => o.kind === 'callLog.create' && ((cardId && o.payload?.cardId === cardId) || (customerId && o.payload?.customerId === customerId))).map(o => o.payload as CallOp)
}

/** The follow up a card has now, as the base for a change made on this phone. */
function current(cardId: string): FollowUpState | null {
  return overrides.get(cardId) ?? board?.cards[cardId]?.state ?? null
}

function predictCall(p: CallOp) {
  const card = cardOf(p.cardId)
  if (!card) return
  overrides.set(p.cardId, applyAnswer(current(p.cardId), card, config, { outcome: p.outcome, pickedOn: p.pickedOn, today: floridaDay(p.at), at: p.at }))
}
function predictNext(p: NextOp) {
  const card = cardOf(p.cardId)
  if (!card) return
  const t = floridaDay(p.at)
  overrides.set(p.cardId, p.keep ? keepGoing(current(p.cardId), card, config, t) : setNext(current(p.cardId), card, config, p.dueOn, t))
}

/** Save an answer: on screen now, on the server as soon as there is signal. Returns the next follow up it sets. */
export async function logAnswer(a: { cardId: string; customerId?: string | null; name: string; channel: Channel; outcome: Outcome; lostReason?: LostReason | null; note?: string; pickedOn?: string | null }): Promise<FollowUpState | null> {
  const op: CallOp = {
    id: newId(), cardId: a.cardId, customerId: a.customerId ?? null, name: a.name, channel: a.channel, outcome: a.outcome,
    lostReason: a.outcome === 'lost' ? (a.lostReason ?? 'other') : null, note: (a.note ?? '').trim(), pickedOn: a.pickedOn ?? null, at: new Date().toISOString(),
  }
  predictCall(op)
  changed()
  await enqueue<CallOp>({ key: `call:${op.id}`, kind: 'callLog.create', payload: op, label: `${a.name}: ${OUTCOME_LABEL[a.outcome]}` })
  return overrides.get(a.cardId) ?? null
}

/** One tap to change the next follow up (null: none), or keep a going-cold card (the steps start again). */
export async function changeNext(cardId: string, name: string, change: { dueOn?: string | null; keep?: boolean }): Promise<FollowUpState | null> {
  const op: NextOp = { cardId, dueOn: change.dueOn ?? null, keep: !!change.keep, at: new Date().toISOString() }
  predictNext(op)
  changed()
  // After this card's answers still on their way, so the date picked is the one that stays.
  const after = allOps().filter(o => o.kind === 'callLog.create' && o.payload?.cardId === cardId).map(o => o.key)
  await enqueue<NextOp>({ key: `followup:${cardId}`, kind: 'followup.next', payload: op, label: `${name}: next follow up`, after })
  return overrides.get(cardId) ?? null
}

let refreshSoon: ReturnType<typeof setTimeout> | null = null
const refreshAfterSave = () => { if (refreshSoon) clearTimeout(refreshSoon); refreshSoon = setTimeout(() => { refreshSoon = null; void refreshBoard() }, 300) }

registerKind<CallOp>('callLog.create', {
  what: () => 'This answer',
  send: op => sendJson('POST', '/api/follow-ups/calls', {
    id: op.payload.id, cardId: op.payload.cardId, channel: op.payload.channel, outcome: op.payload.outcome,
    lostReason: op.payload.lostReason, note: op.payload.note, pickedOn: op.payload.pickedOn, at: op.payload.at,
  }).then(r => r.result),
  apply: op => predictCall(op.payload),
  confirmed: () => { refreshAfterSave(); try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT)) } catch { /* no window */ } },
})
registerKind<NextOp>('followup.next', {
  what: () => 'This follow up date',
  send: op => sendJson('PUT', `/api/follow-ups/cards/${encodeURIComponent(op.payload.cardId)}/next`, op.payload.keep ? { keep: true } : { dueOn: op.payload.dueOn }).then(r => r.result),
  apply: op => predictNext(op.payload),
  confirmed: () => { refreshAfterSave(); try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT)) } catch { /* no window */ } },
})

/** After the board and settings have loaded: this phone's answers still waiting go back on top. */
export async function startFollowUps(): Promise<void> {
  await refreshBoard()
  reapply('callLog.')
  reapply('followup.')
  if (overrides.size) changed()
}
// The outbox confirming or failing changes what "Saving…" shows.
onOutbox(() => emit())

// ── The call just started from a Call or Text tap ───────────────────────────

export interface Touch { cardId: string; customerId: string | null; name: string; firstName?: string; phone?: string; stage?: string; channel: 'call' | 'text'; startedAt: number; manual?: boolean }

let pending: (Touch & { left: boolean }) | null = null
let prompt: Touch | null = null
const promptListeners = new Set<() => void>()
const emitPrompt = () => promptListeners.forEach(f => { try { f() } catch { /* gone */ } })

/** A tap on Call, Text or the phone number: when the person comes back to the app, "How'd it go?" is asked. */
export function startTouch(t: Omit<Touch, 'startedAt'>): void {
  pending = { ...t, startedAt: Date.now(), left: false }
  installWatch()
  // Also on the server, for a phone that reloads the app while in the call. Without signal, memory is enough.
  void sendJson('PUT', '/api/follow-ups/pending', { cardId: t.cardId, crmContactId: t.customerId, channel: t.channel, name: t.name }).catch(() => null)
}

/** "Log a call" for a call made outside the app: the same questions, now. */
export function openLogCall(t: Omit<Touch, 'startedAt' | 'manual'>): void {
  prompt = { ...t, startedAt: Date.now(), manual: true }
  emitPrompt()
}

/** The question was answered or skipped. */
export function closePrompt(answered: boolean): void {
  const was = prompt
  prompt = null
  emitPrompt()
  if (!answered && was && !was.manual) void sendJson('DELETE', '/api/follow-ups/pending').catch(() => null)
}

export function usePrompt(): Touch | null {
  return useSyncExternalStore(f => { promptListeners.add(f); return () => { promptListeners.delete(f) } }, () => prompt, () => null)
}

/** Left within this long of the tap counts as the call (a tap that never left the app is forgotten). */
const LEAVE_WITHIN_MS = 60_000
let watching = false
function installWatch() {
  if (watching || typeof window === 'undefined') return
  watching = true
  const away = () => { if (pending && !pending.left && Date.now() - pending.startedAt < LEAVE_WITHIN_MS) pending.left = true }
  const back = () => {
    if (!pending?.left) return
    const { left: _l, ...t } = pending
    pending = null
    prompt = t
    emitPrompt()
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away(); else back() })
  window.addEventListener('pagehide', away)
  window.addEventListener('pageshow', back)
  window.addEventListener('blur', away)
  window.addEventListener('focus', back)
}

/** On opening the app: a call started from it and not answered yet (the app was reloaded meanwhile) still asks. */
export async function checkServerPending(): Promise<void> {
  if (prompt || pending) return
  const r = await sendJson('GET', '/api/follow-ups/pending')
  const p = r.result.ok ? r.json?.data : null
  if (!p?.cardId || prompt || pending) return
  const started = Date.parse(p.startedAt)
  // Already answered on this phone (waiting for signal).
  if (allOps().some(o => o.kind === 'callLog.create' && o.payload?.cardId === p.cardId && Date.parse(o.payload?.at) >= started - 1000)) return
  const card = cardOf(p.cardId)
  prompt = { cardId: p.cardId, customerId: p.crmContactId ?? null, name: p.name || `${card?.firstName ?? ''} ${card?.lastName ?? ''}`.trim(), firstName: card?.firstName, phone: card?.phone, stage: card?.stage, channel: p.channel === 'text' ? 'text' : 'call', startedAt: started }
  emitPrompt()
}

// ── Who is signed in (from the sign in) ─────────────────────────────────────

export function myName(): string {
  try {
    const t = getAccessToken()
    const p = t ? JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null
    return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim()
  } catch { return '' }
}
