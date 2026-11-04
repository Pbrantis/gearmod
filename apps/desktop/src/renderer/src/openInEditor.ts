import { pop } from './popout'

/** Opens the current version (card worktree or repository) of a diff file in the explorer/editor. */
export async function openInEditor(target: { sourceId: string; cardId: string | null; path: string }): Promise<void> {
  const file = await window.gearmod.invoke('git:file-path', target)
  if (pop) await window.gearmod.invoke('windows:open', { kind: 'file', projectId: file.projectId, cardId: target.cardId ?? undefined, path: file.path, placement: 'new' })
  else window.dispatchEvent(new CustomEvent('gearmod:open-file', { detail: { projectId: file.projectId, cardId: target.cardId, path: file.path } }))
}
