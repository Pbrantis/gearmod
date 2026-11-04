/** Removes common credential material before it reaches storage, UI or logs. */
const patterns = [
  /(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._-]{10,})/gi,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
  /\b(?:[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)|KEY|DATABASE_URL)\s*=\s*[^\s'"`]+/g,
  // password inside a connection URL (postgres://user:password@host)
  /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
]

/** Only unmistakable formats (without the generic `NAME_KEY=value` rule): used to block commits. */
export const highConfidenceSecretPatterns = [patterns[0]!, /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/, patterns[3]!, patterns[4]!]

export function redact(value: string, limit = 100_000): string {
  let result = value
  for (const pattern of patterns) result = result.replace(pattern, '[redacted]')
  return result.slice(0, limit)
}

export function redactObject<T>(value: T): T {
  // Limit individual strings before serialization so large events remain valid JSON.
  return JSON.parse(JSON.stringify(value, (_key, field: unknown) => typeof field === 'string' ? redact(field) : field)) as T
}
