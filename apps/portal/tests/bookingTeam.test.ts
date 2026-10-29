/**
 * The booking team (who appointments can be with) is the company's active
 * staff logins, owner first and the default (server: lib/appointmentRep.ts
 * bookingTeamOf), and the screens' rules for reading it (web:
 * bookingTeamModel.ts): which member an appointment is with, former team
 * members' names kept on past appointments, the person filter, home bases by
 * login id. On the dev database, through the API: bookingTeam.db.test.ts.
 */
import { describe, test, expect } from 'vitest'
import { bookingTeamOf, type StaffLogin } from '../src/server/lib/appointmentRep'
import {
  normalizeTeam, defaultMemberOf, newBookingMemberOf, memberOf, formerNamesOf, matchesPerson, memberKey, formerKey, isWith, homeOf, visitsStartPerson, withSomeoneElse, type TeamMember,
} from '../../web/src/bookingTeamModel'
import { withDefaults } from '../../web/src/appointmentLogic'

const login = (id: string, firstName: string, lastName: string, role: string, status = 'active', phone: string | null = null): StaffLogin => ({ id, firstName, lastName, role, status, phone })

describe('the team from the logins (server)', () => {
  // Oldest first, as staffLogins reads them.
  const staff = [
    login('rep-z', 'Zed', 'Young', 'sales_rep', 'active', '3525550142'),
    login('owner', 'Jonathan', 'Bohdal', 'super_admin', 'active', null),
    login('crew', 'Ann', 'Crew', 'field_crew'),
    login('off', 'Old', 'Hand', 'sales_rep', 'deactivated'),
    login('hold', 'On', 'Hold', 'sales_rep', 'suspended'),
    login('inv', 'New', 'Invite', 'sales_rep', 'invited'),
    login('cust', 'Pat', 'Customer', 'customer'),
    login('blank', ' ', ' ', 'admin'),
  ]
  const team = bookingTeamOf(staff)

  test('active staff logins only: no switched off, suspended, not yet accepted, customer or nameless login', () => {
    expect(team.map(m => m.userId)).toEqual(['owner', 'crew', 'rep-z'])
  })
  test('the owner first and the only default; the rest by name; each with its Direct phone', () => {
    expect(team[0]).toMatchObject({ userId: 'owner', name: 'Jonathan Bohdal', isDefault: true, phone: null, role: 'super_admin' })
    expect(team.filter(m => m.isDefault)).toHaveLength(1)
    expect(team.find(m => m.userId === 'rep-z')).toMatchObject({ name: 'Zed Young', phone: '3525550142', isDefault: false })
  })
  test('no owner login: the oldest active one is the default; none: an empty team', () => {
    expect(bookingTeamOf([login('a', 'Bea', 'Two', 'sales_rep'), login('b', 'Al', 'One', 'admin')]).map(m => [m.name, m.isDefault]))
      .toEqual([['Bea Two', true], ['Al One', false]])
    expect(bookingTeamOf([login('x', 'X', 'Y', 'customer')])).toEqual([])
  })
})

