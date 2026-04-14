import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api, setTokens, clearTokens, getAccessToken } from '../lib/api'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'customer' | 'admin' | 'support_agent'
  accountId: string
  accountName: string
  assignedRep?: string
  assignedRepEmail?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string; accountId: string }) => Promise<void>
  logout: () => void
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUser = useCallback(async () => {
    if (!getAccessToken()) { setLoading(false); return }
    try {
      const data = await api.get<User>('/auth/me')
      setUser(data)
    } catch {
      clearTokens()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUser() }, [fetchUser])

  async function login(email: string, password: string) {
    const data = await api.post<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', { email, password })
    setTokens(data.accessToken, data.refreshToken)
    setUser(data.user)
  }

  async function register(body: { email: string; password: string; firstName: string; lastName: string; phone?: string; accountId: string }) {
    const data = await api.post<{ accessToken: string; refreshToken: string; user: User }>('/auth/register', body)
    setTokens(data.accessToken, data.refreshToken)
    setUser(data.user)
  }

  function logout() {
    api.post('/auth/logout', { refreshToken: localStorage.getItem('portal_refresh_token') }).catch(() => {})
    clearTokens()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
