/** Removes common credential material before it reaches storage, UI or logs. */
const patterns = [
  /(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{10,})/gi,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
  /\b(?:[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)|KEY|DATABASE_URL)\s*=\s*[^\s'"`]+/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
]

export function redact(value: string, limit = 100_000): string {
  let result = value
  for (const pattern of patterns) result = result.replace(pattern, '[redacted]')
  return result.slice(0, limit)
}

export function redactObject<T>(value: T): T {
  // Limit individual strings before serialization so large events remain valid JSON.
  return JSON.parse(JSON.stringify(value, (_key, field: unknown) => typeof field === 'string' ? redact(field) : field)) as T
}
