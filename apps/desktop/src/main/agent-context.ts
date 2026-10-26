import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppLanguage, CardDocumentKind, SkillRef } from '@agentboard/contracts'
import { cardDocumentKinds, complexityDimensions, levelLabels } from '@agentboard/contracts'
import type { CardHistoryService } from './history'
import { sddRoot, workflowInstructions } from './workflows'
import type { BoardRepository } from './projects'
import { constitutionIndex, inlineLimit, type ConstitutionRepository } from './constitution'
import type { SettingsRepository } from './settings'

/** Ensina todo agente a perguntar com botões: o app transforma este bloco em cartão e devolve as respostas como mensagem. */
export const questionRule = 'Quando precisar perguntar algo com respostas fechadas (sim/não, escolher uma ou várias opções), termine a mensagem com um bloco ```agentboard-perguntas com este JSON: {"perguntas":[{"pergunta":"texto","cabecalho":"até 24 caracteres","multipla":false,"opcoes":[{"rotulo":"Sim","descricao":"opcional"},{"rotulo":"Não"}]}]}. De 1 a 4 perguntas, de 2 a 6 opções cada; "multipla": true permite marcar várias. O app mostra botões (com a opção Outro para texto livre) e devolve as respostas na próxima mensagem. Depois do bloco, pare e espere. Perguntas abertas continuam em texto normal.'

const docLabels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks', duvidas: 'Dúvidas', mudancas: 'Mudanças' }

/** Bloco que acompanha cada turno do agente: idioma, card, coluna atual, colunas disponíveis e os 4 documentos. */
export class AgentContextService {
  constructor(private readonly board: BoardRepository, private readonly settings: SettingsRepository, readonly pluginDir: string | null, private readonly constitution?: Pick<ConstitutionRepository, 'get' | 'proposals'>, private readonly gitRule?: (cardId: string) => string | null, private readonly history?: CardHistoryService, private readonly extra?: (cardId: string) => Record<string, unknown>) {}

  language(): AppLanguage { return this.settings.get().idioma }

  block(cardId: string): string {
    const card = this.board.card(cardId), state = this.board.get(card.projectId)
    const column = state.columns.find((item) => item.id === card.columnId)
    const documents = this.board.documents.get(cardId), commitRule = this.gitRule?.(cardId) ?? null
    const body = {
      idioma: this.language(),
      card: { id: card.id, titulo: card.title, tipo: card.type, prioridade: card.priority, coluna: column ? { id: column.id, nome: column.label, estado: column.semanticState } : null },
      colunasDisponiveis: state.columns.map((item) => ({ id: item.id, nome: item.label, estado: item.semanticState })),
      regra: 'Você só move o card se o usuário pedir.',
      perguntasAoUsuario: questionRule,
      ...(commitRule ? { commit: commitRule } : {}),
      // Repositórios do card (com as pastas da worktree) e ferramentas opcionais do projeto, como o Playwright CLI.
      ...this.safeExtra(cardId)
    }
    // Tarefa pequena: sem os quatro documentos (poupa tokens); vai só a descrição do que fazer.
    const law = this.constitutionSection(card.projectId) + this.historySection(cardId, card.projectId)
    if (card.type === 'minor') return `<agentboard-contexto>\n${JSON.stringify({ ...body, tarefa: 'pequena' }, null, 2)}\n\n## O que fazer\n${documents.resumo.contentMd.trim() || card.description.trim() || '(sem descrição)'}${law}\n</agentboard-contexto>`
    const docs = cardDocumentKinds.map((kind) => `### ${docLabels[kind]}\n${documents[kind].contentMd.trim() || '(vazio)'}`).join('\n\n')
    return `<agentboard-contexto>\n${JSON.stringify(body, null, 2)}\n\n## Documentos atuais\n${docs}${law}\n</agentboard-contexto>`
  }

  private safeExtra(cardId: string): Record<string, unknown> { try { return this.extra?.(cardId) ?? {} } catch { return {} } }

