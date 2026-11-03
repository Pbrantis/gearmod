import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppLanguage, CardDocumentKind, SkillRef } from '@agentboard/contracts'
import { cardDocumentKinds, complexityDimensions, levelLabels } from '@agentboard/contracts'
import type { CardHistoryService } from './history'
import { resolvedSddRoot, workflowInstructions } from './workflows'
import type { BoardRepository } from './projects'
import { constitutionIndex, inlineLimit, type ConstitutionRepository } from './constitution'
import type { SettingsRepository } from './settings'
import { specKitStageOf } from './speckit'
import type { SddResolver } from './sdd/sdd-resolver'

/** Ensina todo agente a perguntar com botões: o app transforma este bloco em cartão e devolve as respostas como mensagem. */
export const questionRule = 'When you need to ask something with closed answers (yes/no, pick one or several options), end the message with a ```agentboard-perguntas block containing this JSON: {"perguntas":[{"pergunta":"text","cabecalho":"up to 24 characters","multipla":false,"opcoes":[{"rotulo":"Yes","descricao":"optional"},{"rotulo":"No"}]}]}. Write the question, header, labels and descriptions in the language given in `idioma`. 1 to 4 questions, 2 to 6 options each; "multipla": true lets the user pick several. The app shows buttons (with an Other option for free text) and returns the answers in the next message. After the block, stop and wait. Open-ended questions stay in plain text.'
const freeChangeRule = 'When the user asks for a new change to the project, briefly assess the request and, before modifying files or creating a card, ask whether they prefer to create a card to document the change or to make it directly in the chat. Use the agentboard-perguntas block, with the options "Create card" and "Change directly" (labels in the language given in `idioma`), and wait for the choice. If the user has already clearly chosen one of the options for this change, respect the choice without asking again; do not repeat the question in follow-ups to the same change. Questions, explanations and investigations that do not request a change do not need this choice. If they choose to create a card, use agentboard_create_card and follow the planning flow; if they choose to change directly, proceed in the chat respecting the permission mode. In read-only mode, explain the limitation before any change. Never create a card without an explicit choice or request.'

const docLabels: Record<CardDocumentKind, string> = { resumo: 'Summary', especificacao: 'Specification', plano: 'Plan', tasks: 'Tasks', duvidas: 'Questions', mudancas: 'Changes' }

/** Bloco que acompanha cada turno do agente: idioma, card, coluna atual, colunas disponíveis e os 4 documentos. */
export class AgentContextService {
  /** G06: cache por blob sha (chave `projectId:blobSha`) do trecho já formatado da Constituição, para não recalcular o índice a cada turno. */
  private readonly constitutionCache = new Map<string, string>()
  constructor(private readonly board: BoardRepository, private readonly settings: SettingsRepository, readonly pluginDir: string | null, private readonly constitution?: Pick<ConstitutionRepository, 'get' | 'proposals'>, private readonly gitRule?: (cardId: string) => string | null, private readonly history?: CardHistoryService, private readonly extra?: (cardId: string) => Record<string, unknown>, private readonly sddResolver?: Pick<SddResolver, 'constitution'>) {}

  language(): AppLanguage { return this.settings.get().idioma }

  async block(cardId: string, planning = true): Promise<string> {
    const card = this.board.card(cardId), state = this.board.get(card.projectId)
    const column = state.columns.find((item) => item.id === card.columnId)
    const documents = this.board.documents.get(cardId), commitRule = this.gitRule?.(cardId) ?? null
    const body = {
      idioma: this.language(),
      card: { id: card.id, titulo: card.title, tipo: card.type, prioridade: card.priority, coluna: column ? { id: column.id, nome: column.label, estado: column.semanticState } : null },
      colunasDisponiveis: state.columns.map((item) => ({ id: item.id, nome: item.label, estado: item.semanticState })),
      tiposDeCard: state.project.cardTypes.map((item) => ({ id: item.id, nome: item.name })),
      regra: 'You only move the card if the user asks.',
      perguntasAoUsuario: questionRule,
      ...(commitRule ? { commit: commitRule } : {}),
      // Repositórios do card (com as pastas da worktree) e ferramentas opcionais do projeto, como o Playwright CLI.
      ...this.safeExtra(cardId)
    }
    // Fluxo curto: sem os quatro documentos (poupa tokens); vai só a descrição do que fazer.
    const law = await this.constitutionSection(card.projectId, cardId) + this.historySection(cardId, card.projectId, planning)
    if (card.workflow === 'light') return `<agentboard-contexto>\n${JSON.stringify({ ...body, fluxo: 'curto' }, null, 2)}\n\n## What to do\n${documents.resumo.contentMd.trim() || card.description.trim() || '(no description)'}${law}\n</agentboard-contexto>`
    const docs = cardDocumentKinds.map((kind) => `### ${docLabels[kind]}\n${documents[kind].contentMd.trim() || '(empty)'}`).join('\n\n')
    return `<agentboard-contexto>\n${JSON.stringify(body, null, 2)}\n\n## Current documents\n${docs}${law}\n</agentboard-contexto>`
  }

