import { checklistKey, type CardChecklist } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import { tm } from './i18n'

const item = /^\s*[-*+]\s+\[( |x|X)\]\s+\S/m
const line = /^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/
type Marks = CardChecklist['marks']

/** Itens do checklist (principais e recuados) com o texto e se estão marcados. */
function itemsOf(markdown: string): Array<{ key: string; checked: boolean }> {
  return markdown.split(/\r?\n/).flatMap((text) => { const match = line.exec(text); return match ? [{ key: checklistKey(match[4]!), checked: match[2] !== ' ' }] : [] })
}

/** Checklist do testador: o que ele vai verificar, marcado conforme verifica (pelo agente ou pelo usuário). O app mostra ao lado do chat do teste. */
export class ChecklistRepository {
  constructor(private readonly database: AppDatabase) {}

  get(cardId: string): CardChecklist {
    const row = this.database.db.prepare("SELECT content_md AS contentMd, updated_at AS updatedAt, marks FROM card_checklists WHERE card_id = ? AND purpose = 'test'").get(cardId) as { contentMd: string; updatedAt: string; marks: string | null } | undefined
    let marks: Marks = {}
    try { if (row?.marks) marks = JSON.parse(row.marks) as Marks } catch { /* marcas ruins: recomeça sem elas */ }
    return { cardId, contentMd: row?.contentMd ?? '', updatedAt: row?.updatedAt ?? null, marks }
  }

  /**
   * Grava o checklist inteiro; precisa ter pelo menos um item `- [ ]` ou `- [x]`. Cada item cujo estado mudou em relação ao que
   * estava gravado fica marcado como alterado por `by` (o agente, quando ele grava; o usuário, quando clica).
   */
  write(cardId: string, contentMd: string, by: 'user' | 'agent' = 'agent'): CardChecklist {
    if (!item.test(contentMd)) throw new Error(tm().checklists.invalidFormat)
    const before = this.get(cardId), was = new Map(itemsOf(before.contentMd).map((entry) => [entry.key, entry.checked])), at = new Date().toISOString(), marks: Marks = {}
    for (const entry of itemsOf(contentMd)) {
      const old = before.marks[entry.key]
      if (was.get(entry.key) === entry.checked && old) marks[entry.key] = old
      else if (was.get(entry.key) !== entry.checked && (was.has(entry.key) || entry.checked)) {
        // O OK do agente fica registrado: o usuário pode desmarcar e marcar de novo sem apagá-lo; só o próprio agente o refaz ou o tira.
        if (by === 'agent') marks[entry.key] = entry.checked ? { by, at, agent: at } : { by, at }
        else marks[entry.key] = { by, at, ...(old?.agent ? { agent: old.agent } : {}) }
      }
    }
    this.database.db.prepare(`INSERT INTO card_checklists(card_id, purpose, content_md, updated_at, marks) VALUES (?, 'test', ?, ?, ?)
      ON CONFLICT(card_id, purpose) DO UPDATE SET content_md = excluded.content_md, updated_at = excluded.updated_at, marks = excluded.marks`).run(cardId, contentMd, at, JSON.stringify(marks))
    return this.get(cardId)
  }

  /** O usuário marca ou desmarca um item pela linha do markdown; confere o texto para não alterar outro item se o agente reescreveu o checklist. */
  toggle(cardId: string, lineNumber: number, text: string, checked: boolean): CardChecklist {
    const current = this.get(cardId), eol = current.contentMd.includes('\r\n') ? '\r\n' : '\n', lines = current.contentMd.split(/\r?\n/)
    const match = line.exec(lines[lineNumber] ?? '')
    if (!match || checklistKey(match[4]!) !== checklistKey(text)) throw new Error(tm().checklists.changedWhileClicking)
    lines[lineNumber] = `${match[1]}[${checked ? 'x' : ' '}]${match[3]}${match[4]}`
    return this.write(cardId, lines.join(eol), 'user')
  }
}
