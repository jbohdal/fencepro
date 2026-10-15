/**
 * Voice clips recorded on a phone when live voice could not work are
 * transcribed here, on this Mac, with whisper.cpp (free, MIT; installed with
 * Homebrew). ffmpeg turns the phone's recording (WebM from Chrome, MP4 from
 * Safari) into the 16 kHz WAV whisper reads. The phone runs the same phrase
 * parser on the text when the quote is open. Clips are deleted after 30 days.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import prisma from './prisma.js'

const run = promisify(execFile)

export const WHISPER_BIN = process.env.WHISPER_BIN || '/opt/homebrew/bin/whisper-cli'
export const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(os.homedir(), '.ezbiz-models', 'ggml-base.en.bin')
export const FFMPEG_BIN = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'
export const CLIP_DAYS = 30

export function voiceDir(): string {
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'voice')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Whether this Mac can transcribe right now. */
export function transcriberReady(): { ready: boolean; missing: string[] } {
  const missing = [
    !fs.existsSync(WHISPER_BIN) && 'whisper.cpp (brew install whisper-cpp)',
    !fs.existsSync(WHISPER_MODEL) && `the speech model at ${WHISPER_MODEL}`,
    !fs.existsSync(FFMPEG_BIN) && 'ffmpeg (brew install ffmpeg)',
  ].filter(Boolean) as string[]
  return { ready: missing.length === 0, missing }
}

/** Speech to text for one recording file. */
export async function transcribeFile(file: string): Promise<string> {
  const wav = `${file}.16k.wav`
  try {
    await run(FFMPEG_BIN, ['-loglevel', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 120_000 })
    const { stdout } = await run(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wav, '-nt', '-np', '-l', 'en'], { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 })
    return stdout.replace(/\s+/g, ' ').trim()
  } finally {
    fs.rm(wav, { force: true }, () => {})
  }
}

let busy = false

/** Transcribe waiting clips one at a time. Safe to call often. */
export async function processVoiceQueue(): Promise<void> {
  if (busy || !transcriberReady().ready) return
  busy = true
  try {
    for (;;) {
      const clip = await prisma.voiceClip.findFirst({ where: { status: 'waiting' }, orderBy: { createdAt: 'asc' } })
      if (!clip) return
      await prisma.voiceClip.update({ where: { id: clip.id }, data: { status: 'transcribing' } })
      try {
        const text = await transcribeFile(clip.path)
        await prisma.voiceClip.update({ where: { id: clip.id }, data: { status: 'done', transcript: text, error: null } })
      } catch (err) {
        await prisma.voiceClip.update({ where: { id: clip.id }, data: { status: 'failed', error: String((err as Error)?.message || err).slice(0, 500) } })
      }
    }
  } finally {
    busy = false
  }
}

/** Delete clips (file and record) older than 30 days. */
export async function deleteOldClips(now = Date.now()): Promise<number> {
  const old = await prisma.voiceClip.findMany({ where: { createdAt: { lt: new Date(now - CLIP_DAYS * 86_400_000) } }, select: { id: true, path: true } })
  for (const c of old) fs.rm(c.path, { force: true }, () => {})
  if (old.length) await prisma.voiceClip.deleteMany({ where: { id: { in: old.map(c => c.id) } } })
  return old.length
}

/** A clip left "transcribing" by a restart goes back in the queue. */
export async function startVoiceWorker(): Promise<void> {
  if (process.env.VOICE_WORKER === 'off') return
  await prisma.voiceClip.updateMany({ where: { status: 'transcribing' }, data: { status: 'waiting' } }).catch(() => {})
  processVoiceQueue().catch(err => console.error('[voice] queue:', err))
  deleteOldClips().catch(err => console.error('[voice] cleanup:', err))
  setInterval(() => { processVoiceQueue().catch(err => console.error('[voice] queue:', err)) }, 2 * 60_000).unref()
  setInterval(() => { deleteOldClips().catch(err => console.error('[voice] cleanup:', err)) }, 12 * 3_600_000).unref()
}
