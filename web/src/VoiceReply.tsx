import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { VOICE_SECONDS, voiceWav } from './voice'

type Phase = 'idle' | 'permission' | 'recording' | 'transcribing'
type Capture = { stream?: MediaStream; recorder?: MediaRecorder; timer?: number; clock?: number; request?: AbortController }

export function VoiceReply({ fieldId, onTranscript, onBusyChange, disabled = false }: {
  fieldId: string; onTranscript: (text: string) => void; onBusyChange: (busy: boolean) => void; disabled?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [transcribed, setTranscribed] = useState(false)
  const operation = useRef(0)
  const busy = useRef(false)
  const capture = useRef<Capture>({})
  const receive = useRef(onTranscript)
  receive.current = onTranscript

  const release = () => {
    const c = capture.current
    window.clearTimeout(c.timer); window.clearInterval(c.clock)
    if (c.recorder && c.recorder.state !== 'inactive') c.recorder.stop()
    c.stream?.getTracks().forEach((track) => track.stop())
  }
  useEffect(() => () => { operation.current++; release(); capture.current.request?.abort() }, [])

  const discard = () => {
    operation.current++; release(); capture.current.request?.abort()
    busy.current = false; setPhase('idle'); setError(''); onBusyChange(false)
  }
  const start = async () => {
    if (busy.current || disabled) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') {
      setError('Voice recording is unavailable here. Open this page over HTTPS in a browser with microphone access, or type your reply.')
      return
    }
    const id = ++operation.current
    busy.current = true; setPhase('permission'); setError(''); setSeconds(0); onBusyChange(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
      if (id !== operation.current) { stream.getTracks().forEach((track) => track.stop()); return }
      capture.current = { stream }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      capture.current = { stream, recorder }
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data) }
      recorder.onerror = () => {
        if (id !== operation.current) return
        discard(); setError('The recording stopped unexpectedly. Try again or type your reply.')
      }
      recorder.onstop = async () => {
        if (id !== operation.current) return
        release()
        setPhase('transcribing')
        try {
          const wav = await voiceWav(new Blob(chunks, { type: recorder.mimeType }))
          if (id !== operation.current) return
          const request = new AbortController()
          capture.current.request = request
          const result = await api.transcribeVoice(wav, request.signal)
          if (id !== operation.current) return
          receive.current(result.transcript); setTranscribed(true)
          requestAnimationFrame(() => document.getElementById(fieldId)?.focus())
        } catch (e) {
          if (id === operation.current) setError((e as Error).message || 'The recording could not be transcribed. You can still type your reply.')
        } finally {
          if (id === operation.current) { busy.current = false; setPhase('idle'); onBusyChange(false) }
        }
      }
      recorder.start()
      setPhase('recording')
      const started = performance.now()
      capture.current.clock = window.setInterval(() => setSeconds(Math.min(VOICE_SECONDS, Math.floor((performance.now() - started) / 1000))), 250)
      capture.current.timer = window.setTimeout(() => { if (id === operation.current) release() }, VOICE_SECONDS * 1000)
    } catch (e) {
      if (id !== operation.current) return
      release(); busy.current = false; setPhase('idle'); onBusyChange(false)
      const name = (e as DOMException).name
      setError(name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser or type your reply.'
        : name === 'NotFoundError' ? 'No microphone was found. Connect one or type your reply.'
        : 'The microphone could not be opened. Try again or type your reply.')
    }
  }
  const stop = () => { setPhase('transcribing'); release() }
  return (
    <div className="fv-voice" lang="en" data-phase={phase}>
      <div className="fv-voice-controls">
        <button type="button" className="fv-voice-button" aria-controls={fieldId} disabled={disabled || phase === 'permission' || phase === 'transcribing'} onClick={phase === 'recording' ? stop : start}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>
          {phase === 'recording' ? 'Stop and transcribe' : phase === 'permission' ? 'Allow microphone access…' : phase === 'transcribing' ? 'Transcribing…' : 'Reply in your voice'}
        </button>
        {phase === 'recording' && <span className="fv-voice-time" role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} / 2:00</span>}
        {(phase === 'recording' || phase === 'permission') && <button type="button" className="text-btn" onClick={discard}>Discard recording</button>}
      </div>
      <p id={`${fieldId}-voice-status`} className="fv-voice-status" role="status">
        {phase === 'transcribing' ? 'Turning your recording into text. Your reply has not been sent.'
          : phase === 'recording' ? 'Recording. Stops automatically at 2 minutes.'
          : transcribed ? 'Transcribed by Muse Voice Transcribe, check before sending'
          : 'Speak in Bangla or English, up to 2 minutes. Check and edit the text before sending.'}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
