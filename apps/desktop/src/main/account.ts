import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@gearmod/contracts'

const readJson = (path: string): Record<string, unknown> | null => {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : null } catch { return null }
}
const email = (value: unknown): string | null => (typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value) ? value : null)

function codexEmail(configDir: string): string | null {
  const tokens = readJson(join(configDir, 'auth.json'))?.tokens as Record<string, unknown> | undefined
  const jwt = typeof tokens?.id_token === 'string' ? tokens.id_token.split('.')[1] : undefined
  if (!jwt) return null
  try { return email((JSON.parse(Buffer.from(jwt, 'base64url').toString('utf8')) as Record<string, unknown>).email) } catch { return null }
}

function claudeEmail(configDir: string): string | null {
  for (const file of [join(configDir, '.claude.json'), ...(configDir === join(homedir(), '.claude') ? [join(homedir(), '.claude.json')] : [])]) {
    const found = email((readJson(file)?.oauthAccount as Record<string, unknown> | undefined)?.emailAddress)
    if (found) return found
  }
  return null
}

function geminiEmail(configDir: string): string | null {
  return email(readJson(join(configDir, '.gemini', 'google_accounts.json'))?.active)
}

/** Conta (e-mail) a que o agente está ligado, lida dos arquivos locais do próprio Claude/Codex; null quando não dá para saber. */
export function readAccountEmail(profile: Pick<AgentProfile, 'provider' | 'configDir'>): string | null {
  return profile.provider === 'codex' ? codexEmail(profile.configDir) : profile.provider === 'gemini' ? geminiEmail(profile.configDir) : claudeEmail(profile.configDir)
}

/** Chave opaca e estável: a identidade bruta nunca é persistida no ledger nem enviada pelo histórico. */
export function accountKey(provider: string, identity: string | null | undefined): string | null {
  const normalized = identity?.trim().toLowerCase()
  if (!normalized || normalized.length > 512) return null
  return `acct_${createHash('sha256').update(`agentboard/account/v1/${provider}/${normalized}`).digest('hex').slice(0, 32)}`
}

/** Aceita somente identificadores explícitos retornados pelo provedor, nunca caminhos ou conteúdo de sessão. */
export function accountKeyFromProvider(provider: string, payload: Record<string, unknown>): string | null {
  const sources = [payload, payload.account, payload.user].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  for (const source of sources) for (const field of ['accountId', 'account_id', 'organizationId', 'organization_id', 'userId', 'user_id', 'email']) {
    const value = source[field]
    if (typeof value === 'string') return accountKey(provider, value)
  }
  return null
}
