/**
 * A move the server refused because the stage's requirements are not met
 * (409 STAGE_BLOCKED). The stores put the card back and call this; the
 * StageBlockedNotice window shows what is missing.
 */

export interface BlockedMove { id: string; name: string; board: 'sales' | 'ops'; from: string; to: string; missing: Array<{ type: string; label: string; detail: string }> }

export const STAGE_BLOCKED_EVENT = 'ezbiz:stage-blocked'

export function notifyStageBlocked(blocked: BlockedMove[]) {
  if (!Array.isArray(blocked) || !blocked.length) return
  try { window.dispatchEvent(new CustomEvent(STAGE_BLOCKED_EVENT, { detail: blocked })) } catch { /* no window */ }
}
