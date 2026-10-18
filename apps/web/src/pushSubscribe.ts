/**
 * Push notifications on this phone (free web push): Android Chrome, and
 * iPhone Safari once the app is added to the home screen (iOS 16.4+).
 */

import { api } from './automationsApi'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js').catch(() => null)) ?? null
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIos() && !standalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/** Ask the phone for permission and register it with the server. */
export async function turnOnPush(): Promise<void> {
  const state = await pushState()
  if (state === 'needs-install') throw new Error('On iPhone, push works once the app is on the home screen: tap Share, then Add to Home Screen, open it from there and turn push on again.')
  if (state === 'unsupported') throw new Error('This browser cannot get push notifications. Use Chrome on Android, or the app added to the iPhone home screen.')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this app. Allow them in the phone\'s settings, then try again.')
  const reg = await registration()
  if (!reg) throw new Error('The app\'s background helper is not running. Reload the app and try again.')
  await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>('GET', '/push/key')
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource })
  await api('POST', '/push/subscribe', { subscription: sub.toJSON() })
}

export async function turnOffPush(): Promise<void> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => null)
  await sub.unsubscribe()
}
