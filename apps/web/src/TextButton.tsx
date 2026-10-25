/**
 * The plain Text button (job page, customer page, pipeline card): the
 * phone's texting app opens with "Getter Done Fence: Hi Manuel, " ...
 * "Reply STOP to opt out." (portal lib/customerText.ts), and only for a
 * customer who said yes to texts, like every other customer text. No yes
 * on record: it says why instead of opening the text.
 */

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { toast } from './toast'
import { fetchTextConsent } from './TextConsent'
import { customerTextStart } from '../../portal/src/server/lib/customerText'
import { asTextConsent, describeTextConsent } from '../../portal/src/server/lib/textConsentModel'

/** The customer's texting answer: yes, or the reason the text is not opened (null while it loads). */
export function useTextAllowed(customerId: string | null | undefined, name: string): { allowed: boolean; reason: string | null } {
  const [state, setState] = useState<{ allowed: boolean; reason: string | null }>({ allowed: false, reason: null })
  useEffect(() => {
    let live = true
    if (!customerId) { setState({ allowed: false, reason: 'Not texted: there is no customer record with a yes to texts.' }); return }
    setState({ allowed: false, reason: null })
    fetchTextConsent(customerId).then(c => {
      if (!live) return
      if (!c) setState({ allowed: false, reason: 'The texting answer could not be read (no signal?). Try again.' })
      else if (asTextConsent(c.textConsent) === 'yes') setState({ allowed: true, reason: null })
      else setState({ allowed: false, reason: `Not texted: ${name || 'the customer'} has not agreed to texts yet (Texts: ${describeTextConsent(c)}). Record their yes on the customer page first.` })
    })
    return () => { live = false }
  }, [customerId, name])
  return state
}

export default function TextButton({ phone, customerId, firstName, name, className, children, onTap, ...data }: {
  phone: string
  customerId?: string | null
  firstName?: string
  name?: string
  className?: string
  children: ReactNode
  /** After the text is opened (the follow up's "How'd it go?"). */
  onTap?: () => void
} & Record<`data-${string}`, string | boolean | undefined>) {
  const consent = useTextAllowed(customerId, name || firstName || '')
  const company = getConfig().company?.name || 'Getter Done Fence'
  const href = phone && consent.allowed ? smsLink(phone, customerTextStart(firstName || name, company)) : undefined
  const onClick = (e: MouseEvent) => {
    if (!phone) return
    if (!consent.allowed) {
      e.preventDefault()
      toast.error('Text not opened', consent.reason || 'Checking the texting answer. Try again in a moment.')
      return
    }
    onTap?.()
  }
  return (
    <a href={href} onClick={onClick} aria-disabled={!phone} className={className} data-text-allowed={consent.allowed ? 'yes' : consent.reason ? 'no' : 'checking'} {...data}>
      {children}
    </a>
  )
}
