import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceStatus } from '@gearmod/contracts'
import { encodeWav } from './wav'
import { plainError } from './NoticeDialog'
import { startVoiceInstall, useVoiceInstall } from './voiceStore'
import { tr, useT } from './i18n'

const maxSeconds = 300

/** Voice dictation: records the microphone, converts to 16 kHz WAV and sends it to main (local whisper.cpp or Groq). The text goes back to the chat field. */
export function useDictation(onText: (text: string) => void, hint?: string): { status?: VoiceStatus; recording: boolean; transcribing: boolean; progress: string; error: string; toggle(): Promise<void>; install(): Promise<void> } {
  const t = useT().chat.dictation
  const [status, setStatus] = useState<VoiceStatus>(), [recording, setRecording] = useState(false), [transcribing, setTranscribing] = useState(false), [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | undefined>(undefined), chunks = useRef<Blob[]>([]), stream = useRef<MediaStream | undefined>(undefined), timer = useRef<number | undefined>(undefined)
  const refresh = useCallback(async () => { try { setStatus(await window.gearmod.invoke('voice:status', undefined)) } catch (reason) { setError(plainError(reason)) } }, [])
  useEffect(() => { void refresh(); const changed = (): void => { setError(''); void refresh() }; window.addEventListener('gearmod:voice-changed', changed); return () => window.removeEventListener('gearmod:voice-changed', changed) }, [refresh])
  const installation = useVoiceInstall()
  useEffect(() => { if (installation.done) void refresh() }, [installation.done, refresh])
  const progress = installation.installing ? t.downloading(installation.item || t.program, installation.percent === null ? `${installation.megabytes} MB` : `${installation.percent}%`) : ''
  useEffect(() => () => { window.clearTimeout(timer.current); stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  const finish = useCallback(async () => {
    const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || 'audio/webm' })
    stream.current?.getTracks().forEach((track) => track.stop())
    setRecording(false); setTranscribing(true)
    try {
      const context = new AudioContext({ sampleRate: 16000 })
      const audio = await context.decodeAudioData(await blob.arrayBuffer()); await context.close()
      const wav = encodeWav(audio.getChannelData(0), 16000)
      const { text } = await window.gearmod.invoke('voice:transcribe', { wav, prompt: hint })
      if (text) onText(text); else setError(tr().chat.dictation.notUnderstood)
    } catch (reason) { setError(plainError(reason)) } finally { setTranscribing(false) }
  }, [hint, onText])

  const toggle = useCallback(async () => {
    setError('')
    if (recording) { window.clearTimeout(timer.current); recorder.current?.stop(); return }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      recorder.current = new MediaRecorder(stream.current)
      recorder.current.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      recorder.current.onstop = () => void finish()
      recorder.current.start(); setRecording(true)
      timer.current = window.setTimeout(() => recorder.current?.stop(), maxSeconds * 1000)
    } catch { setError(tr().chat.dictation.micDenied) }
  }, [recording, finish])

  const install = useCallback(async () => { setError(''); await startVoiceInstall() }, [])
  return { status, recording, transcribing, progress, error: error || installation.error, toggle, install }
}
