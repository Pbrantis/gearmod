import { describe, expect, it } from 'vitest'
import { toolActivities } from './tool-activity'

describe('toolActivities', () => {
  it('summarizes Claude tool_use blocks and ignores text', () => {
    const payload = { message: { content: [{ type: 'text', text: 'oi' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a/b.ts' } }, { type: 'tool_use', name: 'mcp__gearmod__gearmod_write_document', input: { tipo: 'plano' } }] } }
    expect(toolActivities('claude/assistant', payload).map((item) => item.title)).toEqual(['Read a/b.ts', 'gearmod_write_document'])
  })
  it('summarizes Codex commands and ignores other events', () => {
    expect(toolActivities('item/started', { item: { type: 'commandExecution', command: 'git status' } })).toEqual([{ title: 'Comando git status', detail: 'git status' }])
    expect(toolActivities('item/started', { item: { type: 'agentMessage' } })).toEqual([])
    expect(toolActivities('claude/user', {})).toEqual([])
  })
})
