/**
 * Back, the way a phone expects it. Every screen has its own address
 * (/customers/<id>, /pipeline, ...) and every window, drawer and popup opened
 * on top of it gets its own entry in the browser's history, so Back (Android's
 * back gesture or button, an iPhone swipe, the browser's back button) closes
 * the window on top first, then returns to the screen before, with its scroll
 * position, filters and tab as they were.
 *
 *   navigate('/customers/abc')          a new screen
 *   useBackLayer(onClose, { params })   in a window: Back closes it. With
 *                                       params ({ quote: id }) it also has an
 *                                       address, so a reload or a link opens it.
 *   <BackClose onClose={...} />         the same, for a window drawn inline
 *   useScreenMemory('key', () => state) what a screen gets back when Back
 *                                       returns to it
 *
 * A window closed by its own button takes its history entry with it, so Back
 * never lands on a window that is already gone. A window with unsaved work
 * (the quote builder) is asked first and stays open if the answer is no.
 *
 * What is kept here is where the user is, never business data: it lives in
 * the browser's history entries for this tab only.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { registerUnsaved } from './appUpdate'

interface EntryState {
  ez: 1
  /** Position of this entry, to tell Back from Forward. */
  i: number
  /** Windows open at this entry. 0 = just the screen. */
  depth: number
  /** The window this entry belongs to. */
  layer?: string
  /** The entry's address includes the window's own params (it can be reopened from it). */
  addressed?: boolean
  /** Screen memories (filters, tab, ...) and the page's scroll position. */
  screen?: Record<string, unknown>
  scroll?: number
  /** Where a screen was opened from, for its back button label. */
  from?: string
}

interface Layer {
  key: string
  close: () => void
  guard?: () => boolean
  params?: Record<string, string>
  depth: number
  /** Index of the history entry this window owns; null while waiting to push it. */
  entryI: number | null
  mounted: boolean
  /** Already closed by Back or by a new screen: nothing left to undo. */
  gone: boolean
}

let started = false
let index = 0
const layers: Layer[] = []
const listeners = new Set<() => void>()
const memories = new Map<string, () => unknown>()
/** Back presses this module made itself, still to arrive as popstate. */
let ownPops = 0
let settleTimer: ReturnType<typeof setTimeout> | null = null
const queue: Array<() => void> = []
/** Window params in the address the app was opened with (a reload, a link). */
let openedWith: URLSearchParams = new URLSearchParams()
let version = 0
/** Skip entries whose window is gone, one step at a time in the same direction. */
let skipping = 0

const LAYER_PARAMS = new Set(['card', 'quote', 'for', 'qv', 'job', 'ticket'])

function state(): EntryState | null {
  const s = window.history.state as EntryState | null
  return s && s.ez === 1 ? s : null
}
function write(kind: 'push' | 'replace', s: EntryState, url: string) {
  if (kind === 'push') window.history.pushState(s, '', url)
  else window.history.replaceState(s, '', url)
}
function currentUrl() { return window.location.pathname + window.location.search + window.location.hash }
function emit() { version += 1; shownUrl = currentUrl(); listeners.forEach(f => f()) }
/** The address the app last drew. */
let shownUrl = ''
/** Screens with unsaved work that may stop a move away (useLeaveGuard). */
const leaveGuards = new Set<(to: string) => boolean>()
function leaveAllowed(to: string): boolean {
  for (const g of [...leaveGuards]) if (!g(to)) return false
  return true
}

/** Run now, or once the Back press this module is waiting on has arrived. */
function whenSettled(fn: () => void) {
  if (ownPops === 0) { fn(); return }
  queue.push(fn)
}
function settle() {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  while (ownPops === 0 && queue.length) queue.shift()!()
}
function goBackOurselves(steps = 1) {
  ownPops += 1
  window.history.go(-steps)
  // A Back with nowhere to go never arrives; do not wait on it forever.
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => { ownPops = 0; settle() }, 600)
}