  private safeExtra(cardId: string): Record<string, unknown> { try { return this.extra?.(cardId) ?? {} } catch { return {} } }

  /**
   * Context Engineering (docs/09): avaliação atual, fluxo/método, decisões vigentes, entendimento e exploração em cache, em resumo
   * estruturado (o histórico completo continua em history.jsonl e na tela do card, sob demanda).
   */
  private historySection(cardId: string, projectId: string, planning = true): string {
    if (!this.history) return ''
    try {
      const history = this.history, current = history.latest(cardId), workflow = history.workflow(cardId), config = history.config(projectId)
      const decisions = history.decisions(cardId).filter((item) => item.status !== 'superseded'), brief = history.discovery(cardId), exploration = history.exploration(cardId)
      const parts: string[] = []
      parts.push(current
        ? `Complexity v${current.version}${current.preliminary ? ' (preliminary)' : ''}: ${current.total} points, ${levelLabels[current.level]}, confidence ${current.confidence}. Scores: ${complexityDimensions.map((dimension) => `${dimension} ${current.scores[dimension]}`).join(', ')}. Recommended workflow: ${current.workflow}${workflow ? `; chosen workflow: ${workflow}` : '; workflow not chosen yet'}.${current.criticalRisks.length ? ` Critical risks: ${current.criticalRisks.join('; ')}.` : ''}`
        : 'Complexity: not assessed yet.')
      const chosenMethod = history.sddMethod(cardId)
      const method = workflow === 'sdd' && !chosenMethod ? 'The SDD workflow has no method chosen on this card yet. Ask the user to choose between AgentBoard SDD and GitHub Spec Kit before planning.' : workflowInstructions({ ...config, complexMethod: chosenMethod ?? config.complexMethod }, resolvedSddRoot(history, this.board, projectId, chosenMethod), workflow, planning)
      if (method) parts.push(`Workflow method: ${method}`)
      if (brief) parts.push(`Understanding (${brief.prontidao}): ${brief.objetivo}${brief.escopo.length ? `\nScope: ${brief.escopo.join('; ')}` : ''}${brief.exclusoes.length ? `\nOut of scope: ${brief.exclusoes.join('; ')}` : ''}${brief.criterios.length ? `\nCriteria: ${brief.criterios.join('; ')}` : ''}${brief.pendencias.length ? `\nOpen items: ${brief.pendencias.join('; ')}` : ''}`)
      if (decisions.length) parts.push(`Current decisions:\n${decisions.map((item) => `- D${String(item.number).padStart(3, '0')} [${item.status === 'approved' ? 'user' : 'agent recommendation, not approved'}] ${item.statement}`).join('\n')}`)
      if (exploration) parts.push(`Code exploration${exploration.stale ? ' (STALE: the code changed since then; check before relying on it)' : ' (valid for the current version of the code)'}: ${exploration.summary}`)
      return `\n\n## Discovery, complexity and decisions\n${historyRule}\n\n${parts.join('\n\n')}`
    } catch { return '' }
  }

