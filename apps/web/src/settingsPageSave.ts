/**
 * Settings pages that keep their own draft (a list, the tiers, the messages)
 * tell the Settings screen about it here, so the one "Unsaved changes · Save ·
 * Discard" bar works for them too and leaving the page asks first. Pages that
 * edit the shared settings draft (Company, Pricing, ...) need nothing: the
 * Settings screen sees their changes itself.
 *
 *   useSettingsPageSave(dirty, save, discard)
 *
 * `save` may be async; the bar waits for it. Saving still goes through each
 * page's own store and the API, exactly as the page's own button does.
 */
import { createContext, useContext, useEffect, useRef } from 'react'

export interface PageSave {
  dirty: boolean
  save: () => unknown
  discard: () => void
}

export const SettingsPageSaveContext = createContext<(s: PageSave | null) => void>(() => {})

export function useSettingsPageSave(dirty: boolean, save: () => unknown, discard: () => void) {
  const report = useContext(SettingsPageSaveContext)
  const ref = useRef({ save, discard })
  ref.current = { save, discard }
  useEffect(() => {
    report({ dirty, save: () => ref.current.save(), discard: () => ref.current.discard() })
  }, [dirty, report])
  useEffect(() => () => report(null), [report])
}
