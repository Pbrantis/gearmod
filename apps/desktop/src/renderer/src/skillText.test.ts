import { describe, expect, it } from 'vitest'
import type { SkillEntry } from '@gearmod/contracts'
import { skillInText } from './skillText'

const entry = (name: string, paths: SkillEntry['paths']): SkillEntry => ({ id: `global:${name}`, name, description: '', scope: 'global', paths } as SkillEntry)
const available = [entry('revisar', { claude: 'C:/s/revisar', codex: null, gemini: null }), entry('so-codex', { claude: null, codex: 'C:/s/so-codex', gemini: null })]

describe('skill citada com / no texto', () => {
  it('acha a primeira skill do agente citada como /nome', () => {
    expect(skillInText('/revisar o arquivo', available, 'claude')).toEqual({ name: 'revisar', path: 'C:/s/revisar' })
    expect(skillInText('por favor /revisar isso', available, 'claude')).toEqual({ name: 'revisar', path: 'C:/s/revisar' })
  })
  it('ignora caminhos, skills de outro agente e texto sem skill', () => {
    expect(skillInText('abra src/revisar.ts', available, 'claude')).toBeNull()
    expect(skillInText('/so-codex agora', available, 'claude')).toBeNull()
    expect(skillInText('/inexistente', available, 'claude')).toBeNull()
    expect(skillInText('/revisar', available, undefined)).toBeNull()
  })
})
