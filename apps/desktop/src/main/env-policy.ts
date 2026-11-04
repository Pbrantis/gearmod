/**
 * S07 — `ProcessEnvPolicy` (docs/07 §7, user decision Q-07): the agent receives only the minimum necessary from the
 * Windows environment. `buildEnv` is pure: it never reads `process.env` nor writes anything; the caller decides the base and the mode.
 *
 * Allocation: a fixed list (system, PATH, proxy, certificates, locale — what CLIs normally need to run) plus the
 * passthrough the profile explicitly declares (`envPassthrough`). No variable that looks like a token/key/secret passes
 * without being in that declared list — even if the name matches the fixed allowlist. Docker Engine variables never pass,
 * declared or not, so the agent's shell does not inherit access to the Engine by accident.
 *
 * `observe` mode (diagnostics only, via environment variable): removes nothing, only returns what would have been removed, for the caller to log.
 * `enforce` mode (default): applies for real.
 */
export type EnvPolicyMode = 'observe' | 'enforce'

/** Fixed list: what CLIs normally need to run (system, PATH, proxy, certificates, locale). Never includes a secret. */
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
/** Never pass, declared or not: the agent's shell must not inherit access to Docker Engine by accident (docs/07 §7). */
const blockedAlways = new Set(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY'])
/** Name looks like a token/key/secret: only passes if explicitly declared in the profile. */
const looksSensitive = (name: string): boolean => /_(TOKEN|KEY|SECRET)$/i.test(name)

export interface EnvPolicyResult { env: NodeJS.ProcessEnv; removed: string[] }

/**
 * Pure function: never reads nor writes anything outside the parameters. In `observe`, `env` is a full copy of `base` (today's behavior)
 * and `removed` lists what the policy would have taken out; in `enforce`, `env` already reflects the policy.
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

/** Current mode: `enforce` by default; `GEARMOD_ENV_POLICY_MODE=observe` goes back to the full environment (for diagnostics only). */
export function envPolicyMode(): EnvPolicyMode { return process.env.GEARMOD_ENV_POLICY_MODE === 'observe' ? 'observe' : 'enforce' }

/** Impure: reads the mode from the process and, in `observe`, logs what would be removed. For the real CLI launch points. */
export function applyEnvPolicy(profile: { envPassthrough?: readonly string[] | null }, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const mode = envPolicyMode(), { env, removed } = buildEnv(profile, base, mode)
  if (mode === 'observe' && removed.length) console.warn(`[env-policy] observe: removeria ${removed.length} variável(is) (${removed.slice(0, 10).join(', ')}${removed.length > 10 ? '…' : ''}); nada foi removido (GEARMOD_ENV_POLICY_MODE=observe)`)
  return env
}