/** Called once, as the signed in app first draws (before any window in it opens). */
export function startNav(initialUrl?: string) {
  if (started) return
  started = true
  window.history.scrollRestoration = 'manual'
  const prev = state()
  index = prev?.i ?? 0
  // Windows named in the address are reopened by their screens; the entry
  // itself becomes the plain screen, and each window pushes its own entry
  // on top as it opens, so Back closes them one at a time.
  const url = new URL(initialUrl ?? currentUrl(), window.location.origin)
  openedWith = new URLSearchParams()
  for (const k of [...url.searchParams.keys()]) {
    if (LAYER_PARAMS.has(k)) { openedWith.set(k, url.searchParams.get(k)!); url.searchParams.delete(k) }
  }
  write('replace', { ez: 1, i: index, depth: 0, screen: prev?.screen, scroll: prev?.scroll, from: prev?.from }, url.pathname + url.search + url.hash)
  window.addEventListener('popstate', onPop)
  window.addEventListener('keydown', onEscape)
  emit()
}

/** Windows that Escape closes on a computer, like Back (review, Oct 25, 2026): the card window and the quote window. */
const ESCAPE_CLOSES = new Set(['card', 'qv'])
function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const top = [...layers].sort((a, b) => b.depth - a.depth)[0]
  if (!top || !ESCAPE_CLOSES.has(top.key) || top.entryI === null) return
  e.preventDefault()
  window.history.back()
}

/** A window param the app was opened with, handed out once. */
export function takeOpenedParam(key: string): string | null {
  const v = openedWith.get(key)
  if (v !== null) openedWith.delete(key)
  return v
}

function onPop(e: PopStateEvent) {
  const st = (e.state && (e.state as EntryState).ez === 1 ? e.state : null) as EntryState | null
  const ours = ownPops > 0
  if (ours) ownPops -= 1
  const newI = st?.i ?? 0
  const dir = newI < index ? -1 : 1
  const depth = st?.depth ?? 0

  // Back or Forward to another address while a screen has unsaved work (and no
  // window is open on top of it): ask first; a no puts the address back.
  if (!ours && leaveGuards.size && !layers.some(l => l.depth > depth) && currentUrl() !== shownUrl && !leaveAllowed(currentUrl())) {
    goBackOurselves(newI - index)
    return
  }

  // Close the windows above where this entry is, the top one first.
  const above = layers.filter(l => l.depth > depth).sort((a, b) => b.depth - a.depth)
  for (const l of above) {
    if (!ours && l.guard && !l.guard()) {
      // Keep it open: put its entry back on top.
      index = newI + 1
      l.entryI = index
      write('push', { ...(state() ?? { ez: 1, i: newI, depth }), ez: 1, i: index, depth: l.depth, layer: l.key, addressed: !!l.params }, urlWith(l.params))
      emit()
      settle()
      return
    }
    l.gone = true
    layers.splice(layers.indexOf(l), 1)
    l.close()
  }
  index = newI
  emit()

  // An entry for a window that is gone and cannot be reopened from its
  // address: step past it so Back never seems to do nothing.
  if (st?.layer && !st.addressed && !layers.some(l => l.entryI === st.i) && skipping < 8) {
    skipping += 1
    ownPops += 1
    window.history.go(dir)
    return
  }
  skipping = 0
  settle()
}

function urlWith(params?: Record<string, string>, base = currentUrl()): string {
  const u = new URL(base, window.location.origin)
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v)
  return u.pathname + u.search + u.hash
}
function urlWithout(keys: string[], base = currentUrl()): string {
  const u = new URL(base, window.location.origin)
  for (const k of keys) u.searchParams.delete(k)
  return u.pathname + u.search + u.hash
}