  /**
   * Context Engineering (docs/09): avaliação atual, fluxo/método, decisões vigentes, entendimento e exploração em cache, em resumo
   * estruturado (o histórico completo continua em history.jsonl e na tela do card, sob demanda).
   */
  private historySection(cardId: string, projectId: string): string {
    if (!this.history) return ''
    try {
      const history = this.history, current = history.latest(cardId), workflow = history.workflow(cardId), config = history.config(projectId)
      const decisions = history.decisions(cardId).filter((item) => item.status !== 'superseded'), brief = history.discovery(cardId), exploration = history.exploration(cardId)
      const parts: string[] = []
      parts.push(current
        ? `Complexidade v${current.version}${current.preliminary ? ' (preliminar)' : ''}: ${current.total} pontos, ${levelLabels[current.level]}, confiança ${current.confidence}. Notas: ${complexityDimensions.map((dimension) => `${dimension} ${current.scores[dimension]}`).join(', ')}. Fluxo recomendado: ${current.workflow}${workflow ? `; fluxo escolhido: ${workflow}` : '; fluxo ainda não escolhido'}.${current.criticalRisks.length ? ` Riscos críticos: ${current.criticalRisks.join('; ')}.` : ''}`
        : 'Complexidade: ainda não avaliada.')
      const method = workflowInstructions(config, sddRoot(history, projectId), workflow)
      if (method) parts.push(`Método do fluxo: ${method}`)
      if (brief) parts.push(`Entendimento (${brief.prontidao}): ${brief.objetivo}${brief.escopo.length ? `\nEscopo: ${brief.escopo.join('; ')}` : ''}${brief.exclusoes.length ? `\nFora do escopo: ${brief.exclusoes.join('; ')}` : ''}${brief.criterios.length ? `\nCritérios: ${brief.criterios.join('; ')}` : ''}${brief.pendencias.length ? `\nPendências: ${brief.pendencias.join('; ')}` : ''}`)
      if (decisions.length) parts.push(`Decisões vigentes:\n${decisions.map((item) => `- D${String(item.number).padStart(3, '0')} [${item.status === 'approved' ? 'usuário' : 'recomendação do agente, não aprovada'}] ${item.statement}`).join('\n')}`)
      if (exploration) parts.push(`Exploração do código${exploration.stale ? ' (DESATUALIZADA: o código mudou desde então; confira antes de confiar)' : ' (válida para a versão atual do código)'}: ${exploration.summary}`)
      return `\n\n## Discovery, complexidade e decisões\n${historyRule}\n\n${parts.join('\n\n')}`
    } catch { return '' }
  }

  /**
   * Constituição no contexto de todo chat do projeto: inteira se for curta, senão só o índice (o agente lê o resto pela ferramenta).
   * Ensina o agente a avisar quando algo fere um princípio e a sugerir o que deveria virar princípio, sem alterá-la direto.
   */
  private constitutionSection(projectId: string): string {
    if (!this.constitution) return ''
    const current = this.constitution.get(projectId), text = current.contentMd.trim()
    if (!text) return `\n\n## Constituição do projeto\n(O projeto ainda não tem Constituição.) ${constitutionRule}`
    const body = text.length <= inlineLimit ? text : `${constitutionIndex(text)}\n\n(Isto é só o índice. Leia o texto completo com agentboard_ler_constituicao antes de planejar ou de decidir se algo fere um princípio.)`
    return `\n\n## Constituição do projeto (versão ${current.version})\n${constitutionRule}\n\n${body}`
  }

