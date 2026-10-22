/**
 * A phone number shown as "(352) 671 8083" (phoneFormat.ts) that calls when
 * tapped. When the number belongs to a customer with a pipeline card, the tap
 * starts the "How'd it go?" follow up, as the card's own phone link does
 * (followUpStore.ts startTouch). A number with no card just calls.
 */

import type { MouseEvent, ReactNode } from 'react'
import { formatPhone, telHref } from './phoneFormat'
import { startTouch } from './followUpStore'
import { getPipeline } from './pipelineStore'

export default function PhoneLink({ phone, customerId, cardId, name, className, children, ...data }: {
  phone: string
  /** The customer the number is theirs (their card is found by it), or the card itself. */
  customerId?: string | null
  cardId?: string | null
  name?: string
  className?: string
  children?: ReactNode
} & Record<`data-${string}`, string | boolean | undefined>) {
  const onClick = (e: MouseEvent) => {
    e.stopPropagation()
    const leads = getPipeline().leads || []
    const lead = (cardId && leads.find((l: any) => l.id === cardId)) || (customerId && leads.find((l: any) => l.customerId === customerId)) || null
    if (!lead) return
    const who = name || `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'Customer'
    startTouch({ cardId: lead.id, customerId: lead.customerId ?? customerId ?? null, name: who, firstName: lead.firstName, phone, stage: lead.stage, channel: 'call' })
  }
  return (
    <a href={telHref(phone)} onClick={onClick} aria-label={`Call ${formatPhone(phone)}`}
      className={className ?? 'text-blue-600 hover:underline whitespace-nowrap'} {...data}>
      {children ?? formatPhone(phone)}
    </a>
  )
}
