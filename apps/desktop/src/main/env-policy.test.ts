import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEnv, applyEnvPolicy, envPolicyMode } from './env-policy'

const base: NodeJS.ProcessEnv = {
  PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe', windir: 'C:\\Windows',
  HTTP_PROXY: 'http://proxy', NODE_OPTIONS: '--max-old-space-size=4096',
  ANTHROPIC_API_KEY: 'sk-ant-secret', OPENAI_API_KEY: 'sk-oai-secret', SOME_RANDOM_TOKEN: 'abc', MY_APP_SECRET: 'xyz',
  DOCKER_HOST: 'tcp://127.0.0.1:2375', DOCKER_TLS_VERIFY: '1',
  RANDOM_VAR: 'not sensitive but not declared either'
}

describe('buildEnv (função pura)', () => {
  it('observe: nunca remove nada de verdade, mas lista o que removeria', () => {
    const { env, removed } = buildEnv({ envPassthrough: [] }, base, 'observe')
    expect(env).toEqual(base)
    expect(removed).toContain('ANTHROPIC_API_KEY'); expect(removed).toContain('DOCKER_HOST'); expect(removed).toContain('RANDOM_VAR')
    expect(removed).not.toContain('PATH')
  })

  it('enforce: lista fixa passa, segredo não declarado não passa, Docker nunca passa', () => {
    const { env, removed } = buildEnv({ envPassthrough: [] }, base, 'enforce')
    expect(env.PATH).toBe(base.PATH); expect(env.SystemRoot).toBe(base.SystemRoot); expect(env.HTTP_PROXY).toBe(base.HTTP_PROXY); expect(env.NODE_OPTIONS).toBe(base.NODE_OPTIONS)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.SOME_RANDOM_TOKEN).toBeUndefined(); expect(env.MY_APP_SECRET).toBeUndefined()
    expect(env.DOCKER_HOST).toBeUndefined(); expect(env.DOCKER_TLS_VERIFY).toBeUndefined()
    expect(env.RANDOM_VAR).toBeUndefined()
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'MY_APP_SECRET', 'OPENAI_API_KEY', 'RANDOM_VAR', 'SOME_RANDOM_TOKEN'].sort())
  })

  it('enforce: variável declarada no perfil passa, mesmo parecendo chave', () => {
    const { env } = buildEnv({ envPassthrough: ['ANTHROPIC_API_KEY'] }, base, 'enforce')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it('enforce: variável do Docker nunca passa, mesmo declarada explicitamente', () => {
    const { env } = buildEnv({ envPassthrough: ['DOCKER_HOST'] }, base, 'enforce')
    expect(env.DOCKER_HOST).toBeUndefined()
  })

  it('Windows: Path em qualquer caixa (case-insensitive) é tratado como a mesma variável da lista fixa', () => {
    const mixedCase: NodeJS.ProcessEnv = { Path: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows', comspec: 'C:\\Windows\\cmd.exe' }
    const { env } = buildEnv({ envPassthrough: [] }, mixedCase, 'enforce')
    expect(env).toEqual(mixedCase)
  })

  it('é pura: não muda a base nem o array declarado', () => {
    const passthrough = ['ANTHROPIC_API_KEY'], copy = { ...base }
    buildEnv({ envPassthrough: passthrough }, base, 'enforce')
    expect(base).toEqual(copy); expect(passthrough).toEqual(['ANTHROPIC_API_KEY'])
  })
})

describe('applyEnvPolicy (modo observe por padrão)', () => {
  afterEach(() => { delete process.env.AGENTBOARD_ENV_POLICY_MODE; vi.restoreAllMocks() })
  it('sem a variável de ambiente, fica em observe: devolve o ambiente completo e loga o que removeria', () => {
    expect(envPolicyMode()).toBe('observe')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const env = applyEnvPolicy({ envPassthrough: [] }, base)
    expect(env).toEqual(base)
    expect(warn).toHaveBeenCalledOnce()
  })
  it('com AGENTBOARD_ENV_POLICY_MODE=enforce, remove de verdade', () => {
    process.env.AGENTBOARD_ENV_POLICY_MODE = 'enforce'
    expect(envPolicyMode()).toBe('enforce')
    const env = applyEnvPolicy({ envPassthrough: [] }, base)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.PATH).toBe(base.PATH)
  })
})

describe('smoke com adaptadores simulados', () => {
  it('perfis existentes com a chave de API no ambiente continuam funcionando em enforce só se declarados', () => {
    const legacyProfile = { envPassthrough: [] as string[] } // perfil de antes do S07, sem nada declarado
    const migratedProfile = { envPassthrough: ['ANTHROPIC_API_KEY'] } // depois da migração (v37), que detecta e declara
    expect(buildEnv(legacyProfile, base, 'enforce').env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(buildEnv(migratedProfile, base, 'enforce').env.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })
})
