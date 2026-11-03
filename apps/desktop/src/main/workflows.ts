import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SddMethod, WorkflowConfig, WorkflowKind } from '@gearmod/contracts'
import { readManifest, type CardHistoryService } from './history'
import type { BoardRepository } from './projects'

/**
 * Pasta do SDD central: prefere a localização nova (`sdd.sourceId` + `sdd.root`, aba SDD do projeto); sem isso configurado,
 * cai no `sddRoot` legado (`sddPath` ou detecção automática). Evita duplicar a mesma escolha em dois lugares da UI.
 */
export function resolvedSddRoot(history: CardHistoryService, board: Pick<BoardRepository, 'get'>, projectId: string, method?: 'native' | 'speckit' | null): string | null {
  const config = history.config(projectId)
  if (config.sdd.sourceId) {
    const source = board.get(projectId).project.sources.find((item) => item.id === config.sdd.sourceId)
    if (source) return resolve(source.localPath, config.sdd.root || '.')
  }
  if (method === 'speckit') return config.sddPath ?? history.detect(projectId).find((item) => item.method === 'speckit')?.path ?? null
  return sddRoot(history, projectId)
}

/**
 * Workflow Adapters (docs/09). O planejador do GearMod continua só lendo o projeto; quem grava os arquivos no formato nativo de
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
    method: 'native', label: 'SDD do GearMod',
    instructions: () => 'Full GearMod SDD: Specification with prioritized stories, RF requirements and success criteria; Plan with decisions, risks, contracts and a test plan; Tasks by phase with acceptance criteria. Use the skills gearmod-specification, gearmod-plan and gearmod-tasks.'
  },
  speckit: {
    method: 'speckit', label: 'GitHub Spec Kit',
    instructions: () => 'Native GitHub Spec Kit: the stages are the installed skills speckit-specify, speckit-plan and speckit-tasks, run in the card worktree; they produce their own artifacts (spec.md, plan.md, tasks.md of the card feature). Do not imitate the templates, do not use the GearMod document tools to write these artifacts and do not generate copies. Follow the skills\' questions and instructions. At the end of each stage say which one is next and wait for the user to ask to continue. Never run speckit-implement here: implementation happens in the implementation chat, after the card is moved. Note: the block enforced by the app rejects the speckit-implement skill and its permissions; code edits by other means depend on the chosen mode and are only prevented by this instruction, not by the app.'
  },
  openspec: {
    method: 'openspec', label: 'OpenSpec',
    instructions: (_config, sddPath) => `OpenSpec${sddPath ? ` at ${sddPath}` : ''}. Read openspec/project.md (and openspec/AGENTS.md, if it exists) and the current specs in openspec/specs/. Write the Specification as an OpenSpec change proposal (Why, What Changes, Impact and the requirements with "#### Scenario:" scenarios), the Plan as design.md and the Tasks as tasks.md. You do not write files: when planning is concluded, GearMod writes proposal.md, design.md and tasks.md to ${sddPath ?? '<SDD folder>'}/openspec/changes/<card folder>/. Do not create another OpenSpec installation in the repositories. Items in tasks.md that are only validation (running tests, checking regressions) go in the Plan's "Test plan", not in the Tasks.`,
    target: (sddPath, folder) => ({ dir: join(sddPath, 'openspec', 'changes', folder), files: { 'proposal.md': ['resumo', 'especificacao'], 'design.md': ['plano'], 'tasks.md': ['tasks'] } })
  },
  custom: {
    method: 'custom', label: 'Método personalizado',
    instructions: (config) => {
      try {
        const manifest = readManifest(config.customManifest)
        return `Custom method "${manifest.name}" (version ${manifest.version}). Follow the steps in order; save the result in the card documents:\n${manifest.steps.map((step, index) => `${index + 1}. ${step.id}: ${step.description}${step.outputs?.length ? ` (outputs: ${step.outputs.join(', ')})` : ''}${step.commands?.length ? ` (allowed commands: ${step.commands.join(', ')})` : ''}`).join('\n')}`
      } catch (error) { return `Custom method unavailable (${error instanceof Error ? error.message : String(error)}). Use GearMod SDD.` }
    }
  }
}

/** O que vai no contexto do planejador para o fluxo do card. */
export function workflowInstructions(config: WorkflowConfig, sddPath: string | null, workflow: WorkflowKind | null, planning = true): string | null {
  // Fora do planejamento (implementação e teste) a skill speckit-implement é o trabalho do chat: a proibição vale só no planejamento.
  if (!planning && workflow === 'sdd' && config.complexMethod === 'speckit') return 'Native GitHub Spec Kit: the specification, plan and tasks of the card feature are already in the worktree. This is the implementation chat: the speckit-implement skill is allowed and is what must be run to implement the tasks (spec.md, plan.md and tasks.md of the card feature). Do not imitate the templates or use the GearMod document tools to write these artifacts.'
  if (workflow === 'light') return 'Short workflow: no Specification, Plan or Tasks. The card is a small task: a description of what to do, implement and validate.'
  if (workflow === 'spec') return 'Light spec: an objective Specification with acceptance criteria, a short technical Plan and Tasks only when they help. No empty sections.'
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
 * OpenSpec, também no formato nativo na pasta central. Nunca sobrescreve uma pasta que não foi criada pelo GearMod para este card.
 */
export function exportPlanArtifacts(history: CardHistoryService, board: BoardRepository, cardId: string): { written: string[]; notices: string[] } {
  const card = board.card(cardId), documents = board.documents.get(cardId), written: string[] = [], notices: string[] = []
  if (history.workflow(cardId) === 'sdd' && history.sddMethod(cardId) === 'speckit') {
    return { written, notices: ['Spec Kit: os artefatos são os das skills nativas na worktree do card; nenhum artefato paralelo foi gerado.'] }
  }
  const content = (kinds: Array<DocName>): string => kinds.map((kind) => documents[kind].contentMd.trim()).filter(Boolean).join('\n\n')
  // `shared`: pasta central do SDD, que pode ter conteúdo de outras pessoas; só grava onde o próprio card marcou como sua.
  const write = (dir: string, files: Record<string, Array<DocName>>, shared: boolean): void => {
    const marker = join(dir, '.gearmod-card')
    if (shared && existsSync(dir) && (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== cardId)) { notices.push(`A pasta ${dir} já existe e não foi criada pelo GearMod para este card; nada foi gravado nela.`); return }
    mkdirSync(dir, { recursive: true }); if (shared) writeFileSync(marker, `${cardId}\n`, 'utf8')
    for (const [name, kinds] of Object.entries(files)) {
      const text = content(kinds); if (!text) continue
      const file = join(dir, name), temp = `${file}.tmp`; writeFileSync(temp, `${text}\n`, 'utf8'); renameSync(temp, file); written.push(file)
    }
  }
  if (card.workflow !== 'light') write(history.artifactsDir(cardId), { 'spec.md': ['especificacao'], 'plan.md': ['plano'], 'tasks.md': ['tasks'] }, false)
  const selectedMethod = history.sddMethod(cardId), adapter = selectedMethod ? methodAdapters[selectedMethod] : null, root = resolvedSddRoot(history, board, card.projectId, selectedMethod)
  if (history.workflow(cardId) === 'sdd' && !adapter) notices.push('Escolha o método SDD neste card; o projeto não define o método automaticamente.')
  if (history.workflow(cardId) === 'sdd' && adapter?.target) {
    if (!root) notices.push(`O fluxo SDD usa ${adapter.label}, mas o projeto não tem a pasta do SDD configurada nem detectada; os arquivos ficaram só na pasta de artefatos do card.`)
    else { const target = adapter.target(resolve(root), `${cardId.slice(0, 8)}-${slug(card.title)}`); write(target.dir, target.files, true) }
  }
  if (written.length) history.recordArtifacts(cardId, written)
  return { written, notices }
}

/**
 * Mantém as cópias que já existem (spec.md, plan.md, tasks.md) iguais aos documentos do card: marcar uma task, ajustar o plano etc. regrava o arquivo.
 * Só atualiza arquivos já criados na conclusão do planejamento; no Spec Kit os arquivos reais são outros e não passam por aqui.
 */
export function refreshArtifactCopies(history: CardHistoryService, board: BoardRepository, cardId: string): void {
  const card = board.card(cardId)
  if (card.workflow === 'light' || (history.workflow(cardId) === 'sdd' && history.sddMethod(cardId) === 'speckit')) return
  const documents = board.documents.get(cardId), dir = history.artifactsDir(cardId)
  for (const [name, kind] of [['spec.md', 'especificacao'], ['plan.md', 'plano'], ['tasks.md', 'tasks']] as const) {
    const file = join(dir, name), text = documents[kind].contentMd.trim()
    if (!existsSync(file) || !text) continue
    const temp = `${file}.tmp`; writeFileSync(temp, `${text}\n`, 'utf8'); renameSync(temp, file)
  }
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'card'
}
