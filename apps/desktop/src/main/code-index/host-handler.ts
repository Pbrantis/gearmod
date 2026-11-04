import { CodeIndex } from './code-index'
import type { HostMessage, HostRequest } from './protocol'
import { runCodeTool } from './tools'

/** What the utility process does with each request (separated so it can be tested without Electron). */
export function createHostHandler(send: (message: HostMessage) => void): { handle(request: HostRequest): Promise<unknown>; close(): void } {
  let index: CodeIndex | undefined
  return {
    async handle(request) {
      if (request.op === 'init') { index ??= new CodeIndex(request.dbFile); return true }
      if (!index) throw new Error('code index not initialized')
      const current = index
      switch (request.op) {
        case 'index': return current.index(request.root, { exclude: request.exclude })
        case 'watch': current.watch(request.root, { exclude: request.exclude, onUpdate: (result) => { if ('changed' in result && result.changed) send({ event: 'updated', root: request.root, changed: result.changed }) } }); return true
        case 'unwatch': current.unwatch(request.root); return true
        case 'forget': await current.forget(request.root); return true
        case 'status': return current.status(request.root)
        case 'tool': return runCodeTool(current.q(request.root), request.tool, request.args)
        case 'symbols': return current.q(request.root).searchSymbols(request.query, { limit: request.limit ?? 50 })
        case 'outline': return current.q(request.root).outline(request.file)
        case 'definitions': return current.q(request.root).definitions(request.name, request.from)
        case 'references': return current.q(request.root).references(request.name, request.from)
      }
    },
    close() { index?.close(); index = undefined }
  }
}
