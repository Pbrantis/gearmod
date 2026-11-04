import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { moveLineDown, toggleComment } from '@codemirror/commands'
import { languageFor } from './languages'
import { insertLineAbove } from './keymap'

/** Runs a command without a DOM: the command only needs `state` and `dispatch`. */
async function run(path: string, doc: string, command: Command, cursor = 0): Promise<string> {
  const language = await languageFor(path)
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: language ? [language] : [] })
  command({ state, dispatch: (transaction: { state: EditorState }) => { state = transaction.state } } as unknown as EditorView)
  return state.doc.toString()
}

describe('editorKeymap', () => {
  it('comments a line with // in .ts and # in .env', async () => {
    expect(await run('a.ts', 'const a = 1\nb', toggleComment)).toBe('// const a = 1\nb')
    expect(await run('.env', 'CHAVE=1\nOUTRA=2', toggleComment)).toBe('# CHAVE=1\nOUTRA=2')
  })
  it('uncomments when repeated', async () => {
    expect(await run('a.ts', '// const a = 1\nb', toggleComment)).toBe('const a = 1\nb')
  })
  it('moves the line down', async () => {
    expect(await run('a.ts', 'um\ndois\ntres', moveLineDown)).toBe('dois\num\ntres')
  })
  it('opens a line above keeping the indent', async () => {
    expect(await run('a.ts', 'x\n  y', insertLineAbove, 4)).toBe('x\n  \n  y')
  })
})
