/**
 * The staff's Customer messages bubble (routes/portal.ts GET /messages/inbox).
 *
 * Audit Oct 26 2026: the bubble said "All caught up" with no badge while a
 * customer's new message waited. The message had been marked read seconds
 * after it came in (the customer page was open in front on another computer),
 * and read was all the bubble counted. A thread now also counts while it is
 * waiting for a reply: its last message is the customer's, from the last
 * WAITING_DAYS days. Reading it does not clear that; replying does.
 */

export const WAITING_DAYS = 14

export interface InboxMessage { crmCustomerId: string; createdAt: Date; body: string; senderType: string; isReadByStaff: boolean }
export interface InboxThread {
  crmCustomerId: string
  lastAt: Date
  lastBody: string
  lastSender: string
  unreadCustomerCount: number
  /** The customer wrote last, within WAITING_DAYS: nobody has answered yet. */
  waitingReply: boolean
}

export function inboxFrom(messages: InboxMessage[], now = new Date()): { threads: InboxThread[]; totalUnread: number; totalWaiting: number; needsYou: number } {
  const byCustomer = new Map<string, InboxThread>()
  for (const m of [...messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    let t = byCustomer.get(m.crmCustomerId)
    if (!t) {
      t = { crmCustomerId: m.crmCustomerId, lastAt: m.createdAt, lastBody: m.body, lastSender: m.senderType, unreadCustomerCount: 0, waitingReply: m.senderType === 'customer' && now.getTime() - m.createdAt.getTime() <= WAITING_DAYS * 86_400_000 }
      byCustomer.set(m.crmCustomerId, t)
    }
    if (m.senderType === 'customer' && !m.isReadByStaff) t.unreadCustomerCount += 1
  }
  const threads = [...byCustomer.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
  return {
    threads,
    totalUnread: threads.reduce((s, t) => s + t.unreadCustomerCount, 0),
    totalWaiting: threads.filter(t => t.waitingReply).length,
    // The bubble's badge: the customers with a message unread or not answered yet.
    needsYou: threads.filter(t => t.unreadCustomerCount > 0 || t.waitingReply).length,
  }
}
