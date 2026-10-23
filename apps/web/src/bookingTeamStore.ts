/**
 * The booking team ("With" on every appointment screen): the company's active
 * staff logins, read from the server (GET /api/appointments/team). There is no
 * names list in Settings any more: anyone added in Settings > Team is here, and
 * anyone switched off or deleted there is gone, on the next read (sign in,
 * liveRefresh when the app comes back on screen and every minute, and after a
 * change in Team on this device). The rules are in bookingTeamModel.ts.
 *
 * Every screen that offers or filters by a person reads this store; the
 * "Settings lists connected" check (apps/portal/tests/settingsListsConnected.test.ts)
 * fails if a screen keeps its own copy.
 */
import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { normalizeTeam, defaultMemberOf, type TeamMember } from './bookingTeamModel'

export type { TeamMember } from './bookingTeamModel'

const EVT = 'fencepro:booking_team:updated'
export const BOOKING_TEAM_UPDATED_EVENT = EVT

let team: TeamMember[] = []
let loaded = false
let initPromise: Promise<void> | null = null

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* not in a browser */ } }

function take(data: unknown) {
  const next = normalizeTeam(data)
  const same = loaded && JSON.stringify(next) === JSON.stringify(team)
  team = next
  loaded = true
  if (!same) emit()
}

export function initBookingTeam(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await sendJson('GET', '/api/appointments/team')
    if (r.result.ok) take(r.json?.data)
  })().finally(() => { if (!loaded) initPromise = null })
  return initPromise
}
export const isBookingTeamLoaded = () => loaded

/** Read again (Team changed here or on another device). Quiet when nothing changed. */
export async function refreshBookingTeam(): Promise<void> {
  const r = await sendJson('GET', '/api/appointments/team')
  if (r.result.ok) take(r.json?.data)
}

export const getBookingTeam = (): TeamMember[] => team
/** The owner: picked for new appointments. */
export const defaultMember = (): TeamMember | null => defaultMemberOf(team)

/** The team, kept current on screen. */
export function useBookingTeam(): TeamMember[] {
  const [t, setT] = useState<TeamMember[]>(team)
  useEffect(() => {
    const h = () => setT(team)
    window.addEventListener(EVT, h)
    h()
    return () => window.removeEventListener(EVT, h)
  }, [])
  return t
}
