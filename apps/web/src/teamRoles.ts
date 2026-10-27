/**
 * The role names and what each role does, one set for the whole app: the
 * sidebar under your name, Settings > Team and its invite form, and the
 * Feedback page (server lib/feedbackModel.ts FEEDBACK_ROLE_LABEL has the same
 * words; tests/teamRoles.test.ts keeps them equal).
 *
 * Audit Oct 26 2026: the invite form still said the office and the Salesman
 * see "prices only" (Jonathan, Oct 25 2026: the owner, admin, manager, office
 * and Salesman see costs; the Installer sees no prices at all), and the
 * sidebar said Sales / Office / Shop / Yard while Team said Salesman / Office
 * Staff / Field Crew.
 */

import type { CrmRole } from './permissions'

export const ROLE_NAMES: Record<CrmRole, string> = {
  super_admin: 'Owner', admin: 'Admin', manager: 'Manager', office_staff: 'Office', sales_rep: 'Salesman', field_crew: 'Installer',
}

/** The roles an invite can give (the Owner is the account's own login), with what each can do and see. */
export const TEAM_ROLES: Array<{ value: Exclude<CrmRole, 'super_admin'>; label: string; desc: string; color: string }> = [
  { value: 'admin', label: ROLE_NAMES.admin, desc: 'Everything, the team and deleting included. Sees costs and margins.', color: 'bg-red-100 text-red-700' },
  { value: 'manager', label: ROLE_NAMES.manager, desc: 'Everything except the team, system tools and deleting (archives instead). Sees costs and margins.', color: 'bg-purple-100 text-purple-700' },
  { value: 'office_staff', label: ROLE_NAMES.office_staff, desc: 'Customers, leads, the pipeline, quotes and proposals, portal messages, jobs, schedule, billing, vendor invoices, stock. Sees costs and margins. No settings, price list changes, team, or deleting customers, quotes or jobs (archives them instead).', color: 'bg-orange-100 text-orange-700' },
  { value: 'sales_rep', label: ROLE_NAMES.sales_rep, desc: 'Leads, customers, quotes and proposals, notes, appointments, moving pipeline cards, payments received, photos. Sees costs and margins. No settings, price list changes, team or deleting. Archives customers and cards.', color: 'bg-blue-100 text-blue-700' },
  { value: 'field_crew', label: ROLE_NAMES.field_crew, desc: 'His installs and service visits on his phone: crew packet, Start and Finish, photos, notes, walkthroughs. Sees no prices and no costs. No quotes, settings or deleting.', color: 'bg-green-100 text-green-700' },
]

/** A login's role in words ("Salesman"); an unknown role as it is. */
export const roleName = (role: string | null | undefined): string => (role && (ROLE_NAMES as Record<string, string>)[role]) || role || ''