  /**
   * G06 — Constituição no contexto de todo chat do projeto: inteira se for curta, senão só o índice (o agente lê o resto
   * pela ferramenta). Com `AGENTBOARD_SDD_FILE_FIRST=1` e arquivo já migrado, lê pelo `SddResolver` (cache por blob sha);
   * sem arquivo lá ainda, cai no SQLite legado com aviso de que não foi migrada. Ensina o agente a avisar quando algo
   * fere um princípio e a sugerir o que deveria virar princípio, sem alterá-la direto.
   */
  private async constitutionSection(projectId: string, cardId?: string): Promise<string> {
    // O arquivo do repositório é a única fonte da Constituição; o SQLite não entra no contexto do agente.
    if (this.sddResolver) {
      try {
        const view = await this.sddResolver.constitution({ projectId, cardId })
        if (view.content !== null) {
          const cacheKey = `${projectId}:${view.blobSha ?? 'null'}`
          const cached = this.constitutionCache.get(cacheKey)
          if (cached !== undefined) return cached
          const text = view.content.trim()
          const section = !text
            ? `\n\n## Project Constitution\n(The project has no Constitution yet.) ${constitutionRule}`
            : `\n\n## Project Constitution\n${constitutionRule}\n\n${text.length <= inlineLimit ? text : `${constitutionIndex(text)}\n\n(This is only the index. Read the full text with agentboard_read_constitution before planning or deciding whether something violates a principle.)`}`
          this.constitutionCache.set(cacheKey, section)
          return section
        }
        // view.content === null: o arquivo ainda não existe; segue abaixo como "sem Constituição".
      } catch { /* resolver indisponível (sourceId removido etc.): trata como sem Constituição */ }
    }
    return `

## Project Constitution
(The project has no Constitution yet.) ${constitutionRule}`
  }

  /** Chat da Constituição: a versão atual inteira e as mudanças que os agentes sugeriram e ainda esperam decisão. */
  constitutionPrompt(projectId: string, prompt: string): string {
    const current = this.constitution?.get(projectId), pending = this.constitution?.proposals(projectId).filter((item) => item.status === 'pending') ?? []
    const body = { idioma: this.language(), tipo: 'constituicao', versaoAtual: current?.version ?? 0, regra: 'This chat only writes the project Constitution: read the code freely, without changing files or cards. Always save the complete text with agentboard_write_constitution, and only after the user agrees to the change.', perguntasAoUsuario: questionRule }
    const proposals = pending.length ? `\n\n## Changes suggested by agents (awaiting decision)\n${pending.map((item) => `- C${String(item.number).padStart(3, '0')} ${item.title}\n  What changes: ${item.details}\n  Reason: ${item.reason}`).join('\n')}` : ''
    return `<agentboard-contexto>\n${JSON.stringify(body, null, 2)}\n\n## Current Constitution\n${current?.contentMd.trim() || '(empty: the project has no Constitution yet)'}${proposals}\n</agentboard-contexto>\n\nUse the agentboard-constitution skill to run this chat.\n\n${prompt}`
  }

  /** Texto enviado ao agente: contexto + pedido. Em planejamento, pede explicitamente a skill de planejamento do sistema. */
  async prompt(cardId: string, prompt: string, planning: boolean, skill?: SkillRef | null): Promise<string> {
    const untitled = planning && !this.board.card(cardId).title.trim()
    const naming = untitled ? 'This card has no title yet: right in this first reply, call agentboard_update_card with a short title (up to 60 characters, in the language given in `idioma`) that identifies the subject, as chats do. Then continue planning.\n\n' : ''
    const speckitStage = planning ? specKitStageOf(prompt) : null
    const entry = planning && !skill && !speckitStage && !this.history?.workflow(cardId)
    const planningLead = (): string => (skill ? `Use the ${skill.name} skill to run this chat, instead of agentboard-planning. The card documents, the language and the AgentBoard tools still apply.\n\n` : 'Use the agentboard-planning skill to run this chat.\n\n')
    const implementing = !planning && specKitStageOf(prompt) === 'implement'
    const implementLead = implementing ? 'Spec Kit task tracking: when you finish a task in tasks.md, mark its line [X] and also mark every indented sub-item (checkbox) under it that you completed (- [x]). Never leave the sub-items of a finished task unchecked, and keep the file structure as it is.\n\n' : ''
    const executionLead = !planning && skill ? `Use the ${skill.name} skill for this request.

` : ''
    const lead = naming + executionLead + implementLead + (speckitStage ? `Run now the native Spec Kit skill requested below (speckit-${speckitStage}), with the context and current decisions above as input. Follow the skill's questions and instructions; do not use the AgentBoard document skills or write parallel artifacts.\n\n` : entry ? 'Mandatory entry point: the workflow for this card has not been chosen yet. Start with the agentboard-discovery skill (understand, assess the complexity and propose the workflow for the user to choose) before any planning.\n\n' + planningLead() : planning ? (skill ? `Use the ${skill.name} skill to run this chat, instead of agentboard-planning. The card documents, the language and the AgentBoard tools still apply.\n\n` : 'Use the agentboard-planning skill to run this chat.\n\n') : '')
    return `${await this.block(cardId, planning)}\n\n${lead}${prompt}`
  }

