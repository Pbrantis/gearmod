/** 16-bit mono PCM WAV (the format whisper.cpp reads) from Float32 samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2)), view = new DataView(bytes.buffer)
  const text = (offset: number, value: string): void => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => { const clamped = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true) })
  return bytes
}
