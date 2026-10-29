/**
 * My profile: each person sets their own Direct phone (PATCH /api/crm-auth/me).
 * It is {rep_phone} in the appointment texts (appointmentMessages.ts); the
 * owner and admin can also set anyone's in Settings > Team.
 */

import { useState } from 'react'
import { currentUser, saveMyPhone } from './crmAuth'
import { formatPhone } from './phoneFormat'
import { useBackLayer } from './nav'
import { toast } from './toast'
import { refreshBookingTeam } from './bookingTeamStore'

export default function MyProfileDialog({ onClose }: { onClose: () => void }) {
  useBackLayer(onClose, { key: 'my-profile' })
  const me = currentUser()
  const [phone, setPhone] = useState(formatPhone(me?.phone || ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setError('')
    try {
      const saved = await saveMyPhone(phone.trim())
      setPhone(formatPhone(saved || ''))
      void refreshBookingTeam()  // the booking team shows each person's Direct phone
      toast.success('Direct phone saved', saved ? formatPhone(saved) : 'Cleared: the On my way text gives the company number.')
      onClose()
    } catch (err: any) { setError(err?.message || 'Could not save') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} data-my-profile className="bg-white w-full sm:max-w-[420px] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">My profile</h2>
          <button onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <p className="text-sm text-gray-700">{me ? `${me.firstName} ${me.lastName}` : ''}<span className="block text-xs text-gray-500">{me?.email}</span></p>
        <label className="block text-xs font-semibold text-gray-500">Direct phone
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} placeholder="(352) 555 0100"
            data-my-direct-phone className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-normal text-gray-900" />
        </label>
        <p className="text-xs text-gray-500">Your own cell. When an appointment is booked with you, the On my way text gives customers this number (empty: the company number). Booking confirmations, calendar invites and install texts give the office line from Settings > Company.</p>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl">Cancel</button>
          <button onClick={save} disabled={saving} data-save-my-profile className="btn btn-primary flex-1 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
