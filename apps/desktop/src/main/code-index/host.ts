import type { HostMessage, HostRequest } from './protocol'
import { createHostHandler } from './host-handler'

/**
 * Code index utility process (Electron utilityProcess). It owns the database: indexes, watches the folders and
 * answers queries without blocking the main process.
 */
const port = process.parentPort
const send = (message: HostMessage): void => port.postMessage(message)
const handler = createHostHandler(send)

port.on('message', (event: { data: { id: number; request: HostRequest } }) => {
  const { id, request } = event.data
  handler.handle(request).then((value) => send({ id, ok: true, value }), (error: unknown) => send({ id, ok: false, error: error instanceof Error ? error.message : String(error) }))
})
process.on('exit', () => handler.close())
