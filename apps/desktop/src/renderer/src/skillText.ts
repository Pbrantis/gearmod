import type { AgentProfile, SkillEntry, SkillRef } from '@gearmod/contracts'

/** Skill mentioned in the text as `/name` (the first one the agent has); `null` when the message mentions none. */
export function skillInText(text: string, available: SkillEntry[], provider: AgentProfile['provider'] | undefined): SkillRef | null {
  if (!provider) return null
  for (const match of text.matchAll(/(^|\s)\/([^\s/]+)/g)) {
    const entry = available.find((item) => item.name === match[2] && item.paths[provider])
    if (entry) return { name: entry.name, path: entry.paths[provider]! }
  }
  return null
}
