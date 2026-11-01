/** Leitura do documento Tasks: só os itens de primeiro nível contam como tasks; os critérios ficam recuados dentro de cada task. */
import { tm } from './i18n'
const topLevelItem = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/
const anyItem = /^\s*[-*+]\s+\[( |x|X)\]\s+/

export interface TaskCount { done: number; total: number }

export function countTasks(markdown: string): TaskCount {
  let done = 0, total = 0
  for (const line of markdown.split(/\r?\n/)) {
    const match = topLevelItem.exec(line)
    if (!match) continue
    total += 1
    if (match[1] !== ' ') done += 1
  }
  return { done, total }
}

/** Erro em português para o agente corrigir quando o Tasks foge do formato (o contador do card depende dele). */
export function validateTasks(markdown: string): string | null {
  if (!markdown.trim()) return null
  if (countTasks(markdown).total === 0) return 'O documento Tasks precisa ter ao menos uma task de primeiro nível no formato "- [ ] T001 Descrição".'
  const indentedOnly = markdown.split(/\r?\n/).some((line) => /^\s+[-*+]\s+\[( |x|X)\]/.test(line) && !/^(\s{2,}|\t)/.test(line))
  return indentedOnly ? 'Os critérios de aceite devem ficar recuados (dois espaços) abaixo da task.' : null
}

const plainText = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const checkVerb = /^(rodar|executar|verificar|validar|confirmar|garantir|checar|conferir|testar manualmente|run|execute|verify|validate|confirm|ensure|check)\b/
const checkTarget = /\b(lint|type-?check|typecheck|tsc|suite|testes|tests?|regress\w*|continua\w* funcionando|still works?|build)\b/

/**
 * Tasks que são só verificação ("rodar lint, type-check e a suíte", "confirmar que X continua funcionando"): isso é da etapa de teste
 * (Plano de testes) ou da regra de pronto do desenvolvedor, não uma task. Escrever testes continua sendo task normal.
 */
export function verificationOnlyTasks(markdown: string): string[] {
  const found: string[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = topLevelItem.exec(line)
    if (!match) continue
    const id = /\bT\d{2,4}\b/.exec(match[2]!)?.[0]
    const text = plainText(match[2]!.replace(/\bT\d{2,4}\b/, '').replace(/\[[^\]]*\]/g, '').trim())
    if (checkVerb.test(text) && checkTarget.test(text)) found.push(id ?? match[2]!.slice(0, 40))
  }
  return found
}

/** Marca ou desmarca o item (de qualquer nível) da linha informada, contando linhas a partir de 0. */
export function setTaskChecked(markdown: string, lineIndex: number, checked: boolean): string {
  const lines = markdown.split('\n')
  const line = lines[lineIndex]
  if (line === undefined || !anyItem.test(line)) throw new Error(tm().tasks.notChecklistItem)
  lines[lineIndex] = line.replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]')
  return lines.join('\n')
}
