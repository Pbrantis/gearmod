import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { ipcContracts, type GearModApi, type IpcChannel, type IpcInput, type IpcOutput, type PushedRunEvent } from '@gearmod/contracts'

const allowed = new Set<IpcChannel>(Object.keys(ipcContracts) as IpcChannel[])
const cleanIpcError = (reason: unknown): Error => {
  let message = String(reason)
  for (let index = 0; index < 3; index += 1) message = message.replace(/^Error:\s*/i, '').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
  return new Error(message || 'Não foi possível concluir a operação')
}
const api: GearModApi = {
  async invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
    if (!allowed.has(channel)) throw new Error(`IPC channel is not allowed: ${channel}`)
    try { return await ipcRenderer.invoke(channel, input) as IpcOutput<C> } catch (reason) { throw cleanIpcError(reason) }
  },
  onRunEvent(listener: (event: PushedRunEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: PushedRunEvent): void => listener(value)
    ipcRenderer.on('runs:event-pushed', handler)
    return () => ipcRenderer.removeListener('runs:event-pushed', handler)
  },
  getDroppedFilePath(file: File): string { return webUtils.getPathForFile(file) }
}

contextBridge.exposeInMainWorld('gearmod', Object.freeze(api))