function openLayer(l: Layer) {
  l.mounted = true
  if (l.gone) return
  if (layers.includes(l)) return            // the same window again (React's double check in development)
  whenSettled(() => {
    if (!l.mounted || l.gone || layers.includes(l)) return
    const st = state()
    l.depth = layers.length + 1
    layers.push(l)
    // Back or Forward landed on this window's own entry and its screen reopened it.
    if (st && st.layer === l.key && st.depth === l.depth && !layers.some(x => x !== l && x.entryI === st.i)) {
      l.entryI = st.i
      return
    }
    index += 1
    l.entryI = index
    write('push', { ...(st ?? { ez: 1, i: 0, depth: 0 }), ez: 1, i: index, depth: l.depth, layer: l.key, addressed: !!l.params }, urlWith(l.params))
    emit()
  })
}

let reconcileQueued = false
function closeLayer(l: Layer) {
  l.mounted = false
  // React checks a new component by closing and reopening it at once in
  // development; only a window still closed a moment later is really closed.
  // Windows that close together (a save form and the quote under it) are
  // handled together, so all their entries go in one step.
  if (reconcileQueued) return
  reconcileQueued = true
  queueMicrotask(() => {
    reconcileQueued = false
    const closed = layers.filter(x => !x.mounted && !x.gone)
    if (!closed.length) return
    for (const x of closed) { x.gone = true; layers.splice(layers.indexOf(x), 1) }
    const st = state()
    const owned = closed.map(x => x.entryI).filter((i): i is number => i !== null)
    if (!st || !owned.length) return
    const lowest = Math.min(...owned)
    // Closed by their own buttons: take their entries with them, unless a
    // window still open sits above them (its entry has to stay).
    if (st.i >= lowest && !layers.some(x => x.entryI !== null && x.entryI >= lowest)) goBackOurselves(st.i - lowest + 1)
  })
}

/** Back closes this window. Call it in the window's component, which is mounted only while open. */
export function useBackLayer(onClose: () => void, opts: { key?: string; params?: Record<string, string>; guard?: () => boolean } = {}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const guardRef = useRef(opts.guard)
  guardRef.current = opts.guard
  const layer = useRef<Layer | null>(null)
  if (!layer.current) {
    layer.current = {
      key: opts.key ?? 'window', params: opts.params, depth: 0, entryI: null, mounted: false, gone: false,
      close: () => closeRef.current(),
      guard: opts.guard ? () => guardRef.current?.() ?? true : undefined,
    }
  }
  useEffect(() => {
    const l = layer.current!
    if (!started) return
    openLayer(l)
    return () => closeLayer(l)
  }, [])
}

/** For a window drawn inline: render this inside it. */
export function BackClose({ onClose, name }: { onClose: () => void; name?: string }) {
  useBackLayer(onClose, { key: name })
  return null
}

// ── Screens ──────────────────────────────────────────────────────────────────

function snapshotScreen() {
  const st = state()
  if (!st) return
  const screen: Record<string, unknown> = { ...(st.screen ?? {}) }
  memories.forEach((get, key) => { try { screen[key] = get() } catch { /* a screen that is going away */ } })
  const scroller = document.querySelector<HTMLElement>('[data-page-scroll]')
  write('replace', { ...st, screen, scroll: scroller?.scrollTop ?? 0 }, currentUrl())
}

/**
 * Go to a screen. Windows open on this screen close. Back returns to the
 * screen with the windows that have an address (a customer's card, a quote)
 * open again; popups without one are taken out of the history first.
 */
