import { useEffect, useRef } from 'react'

/**
 * For a screen that keeps its own copy of a whole saved record.
 *
 * When a save of `storeName` was refused and another device's changes were
 * merged in (see syncGuard), `reload` is called so the screen reads the merged
 * data in place. Handling it here also tells the app shell not to remount the
 * page, which is what happens for screens that do not use this hook.
 */
export function useMergedRefresh(storeName: string, reload: () => void): void {
  const fn = useRef(reload)
  fn.current = reload
  useEffect(() => {
    const onMerged = (e: Event) => {
      if ((e as CustomEvent).detail?.name !== storeName) return
      e.preventDefault()
      fn.current()
    }
    window.addEventListener('ezbiz:merged-from-server', onMerged)
    return () => window.removeEventListener('ezbiz:merged-from-server', onMerged)
  }, [storeName])
}
