export const VOICE_SECONDS = 120
const RATE = 24000

/** Browser recordings vary by device; the transcription endpoint needs mono PCM WAV. */
export async function voiceWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext()
  let decoded: AudioBuffer
  try { decoded = await context.decodeAudioData(await recording.arrayBuffer()) }
  catch { throw new Error('The recording could not be read. Please record it again or type your reply.') }
  finally { await context.close() }
  const length = Math.min(Math.ceil(decoded.duration * RATE), VOICE_SECONDS * RATE)
  if (!length) throw new Error('The recording is empty. Please record it again.')
  const offline = new OfflineAudioContext(1, length, RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const samples = (await offline.startRendering()).getChannelData(0)
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}
