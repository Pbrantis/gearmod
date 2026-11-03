import type { AgentProfile, SkillEntry, SkillRef } from '@gearmod/contracts'

/** Skill citada no texto como `/nome` (a primeira que o agente tem); `null` quando a mensagem não cita nenhuma. */
export function skillInText(text: string, available: SkillEntry[], provider: AgentProfile['provider'] | undefined): SkillRef | null {
  if (!provider) return null
  for (const match of text.matchAll(/(^|\s)\/([^\s/]+)/g)) {
    const entry = available.find((item) => item.name === match[2] && item.paths[provider])
    if (entry) return { name: entry.name, path: entry.paths[provider]! }
  }
  return null
}
