/**
 * S07 — `ProcessEnvPolicy` (docs/07 §7, decisão do usuário Q-07): o agente recebe só o mínimo necessário do ambiente do
 * Windows. `buildEnv` é pura: nunca lê `process.env` nem grava nada; quem chama decide a base e o modo.
 *
 * Alocação: uma lista fixa (sistema, PATH, proxy, certificados, locale — o que CLIs normalmente precisam para rodar) mais o
 * passthrough que o perfil declarar explicitamente (`envPassthrough`). Nenhuma variável que pareça token/chave/segredo passa
 * sem estar nessa lista declarada — mesmo que o nome bata com a allowlist fixa. As variáveis do Docker Engine nunca passam,
 * declaradas ou não, para o shell do agente não herdar acesso ao Engine por acidente.
 *
 * Modo `observe` (só diagnóstico, via variável de ambiente): não remove nada, só devolve o que teria sido removido, para quem chamar logar.
 * Modo `enforce` (padrão): aplica de verdade.
 */
export type EnvPolicyMode = 'observe' | 'enforce'

/** Lista fixa: o que CLIs normalmente precisam para rodar (sistema, PATH, proxy, certificados, locale). Nunca inclui segredo. */
const baselineAllowlist = [
  'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'TMPDIR',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'ALLUSERSPROFILE', 'PUBLIC',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'OS',
  'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'LOGONSERVER',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SHELL', 'EDITOR', 'TERM', 'COLORTERM', 'FORCE_COLOR', 'CI',
  'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'DISPLAY', 'WSLENV', 'ELECTRON_RUN_AS_NODE'
]
const baselineSet = new Set(baselineAllowlist)
/** Nunca passam, declaradas ou não: o shell do agente não deve herdar acesso ao Docker Engine por acidente (docs/07 §7). */
const blockedAlways = new Set(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY'])
/** Nome parece token/chave/segredo: só passa se declarado explicitamente no perfil. */
const looksSensitive = (name: string): boolean => /_(TOKEN|KEY|SECRET)$/i.test(name)

export interface EnvPolicyResult { env: NodeJS.ProcessEnv; removed: string[] }

/**
 * Função pura: nunca lê nem grava nada fora dos parâmetros. Em `observe`, `env` é uma cópia integral de `base` (comportamento
 * de hoje) e `removed` lista o que a política teria tirado; em `enforce`, `env` já reflete a política.
 */
export function buildEnv(profile: { envPassthrough?: readonly string[] | null }, base: NodeJS.ProcessEnv, mode: EnvPolicyMode = 'enforce'): EnvPolicyResult {
  const declared = new Set((profile.envPassthrough ?? []).map((name) => name.toUpperCase()))
  const removed: string[] = []
  const kept: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(base)) {
    const upper = name.toUpperCase()
    const allowed = !blockedAlways.has(upper) && ((baselineSet.has(upper) && !looksSensitive(upper)) || declared.has(upper))
    if (allowed) kept[name] = value
    else removed.push(name)
  }
  return { env: mode === 'enforce' ? kept : { ...base }, removed }
}

/** Modo atual: `enforce` por padrão; `GEARMOD_ENV_POLICY_MODE=observe` volta ao ambiente completo (só para diagnóstico). */
export function envPolicyMode(): EnvPolicyMode { return process.env.GEARMOD_ENV_POLICY_MODE === 'observe' ? 'observe' : 'enforce' }

/** Impuro: lê o modo do processo e, em `observe`, loga o que seria removido. Para os pontos reais de disparo de CLI. */
export function applyEnvPolicy(profile: { envPassthrough?: readonly string[] | null }, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const mode = envPolicyMode(), { env, removed } = buildEnv(profile, base, mode)
  if (mode === 'observe' && removed.length) console.warn(`[env-policy] observe: removeria ${removed.length} variável(is) (${removed.slice(0, 10).join(', ')}${removed.length > 10 ? '…' : ''}); nada foi removido (GEARMOD_ENV_POLICY_MODE=observe)`)
  return env
}
