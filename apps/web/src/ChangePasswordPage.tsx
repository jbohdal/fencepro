/**
 * Change password screen.
 *
 * Shown full screen when the account must change its password before using
 * the app (the seeded owner login), and as a dialog from the sidebar for
 * anyone who wants to change theirs.
 */

import { useState } from 'react'
import { changePassword } from './crmAuth'

export default function ChangePasswordPage({
  forced,
  onDone,
  onCancel,
}: {
  /** True when the user cannot continue until the password is changed. */
  forced: boolean
  onDone: () => void
  /** Sign out (forced) or close (dialog). */
  onCancel: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (next.length < 8) { setError('New password must be at least 8 characters'); return }
    if (next !== confirm) { setError('New passwords do not match'); return }
    setSaving(true)
    try {
      await changePassword(current, next)
      onDone()
    } catch (err: any) {
      setError(err?.message || 'Could not change password')
    }
    setSaving(false)
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400'
  const type = show ? 'text' : 'password'

  return (
    <div className={forced ? 'min-h-screen bg-gray-900 flex items-center justify-center px-4' : 'fixed inset-0 z-[120] bg-black/50 flex items-center justify-center px-4'}>
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{forced ? 'Set a new password' : 'Change password'}</h2>
          <p className="text-xs text-gray-500 mt-1">
            {forced
              ? 'This account is still on its starter password. Choose your own before you continue.'
              : 'Your other devices will be signed out.'}
          </p>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Current password</label>
          <input type={type} autoFocus autoComplete="current-password" className={inputCls} value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">New password</label>
          <input type={type} autoComplete="new-password" className={inputCls} placeholder="At least 8 characters" value={next} onChange={e => setNext(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Confirm new password</label>
          <input type={type} autoComplete="new-password" className={inputCls} value={confirm} onChange={e => setConfirm(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show passwords
        </label>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50">
            {forced ? 'Sign out' : 'Cancel'}
          </button>
          <button type="submit" disabled={saving || !current || !next || !confirm} className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold py-2.5 rounded-lg">
            {saving ? 'Saving...' : 'Save password'}
          </button>
        </div>
      </form>
    </div>
  )
}
