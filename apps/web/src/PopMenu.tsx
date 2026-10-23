/**
 * One way to open a menu, dropdown or small popup so it is always fully on
 * the screen.
 *
 *   - A phone (under 640 px wide, or a finger instead of a mouse) gets a
 *     bottom sheet: full width, sitting just above the tab bar (or above the
 *     phone's home bar when there is no tab bar), never taller than the screen
 *     above it, scrolling inside itself when the list is long.
 *   - A desktop gets a small box by the button. It opens below the button,
 *     lined up with the button's right edge (align "end") or left edge
 *     ("start"). If that runs off a side it flips to the other edge, and if it
 *     still does not fit it is pushed in, 8 px from the edge. If there is no
 *     room below it opens above; if neither fits it sits in the taller space
 *     and scrolls inside itself.
 *
 * The popup is drawn on top of everything (a portal on <body>), so a box that
 * clips (a kanban column, a card) cannot cut it off. Clicks inside it do not
 * reach the card or row under the button. It closes on a tap outside, Escape,
 * the phone's back button, or when an item calls close().
 *
 * The button carries data-popup-trigger and the popup data-popup, which is how
 * e2e/phone-fit.mjs finds and opens every one.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { BackClose } from './nav'
import { placePopup, POPUP_MARGIN as MARGIN } from './popupPlace'

export { placePopup }
const PHONE = '(max-width: 639px), (pointer: coarse)'

/** True on a phone-sized screen or a touch-only device. */
export function usePhoneSheet(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches)
  useEffect(() => {
    const m = window.matchMedia(PHONE)
    const on = () => setPhone(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return phone
}

/** How far up from the bottom of the screen the tab bar reaches (0 when there is none). */
function tabBarHeight(): number {
  const t = document.querySelector('[data-tabbar]')
  if (!t) return 0
  const r = t.getBoundingClientRect()
  if (r.height < 2 || getComputedStyle(t).display === 'none') return 0
  return Math.max(0, window.innerHeight - r.top)
}

type Props = {
  /** What the button shows. */
  label: ReactNode
  /** The button's own classes. */
  triggerClassName?: string
  /** Extra attributes for the button (aria-label, data-*, title). */
  triggerProps?: Record<string, string | boolean | undefined>
  /** Which edge of the button a desktop popup lines up with. */
  align?: 'start' | 'end'
  /** Desktop width in px (a phone sheet is always full width). */
  width?: number
  /** Heading on the phone sheet. */
  title?: string
  /** "menu" for a list of actions, "dialog" for a panel (filters, a list to read). */
  kind?: 'menu' | 'dialog'
  /** Classes for the popup's inside (padding, text size). */
  className?: string
  /** A name for the popup, as data-popup="<name>". */
  name?: string
  /** Opened from outside (e.g. a test or a keyboard shortcut). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode | ((close: () => void) => ReactNode)
}

export default function PopMenu({
  label, triggerClassName, triggerProps, align = 'end', width = 224, title, kind = 'menu',
  className = 'p-1', name, open: openProp, onOpenChange, children,
}: Props) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = useCallback((v: boolean) => { setOpenState(v); onOpenChange?.(v) }, [onOpenChange])
  const close = useCallback(() => setOpen(false), [setOpen])
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const phone = usePhoneSheet()
  const back = useRef<HTMLDivElement>(null)
  const hidden = useCallback((): CSSProperties => ({ visibility: 'hidden', left: 0, top: 0, width: Math.min(width, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 2 * MARGIN) }), [width])
  const [style, setStyle] = useState<CSSProperties>(hidden)

  const place = useCallback(() => {
    if (!btn.current || !pop.current) return
    if (phone) {
      const tab = tabBarHeight()
      setStyle({
        left: 0, right: 0, bottom: tab,
        maxHeight: `calc(${window.innerHeight - tab}px - ${MARGIN * 2}px${tab ? '' : ' - env(safe-area-inset-bottom)'})`,
        paddingBottom: tab ? undefined : 'env(safe-area-inset-bottom)',
      })
      return
    }
    const t = btn.current.getBoundingClientRect()
    const p = pop.current
    const h = p.scrollHeight + (p.offsetHeight - p.clientHeight)
    const pos = placePopup(t, { width, height: h }, { width: window.innerWidth, height: window.innerHeight }, align)
    setStyle({ left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 2 * MARGIN), maxHeight: pos.maxHeight })
  }, [phone, width, align])

  useLayoutEffect(() => {
    if (!open) { setStyle(hidden()); return }
    place()
  }, [open, place, hidden])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => {
      const n = e.target as Node
      // The phone's dimmed backdrop closes on its own click, so the tap cannot land on what is under it.
      if (btn.current?.contains(n) || pop.current?.contains(n) || back.current?.contains(n)) return
      close()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus() } }
    const again = () => place()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', again)
    // A desktop popup follows its button when the page scrolls.
    if (!phone) window.addEventListener('scroll', again, true)
    // A list that fills in after opening (notifications loading) is placed again.
    const ro = typeof ResizeObserver !== 'undefined' && pop.current ? new ResizeObserver(again) : null
    if (ro && pop.current) ro.observe(pop.current.lastElementChild ?? pop.current)
    return () => {
      ro?.disconnect()
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [open, phone, close, place])

  // Nothing under the popup (a card, a draggable row) hears its taps.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  const body = typeof children === 'function' ? children(close) : children

  return (
    <>
      <button
        ref={btn} type="button"
        className={triggerClassName}
        aria-haspopup={kind} aria-expanded={open} data-popup-trigger={name ?? ''}
        onClick={e => { e.stopPropagation(); setOpen(!open) }}
        onPointerDown={stop} onMouseDown={stop} onTouchStart={stop}
        {...triggerProps}
      >{label}</button>
      {open && createPortal(
        <div onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onDragStart={stop}>
          <BackClose onClose={close} name="popup" />
          {phone && <div ref={back} className="fixed inset-0 z-(--z-popover) bg-black/30" onClick={close} aria-hidden="true" data-popup-backdrop />}
          <div
            ref={pop}
            role={kind} aria-label={title}
            data-popup={name ?? ''}
            style={style}
            className={phone
              ? 'fixed z-[calc(var(--z-popover)+1)] bg-white rounded-t-2xl border-t border-gray-200 shadow-2xl overflow-y-auto overscroll-contain'
              : 'fixed z-[calc(var(--z-popover)+1)] bg-white rounded-xl border border-gray-200 shadow-xl overflow-y-auto overscroll-contain'}
          >
            {phone && (
              <div className="sticky top-0 bg-white flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900 truncate">{title || ''}</p>
                <button type="button" onClick={close} className="btn btn-quiet btn-sm shrink-0" data-popup-close>Close</button>
              </div>
            )}
            <div className={className}>{body}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** A row in a PopMenu: a full-width button at least 44 px tall. */
export function PopItem({ onClick, children, danger, className = '', ...rest }: {
  onClick: () => void; children: ReactNode; danger?: boolean; className?: string; [k: string]: unknown
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} {...rest}
      className={`w-full text-left px-3 min-h-[44px] rounded-lg text-sm ${danger ? 'font-semibold text-red-700 hover:bg-red-50' : 'text-gray-800 hover:bg-gray-50'} ${className}`}>
      {children}
    </button>
  )
}
