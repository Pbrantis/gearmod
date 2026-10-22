import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@agentboard/contracts'

const readJson = (path: string): Record<string, unknown> | null => {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : null } catch { return null }
}
const email = (value: unknown): string | null => (typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value) ? value : null)

/** E-mail da conta logada no Codex: vem do id_token (JWT) que o próprio Codex guarda em auth.json. Só leitura, sem validar assinatura. */
function codexEmail(configDir: string): string | null {
  const tokens = readJson(join(configDir, 'auth.json'))?.tokens as Record<string, unknown> | undefined
  const jwt = typeof tokens?.id_token === 'string' ? tokens.id_token.split('.')[1] : undefined
  if (!jwt) return null
  try { return email((JSON.parse(Buffer.from(jwt, 'base64url').toString('utf8')) as Record<string, unknown>).email) } catch { return null }
}

/** E-mail da conta logada no Claude: `oauthAccount.emailAddress` no .claude.json (dentro da pasta do perfil ou, no perfil padrão, na pasta pessoal). */
function claudeEmail(configDir: string): string | null {
  for (const file of [join(configDir, '.claude.json'), ...(configDir === join(homedir(), '.claude') ? [join(homedir(), '.claude.json')] : [])]) {
    const found = email((readJson(file)?.oauthAccount as Record<string, unknown> | undefined)?.emailAddress)
    if (found) return found
  }
  return null
}

/** Conta (e-mail) a que o agente está ligado, lida dos arquivos locais do próprio Claude/Codex; null quando não dá para saber. */
export function readAccountEmail(profile: Pick<AgentProfile, 'provider' | 'configDir'>): string | null {
  return profile.provider === 'codex' ? codexEmail(profile.configDir) : claudeEmail(profile.configDir)
}
