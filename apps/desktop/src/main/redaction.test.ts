import { describe, expect, it } from 'vitest'
import { redact, redactObject } from './redaction'

describe('redact', () => {
  it('removes credential shapes while keeping ordinary text', () => {
    expect(redact('ok sk-abcdefghijk KEY=value Bearer abcdefghijklm')).toBe('ok [redacted] [redacted] [redacted]')
    expect(redact('const key = 1')).toBe('const key = 1')
    expect(redact('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toBe('[redacted]')
  })
})

describe('redactObject', () => {
  it('limits large text fields without truncating the surrounding event', () => {
    const value = { type: 'tool_result', content: 'x'.repeat(120_000), session_id: 'session-1', complete: true }
    expect(redactObject(value)).toEqual({ ...value, content: 'x'.repeat(100_000) })
    expect(value.content).toHaveLength(120_000)
  })

  it('preserves events whose combined text exceeds the limit', () => {
    const value = { content: [{ text: 'a'.repeat(60_000) }, { text: 'b'.repeat(60_000) }], usage: 42, error: null }
    expect(redactObject(value)).toEqual(value)
  })

  it('redacts nested strings with quotes, backslashes and multiline credentials', () => {
    const value = { content: ['"quoted" \\ path\nline', { text: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', token: 'sk-abcdefghijk' }] }
    expect(redactObject(value)).toEqual({ content: ['"quoted" \\ path\nline', { text: '[redacted]', token: '[redacted]' }] })
  })

  it('handles escaped characters at the text limit', () => {
    const value = { text: `${'x'.repeat(99_999)}"\\\n`, next: 'preserved' }
    expect(redactObject(value)).toEqual({ text: `${'x'.repeat(99_999)}"`, next: 'preserved' })
  })

  it('preserves JSON primitives and redacts a root string', () => {
    expect(redactObject(null)).toBeNull()
    expect(redactObject(false)).toBe(false)
    expect(redactObject(42)).toBe(42)
    expect(redactObject('sk-abcdefghijk')).toBe('[redacted]')
  })
  it('S12: pega chave da Groq, chave do Google e senha dentro de URL de conexão', () => {
    const text = redact('groq gsk_abcdefghijklmnopqrstuvwx google AIzaSyA1234567890abcdefghijklmnopqrstu db postgres://app:s3nh4-forte@localhost:5432/app fim')
    expect(text).not.toMatch(/gsk_|AIza|s3nh4/); expect(text).toContain('fim')
    expect(redact('abra https://exemplo.com/caminho e http://localhost:3000/x')).toBe('abra https://exemplo.com/caminho e http://localhost:3000/x')
  })
})
