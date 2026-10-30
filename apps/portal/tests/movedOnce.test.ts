/**
 * A Salesman's quote moved to someone else while its window or the builder was open on her phone (review, Oct 30
 * 2026): Edit opened the builder from the phone's copy with its prices, and its Update fired five contradictory
 * messages; Save notes on a moved signed quote opened a Save window offering to create a new customer.
 *
 * Now the phone asks the server before the builder opens or a save goes (web quoteStore.ts quoteStillMine,
 * App.tsx handleOpenQuote / handleSaveQuote). This pins the parts without a browser:
 *   - the server's MOVED answer reaches the app as ONE "The owner moved this to <name>" event, with the quote's id
 *     (the app closes the builder and the window on it), however many answers carried it;
 *   - the quote leaves the phone's lists, and the check says 'moved' (nothing opens, nothing is saved);
 *   - the outbox drops a save of it without a second "Not saved" message.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest'

const events: Array<{ type: string; detail: any }> = []
const w = globalThis as any
let hadWindow = false

describe('moved while open: one message, nothing opens, nothing is saved', () => {
  beforeAll(() => {
    hadWindow = 'window' in w
    if (!hadWindow) {
      const t = new EventTarget()
      w.window = Object.assign(t, { location: { origin: 'http://localhost', pathname: '/', search: '', hash: '' } })
    }
    if (!('document' in w)) w.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const orig = w.window.dispatchEvent.bind(w.window)
    w.window.dispatchEvent = (e: Event) => { events.push({ type: e.type, detail: (e as CustomEvent).detail }); return orig(e) }
  })
  afterAll(() => { if (!hadWindow) { delete w.window; delete w.document }; vi.unstubAllGlobals() })

  const MOVED = { success: false, code: 'MOVED', movedTo: 'AUD Sales', movedId: 'q-moved', error: 'The owner moved this to AUD Sales. It is off your list now.' }

  test('the same MOVED answer from several places (a read, its copy, a save): one event, with the id', async () => {
    const { noteMoved, peekMoved, MOVED_EVENT } = await import('../../web/src/movedNotice')
    events.length = 0
    noteMoved(MOVED)
    peekMoved(new Response(JSON.stringify(MOVED), { status: 404 }))
    await new Promise(r => setTimeout(r, 10))
    noteMoved(MOVED)
    const moved = events.filter(e => e.type === MOVED_EVENT)
    expect(moved).toEqual([{ type: MOVED_EVENT, detail: { message: MOVED.error, id: 'q-moved' } }])
    // Another quote moved a moment later is its own message.
    noteMoved({ ...MOVED, movedId: 'q-other' })
    expect(events.filter(e => e.type === MOVED_EVENT)).toHaveLength(2)
  })

  test('the check before Edit or Save: "moved", the quote leaves her lists; no answer: "unknown" (the phone goes on as before)', async () => {
    const answers: Record<string, () => Response> = {
      '/api/saved-quotes/q-moved': () => new Response(JSON.stringify(MOVED), { status: 404 }),
      '/api/saved-quotes/q-mine': () => new Response(JSON.stringify({ success: true, data: { id: 'q-mine' } }), { status: 200 }),
    }
    vi.stubGlobal('fetch', async (url: string) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
      if (answers[path]) return answers[path]()
      throw new TypeError('Failed to fetch')
    })
    const store = await import('../../web/src/quoteStore')
    expect(await store.quoteStillMine('q-mine')).toBe('mine')
    expect(await store.quoteStillMine('q-moved')).toBe('moved')
    expect(store.getQuotes().some(q => q.id === 'q-moved')).toBe(false)
    expect(await store.quoteStillMine('q-offline')).toBe('unknown')
  })

  test('the outbox: a save of a moved quote is dropped and says nothing more (no "Not saved")', async () => {
    const ob = await import('../../web/src/outbox')
    ob._resetForTests()
    const map = new Map<string, any>()
    const storage = { all: async () => [...map.values()], put: async (o: any) => { map.set(o.id, o) }, remove: async (id: string) => { map.delete(id) } }
    let sent = 0
    ob.registerKind('quote.update', { send: async () => { sent++; return { ok: false, status: 404, code: 'MOVED', error: MOVED.error } }, refused: () => {} })
    events.length = 0
    await ob.startOutbox('u1', { storage })
    await ob.enqueue({ key: 'quote:q-moved', kind: 'quote.update', payload: { id: 'q-moved' }, label: 'Dana, quote changes' })
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5))
    expect(sent).toBe(1)
    expect(map.size).toBe(0)
    expect(events.filter(e => e.type === ob.REFUSED_EVENT)).toEqual([])
  })
})
