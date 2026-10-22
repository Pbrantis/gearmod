import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceStatus } from '@agentboard/contracts'
import { encodeWav } from './wav'
import { startVoiceInstall, useVoiceInstall } from './voiceStore'

const maxSeconds = 300

/** Ditado por voz: grava o microfone, converte para WAV 16 kHz e manda ao main (whisper.cpp local). O texto volta para o campo do chat. */
export function useDictation(onText: (text: string) => void, hint?: string): { status?: VoiceStatus; recording: boolean; transcribing: boolean; progress: string; error: string; toggle(): Promise<void>; install(): Promise<void> } {
  const [status, setStatus] = useState<VoiceStatus>(), [recording, setRecording] = useState(false), [transcribing, setTranscribing] = useState(false), [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | undefined>(undefined), chunks = useRef<Blob[]>([]), stream = useRef<MediaStream | undefined>(undefined), timer = useRef<number | undefined>(undefined)
  const refresh = useCallback(async () => { try { setStatus(await window.agentboard.invoke('voice:status', undefined)) } catch (reason) { setError(String(reason)) } }, [])
  useEffect(() => { void refresh() }, [refresh])
  const installation = useVoiceInstall()
  useEffect(() => { if (installation.done) void refresh() }, [installation.done, refresh])
  const progress = installation.installing ? `Baixando o ${installation.item || 'programa'}… ${installation.percent === null ? `${installation.megabytes} MB` : `${installation.percent}%`}` : ''
  useEffect(() => () => { window.clearTimeout(timer.current); stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  const finish = useCallback(async () => {
    const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || 'audio/webm' })
    stream.current?.getTracks().forEach((track) => track.stop())
    setRecording(false); setTranscribing(true)
    try {
      const context = new AudioContext({ sampleRate: 16000 })
      const audio = await context.decodeAudioData(await blob.arrayBuffer()); await context.close()
      const wav = encodeWav(audio.getChannelData(0), 16000)
      const { text } = await window.agentboard.invoke('voice:transcribe', { wav, prompt: hint })
      if (text) onText(text); else setError('Não entendi o áudio. Tente falar mais perto do microfone.')
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setTranscribing(false) }
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
    } catch { setError('Não consegui acessar o microfone. Verifique a permissão do sistema.') }
  }, [recording, finish])

  const install = useCallback(async () => { setError(''); await startVoiceInstall() }, [])
  return { status, recording, transcribing, progress, error: error || installation.error, toggle, install }
}
