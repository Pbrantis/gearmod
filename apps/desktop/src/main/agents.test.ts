import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentProbeService, type CommandRunner } from './agents'
import { AppDatabase } from './database'
import { ProfileRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('AgentProbeService', () => {
  it('probes version and authentication in the isolated profile directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-probe-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
    const runner: CommandRunner = { async run(command, args, env) { calls.push({ command, args, env }); return args[0] === '--version' ? { stdout: 'codex-cli 1.0.0', stderr: '' } : { stdout: 'Logged in using ChatGPT', stderr: '' } } }
    const profile = profiles.list().find((item) => item.provider === 'codex')!
    const result = await new AgentProbeService(profiles, runner).probe(profile.id)
    expect(result).toMatchObject({ installed: true, authenticated: true, version: 'codex-cli 1.0.0' })
    expect(calls[0]?.env.CODEX_HOME).toBe(profile.configDir)
    expect(calls[1]?.args).toEqual(['login', 'status'])
    database.close()
  })

  it('reports an unavailable executable without pretending authentication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-probe-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const runner: CommandRunner = { async run() { throw new Error('spawn failed with sk-secret-value') } }
    const result = await new AgentProbeService(profiles, runner).probe(profiles.list()[0]!.id)
    expect(result.installed).toBe(false); expect(result.authenticated).toBe(false); expect(result.error).not.toContain('sk-secret-value')
    database.close()
  })
})
