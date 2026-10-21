import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono 16-bit PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2]), 16000), view = new DataView(wav.buffer)
    const text = (offset: number, length: number): string => String.fromCharCode(...wav.slice(offset, offset + length))
    expect(text(0, 4)).toBe('RIFF'); expect(text(8, 4)).toBe('WAVE'); expect(text(12, 4)).toBe('fmt '); expect(text(36, 4)).toBe('data')
    expect(view.getUint32(4, true)).toBe(36 + 10); expect(view.getUint16(20, true)).toBe(1); expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000); expect(view.getUint32(28, true)).toBe(32000); expect(view.getUint16(34, true)).toBe(16); expect(view.getUint32(40, true)).toBe(10)
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768])
    expect(wav.length).toBe(54)
  })
})
