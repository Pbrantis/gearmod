import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { relativeLink } from './markdownPaths'
import { tr } from '../i18n'

const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
type ImageType = typeof imageTypes[number]
const isImage = (type: string): type is ImageType => (imageTypes as readonly string[]).includes(type)
const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(new Error(tr().files.editor.markdownImages.readFailed)); reader.readAsDataURL(file) })
let counter = 0

/**
 * Colar ou soltar imagem num Markdown: a imagem vai para `imagens/` ao lado do `.md` e o link é inserido na posição do cursor.
 * Enquanto grava aparece um texto provisório; em erro ele some e o erro vai para `fail`. Imagem solta que já está no projeto só vira link.
 */
export function markdownImages({ markdownPath, save, inProject, droppedPath, fail }: {
  markdownPath: string
  save(data: string, mime: ImageType): Promise<{ relative: string }>
  inProject(path: string): boolean
  droppedPath(file: File): string
  fail(message: string): void
}): Extension {
  const insert = (view: EditorView, at: number, alt: string, work: (marker: string) => Promise<string>): void => {
    const marker = `![${tr().files.editor.markdownImages.saving}](carregando-${++counter})`, selected = alt
    view.dispatch({ changes: { from: at, to: at + selected.length, insert: marker }, selection: { anchor: at + marker.length } })
    void work(marker).then((link) => { const found = view.state.doc.toString().indexOf(marker); if (found >= 0) view.dispatch({ changes: { from: found, to: found + marker.length, insert: `![${alt}](${link})` } }) })
      .catch((reason: unknown) => { const found = view.state.doc.toString().indexOf(marker); if (found >= 0) view.dispatch({ changes: { from: found, to: found + marker.length, insert: alt } }); fail(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : tr().files.editor.markdownImages.saveFailed) })
  }
  const place = (view: EditorView, file: File, at?: number): void => {
    const range = view.state.selection.main, from = at ?? range.from, alt = at === undefined ? view.state.sliceDoc(range.from, range.to) : ''
    insert(view, from, alt, async () => {
      if (!isImage(file.type)) throw new Error(tr().files.editor.markdownImages.unsupportedType)
      const dropped = at === undefined ? '' : droppedPath(file)
      const direct = dropped && inProject(dropped) ? relativeLink(markdownPath, dropped) : null
      return direct ?? (await save(await toBase64(file), file.type)).relative
    })
  }
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'))
      if (!file || view.state.readOnly) return false
      event.preventDefault(); place(view, file); return true
    },
    drop: (event, view) => {
      const file = [...(event.dataTransfer?.files ?? [])].find((item) => item.type.startsWith('image/'))
      if (!file || view.state.readOnly) return false
      event.preventDefault(); place(view, file, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head); return true
    }
  })
}
