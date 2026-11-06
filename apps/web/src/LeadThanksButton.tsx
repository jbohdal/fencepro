/**
 * "Text Jane thanks" on a new lead's card and on its Assign screen (where the
 * new lead push opens), while the thanks is still to send (Jonathan, Nov 6
 * 2026: no Twilio; portal lib/leadTexts.ts). A tap opens the phone's Messages
 * with the text written; the person presses send. The tap marks the thanks
 * done, so the button and its Today task go away.
 */

import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { sendJson } from './syncHttp'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { customerText } from '../../portal/src/server/lib/customerText'

interface Thanks { taskId: string; text: string; phone: string }

export default function LeadThanksButton({ customerId, firstName, className }: { customerId: string | null | undefined; firstName?: string | null; className?: string }) {
  const [thanks, setThanks] = useState<Thanks | null>(null)
  useEffect(() => {
    let live = true
    setThanks(null)
    if (!customerId) return
    void sendJson('GET', `/api/automations/lead-thanks/${encodeURIComponent(customerId)}`).then(r => {
      if (live && r.result.ok) setThanks((r.result.data as Thanks | null) ?? null)
    })
    return () => { live = false }
  }, [customerId])
  if (!customerId || !thanks?.phone) return null
  // A phone lead with no name ("Unknown", "+1 (352) ..."): "Text them thanks".
  const word = String(firstName ?? '').trim().split(/\s+/)[0] ?? ''
  const first = /^[A-Za-z][A-Za-z'.-]*$/.test(word) && !/^unknown$/i.test(word) ? word : 'them'
  return (
    <a href={smsLink(thanks.phone, customerText(thanks.text, getConfig().company?.name))} className={className ?? 'btn btn-primary w-full min-h-[48px] justify-center'} data-lead-thanks={customerId}
      onClick={() => { void sendJson('POST', `/api/automations/lead-thanks/${encodeURIComponent(customerId)}/sent`).then(r => { if (r.result.ok) setThanks(null) }) }}>
      <MessageSquare size={20} aria-hidden="true" /> Text {first} thanks
    </a>
  )
}
