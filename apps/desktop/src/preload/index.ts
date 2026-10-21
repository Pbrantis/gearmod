import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { ipcContracts, type AgentBoardApi, type IpcChannel, type IpcInput, type IpcOutput, type PushedRunEvent } from '@agentboard/contracts'

const allowed = new Set<IpcChannel>(Object.keys(ipcContracts) as IpcChannel[])
const api: AgentBoardApi = {
  async invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
    if (!allowed.has(channel)) throw new Error(`IPC channel is not allowed: ${channel}`)
    return ipcRenderer.invoke(channel, input) as Promise<IpcOutput<C>>
  },
  onRunEvent(listener: (event: PushedRunEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: PushedRunEvent): void => listener(value)
    ipcRenderer.on('runs:event-pushed', handler)
    return () => ipcRenderer.removeListener('runs:event-pushed', handler)
  },
  getDroppedFilePath(file: File): string { return webUtils.getPathForFile(file) }
}

contextBridge.exposeInMainWorld('agentboard', Object.freeze(api))
