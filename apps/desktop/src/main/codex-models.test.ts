import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentProfile } from '@gearmod/contracts'
import { agentOptionsSchema } from '@gearmod/contracts'
import { readCodexModelsCache } from './adapters'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('Codex models', () => {
  it('accepts the ultra effort and ignores unknown levels instead of losing the list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-models-')); roots.push(root)
    await writeFile(join(root, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'x', default_reasoning_level: 'galactic', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }, { effort: 'ultra' }, { effort: 'galactic' }] }] }))
    const models = readCodexModelsCache({ configDir: root } as AgentProfile)
    expect(models).toMatchObject([{ id: 'gpt-6.1-sol', efforts: ['low', 'max', 'ultra'], defaultEffort: 'low' }])
    // The IPC response is validated by the contract: the whole list must pass.
    expect(agentOptionsSchema.safeParse({ models, mostUsed: { planning: null, execution: null, test: null } }).success).toBe(true)
  })
})