export function navigate(url: string, opts: { replace?: boolean; from?: string } = {}) {
  whenSettled(() => {
    const target = new URL(url, window.location.origin)
    const to = target.pathname + target.search + target.hash
    if (to === currentUrl() && !layers.length) return
    if (to !== currentUrl() && !leaveAllowed(to)) return
    const open = [...layers].sort((a, b) => b.depth - a.depth)
    let popups = 0
    for (const l of open) { if (l.params) break; if (l.entryI !== null) popups += 1 }
    layers.length = 0
    for (const l of open) { l.gone = true; l.close() }
    const go = () => {
      if (opts.replace) write('replace', { ez: 1, i: index, depth: 0, from: opts.from ?? state()?.from }, to)
      else { snapshotScreen(); index += 1; write('push', { ez: 1, i: index, depth: 0, from: opts.from }, to) }
      emit()
    }
    if (popups > 0 && !opts.replace) { queue.push(go); goBackOurselves(popups) }
    else go()
  })
}

/** Change the address of this screen without a new history entry (a filter in the address, tidying a link). */
export function replaceUrl(url: string) {
  whenSettled(() => { write('replace', { ...(state() ?? { ez: 1, i: index, depth: 0 }), ez: 1 } as EntryState, url); emit() })
}

/** Back, or the given screen when there is nothing in the app to go back to. */
export function goBack(fallback: string) {
  if (index > 0 || layers.length) window.history.back()
  else navigate(fallback, { replace: true })
}

/** Where a screen was opened from ("Sales Pipeline"), if it was opened with one. */
export function openedFrom(): string | undefined { return state()?.from }

/**
 * A screen's filters, tab and the like, given back when Back returns to it.
 * `get` is read just before the user leaves the screen.
 */
export function useScreenMemory<T>(key: string, get: () => T): T | null {
  const saved = useRef<{ v: T | null } | null>(null)
  if (!saved.current) saved.current = { v: (state()?.screen?.[key] as T | undefined) ?? null }
  const getRef = useRef(get)
  getRef.current = get
  useEffect(() => {
    memories.set(key, () => getRef.current())
    return () => { if (memories.get(key)) memories.delete(key) }
  }, [key])
  return saved.current.v
}

/** The scroll position to put back on a screen Back returned to (null for a new visit). */
export function savedScroll(): number | null {
  const st = state()
  return typeof st?.scroll === 'number' ? st.scroll : null
}

// ── Reading where the user is ───────────────────────────────────────────────

function subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }
let cache = { version: -1, path: '', params: new URLSearchParams() }
function snapshot() {
  if (cache.version !== version) cache = { version, path: window.location.pathname, params: new URLSearchParams(window.location.search) }
  return cache
}

/** The current address: the screen's path and the window params. Re-renders on every move. */
export function useNav(): { path: string; params: URLSearchParams } {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// ── Screen addresses ─────────────────────────────────────────────────────────

const SPECIAL: Record<string, string> = { Dashboard: '/', 'Sales Pipeline': '/pipeline', Portal: '/portal-inbox' }

export function pagePath(page: string): string {
  return SPECIAL[page] ?? '/' + page.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** The page a path shows, from the pages the app has. Unknown paths show the Dashboard. */
export function pageForPath(path: string, pages: string[]): string {
  const first = '/' + (path.split('/')[1] ?? '')
  return pages.find(p => pagePath(p) === first) ?? 'Dashboard'
}

/**
 * A screen with unsaved work: `allow(to)` is asked before the app moves to
 * another address (a link, the menu, Back or Forward). It returns false to
 * stay (it asks the user itself). Closing the tab is useLeaveWarning's job.
 */
export function useLeaveGuard(allow: (to: string) => boolean) {
  const ref = useRef(allow)
  ref.current = allow
  useEffect(() => {
    const g = (to: string) => ref.current(to)
    leaveGuards.add(g)
    return () => { leaveGuards.delete(g) }
  }, [])
}

/** Keep the editor's own unsaved work from being dropped by a reload or closing the tab. */
export function useLeaveWarning(dirty: () => boolean) {
  const ref = useRef(dirty)
  ref.current = dirty
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (ref.current()) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    // A new version of the app waits while this editor has unsaved work.
    const off = registerUnsaved(() => ref.current())
    return () => { window.removeEventListener('beforeunload', h); off() }
  }, [])
}

