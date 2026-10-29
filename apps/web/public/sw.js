// Getter Done Fence app shell. Keeps the app's files on the phone so it opens
// fast on cell data. Customer data always comes live from the server: nothing
// under /api is ever cached, and the page itself is fetched fresh first so a
// new version shows up as soon as it is deployed.
const CACHE = 'gdf-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/portal')) return
  // Built files have the content hash in their name: once fetched, never changes.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r })))
    return
  }
  // The app page, at any of its screens' addresses (/customers/<id>, ...): the
  // network first, the saved copy when there is no signal. Public pages under
  // /p/ are the server's own and are never answered from here.
  if (req.mode === 'navigate' && !url.pathname.startsWith('/p/')) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok && url.pathname === '/') { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)) }
      return r
    }).catch(() => caches.match('/')))
  }
})

// Push notifications from automations (free web push). Shows the message; a
// tap opens the app at the screen it is about (or focuses the open app there).
// A new lead's push (portal lib/leadAssign.ts) also carries Assign buttons
// where the phone shows them (Android Chrome, a computer); an iPhone home
// screen app shows none, and its tap opens the Assign screen instead.
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'EZ Biz', body: e.data ? e.data.text() : '' } }
  const actions = Array.isArray(d.actions) ? d.actions.filter(a => a && a.action && a.title).slice(0, 2) : []
  e.waitUntil(self.registration.showNotification(d.title || 'EZ Biz', {
    body: d.body || '', tag: d.tag || undefined, data: { url: d.url || '/', assign: d.assign || null },
    icon: '/icon-192.png', badge: '/icon-192.png',
    ...(actions.length ? { actions } : {}),
  }))
})

async function openApp(url) {
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const here = open.find(c => new URL(c.url).origin === self.location.origin)
  if (here) { await here.focus(); try { await here.navigate(url) } catch { /* an iPhone home screen app may refuse: it is open and focused anyway */ } return }
  await self.clients.openWindow(url)
}

// An Assign button on a lead's push: assign it right here with the app's sign in, and say so. Anything
// else (not signed in, already assigned to someone else, no signal) opens the Assign screen, which says why.
async function assignFromPush(assign, to, url) {
  try {
    const r = await fetch(`/api/lead-assign/${encodeURIComponent(assign.customerId)}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Staff-Request': '1' },
      body: JSON.stringify({ to }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j && j.success) {
      await self.registration.showNotification(`Assigned to ${j.data.assignedTo}`, {
        body: j.data.already ? 'It was already theirs.' : 'It is on their list now.',
        tag: `lead-${assign.customerId}`, data: { url }, icon: '/icon-192.png', badge: '/icon-192.png',
      })
      return
    }
  } catch { /* no signal: the screen tries again */ }
  await openApp(url)
}

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const data = e.notification.data || {}
  const url = new URL(data.url || '/', self.location.origin).href
  if (e.action && e.action.startsWith('assign:') && data.assign && data.assign.customerId) {
    e.waitUntil(assignFromPush(data.assign, e.action.slice('assign:'.length), url))
    return
  }
  e.waitUntil(openApp(url))
})
