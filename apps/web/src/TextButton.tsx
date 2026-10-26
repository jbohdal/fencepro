/**
 * The plain Text button (job page, customer page, pipeline card): the
 * phone's texting app opens with "Getter Done Fence: Hi Manuel, " ...
 * "Reply STOP to opt out." (portal lib/customerText.ts), for any customer
 * with a phone number. The app sends nothing here (the person sends it from
 * their own phone), so no yes to texts is asked for; only texts the app sends
 * by itself need one (portal lib/textConsent.ts).
 */

import type { ReactNode } from 'react'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { customerTextStart } from '../../portal/src/server/lib/customerText'

export default function TextButton({ phone, firstName, name, className, children, onTap, ...data }: {
  phone: string
  firstName?: string
  name?: string
  className?: string
  children: ReactNode
  /** After the text is opened (the follow up's "How'd it go?"). */
  onTap?: () => void
} & Record<`data-${string}`, string | boolean | undefined>) {
  const company = getConfig().company?.name || 'Getter Done Fence'
  const href = phone ? smsLink(phone, customerTextStart(firstName || name, company)) : undefined
  return (
    <a href={href} onClick={() => { if (phone) onTap?.() }} aria-disabled={!phone} className={className} {...data}>
      {children}
    </a>
  )
}
