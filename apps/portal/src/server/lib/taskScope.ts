/**
 * Whose tasks the Today screen lists (GET /api/automations/tasks).
 *
 *   Owner, admin, manager, office: tasks named for them, and the company's
 *     tasks that name nobody (permits, materials, ...): the office runs those.
 *   Salesman, Installer: only tasks named for them, or for their role
 *     (assignedRole). Christa's Today listed every company task (walkthrough,
 *     Oct 24, 2026).
 */

import type { Prisma } from '@prisma/client'
import { isFullRole } from './permissions.js'

/** Roles whose Today also lists the company's tasks that name nobody. */
export const seesCompanyTasks = (role: string | null | undefined): boolean => isFullRole(role) || role === 'office_staff'

/** The where clause for "my tasks". `names`: the login's email, full name and first name. */
export function myTasksWhere(role: string | null | undefined, names: string[]): Prisma.TaskWhereInput {
  const named: Prisma.TaskWhereInput[] = names.filter(n => n && n.trim()).map(n => ({ assignedTo: { equals: n.trim(), mode: 'insensitive' as const } }))
  if (seesCompanyTasks(role)) return { OR: [{ assignedTo: null }, { assignedTo: '' }, ...named] }
  const nobody: Prisma.TaskWhereInput = { OR: [{ assignedTo: null }, { assignedTo: '' }] }
  return { OR: [...named, ...(role ? [{ AND: [nobody, { assignedRole: role }] }] : [])] }
}
