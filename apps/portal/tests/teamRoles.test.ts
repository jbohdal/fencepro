/**
 * One set of role names and true descriptions (apps/web/src/teamRoles.ts).
 * Audit Oct 26 2026: the invite form said the office and the Salesman see
 * "prices only" (they see costs since Oct 25), and the sidebar said Sales /
 * Office / Shop / Yard while Team said Salesman / Office Staff / Field Crew.
 */

import { describe, test, expect } from 'vitest'
import { ROLE_NAMES, TEAM_ROLES, roleName } from '../../web/src/teamRoles'
import { roleCan } from '../../web/src/permissions'
import { FEEDBACK_ROLE_LABEL } from '../src/server/lib/feedbackModel.js'

describe('role names', () => {
  test('the same words everywhere: Team, the sidebar and the Feedback page', () => {
    expect(ROLE_NAMES).toEqual(FEEDBACK_ROLE_LABEL)
    for (const r of TEAM_ROLES) expect(r.label).toBe(ROLE_NAMES[r.value])
    expect(roleName('field_crew')).toBe('Installer')
    expect(roleName('super_admin')).toBe('Owner')
    expect(roleName('something_new')).toBe('something_new')
  })
})

describe('what each role sees, in the invite form', () => {
  test('every role that sees costs says so; the Installer says he sees no prices and no costs', () => {
    for (const r of TEAM_ROLES) {
      expect(r.desc).not.toMatch(/prices only|never a cost/i)
      if (roleCan(r.value, 'costs.view')) expect(r.desc).toMatch(/Sees costs and margins/)
      else expect(r.desc).toMatch(/Sees no prices and no costs/)
    }
    expect(roleCan('field_crew', 'prices.view')).toBe(false)
  })
})
