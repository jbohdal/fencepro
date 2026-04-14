import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import type { TokenPayload, AuthTokens } from '../../types/index.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me'
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m'
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d'
const SALT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateTokens(payload: TokenPayload): AuthTokens {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: parseInt(ACCESS_EXPIRY) || ACCESS_EXPIRY } as jwt.SignOptions)
  const refreshToken = jwt.sign({ sub: payload.sub, jti: uuidv4() }, JWT_REFRESH_SECRET, { expiresIn: parseInt(REFRESH_EXPIRY) || REFRESH_EXPIRY } as jwt.SignOptions)
  return { accessToken, refreshToken }
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  return jwt.verify(token, JWT_REFRESH_SECRET) as { sub: string; jti: string }
}

export function getRefreshExpiry(): Date {
  const ms = parseDuration(REFRESH_EXPIRY)
  return new Date(Date.now() + ms)
}

function parseDuration(d: string): number {
  const match = d.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000
  const n = parseInt(match[1])
  switch (match[2]) {
    case 's': return n * 1000
    case 'm': return n * 60 * 1000
    case 'h': return n * 60 * 60 * 1000
    case 'd': return n * 24 * 60 * 60 * 1000
    default: return n * 1000
  }
}
