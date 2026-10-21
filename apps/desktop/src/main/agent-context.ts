import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppLanguage, CardDocumentKind } from '@agentboard/contracts'
import { cardDocumentKinds } from '@agentboard/contracts'
import type { BoardRepository } from './projects'
import type { SettingsRepository } from './settings'

const docLabels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks' }

/** Bloco que acompanha cada turno do agente: idioma, card, coluna atual, colunas disponíveis e os 4 documentos. */
export class AgentContextService {
  constructor(private readonly board: BoardRepository, private readonly settings: SettingsRepository, readonly pluginDir: string | null) {}

  language(): AppLanguage { return this.settings.get().idioma }

  block(cardId: string): string {
    const card = this.board.card(cardId), state = this.board.get(card.projectId)
    const column = state.columns.find((item) => item.id === card.columnId)
    const documents = this.board.documents.get(cardId)
    const body = {
      idioma: this.language(),
      card: { id: card.id, titulo: card.title, tipo: card.type, prioridade: card.priority, coluna: column ? { id: column.id, nome: column.label, estado: column.semanticState } : null },
      colunasDisponiveis: state.columns.map((item) => ({ id: item.id, nome: item.label, estado: item.semanticState })),
      regra: 'Você só move o card se o usuário pedir.'
    }
    const docs = cardDocumentKinds.map((kind) => `### ${docLabels[kind]}\n${documents[kind].contentMd.trim() || '(vazio)'}`).join('\n\n')
    return `<agentboard-contexto>\n${JSON.stringify(body, null, 2)}\n\n## Documentos atuais\n${docs}\n</agentboard-contexto>`
  }

  /** Texto enviado ao agente: contexto + pedido. Em planejamento, pede explicitamente a skill de planejamento do sistema. */
  prompt(cardId: string, prompt: string, planning: boolean): string {
    const lead = planning ? 'Use a skill agentboard-planejamento para conduzir este chat.\n\n' : ''
    return `${this.block(cardId)}\n\n${lead}${prompt}`
  }

  /** Para agentes sem suporte a plugin (Codex): skills e modelos do idioma, em `developerInstructions`. */
  developerInstructions(planning: boolean): string | undefined {
    if (!this.pluginDir) return undefined
    return loadSkillInstructions(this.pluginDir, this.language(), planning)
  }
}

function stripFrontMatter(text: string): string { return text.replace(/^---\n[\s\S]*?\n---\n/, '').trim() }

export function loadSkillInstructions(pluginDir: string, language: AppLanguage, planning: boolean): string | undefined {
  const skillsDir = join(pluginDir, 'skills')
  if (!existsSync(skillsDir)) return undefined
  const names = readdirSync(skillsDir).filter((name) => name.startsWith('agentboard-')).sort()
  const wanted = planning ? names : names.filter((name) => name === 'agentboard-resumo')
  const parts = wanted.map((name) => {
    const skill = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8')
    const templates = join(skillsDir, name, 'templates')
    const file = [`${language}.md`, 'pt-BR.md'].map((item) => join(templates, item)).find((item) => existsSync(item))
    return `## Skill ${name}\n${stripFrontMatter(skill)}${file ? `\n\n### Modelo (${language})\n${readFileSync(file, 'utf8').trim()}` : ''}`
  })
  return parts.length ? `Skills do sistema AgentBoard. Siga-as ao trabalhar no card.\n\n${parts.join('\n\n---\n\n')}` : undefined
}
