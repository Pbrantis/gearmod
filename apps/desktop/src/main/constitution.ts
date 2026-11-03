import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Constitution, ConstitutionProposal, ConstitutionState } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import { tm } from './i18n'

type Actor = 'user' | 'agent' | 'system'
/** Até este tamanho a Constituição vai inteira no contexto do agente; acima, vai só o índice e ele lê o resto pela ferramenta. */
export const inlineLimit = 6000
/** Onde o GitHub Spec Kit guarda a constituição de um projeto. */
const specKitFile = join('.specify', 'memory', 'constitution.md')

/** Constituição do projeto: princípios que todo card respeita. É opcional; sem ela o GearMod segue como antes. */
export class ConstitutionRepository {
  constructor(private readonly database: AppDatabase) {}

  get(projectId: string): Constitution {
    const row = this.database.db.prepare('SELECT content_md AS contentMd, version, updated_at AS updatedAt, updated_by AS updatedBy FROM project_constitutions WHERE project_id = ?').get(projectId) as Omit<Constitution, 'projectId'> | undefined
    return row ? { projectId, ...row } : { projectId, contentMd: '', version: 0, updatedAt: null, updatedBy: null }
  }

  /** Grava o texto inteiro e guarda a versão anterior no histórico. Texto igual ao atual não gera versão nova. */
  write(projectId: string, contentMd: string, actor: Actor): Constitution {
    const current = this.get(projectId)
    if (current.version && current.contentMd === contentMd) return current
    const version = current.version + 1, now = new Date().toISOString()
    this.database.db.transaction(() => {
      this.database.db.prepare(`INSERT INTO project_constitutions(project_id, content_md, version, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET content_md = excluded.content_md, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(projectId, contentMd, version, now, actor)
      this.database.db.prepare('INSERT INTO project_constitution_versions(id, project_id, version, content_md, created_at, actor) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), projectId, version, contentMd, now, actor)
    })()
    return this.get(projectId)
  }

  propose(input: { projectId: string; cardId: string | null; chatId: string; title: string; details: string; reason: string }): ConstitutionProposal {
    const next = this.database.db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM constitution_proposals WHERE project_id = ?').get(input.projectId) as { number: number }
    const id = randomUUID()
    this.database.db.prepare(`INSERT INTO constitution_proposals(id, project_id, number, card_id, chat_id, title, details, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.projectId, next.number, input.cardId, input.chatId, input.title.trim(), input.details.trim(), input.reason.trim(), new Date().toISOString())
    return this.proposals(input.projectId).find((item) => item.id === id)!
  }

  proposals(projectId: string): ConstitutionProposal[] {
    return this.database.db.prepare(`SELECT id, project_id AS projectId, number, card_id AS cardId, title, details, reason, status, created_at AS createdAt
      FROM constitution_proposals WHERE project_id = ? ORDER BY number DESC`).all(projectId) as ConstitutionProposal[]
  }

  setProposal(proposalId: string, status: 'applied' | 'dismissed'): string {
    const row = this.database.db.prepare('SELECT project_id AS projectId FROM constitution_proposals WHERE id = ?').get(proposalId) as { projectId: string } | undefined
    if (!row) throw new Error(tm().common.proposalNotFound)
    this.database.db.prepare('UPDATE constitution_proposals SET status = ? WHERE id = ?').run(status, proposalId)
    return row.projectId
  }

  /** Estado da aba: texto, propostas e, se houver, a constituição do Spec Kit que dá para importar. */
  state(projectId: string): ConstitutionState {
    return { constitution: this.get(projectId), proposals: this.proposals(projectId), importable: this.specKitPath(projectId) }
  }

  /** Importa `.specify/memory/constitution.md` (Spec Kit) da pasta do projeto ou do primeiro repositório que tiver. */
  importSpecKit(projectId: string): ConstitutionState {
    const path = this.specKitPath(projectId)
    if (!path) throw new Error(tm().constitution.noConstitutionFile)
    this.write(projectId, readFileSync(path, 'utf8').trim(), 'user')
    return this.state(projectId)
  }

  private specKitPath(projectId: string): string | null {
    const project = this.database.db.prepare('SELECT local_path AS localPath FROM projects WHERE id = ?').get(projectId) as { localPath: string } | undefined
    const sources = this.database.db.prepare('SELECT local_path AS localPath FROM project_sources WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<{ localPath: string }>
    const roots = [project?.localPath, ...sources.map((item) => item.localPath)].filter((item): item is string => Boolean(item))
    return roots.map((root) => join(root, specKitFile)).find((file) => existsSync(file)) ?? null
  }
}

/** Índice da Constituição para o contexto: os títulos (princípios e seções), sem o corpo. */
export function constitutionIndex(contentMd: string): string {
  const headings = contentMd.split(/\r?\n/).filter((line) => /^#{1,4}\s+\S/.test(line)).map((line) => line.replace(/\s+$/, ''))
  return headings.slice(0, 80).join('\n')
}
