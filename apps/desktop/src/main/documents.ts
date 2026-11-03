import { randomUUID } from 'node:crypto'
import type { CardDocument, CardDocumentKind, CardDocuments, DocumentVersion } from '@agentboard/contracts'
import { cardDocumentKinds } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import { setTaskChecked, validateTasks, verificationOnlyTasks } from './tasks'
import { tm } from './i18n'

type Actor = 'user' | 'agent' | 'system'

/** Os 4 documentos Markdown do card (Resumo, Especificação, Plano e Tasks) e o histórico de versões de cada um. */
export class DocumentRepository {
  /** Chamado depois de cada gravação que mudou o documento (usado para manter as cópias em arquivo iguais). */
  onWrite?: (cardId: string, kind: CardDocumentKind) => void
  constructor(private readonly database: AppDatabase) {}

  get(cardId: string): CardDocuments {
    this.assertCard(cardId)
    const rows = this.database.db.prepare('SELECT kind, content_md AS contentMd, updated_at AS updatedAt, updated_by AS updatedBy FROM card_documents WHERE card_id = ?').all(cardId) as CardDocument[]
    const result = {} as CardDocuments
    for (const kind of cardDocumentKinds) result[kind] = rows.find((row) => row.kind === kind) ?? { kind, contentMd: '', updatedAt: null, updatedBy: null }
    return result
  }

  read(cardId: string, kind: CardDocumentKind): string {
    return (this.database.db.prepare('SELECT content_md AS value FROM card_documents WHERE card_id = ? AND kind = ?').get(cardId, kind) as { value: string } | undefined)?.value ?? ''
  }

  write(cardId: string, kind: CardDocumentKind, contentMd: string, actor: Actor = 'user'): CardDocument {
    this.assertCard(cardId)
    if (kind === 'tasks') { const problem = validateTasks(contentMd); if (problem) throw new Error(problem) }
    // Só o agente é barrado (o usuário escreve o que quiser): verificação vai para o Plano de testes, vale para qualquer método (Spec Kit, OpenSpec...).
    if (kind === 'tasks' && actor === 'agent') {
      const checks = verificationOnlyTasks(contentMd)
      if (checks.length) throw new Error(tm().documents.verificationOnlyTasks(checks.join(', '), checks.length > 1))
    }
    const now = new Date().toISOString()
    const save = this.database.db.transaction(() => {
      const current = this.read(cardId, kind)
      const exists = this.database.db.prepare('SELECT 1 FROM card_documents WHERE card_id = ? AND kind = ?').get(cardId, kind)
      if ((exists && current === contentMd) || (!exists && !contentMd)) return
      this.database.db.prepare(`INSERT INTO card_documents(card_id, kind, content_md, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(card_id, kind) DO UPDATE SET content_md = excluded.content_md, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(cardId, kind, contentMd, now, actor)
      const version = (this.database.db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS value FROM card_document_versions WHERE card_id = ? AND kind = ?').get(cardId, kind) as { value: number }).value
      this.database.db.prepare('INSERT INTO card_document_versions(id, card_id, kind, version, content_md, created_at, actor) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), cardId, kind, version, contentMd, now, actor)
      if (kind === 'resumo') this.database.db.prepare('UPDATE cards SET description = ?, updated_at = ? WHERE id = ?').run(contentMd, now, cardId)
      else this.database.db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, cardId)
    })
    save()
    try { this.onWrite?.(cardId, kind) } catch { /* a cópia em arquivo é melhor esforço */ }
    return this.get(cardId)[kind]
  }

  versions(cardId: string, kind: CardDocumentKind): DocumentVersion[] {
    this.assertCard(cardId)
    return this.database.db.prepare(`SELECT id, version, content_md AS contentMd, created_at AS createdAt, actor FROM card_document_versions
      WHERE card_id = ? AND kind = ? ORDER BY version DESC`).all(cardId, kind) as DocumentVersion[]
  }

  setTask(cardId: string, line: number, checked: boolean, actor: Actor = 'user'): CardDocument {
    return this.write(cardId, 'tasks', setTaskChecked(this.read(cardId, 'tasks'), line, checked), actor)
  }

  private assertCard(cardId: string): void {
    if (!this.database.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(cardId)) throw new Error(tm().common.cardNotFound)
  }
}
