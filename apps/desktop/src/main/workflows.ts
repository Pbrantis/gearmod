import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SddMethod, WorkflowConfig, WorkflowKind } from '@agentboard/contracts'
import { readManifest, type CardHistoryService } from './history'
import type { BoardRepository } from './projects'

/**
 * Workflow Adapters (docs/09). O planejador do AgentBoard continua só lendo o projeto; quem grava os arquivos no formato nativo de
 * cada método é o app, ao concluir o planejamento, na pasta central do SDD do projeto (uma só, mesmo com vários repositórios).
 */
export interface MethodAdapter {
  method: SddMethod
  label: string
  /** Instruções do método para o planejador, com a pasta central quando houver. */
  instructions(config: WorkflowConfig, sddPath: string | null): string
  /** Pasta e arquivos nativos onde o plano aprovado do card é gravado; `null` = o método não grava fora da pasta de artefatos. */
  target?(sddPath: string, folder: string): { dir: string; files: Record<string, Array<'resumo' | 'especificacao' | 'plano' | 'tasks'>> }
}

export const methodAdapters: Record<SddMethod, MethodAdapter> = {
  native: {
    method: 'native', label: 'SDD do AgentBoard',
    instructions: () => 'SDD completo do AgentBoard: Especificação com histórias priorizadas, requisitos RF e critérios de sucesso; Plano com decisões, riscos, contratos e plano de testes; Tasks por fase com critérios de aceite. Use as skills agentboard-especificacao, agentboard-plano e agentboard-tasks.'
  },
  speckit: {
    method: 'speckit', label: 'GitHub Spec Kit',
    instructions: (_config, sddPath) => `GitHub Spec Kit${sddPath ? ` instalado em ${sddPath}` : ''}. Leia a constituição (.specify/memory/constitution.md) e os modelos nativos (.specify/templates/spec-template.md, plan-template.md e tasks-template.md) e escreva Especificação, Plano e Tasks do card seguindo a estrutura desses modelos (seções e numeração do Spec Kit). Você não roda os comandos /speckit.* nem grava arquivos: ao concluir o planejamento, o AgentBoard grava spec.md, plan.md e tasks.md em ${sddPath ?? '<pasta do SDD>'}/specs/<pasta do card>/. Não crie outra instalação do Spec Kit nos repositórios. Se o modelo de tasks do Spec Kit tiver tarefas só de validação (rodar testes, conferir regressões), elas vão para o "Plano de testes" do Plano, não para as Tasks.`,
    target: (sddPath, folder) => ({ dir: join(sddPath, 'specs', folder), files: { 'spec.md': ['especificacao'], 'plan.md': ['plano'], 'tasks.md': ['tasks'] } })
  },
  openspec: {
    method: 'openspec', label: 'OpenSpec',
    instructions: (_config, sddPath) => `OpenSpec${sddPath ? ` em ${sddPath}` : ''}. Leia openspec/project.md (e openspec/AGENTS.md, se existir) e as specs atuais em openspec/specs/. Escreva a Especificação como proposta de mudança do OpenSpec (Why, What Changes, Impact e os requisitos com cenários "#### Scenario:"), o Plano como design.md e as Tasks como tasks.md. Você não grava arquivos: ao concluir o planejamento, o AgentBoard grava proposal.md, design.md e tasks.md em ${sddPath ?? '<pasta do SDD>'}/openspec/changes/<pasta do card>/. Não crie outra instalação do OpenSpec nos repositórios. Itens do tasks.md que são só validação (rodar testes, conferir regressões) vão para o "Plano de testes" do Plano, não para as Tasks.`,
    target: (sddPath, folder) => ({ dir: join(sddPath, 'openspec', 'changes', folder), files: { 'proposal.md': ['resumo', 'especificacao'], 'design.md': ['plano'], 'tasks.md': ['tasks'] } })
  },
  custom: {
    method: 'custom', label: 'Método personalizado',
    instructions: (config) => {
      try {
        const manifest = readManifest(config.customManifest)
        return `Método personalizado "${manifest.name}" (versão ${manifest.version}). Siga as etapas na ordem; grave o resultado nos documentos do card:\n${manifest.steps.map((step, index) => `${index + 1}. ${step.id}: ${step.description}${step.outputs?.length ? ` (saídas: ${step.outputs.join(', ')})` : ''}${step.commands?.length ? ` (comandos permitidos: ${step.commands.join(', ')})` : ''}`).join('\n')}`
      } catch (error) { return `Método personalizado indisponível (${error instanceof Error ? error.message : String(error)}). Use o SDD do AgentBoard.` }
    }
  }
}

