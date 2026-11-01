import type { HostMessage, HostRequest } from './protocol'
import { createHostHandler } from './host-handler'

/**
 * Processo utilitário do índice de código (Electron utilityProcess). É o dono do banco: indexa, observa as pastas e
 * responde às consultas sem travar o processo principal.
 */
const port = process.parentPort
const send = (message: HostMessage): void => port.postMessage(message)
const handler = createHostHandler(send)

port.on('message', (event: { data: { id: number; request: HostRequest } }) => {
  const { id, request } = event.data
  handler.handle(request).then((value) => send({ id, ok: true, value }), (error: unknown) => send({ id, ok: false, error: error instanceof Error ? error.message : String(error) }))
})
process.on('exit', () => handler.close())
