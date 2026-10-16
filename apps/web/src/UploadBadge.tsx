/** Top bar: how many photos and videos are still on this phone waiting to upload. */

import { useEffect, useState } from 'react'
import { CloudUpload } from 'lucide-react'
import { waitingCount, uploadAll, MEDIA_EVENT } from './mediaStore'

export default function UploadBadge() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const read = () => { waitingCount().then(setN).catch(() => {}) }
    read()
    window.addEventListener(MEDIA_EVENT, read)
    const t = setInterval(read, 20_000)
    return () => { window.removeEventListener(MEDIA_EVENT, read); clearInterval(t) }
  }, [])
  if (n === 0) return null
  return (
    <button type="button" onClick={() => uploadAll()} title="Photos and video waiting to upload; tap to try now" data-upload-badge
      className="flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold px-2.5 h-9">
      <CloudUpload size={16} aria-hidden="true" /> {n}<span className="hidden sm:inline">&nbsp;waiting to upload</span>
    </button>
  )
}
