/**
 * Accounts Payable and Vendors stay current while they are open: bills the
 * server makes or voids (the owner taps "We ordered this" or "Undo the order"
 * in another tab or on another device) show without opening the page again.
 * Read again when the page comes back on screen, and every 20 seconds while
 * it is on screen (one small request; nothing while the tab is hidden).
 */

import { useEffect } from 'react'
import { refreshVendors } from './vendorStore'

export const VENDORS_POLL_MS = 20_000

export function useVendorsLive(): void {
  useEffect(() => {
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    let last = 0
    const again = () => {
      if (!visible() || Date.now() - last < 2_000) return
      last = Date.now()
      void refreshVendors()
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    const t = setInterval(again, VENDORS_POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('focus', again)
      clearInterval(t)
    }
  }, [])
}
