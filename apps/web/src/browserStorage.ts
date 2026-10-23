/**
 * What the staff app may keep in the browser's own storage, and nothing else.
 *
 * Rule 1 (CLAUDE.md): business data and the sign in live on the server only.
 * The sign in is the httpOnly cookie `ezbiz_staff` (crmAuth.ts); the app asks
 * the server who is signed in on every start. Jonathan's answers to the sign
 * in plan (Oct 20, 2026) allow exactly these:
 *
 *   1. Per device screen choices (answer 4): the boards' folded columns, view,
 *      sort and filters. Not business data. DEVICE_PREF_KEYS, read and written
 *      only through readPref / writePref below.
 *   2. The offline queues (answer 1, the one written exception): unsent
 *      changes (outbox.ts, IndexedDB `ezbiz-outbox`), photos, video and
 *      invoice files (mediaStore.ts, `ezbiz-media`), voice clips
 *      (voiceClient.ts, `ezbiz-voice`). Encrypted at rest with a key that
 *      cannot be read out of the browser (vault.ts, `ezbiz-vault`); they hold
 *      nothing but what has not reached the server, and each item is deleted
 *      the moment the server confirms it.
 *   3. Until stage D: the old sign in's two keys, read once to move a phone
 *      over to the cookie and then deleted (crmAuth.ts, moveOverOldSignIn).
 *   4. The service worker's cache of the app's own files (public/sw.js, Cache
 *      Storage): code and the app page, never anything under /api.
 *
 * Anything else an older version left behind (the Settings and budget copies,
 * who was signed in, the last email typed, customers, quotes, jobs, the old
 * one time moves' flags ...) is deleted on load without being read or
 * uploaded (answer 5: the server is the record): clearOldBrowserData.
 *
 * apps/portal/tests/browserStorageGuard.test.ts fails on any new use of
 * localStorage, sessionStorage or IndexedDB outside this list.
 */

/** Answer 4: per device board choices. */
export const DEVICE_PREF_KEYS = [
  'fencepro_pipeline_collapsed_columns', 'fencepro_pipeline_view', 'fencepro_pipeline_sort_v2', 'fencepro_pipeline_analytics_open',
  'fencepro_ops_collapsed_columns', 'fencepro_ops_view', 'fencepro_ops_sort', 'fencepro_ops_analytics_open',
  'fencepro_ops_show_completed', 'fencepro_ops_highlight_today',
] as const
export type DevicePrefKey = typeof DEVICE_PREF_KEYS[number]

/** Until stage D: the old sign in, read once and deleted by crmAuth.ts. */
export const MOVE_OVER_KEYS = ['crm_access_token', 'crm_refresh_token'] as const

/** The offline queues' IndexedDB databases (encrypted, vault.ts) and the vault holding their key. */
export const QUEUE_DATABASES = ['ezbiz-outbox', 'ezbiz-media', 'ezbiz-voice', 'ezbiz-vault'] as const

const KEEP = new Set<string>([...DEVICE_PREF_KEYS, ...MOVE_OVER_KEYS])

/** A board choice on this device, or null. */
export function readPref(key: DevicePrefKey): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/** Keep a board choice on this device. */
export function writePref(key: DevicePrefKey, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage full or switched off: the choice lasts this visit */ }
}

/**
 * Deletes everything an older version kept in this browser that is not on the
 * list above: unread, not uploaded. Returns the keys removed (for the tests).
 */
export function clearOldBrowserData(): string[] {
  const removed: string[] = []
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k !== null && !KEEP.has(k)) { localStorage.removeItem(k); removed.push(k) }
    }
  } catch { /* storage unavailable: nothing to clear */ }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k !== null) { sessionStorage.removeItem(k); removed.push(`session:${k}`) }
    }
  } catch { /* storage unavailable */ }
  return removed
}
