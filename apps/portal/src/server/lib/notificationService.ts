/**
 * In-App Notification Service
 *
 * Creates notifications stored in the database.
 * Frontend polls for unread notifications.
 */

import prisma from './prisma.js'

export interface CreateNotificationOptions {
  recipientId?: string    // specific user
  recipientRole?: string  // broadcast to all users with this role
  title: string
  body: string
  type?: 'info' | 'warning' | 'success' | 'error' | 'automation'
  link?: string           // deep link within app
  jobId?: string
}

/** Create a notification for a specific user or role */
export async function createNotification(opts: CreateNotificationOptions): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        recipientId: opts.recipientId || null,
        recipientRole: opts.recipientRole || null,
        title: opts.title,
        body: opts.body,
        type: opts.type || 'info',
        link: opts.link || null,
        jobId: opts.jobId || null,
      },
    })
  } catch (err) {
    console.error('[Notification] Failed to create:', err)
  }
}

/** Get unread notifications for a user/role */
export async function getNotifications(userId?: string, role?: string, limit = 50): Promise<any[]> {
  const where: any = { OR: [] }
  if (userId) where.OR.push({ recipientId: userId })
  if (role) where.OR.push({ recipientRole: role })
  // Also include global notifications (no specific recipient)
  where.OR.push({ recipientId: null, recipientRole: null })

  if (where.OR.length === 0) return []

  return prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/** Mark notification(s) as read */
export async function markRead(id: string): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { read: true, readAt: new Date() },
  })
}

/** Mark all notifications read for a user */
export async function markAllRead(userId: string, role?: string): Promise<void> {
  const where: any = { read: false, OR: [] }
  if (userId) where.OR.push({ recipientId: userId })
  if (role) where.OR.push({ recipientRole: role })
  where.OR.push({ recipientId: null, recipientRole: null })

  await prisma.notification.updateMany({
    where,
    data: { read: true, readAt: new Date() },
  })
}

/** Get unread count */
export async function getUnreadCount(userId?: string, role?: string): Promise<number> {
  const where: any = { read: false, OR: [] }
  if (userId) where.OR.push({ recipientId: userId })
  if (role) where.OR.push({ recipientRole: role })
  where.OR.push({ recipientId: null, recipientRole: null })

  if (where.OR.length === 0) return 0

  return prisma.notification.count({ where })
}
