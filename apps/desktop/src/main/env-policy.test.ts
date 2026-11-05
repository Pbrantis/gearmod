import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEnv, applyEnvPolicy, envPolicyMode } from './env-policy'

const base: NodeJS.ProcessEnv = {
  PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe', windir: 'C:\\Windows',
  HTTP_PROXY: 'http://proxy', NODE_OPTIONS: '--max-old-space-size=4096',
  ANTHROPIC_API_KEY: 'sk-ant-secret', OPENAI_API_KEY: 'sk-oai-secret', SOME_RANDOM_TOKEN: 'abc', MY_APP_SECRET: 'xyz',
  DOCKER_HOST: 'tcp://127.0.0.1:2375', DOCKER_TLS_VERIFY: '1',
  RANDOM_VAR: 'not sensitive but not declared either'
}

describe('buildEnv (pure function)', () => {
  it('observe: never actually removes anything, but lists what it would remove', () => {
    const { env, removed } = buildEnv({ envPassthrough: [] }, base, 'observe')
    expect(env).toEqual(base)
    expect(removed).toContain('ANTHROPIC_API_KEY'); expect(removed).toContain('DOCKER_HOST'); expect(removed).toContain('RANDOM_VAR')
    expect(removed).not.toContain('PATH')
  })

  it('enforce: fixed list passes, undeclared secret does not pass, Docker never passes', () => {
    const { env, removed } = buildEnv({ envPassthrough: [] }, base, 'enforce')
    expect(env.PATH).toBe(base.PATH); expect(env.SystemRoot).toBe(base.SystemRoot); expect(env.HTTP_PROXY).toBe(base.HTTP_PROXY); expect(env.NODE_OPTIONS).toBe(base.NODE_OPTIONS)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.SOME_RANDOM_TOKEN).toBeUndefined(); expect(env.MY_APP_SECRET).toBeUndefined()
    expect(env.DOCKER_HOST).toBeUndefined(); expect(env.DOCKER_TLS_VERIFY).toBeUndefined()
    expect(env.RANDOM_VAR).toBeUndefined()
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'MY_APP_SECRET', 'OPENAI_API_KEY', 'RANDOM_VAR', 'SOME_RANDOM_TOKEN'].sort())
  })

  it('enforce: variable declared in the profile passes, even if it looks like a key', () => {
    const { env } = buildEnv({ envPassthrough: ['ANTHROPIC_API_KEY'] }, base, 'enforce')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it('enforce: Docker variable never passes, even if explicitly declared', () => {
    const { env } = buildEnv({ envPassthrough: ['DOCKER_HOST'] }, base, 'enforce')
    expect(env.DOCKER_HOST).toBeUndefined()
  })

  it('Windows: Path in any case (case-insensitive) is treated as the same variable from the fixed list', () => {
    const mixedCase: NodeJS.ProcessEnv = { Path: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows', comspec: 'C:\\Windows\\cmd.exe' }
    const { env } = buildEnv({ envPassthrough: [] }, mixedCase, 'enforce')
    expect(env).toEqual(mixedCase)
  })

  it('is pure: does not change the base nor the declared array', () => {
    const passthrough = ['ANTHROPIC_API_KEY'], copy = { ...base }
    buildEnv({ envPassthrough: passthrough }, base, 'enforce')
    expect(base).toEqual(copy); expect(passthrough).toEqual(['ANTHROPIC_API_KEY'])
  })
})

describe('applyEnvPolicy (enforce by default)', () => {
  afterEach(() => { delete process.env.GEARMOD_ENV_POLICY_MODE; vi.restoreAllMocks() })
  it('without the environment variable, stays in enforce: removes what the policy dictates', () => {
    expect(envPolicyMode()).toBe('enforce')
    const env = applyEnvPolicy({ envPassthrough: [] }, base)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.PATH).toBe(base.PATH)
  })
  it('with GEARMOD_ENV_POLICY_MODE=observe, returns the full environment and logs what it would remove', () => {
    process.env.GEARMOD_ENV_POLICY_MODE = 'observe'
    expect(envPolicyMode()).toBe('observe')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const env = applyEnvPolicy({ envPassthrough: [] }, base)
    expect(env).toEqual(base)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('buildEnv on the Linux desktop', () => {
  it('keeps the session variables the CLI login needs to open the browser', () => {
    const linux: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/ana', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', XAUTHORITY: '/run/user/1000/.Xauth', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_CURRENT_DESKTOP: 'GNOME', BROWSER: 'firefox' }
    expect(buildEnv({ envPassthrough: [] }, linux, 'enforce').env).toEqual(linux)
  })
})

describe('smoke test with simulated adapters', () => {
  it('existing profiles with the API key in the environment keep working in enforce only if declared', () => {
    const legacyProfile = { envPassthrough: [] as string[] } // profile from before S07, with nothing declared
    const migratedProfile = { envPassthrough: ['ANTHROPIC_API_KEY'] } // after the migration (v37), which detects and declares
    expect(buildEnv(legacyProfile, base, 'enforce').env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(buildEnv(migratedProfile, base, 'enforce').env.ANTHROPIC_API_KEY).toBe('sk-ant-secret')
  })
})