  /** Chat livre: conversa solta, somente leitura. Se a conversa virar um planejamento, o agente cria o card e passa a planejar. */
  async freePrompt(prompt: string, projectId?: string, canEdit = false): Promise<string> {
    const regra = canEdit ? 'Free conversation without a card: when the user asks, you may change project files and run commands, within the chosen permission mode. Do not create or change cards, except through the agentboard_create_card tool.' : 'Free conversation in read-only mode: you do not change files or cards, except through the agentboard_create_card tool.'
    return `<agentboard-contexto>\n${JSON.stringify({ idioma: this.language(), tipo: 'chat-livre', regra, escolhaParaAlteracao: freeChangeRule, perguntasAoUsuario: questionRule }, null, 2)}${projectId ? await this.constitutionSection(projectId) : ''}\n</agentboard-contexto>\n\n${prompt}`
  }

  /** Instruções fixas do chat livre; no Codex levam só o catálogo, e a skill completa é lida sob demanda pelo MCP. */
  freeInstructions(withSkills: boolean, canEdit = false): string {
    const base = `You are in an AgentBoard free chat: converse, answer questions and read the project freely${canEdit ? ', with changes allowed according to the permission mode' : ', without changing files'}. ${freeChangeRule} ${questionRule} Do not use a skill for ordinary conversation or a direct change to files. When the user asks for a card or planning, load agentboard-discovery with agentboard_read_skill, call agentboard_create_card with a short title, type, priority and a summary, record the understanding and the complexity assessment, then load and follow agentboard-planning in this same chat (documents with agentboard_write_document and, at the end, agentboard_finish_planning). Load any other skill from the catalog only when the request matches its description.`
    const skills = withSkills && this.pluginDir ? loadSkillCatalog(this.pluginDir, true) : undefined
    return [base, skills].filter(Boolean).join('\n\n---\n\n')
  }

  /** Conteúdo integral de uma skill confiável do plugin, devolvido apenas quando o agente a ativa. */
  skillInstructions(name: string): string | undefined {
    if (!this.pluginDir) return undefined
    return loadSkillInstructions(this.pluginDir, this.language(), [name])
  }

  /**
   * Para agentes sem suporte a plugin (Codex): skills e modelos do idioma, em `developerInstructions`. Cada etapa leva só as suas:
   * planejamento as de planejar; implementação e teste o resumo mais a skill da etapa; fluxo curto a sua própria.
   */
  developerInstructions(planning: boolean, skill?: SkillRef | null, cardId?: string | null, purpose?: string): string | undefined {
    const which = purpose === 'constitution' ? ['agentboard-constitution'] : planning ? true : this.executionSkills(cardId, purpose)
    const system = this.pluginDir ? loadSkillInstructions(this.pluginDir, this.language(), which) : undefined
    const file = skill ? join(skill.path, 'SKILL.md') : null
    const chosen = file && existsSync(file) ? `## Skill chosen for this chat: ${skill!.name}\n${stripFrontMatter(readFileSync(file, 'utf8'))}` : undefined
    return [system, chosen].filter(Boolean).join('\n\n---\n\n') || undefined
  }

  /** Skills da etapa de execução: o fluxo curto tem a sua; os demais, a de implementar ou a de testar. */
  private executionSkills(cardId?: string | null, purpose?: string): string[] {
    const small = cardId ? this.board.card(cardId).workflow === 'light' : false
    return ['agentboard-summary', small ? 'agentboard-small' : purpose === 'test' ? 'agentboard-test' : 'agentboard-implement']
  }
}