/** O que vai no contexto do planejador para o fluxo do card. */
export function workflowInstructions(config: WorkflowConfig, sddPath: string | null, workflow: WorkflowKind | null): string | null {
  if (workflow === 'light') return 'Fluxo curto: sem Especificação, Plano nem Tasks. O card é uma tarefa pequena: descrição do que fazer, implementar e validar.'
  if (workflow === 'spec') return 'Spec leve: Especificação objetiva com critérios de aceite, Plano técnico curto e Tasks só quando ajudarem. Nada de seções vazias.'
  if (workflow === 'sdd') return methodAdapters[config.complexMethod].instructions(config, sddPath)
  return null
}

/** Pasta do SDD central: a configurada ou, sem configuração, a primeira instalação detectada do método escolhido. */
export function sddRoot(history: CardHistoryService, projectId: string): string | null {
  const config = history.config(projectId)
  if (config.sddPath) return config.sddPath
  if (config.complexMethod !== 'speckit' && config.complexMethod !== 'openspec') return null
  return history.detect(projectId).find((item) => item.method === config.complexMethod)?.path ?? null
}

type DocName = 'resumo' | 'especificacao' | 'plano' | 'tasks'

/**
 * Plano concluído: grava Especificação, Plano e Tasks como arquivos na pasta de artefatos do card e, no fluxo SDD com Spec Kit ou
 * OpenSpec, também no formato nativo na pasta central. Nunca sobrescreve uma pasta que não foi criada pelo AgentBoard para este card.
 */
export function exportPlanArtifacts(history: CardHistoryService, board: BoardRepository, cardId: string): { written: string[]; notices: string[] } {
  const card = board.card(cardId), documents = board.documents.get(cardId), written: string[] = [], notices: string[] = []
  const content = (kinds: Array<DocName>): string => kinds.map((kind) => documents[kind].contentMd.trim()).filter(Boolean).join('\n\n')
  // `shared`: pasta central do SDD, que pode ter conteúdo de outras pessoas; só grava onde o próprio card marcou como sua.
  const write = (dir: string, files: Record<string, Array<DocName>>, shared: boolean): void => {
    const marker = join(dir, '.agentboard-card')
    if (shared && existsSync(dir) && (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== cardId)) { notices.push(`A pasta ${dir} já existe e não foi criada pelo AgentBoard para este card; nada foi gravado nela.`); return }
    mkdirSync(dir, { recursive: true }); if (shared) writeFileSync(marker, `${cardId}\n`, 'utf8')
    for (const [name, kinds] of Object.entries(files)) {
      const text = content(kinds); if (!text) continue
      const file = join(dir, name), temp = `${file}.tmp`; writeFileSync(temp, `${text}\n`, 'utf8'); renameSync(temp, file); written.push(file)
    }
  }
  if (card.type !== 'minor') write(history.artifactsDir(cardId), { 'spec.md': ['especificacao'], 'plan.md': ['plano'], 'tasks.md': ['tasks'] }, false)
  const config = history.config(card.projectId), adapter = methodAdapters[config.complexMethod], root = sddRoot(history, card.projectId)
  if (history.workflow(cardId) === 'sdd' && adapter.target) {
    if (!root) notices.push(`O fluxo SDD usa ${adapter.label}, mas o projeto não tem a pasta do SDD configurada nem detectada; os arquivos ficaram só na pasta de artefatos do card.`)
    else { const target = adapter.target(resolve(root), `${cardId.slice(0, 8)}-${slug(card.title)}`); write(target.dir, target.files, true) }
  }
  if (written.length) history.recordArtifacts(cardId, written)
  return { written, notices }
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'card'
}
