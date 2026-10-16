/**
 * The in-app camera: several photos in a row, or video, without leaving the
 * screen. Each capture is saved on the phone the moment it is taken (see
 * mediaStore) with the time, GPS position and compass direction when the
 * phone allows them, then uploads in the background. Video is capped at
 * 1080p.
 */

import { useEffect, useRef, useState } from 'react'
import { X, Camera, Video, Square } from 'lucide-react'
import { addCapture, storageWarning, CATEGORIES, type Category, type LocalMedia, type MediaMeta } from './mediaStore'
import { watchLocation, watchHeading, type Fix } from './sensors'
import { useBackLayer } from './nav'

/** "video/webm;codecs=vp8,opus" → "video/webm" (what the Mac stores). */
export const baseMime = (m: string) => m.split(';')[0].trim().toLowerCase()

export default function MediaCapture({ where, defaultCategory, onDone, onClose }: {
  where: Pick<MediaMeta, 'quoteKey' | 'jobId' | 'customerId'>
  defaultCategory: Category
  onDone: (taken: LocalMedia[]) => void
  onClose: () => void
}) {
  useBackLayer(onClose, { key: 'media-capture' })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const fix = useRef<Fix | null>(null)
  const heading = useRef<number | null>(null)
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [category, setCategory] = useState<Category>(defaultCategory)
  const [taken, setTakenState] = useState<Array<LocalMedia & { thumb: string }>>([])
  const takenRef = useRef<Array<LocalMedia & { thumb: string }>>([])
  const setTaken = (fn: (l: Array<LocalMedia & { thumb: string }>) => Array<LocalMedia & { thumb: string }>) => { takenRef.current = fn(takenRef.current); setTakenState(takenRef.current) }
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [problem, setProblem] = useState('')
  const [warn, setWarn] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let alive = true
    const open = async () => {
      const video = { facingMode: { ideal: 'environment' }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ video, audio: true })
      } catch {
        // No microphone permission: photos and silent video still work.
        try { stream.current = await navigator.mediaDevices.getUserMedia({ video }) } catch { if (alive) setProblem('The camera is not available. Allow it for this site in the phone settings, or use Choose from gallery.') ; return }
      }
      if (!alive) { stream.current?.getTracks().forEach(t => t.stop()); return }
      if (videoRef.current) { videoRef.current.srcObject = stream.current; videoRef.current.play().catch(() => {}) }
    }
    open()
    const stopFix = watchLocation(f => { fix.current = f })
    const stopHeading = watchHeading(h => { heading.current = h })
    storageWarning().then(setWarn)
    return () => { alive = false; stopFix(); stopHeading(); stream.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [recording])

  function meta(kind: 'photo' | 'video', mime: string): MediaMeta {
    return {
      ...where, kind, mime: baseMime(mime), takenAt: new Date().toISOString(), category,
      lat: fix.current?.lat ?? null, lng: fix.current?.lng ?? null, accuracyM: fix.current?.accuracyM ?? null,
      heading: heading.current != null ? Math.round(heading.current * 10) / 10 : null,
    }
  }

  async function keep(blob: Blob, m: MediaMeta) {
    const saved = await addCapture(blob, m)
    const thumb = m.kind === 'photo' ? URL.createObjectURL(blob) : ''
    setTaken(list => [...list, { ...saved, thumb }])
    storageWarning().then(setWarn)
  }

  async function shoot() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    setFlash(true); setTimeout(() => setFlash(false), 120)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.9))
    if (blob) await keep(blob, meta('photo', 'image/jpeg'))
  }

  function startVideo() {
    if (!stream.current) return
    const MR = (window as any).MediaRecorder
    const type = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => { try { return MR?.isTypeSupported?.(t) } catch { return false } })
    try {
      const rec: MediaRecorder = new MR(stream.current, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 6_000_000 })
      chunks.current = []
      rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      rec.onstop = () => {
        const mime = rec.mimeType || type || 'video/webm'
        const blob = new Blob(chunks.current, { type: baseMime(mime) })
        if (blob.size > 0) keep(blob, meta('video', mime))
      }
      rec.start(1000)
      recorder.current = rec
      setSeconds(0); setRecording(true)
    } catch {
      setProblem('This phone cannot record video here. Use the phone camera, then Choose from gallery.')
    }
  }
  function stopVideo() { recorder.current?.stop(); recorder.current = null; setRecording(false) }

  function finish() {
    if (recording) stopVideo()
    // The video's last piece is saved a moment after Stop.
    setTimeout(() => onDone(takenRef.current), recording ? 800 : 0)
  }

  return (
    <div className="fixed inset-0 z-[85] bg-black flex flex-col" data-media-capture>
      <div className="flex items-center gap-2 px-3 py-2 pt-[max(8px,env(safe-area-inset-top))] text-white">
        <button type="button" className="w-11 h-11 grid place-items-center" aria-label="Close the camera" onClick={() => (taken.length ? finish() : onClose())}><X size={26} /></button>
        <select className="h-11 rounded-lg bg-white/15 text-white px-2 text-sm" value={category} onChange={e => setCategory(e.target.value as Category)} aria-label="Category" data-capture-category>
          {CATEGORIES.map(c => <option key={c} value={c} className="text-black">{c}</option>)}
        </select>
        <span className="flex-1" />
        {recording && <span className="text-red-400 font-bold tabular-nums" data-recording>● {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>}
      </div>
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay data-capture-preview />
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {problem && <p className="absolute inset-x-4 top-6 rounded-lg bg-white text-gray-900 p-3 text-sm" data-capture-problem>{problem}</p>}
        {warn && <p className="absolute inset-x-4 bottom-4 rounded-lg bg-amber-100 text-amber-900 p-3 text-sm" data-capture-storage>{warn}</p>}
      </div>
      <div className="px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] text-white">
        <div className="flex justify-center gap-2 mb-3">
          {(['photo', 'video'] as const).map(m => (
            <button key={m} type="button" disabled={recording} onClick={() => setMode(m)} data-capture-mode={m}
              className={`h-10 px-4 rounded-full text-sm font-semibold ${mode === m ? 'bg-white text-black' : 'bg-white/15'}`}>{m === 'photo' ? 'Photo' : 'Video'}</button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="w-20 h-14 flex items-center" data-capture-count>
            {taken.length > 0 && (
              <span className="relative">
                {taken[taken.length - 1].thumb ? <img src={taken[taken.length - 1].thumb} alt="" className="w-14 h-14 object-cover rounded-lg border-2 border-white" />
                  : <span className="w-14 h-14 rounded-lg border-2 border-white grid place-items-center"><Video size={22} /></span>}
                <span className="absolute -top-2 -right-2 bg-white text-black text-xs font-bold rounded-full w-6 h-6 grid place-items-center">{taken.length}</span>
              </span>
            )}
          </div>
          {mode === 'photo' ? (
            <button type="button" aria-label="Take a photo" onClick={shoot} disabled={!!problem} className="w-20 h-20 rounded-full border-4 border-white bg-white/90 grid place-items-center active:scale-95" data-capture-shutter>
              <Camera size={28} className="text-black" />
            </button>
          ) : recording ? (
            <button type="button" aria-label="Stop recording" onClick={stopVideo} className="w-20 h-20 rounded-full border-4 border-white bg-red-600 grid place-items-center" data-capture-stop><Square size={26} fill="white" /></button>
          ) : (
            <button type="button" aria-label="Start recording" onClick={startVideo} disabled={!!problem} className="w-20 h-20 rounded-full border-4 border-white bg-red-600/90 grid place-items-center" data-capture-record><Video size={28} /></button>
          )}
          <button type="button" className="w-20 h-12 rounded-lg bg-white text-black font-bold disabled:opacity-40" disabled={!taken.length && !recording} onClick={finish} data-capture-done>Done</button>
        </div>
      </div>
    </div>
  )
}
