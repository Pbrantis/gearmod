import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppLanguage, CardDocumentKind, SkillRef } from '@agentboard/contracts'
import { cardDocumentKinds } from '@agentboard/contracts'
import type { BoardRepository } from './projects'
import type { SettingsRepository } from './settings'

const docLabels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks', duvidas: 'Dúvidas', mudancas: 'Mudanças' }

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
  prompt(cardId: string, prompt: string, planning: boolean, skill?: SkillRef | null): string {
    const untitled = planning && !this.board.card(cardId).title.trim()
    const naming = untitled ? 'Este card ainda não tem título: logo nesta primeira resposta, chame agentboard_atualizar_card com um título curto (até 60 caracteres) que identifique o assunto, como os chats fazem. Depois continue o planejamento.\n\n' : ''
    const lead = naming + (planning ? (skill ? `Use a skill ${skill.name} para conduzir este chat, no lugar de agentboard-planejamento. Os documentos do card, o idioma e as ferramentas do AgentBoard continuam valendo.\n\n` : 'Use a skill agentboard-planejamento para conduzir este chat.\n\n') : '')
    return `${this.block(cardId)}\n\n${lead}${prompt}`
  }

  /** Chat livre: conversa solta, somente leitura. Se a conversa virar um planejamento, o agente cria o card e passa a planejar. */
  freePrompt(prompt: string): string {
    return `<agentboard-contexto>\n${JSON.stringify({ idioma: this.language(), tipo: 'chat-livre', regra: 'Conversa livre: você não altera arquivos nem cards, a não ser pela ferramenta agentboard_criar_card.' }, null, 2)}\n</agentboard-contexto>\n\n${prompt}`
  }

  /** Instruções fixas do chat livre; no Codex (sem plugin) levam também as skills de planejamento, usadas depois de criar o card. */
  freeInstructions(withSkills: boolean): string {
    const base = 'Você está em um chat livre do AgentBoard: converse, tire dúvidas e leia o projeto à vontade, sem alterar arquivos. Quando o usuário pedir para planejar algo (ou a conversa claramente virar um planejamento de tarefa), responda que consegue, chame agentboard_criar_card com um título curto, tipo, prioridade e um resumo, e em seguida planeje neste mesmo chat com a skill agentboard-planejamento (documentos com agentboard_escrever_documento e, no fim, agentboard_concluir_planejamento). Não crie card sem o usuário pedir.'
    const skills = withSkills && this.pluginDir ? loadSkillInstructions(this.pluginDir, this.language(), true) : undefined
    return [base, skills].filter(Boolean).join('\n\n---\n\n')
  }

  /** Para agentes sem suporte a plugin (Codex): skills e modelos do idioma, em `developerInstructions`. */
  developerInstructions(planning: boolean, skill?: SkillRef | null): string | undefined {
    const system = this.pluginDir ? loadSkillInstructions(this.pluginDir, this.language(), planning) : undefined
    const file = skill && planning ? join(skill.path, 'SKILL.md') : null
    const chosen = file && existsSync(file) ? `## Skill escolhida para este chat: ${skill!.name}\n${stripFrontMatter(readFileSync(file, 'utf8'))}` : undefined
    return [system, chosen].filter(Boolean).join('\n\n---\n\n') || undefined
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
