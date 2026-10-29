/**
 * Notification bell — shows unread count, dropdown with recent notifications.
 * Polls /api/automations/notifications every 60s.
 */

import { useEffect, useState } from 'react'
import PopMenu from './PopMenu'
import { authFetch } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { navigate } from './nav'

interface Notification {
  id: string
  title: string
  body: string
  type: string
  link?: string | null
  jobId?: string | null
  read: boolean
  createdAt: string
}

interface NotifResponse {
  notifications: Notification[]
  unread: number
}

const POLL_MS = 60_000

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)

  async function load() {
    try {
      setLoading(true)
      const host = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
      const data = await authFetch<NotifResponse>(host + '/api/automations/notifications')
      setNotifs(data.notifications || [])
      setUnread(data.unread || 0)
    } catch { /* silent — don't toast-spam */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [])


  /** Go where the notification is about (a customer, a job). */
  function openLink(link?: string | null) {
    if (!link) return
    const u = new URL(link, window.location.origin)
    // The Assign screen (a new lead nobody has yet) reads its own ?customer=; other ?customer= links open that customer.
    const customer = u.pathname === '/assign-lead' ? null : u.searchParams.get('customer')
    setOpen(false)
    navigate(customer ? `/customers/${encodeURIComponent(customer)}` : u.pathname + u.search)
  }

  async function markRead(id: string) {
    try {
      const host = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
      await authFetch(host + `/api/automations/notifications/${id}/read`, { method: 'PATCH' })
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnread(u => Math.max(0, u - 1))
    } catch { /* noop */ }
  }

  async function markAllRead() {
    try {
      const host = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
      await authFetch(host + '/api/automations/notifications/read-all', { method: 'POST' })
      setNotifs(prev => prev.map(n => ({ ...n, read: true })))
      setUnread(0)
    } catch { /* noop */ }
  }

  return (
    <PopMenu name="notifications" kind="dialog" title="Notifications" width={320} className="" open={open} onOpenChange={setOpen}
      triggerClassName="relative text-gray-500 hover:text-gray-900 min-w-[48px] min-h-[48px] grid place-items-center rounded-lg hover:bg-gray-100 transition-colors"
      triggerProps={{ title: 'Notifications', 'aria-label': 'Notifications' }}
      label={<>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </>}>
        <div>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              <p className="text-[10px] text-gray-400">{unread > 0 ? `${unread} unread` : 'All caught up'}</p>
            </div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-orange-600 hover:underline">Mark all read</button>
            )}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {loading && notifs.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
            ) : notifs.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No notifications yet.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifs.map(n => {
                  // Something to act on (a proposal conflict, ...): amber with a warning sign, its body in full.
                  const warn = n.type === 'warning'
                  return (
                  <button key={n.id} onClick={() => { markRead(n.id); openLink(n.link) }} data-notification-kind={n.type}
                    className={`block w-full text-left px-4 py-3 transition-colors ${warn ? `border-l-4 border-amber-400 ${n.read ? 'bg-white hover:bg-amber-50' : 'bg-amber-50 hover:bg-amber-100'}` : n.read ? 'bg-white hover:bg-gray-50' : 'bg-orange-50 hover:bg-orange-100'}`}>
                    <div className="flex items-start gap-2">
                      {warn ? <span className="text-amber-600 text-sm leading-5 shrink-0" aria-label="Warning">⚠</span>
                        : !n.read && <span className="w-2 h-2 bg-orange-500 rounded-full mt-1.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${warn ? (n.read ? 'text-amber-900' : 'text-amber-900 font-semibold') : n.read ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>{n.title}</p>
                        {n.body && <p className={`text-xs text-gray-500 mt-0.5${warn ? '' : ' line-clamp-2'}`}>{n.body}</p>}
                        <p className="text-[10px] text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
    </PopMenu>
  )
}