function stripFrontMatter(text: string): string { return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim() }

/** O que todo agente faz com a Constituição: avisar quando algo fere um princípio e sugerir o que deveria virar princípio. */
const constitutionRule = 'The Constitution gathers the principles that apply to the whole project, above each card\'s Specification. Before proposing or doing something, check whether it violates any principle. If it does: stop before continuing, say which principle and why, and ask the user whether to adjust the request, proceed anyway (with the justification recorded in the Plan, Complexity section) or change the Constitution. If a rule emerges that should apply to the whole project (not just this work), say it would be good to have it in the Constitution. You do not change the Constitution: if the user agrees to the change, record it with agentboard_propose_constitution; they apply it from the project Constitution tab.'

/** Como o agente usa o histórico: reavaliar só por gatilho real e separar recomendação própria de decisão do usuário. */
const historyRule = 'Reassess the complexity (agentboard_assess_complexity with a trigger) only when a requirement changes, a new dependency or risk appears, the solution requires an architectural change, the scope is wrong or there are repeated failures; never on every message. For SDD, recommend per card the native or speckit method and explain the choice: consider the context, including whether the work is new or modifies an existing feature; do not treat this as a fixed rule. The choice is the user\'s. Decisions marked as a recommendation have not been approved by the user yet. Before recording a decision, review all current and proposed decisions; if it replaces one of them, give its number in substitui. Do not duplicate equivalent decisions.'

/** Skills do planejamento: as de execução (implementar, testar, pequena) ficam de fora para não pesar nesse contexto. */
const planningSkills = new Set(['agentboard-discovery', 'agentboard-planning', 'agentboard-specification', 'agentboard-plan', 'agentboard-tasks', 'agentboard-summary'])

/** `which`: `true` = as do planejamento; `false` = só o resumo; ou a lista exata de skills. */
export function loadSkillInstructions(pluginDir: string, language: AppLanguage, which: boolean | string[]): string | undefined {
  const skillsDir = join(pluginDir, 'skills')
  if (!existsSync(skillsDir)) return undefined
  const wanted = wantedSkills(skillsDir, which)
  const parts = wanted.map((name) => {
    const skill = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8')
    const templates = join(skillsDir, name, 'templates')
    const file = [`${language}.md`, 'pt-BR.md'].map((item) => join(templates, item)).find((item) => existsSync(item))
    return `## Skill ${name}\n${stripFrontMatter(skill)}${file ? `\n\n### Template (${language})\n${readFileSync(file, 'utf8').trim()}` : ''}`
  })
  return parts.length ? `AgentBoard system skills. Follow them when working on the card.\n\n${parts.join('\n\n---\n\n')}` : undefined
}

/** Metadados mínimos para descoberta progressiva; não injeta o corpo nem os templates das skills. */
export function loadSkillCatalog(pluginDir: string, which: boolean | string[]): string | undefined {
  const skillsDir = join(pluginDir, 'skills')
  if (!existsSync(skillsDir)) return undefined
  const entries = wantedSkills(skillsDir, which).map((folder) => {
    const source = readFileSync(join(skillsDir, folder, 'SKILL.md'), 'utf8')
    const name = source.match(/^name:\s*(.+)$/m)?.[1]?.trim() || folder
    const description = source.match(/^description:\s*(.+)$/m)?.[1]?.trim() || 'No description.'
    return `- ${name}: ${description}`
  })
  return entries.length ? `Skills available in AgentBoard (discovery catalog). The full content is not loaded. When a request matches a description, call agentboard_read_skill with the name before following the procedure.\n\n${entries.join('\n')}` : undefined
}

function wantedSkills(skillsDir: string, which: boolean | string[]): string[] {
  const names = readdirSync(skillsDir).filter((name) => name.startsWith('agentboard-')).sort()
  return Array.isArray(which) ? names.filter((name) => which.includes(name)) : which ? names.filter((name) => planningSkills.has(name)) : names.filter((name) => name === 'agentboard-summary')
}