  /** Chat da Constituição: a versão atual inteira e as mudanças que os agentes sugeriram e ainda esperam decisão. */
  constitutionPrompt(projectId: string, prompt: string): string {
    const current = this.constitution?.get(projectId), pending = this.constitution?.proposals(projectId).filter((item) => item.status === 'pending') ?? []
    const body = { idioma: this.language(), tipo: 'constituicao', versaoAtual: current?.version ?? 0, regra: 'Este chat só escreve a Constituição do projeto: leia o código à vontade, sem alterar arquivos nem cards. Grave sempre o texto completo com agentboard_escrever_constituicao, e só depois que o usuário concordar com a mudança.', perguntasAoUsuario: questionRule }
    const proposals = pending.length ? `\n\n## Mudanças sugeridas pelos agentes (aguardando decisão)\n${pending.map((item) => `- C${String(item.number).padStart(3, '0')} ${item.title}\n  O que muda: ${item.details}\n  Motivo: ${item.reason}`).join('\n')}` : ''
    return `<agentboard-contexto>\n${JSON.stringify(body, null, 2)}\n\n## Constituição atual\n${current?.contentMd.trim() || '(vazia: o projeto ainda não tem Constituição)'}${proposals}\n</agentboard-contexto>\n\nUse a skill agentboard-constituicao para conduzir este chat.\n\n${prompt}`
  }

  /** Texto enviado ao agente: contexto + pedido. Em planejamento, pede explicitamente a skill de planejamento do sistema. */
  prompt(cardId: string, prompt: string, planning: boolean, skill?: SkillRef | null): string {
    const untitled = planning && !this.board.card(cardId).title.trim()
    const naming = untitled ? 'Este card ainda não tem título: logo nesta primeira resposta, chame agentboard_atualizar_card com um título curto (até 60 caracteres) que identifique o assunto, como os chats fazem. Depois continue o planejamento.\n\n' : ''
    const lead = naming + (planning ? (skill ? `Use a skill ${skill.name} para conduzir este chat, no lugar de agentboard-planejamento. Os documentos do card, o idioma e as ferramentas do AgentBoard continuam valendo.\n\n` : 'Use a skill agentboard-planejamento para conduzir este chat.\n\n') : '')
    return `${this.block(cardId)}\n\n${lead}${prompt}`
  }

  /** Chat livre: conversa solta, somente leitura. Se a conversa virar um planejamento, o agente cria o card e passa a planejar. */
  freePrompt(prompt: string, projectId?: string, canEdit = false): string {
    const regra = canEdit ? 'Conversa livre sem card: quando o usuário pedir, você pode alterar arquivos do projeto e rodar comandos, dentro do modo de permissão escolhido. Não crie nem mude cards, a não ser pela ferramenta agentboard_criar_card.' : 'Conversa livre em modo somente leitura: você não altera arquivos nem cards, a não ser pela ferramenta agentboard_criar_card.'
    return `<agentboard-contexto>\n${JSON.stringify({ idioma: this.language(), tipo: 'chat-livre', regra, perguntasAoUsuario: questionRule }, null, 2)}${projectId ? this.constitutionSection(projectId) : ''}\n</agentboard-contexto>\n\n${prompt}`
  }

  /** Instruções fixas do chat livre; no Codex (sem plugin) levam também as skills de planejamento, usadas depois de criar o card. */
  freeInstructions(withSkills: boolean, canEdit = false): string {
    const base = `Você está em um chat livre do AgentBoard: converse, tire dúvidas e leia o projeto à vontade${canEdit ? '. Quando o usuário pedir, altere os arquivos do projeto diretamente (respeitando o modo de permissão)' : ', sem alterar arquivos'}. Quando o usuário pedir para planejar algo (ou a conversa claramente virar um planejamento de tarefa), responda que consegue, chame agentboard_criar_card com um título curto, tipo, prioridade e um resumo, registre o entendimento e a avaliação de complexidade (skill agentboard-discovery) e em seguida planeje neste mesmo chat com a skill agentboard-planejamento (documentos com agentboard_escrever_documento e, no fim, agentboard_concluir_planejamento). Não crie card sem o usuário pedir.`
    const skills = withSkills && this.pluginDir ? loadSkillInstructions(this.pluginDir, this.language(), true) : undefined
    return [base, skills].filter(Boolean).join('\n\n---\n\n')
  }

