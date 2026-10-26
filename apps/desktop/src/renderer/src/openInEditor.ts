import { pop } from './popout'

/** Abre a versão atual (worktree do card ou repositório) de um arquivo do diff no explorador/editor. */
export async function openInEditor(target: { sourceId: string; cardId: string | null; path: string }): Promise<void> {
  const file = await window.agentboard.invoke('git:file-path', target)
  if (pop) await window.agentboard.invoke('windows:open', { kind: 'file', projectId: file.projectId, cardId: target.cardId ?? undefined, path: file.path, placement: 'new' })
  else window.dispatchEvent(new CustomEvent('agentboard:open-file', { detail: { projectId: file.projectId, cardId: target.cardId, path: file.path } }))
}
