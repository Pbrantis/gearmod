/**
 * Resumo do card em texto corrido para o quadro: tira só a marcação de Markdown (marcador de lista e caixinha no começo da linha,
 * `#` de título, citação, cerca de código, ênfase *x* / **x** / _x_, `código` e links), preservando hífens e asteriscos no meio do texto.
 */
export function plainSummary(markdown: string): string {
  return markdown
    .replace(/^\s*```.*$/gm, '')
    .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm, '')
    .replace(/^\s*\[[ xX]\]\s+/gm, '')
    .replace(/(\*\*|__)(?=\S)([^\n]+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