describe('reading the team on the screens (web)', () => {
  const team: TeamMember[] = normalizeTeam([
    { userId: 'owner', name: 'Jonathan Bohdal', firstName: 'Jonathan', lastName: 'Bohdal', phone: null, role: 'super_admin', isDefault: true },
    { userId: 'christa', name: 'Christa Feagin', firstName: 'Christa', lastName: 'Feagin', phone: '3525550142', role: 'sales_rep', isDefault: false },
    { userId: '', name: 'No id' }, { name: 'No id either' }, null,
  ])
  const appts = [
    { assignedTo: 'Christa Feagin', assignedToUserId: 'christa' },
    { assignedTo: 'jonathan  bohdal', assignedToUserId: null },           // saved before logins were kept: matched by name
    { assignedTo: 'Alexander Bohdal', assignedToUserId: null },           // never a login: a former team member
    { assignedTo: 'Stacy Mcgovern', assignedToUserId: 'gone-login' },     // a login since switched off
    { assignedTo: 'Christa Feagin', assignedToUserId: 'other-christa' },  // another login with the same name, not on the team
    { assignedTo: '', assignedToUserId: null },
  ]

  test('only well formed members are kept; the owner is the default', () => {
    expect(team.map(m => m.userId)).toEqual(['owner', 'christa'])
    expect(defaultMemberOf(team)?.userId).toBe('owner')
    expect(defaultMemberOf([])).toBeNull()
  })
  test("a new booking starts on whoever is signed in when they are on the team (Christa books for herself), else the owner", () => {
    expect(newBookingMemberOf(team, 'christa')?.userId).toBe('christa')
    expect(newBookingMemberOf(team, 'owner')?.userId).toBe('owner')
    expect(newBookingMemberOf(team, 'installer-not-on-team')?.userId).toBe('owner')
    expect(newBookingMemberOf(team, null)?.userId).toBe('owner')
    expect(newBookingMemberOf([], 'christa')).toBeNull()
  })
  test('the member an appointment is with: by the login kept on it, else by exact name', () => {
    expect(appts.map(a => memberOf(team, a)?.userId ?? null)).toEqual(['christa', 'owner', null, null, null, null])
  })
  test('former team members: names on appointments whose person is not on the team, once each', () => {
    expect(formerNamesOf(team, appts)).toEqual(['Alexander Bohdal', 'Christa Feagin', 'Stacy Mcgovern'])
  })
  test('the person filter: everyone, a member, a former name', () => {
    const pick = (key: string) => appts.filter(a => matchesPerson(team, a, key)).length
    expect(pick('')).toBe(appts.length)
    expect(pick(memberKey(team[1]))).toBe(1)
    expect(pick(memberKey(team[0]))).toBe(1)
    expect(pick(formerKey('Stacy Mcgovern'))).toBe(1)
    expect(pick(formerKey('Christa Feagin'))).toBe(1)  // the other login's appointment, not the member's
    expect(isWith(team, appts[0], team[1])).toBe(true)
    expect(isWith(team, appts[4], team[1])).toBe(false)
  })
  test("home bases are kept by login id in Settings > Appointments; the old names list is dropped", () => {
    const s = withDefaults({ homes: { christa: { homeBase: '1 Main St, Ocala, FL', homeLat: 29.1, homeLng: -82.1 } }, team: [{ name: 'Stacy Mcgovern' }] } as any)
    expect('team' in s).toBe(false)
    expect(homeOf(s.homes, team[1])).toEqual({ lat: 29.1, lng: -82.1 })
    expect(homeOf(s.homes, team[0])).toBeNull()
    expect(withDefaults(undefined).homes).toEqual({})
  })
})

describe('Visits: the Salesman sees every appointment in scope, each with someone else marked (review Oct 28 2026)', () => {
  const team: TeamMember[] = normalizeTeam([
    { userId: 'owner', name: 'Jonathan Bohdal', firstName: 'Jonathan', lastName: 'Bohdal', phone: null, role: 'super_admin', isDefault: true },
    { userId: 'christa', name: 'Christa Feagin', firstName: 'Christa', lastName: 'Feagin', phone: null, role: 'sales_rep', isDefault: false },
  ])
  test('starts on everyone for the Salesman and the office; the crew on their own', () => {
    expect(visitsStartPerson('sales_rep', 'u:christa')).toBe('')
    expect(visitsStartPerson('super_admin', '')).toBe('')
    expect(visitsStartPerson('field_crew', 'u:crew')).toBe('u:crew')
  })
  test('one with the Salesman: no mark; one with the owner or nobody: "With …"', () => {
    expect(withSomeoneElse(team, { assignedTo: 'Christa Feagin', assignedToUserId: 'christa' }, 'u:christa')).toBeNull()
    expect(withSomeoneElse(team, { assignedTo: 'Jonathan Bohdal', assignedToUserId: 'owner' }, 'u:christa')).toBe('With Jonathan Bohdal')
    expect(withSomeoneElse(team, { assignedTo: '', assignedToUserId: null }, 'u:christa')).toBe('With nobody yet')
    // The Salesman's login not on the team list: still the Salesman's by its login.
    expect(withSomeoneElse([], { assignedTo: 'Christa Feagin', assignedToUserId: 'christa' }, 'u:christa')).toBeNull()
    // Nobody's key (the office): nothing is marked.
    expect(withSomeoneElse(team, { assignedTo: 'Jonathan Bohdal', assignedToUserId: 'owner' }, '')).toBeNull()
  })
})
