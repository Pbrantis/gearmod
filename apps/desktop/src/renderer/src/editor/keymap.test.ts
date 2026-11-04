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
  it('comenta linha com // em .ts e # em .env', async () => {
    expect(await run('a.ts', 'const a = 1\nb', toggleComment)).toBe('// const a = 1\nb')
    expect(await run('.env', 'CHAVE=1\nOUTRA=2', toggleComment)).toBe('# CHAVE=1\nOUTRA=2')
  })
  it('descomenta ao repetir', async () => {
    expect(await run('a.ts', '// const a = 1\nb', toggleComment)).toBe('const a = 1\nb')
  })
  it('move a linha para baixo', async () => {
    expect(await run('a.ts', 'um\ndois\ntres', moveLineDown)).toBe('dois\num\ntres')
  })
  it('abre linha acima mantendo o recuo', async () => {
    expect(await run('a.ts', 'x\n  y', insertLineAbove, 4)).toBe('x\n  \n  y')
  })
})