  /**
   * Para agentes sem suporte a plugin (Codex): skills e modelos do idioma, em `developerInstructions`. Cada etapa leva só as suas:
   * planejamento as de planejar; implementação e teste o resumo mais a skill da etapa; tarefa pequena a sua própria.
   */
  developerInstructions(planning: boolean, skill?: SkillRef | null, cardId?: string | null, purpose?: string): string | undefined {
    const which = purpose === 'constitution' ? ['agentboard-constituicao'] : planning ? true : this.executionSkills(cardId, purpose)
    const system = this.pluginDir ? loadSkillInstructions(this.pluginDir, this.language(), which) : undefined
    const file = skill && planning ? join(skill.path, 'SKILL.md') : null
    const chosen = file && existsSync(file) ? `## Skill escolhida para este chat: ${skill!.name}\n${stripFrontMatter(readFileSync(file, 'utf8'))}` : undefined
    return [system, chosen].filter(Boolean).join('\n\n---\n\n') || undefined
  }

  /** Skills da etapa de execução: a tarefa pequena tem a sua; as demais, a de implementar ou a de testar. */
  private executionSkills(cardId?: string | null, purpose?: string): string[] {
    const small = cardId ? this.board.card(cardId).type === 'minor' : false
    return ['agentboard-resumo', small ? 'agentboard-pequena' : purpose === 'test' ? 'agentboard-testar' : 'agentboard-implementar']
  }
}

function stripFrontMatter(text: string): string { return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim() }

/** O que todo agente faz com a Constituição: avisar quando algo fere um princípio e sugerir o que deveria virar princípio. */
const constitutionRule = 'A Constituição reúne os princípios que valem para todo o projeto, acima da Especificação de cada card. Antes de propor ou fazer algo, confira se fere algum princípio. Se ferir: pare antes de seguir, diga qual princípio e por quê e pergunte ao usuário se ajusta o pedido, segue assim mesmo (com a justificativa registrada no Plano, seção Complexidade) ou muda a Constituição. Se surgir uma regra que deveria valer para o projeto inteiro (não só para este trabalho), diga que seria bom tê-la na Constituição. Você não altera a Constituição: se o usuário concordar com a mudança, registre-a com agentboard_propor_constituicao; ele aplica pela aba Constituição do projeto.'

/** Como o agente usa o histórico: reavaliar só por gatilho real e separar recomendação própria de decisão do usuário. */
const historyRule = 'Reavalie a complexidade (agentboard_avaliar_complexidade com gatilho) só quando um requisito mudar, surgir dependência ou risco novo, a solução exigir mudança arquitetural, o escopo estiver errado ou houver falhas repetidas; nunca a cada mensagem. Decisões marcadas como recomendação ainda não foram aprovadas pelo usuário.'

/** Skills do planejamento: as de execução (implementar, testar, pequena) ficam de fora para não pesar nesse contexto. */
const planningSkills = new Set(['agentboard-discovery', 'agentboard-planejamento', 'agentboard-especificacao', 'agentboard-plano', 'agentboard-tasks', 'agentboard-resumo'])

/** `which`: `true` = as do planejamento; `false` = só o resumo; ou a lista exata de skills. */
export function loadSkillInstructions(pluginDir: string, language: AppLanguage, which: boolean | string[]): string | undefined {
  const skillsDir = join(pluginDir, 'skills')
  if (!existsSync(skillsDir)) return undefined
  const names = readdirSync(skillsDir).filter((name) => name.startsWith('agentboard-')).sort()
  const wanted = Array.isArray(which) ? names.filter((name) => which.includes(name)) : which ? names.filter((name) => planningSkills.has(name)) : names.filter((name) => name === 'agentboard-resumo')
  const parts = wanted.map((name) => {
    const skill = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8')
    const templates = join(skillsDir, name, 'templates')
    const file = [`${language}.md`, 'pt-BR.md'].map((item) => join(templates, item)).find((item) => existsSync(item))
    return `## Skill ${name}\n${stripFrontMatter(skill)}${file ? `\n\n### Modelo (${language})\n${readFileSync(file, 'utf8').trim()}` : ''}`
  })
  return parts.length ? `Skills do sistema AgentBoard. Siga-as ao trabalhar no card.\n\n${parts.join('\n\n---\n\n')}` : undefined
}
