/**
 * CRM Login Page
 *
 * Clean branded login with forgot password and accept invite flows.
 */

import { useState, useEffect } from 'react'
import { login, acceptInvite, forgotPassword, resetPassword, type CrmUser } from './crmAuth'

type View = 'login' | 'forgot' | 'accept-invite' | 'reset-password'

export default function LoginPage({ onLogin }: { onLogin: (user: CrmUser) => void }) {
  const [view, setView] = useState<View>('login')
  const [email, setEmail] = useState(() => localStorage.getItem('crm_last_email') || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  // Check URL for invite or reset token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const tokenEmail = params.get('email')
    if (window.location.pathname === '/accept-invite' && token) {
      setView('accept-invite')
      if (tokenEmail) setEmail(decodeURIComponent(tokenEmail))
    }
    if (window.location.pathname === '/reset-password' && token) {
      setView('reset-password')
      if (tokenEmail) setEmail(decodeURIComponent(tokenEmail))
    }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { user } = await login(email, password)
      onLogin(user)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess(''); setLoading(true)
    try {
      await forgotPassword(email)
      setSuccess('If an account exists with that email, a reset link has been sent.')
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }

  async function handleAcceptInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    if (password !== confirmPassword) { setError('Passwords do not match'); setLoading(false); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); setLoading(false); return }
    try {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token') || ''
      const { user } = await acceptInvite(token, email, password)
      window.history.replaceState({}, '', '/')
      onLogin(user)
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess(''); setLoading(true)
    if (password !== confirmPassword) { setError('Passwords do not match'); setLoading(false); return }
    try {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token') || ''
      await resetPassword(token, email, password)
      setSuccess('Password reset successfully. You can now log in.')
      setView('login')
      setPassword(''); setConfirmPassword('')
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">F</div>
          <h1 className="text-2xl font-bold text-white">FencePro CRM</h1>
          <p className="text-gray-500 text-sm mt-1">Management Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-6 shadow-xl">

          {/* Login Form */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 text-center">Sign In</h2>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
              {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{success}</div>}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="you@company.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="••••••••" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50 transition">
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <button type="button" onClick={() => { setView('forgot'); setError(''); setSuccess('') }}
                className="w-full text-sm text-gray-500 hover:text-orange-600 transition">
                Forgot password?
              </button>
            </form>
          )}

          {/* Forgot Password */}
          {view === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 text-center">Reset Password</h2>
              <p className="text-sm text-gray-500 text-center">Enter your email to receive a reset link.</p>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
              {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{success}</div>}
              <div>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="you@company.com" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
              <button type="button" onClick={() => { setView('login'); setError(''); setSuccess('') }}
                className="w-full text-sm text-gray-500 hover:text-orange-600">
                Back to login
              </button>
            </form>
          )}

          {/* Accept Invite */}
          {view === 'accept-invite' && (
            <form onSubmit={handleAcceptInvite} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 text-center">Welcome!</h2>
              <p className="text-sm text-gray-500 text-center">Set your password to activate your account.</p>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input type="email" value={email} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="Min 8 characters" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="••••••••" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50">
                {loading ? 'Setting up...' : 'Set Password & Sign In'}
              </button>
            </form>
          )}

          {/* Reset Password */}
          {view === 'reset-password' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 text-center">New Password</h2>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
              {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{success}</div>}
              <div>
                <label className="block text-xs text-gray-500 mb-1">New Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="Min 8 characters" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-orange-400 outline-none" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50">
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">Systems Syndicate</p>
      </div>
    </div>
  )
}
