import type { EditorState } from '@codemirror/state'

/** Item da estrutura do arquivo: títulos do Markdown ou símbolos do índice de código (linha a partir de 1). */
export interface OutlineItem { line: number; endLine: number; text: string; depth: number; kind?: string }

/** Símbolos que contêm a linha, do mais externo ao mais interno (classe › método). */
export function symbolTrail(items: OutlineItem[], line: number): OutlineItem[] {
  const trail: OutlineItem[] = []
  for (const item of items) {
    if (item.line > line || item.endLine < line || item.endLine === item.line) continue
    while (trail.length && trail.at(-1)!.depth >= item.depth) trail.pop()
    trail.push(item)
  }
  return trail
}

const identifier = /^[\p{L}_$][\p{L}\p{N}_$]*$/u
/** Nome sob o cursor (ou o último pedaço do texto selecionado, como em `this.deps.save`); vazio se não for um identificador. */
export function nameAtCursor(state: EditorState): string {
  const range = state.selection.main
  if (!range.empty) {
    const picked = state.sliceDoc(range.from, Math.min(range.to, range.from + 200)).trim().split(/[.:]+/).filter(Boolean).at(-1) ?? ''
    return identifier.test(picked) ? picked : ''
  }
  const word = state.wordAt(range.head)
  const text = word ? state.sliceDoc(word.from, word.to) : ''
  return identifier.test(text) ? text : ''
}

/** Letra curta do tipo de símbolo, mostrada antes do nome nas listas. */
export function kindMark(kind: string | undefined): string {
  switch (kind) {
    case 'function': case 'method': case 'constructor': return 'ƒ'
    case 'class': return 'C'
    case 'interface': return 'I'
    case 'type': return 'T'
    case 'enum': return 'E'
    case 'struct': return 'S'
    case 'trait': return 'R'
    case 'module': case 'namespace': return 'N'
    case 'field': case 'property': return 'p'
    case 'const': case 'variable': case 'var': return 'v'
    default: return kind ? kind[0]!.toUpperCase() : '·'
  }
}
