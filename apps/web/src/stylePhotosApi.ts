/** Style photos for proposals: one per fence style, uploaded in Settings. */

import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'

const API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/style-photos'

export interface StylePhoto { id: string; styleName: string; updatedAt: string }

export async function listStylePhotos(): Promise<StylePhoto[]> {
  const r = await fetchWithAuth(API).catch(() => null)
  if (!r?.ok) return []
  const j = await r.json().catch(() => null)
  return Array.isArray(j?.data) ? j.data : []
}

/** Shrinks the photo to at most 1600 px wide JPEG before sending. */
export async function uploadStylePhoto(styleName: string, file: File): Promise<StylePhoto | null> {
  const blob = await shrink(file).catch(() => file)
  const form = new FormData()
  form.append('styleName', styleName)
  form.append('photo', blob, 'style.jpg')
  const r = await fetchWithAuth(API, { method: 'POST', body: form }).catch(() => null)
  if (!r?.ok) return null
  const j = await r.json().catch(() => null)
  return j?.data ?? null
}

export async function deleteStylePhoto(id: string): Promise<boolean> {
  const r = await fetchWithAuth(`${API}/${id}`, { method: 'DELETE' }).catch(() => null)
  return !!r?.ok
}

/** Public address of a style photo (same path the proposal uses). */
export function stylePhotoUrl(id: string): string {
  return (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + `/p/photo/${id}`
}

async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / img.width)
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('no image'))), 'image/jpeg', 0.85))
}
