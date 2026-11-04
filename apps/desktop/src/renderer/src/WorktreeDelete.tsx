import React, { useEffect, useState } from 'react'
import type { GitWorktreeInfo } from '@gearmod/contracts'
import { Checkbox } from './Checkbox'
import { ConfirmDialog } from './ConfirmDialog'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'
import { toast } from './toasts'


/**
 * Confirmation to delete a card's worktree (all its folders). Shows the card, what would be lost (unpushed commits and uncommitted files)
 * and lets you choose whether the local branch goes too: with unpushed commits it is marked to be kept.
 */
export function WorktreeDeleteDialog({ projectId, cardId, sourceId, close, done }: { projectId?: string; cardId: string; sourceId?: string; close(): void; done(): void }): React.JSX.Element | null {
  const t = useT().git.worktreeDelete
  const [info, setInfo] = useState<GitWorktreeInfo>(), [deleteBranch, setDeleteBranch] = useState<boolean>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    void window.gearmod.invoke('git:worktree-info', { projectId, cardId, sourceId }).then((value) => { if (!alive) return; setInfo(value) }, (reason) => { if (alive) { toast.error(t.failed, plainError(reason)); close() } })
    return () => { alive = false }
  }, [projectId, cardId, sourceId])
  if (!info) return null
  const unpushed = info.repos.reduce((sum, repo) => sum + repo.unpushed, 0), files = info.repos.reduce((sum, repo) => sum + repo.files, 0), risky = unpushed > 0 || files > 0
  // With no loose commits the branch goes along by default; with unpushed commits it stays, unless the person checks it.
  const withBranch = deleteBranch ?? unpushed === 0
  const lossLines = info.repos.filter((repo) => repo.unpushed > 0 || repo.files > 0)
  const confirm = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const out = await window.gearmod.invoke('git:worktree-delete', { projectId, cardId, sourceId, deleteBranch: withBranch })
      if (out.keptBranches.length) toast.warning(t.done, t.keptBranches(out.keptBranches)); else toast.success(t.done, out.output)
      done()
    } catch (reason) { setError(plainError(reason)); setBusy(false) }
  }
  const box = (tone: 'danger' | 'ok'): React.CSSProperties => ({ margin: '0 0 12px', padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5, border: `1px solid color-mix(in srgb, var(${tone === 'danger' ? '--danger' : '--border'}) 70%, transparent)`, background: tone === 'danger' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : 'color-mix(in srgb, var(--muted) 10%, transparent)' })
  const extra = <div>
    <div style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--muted) 10%, transparent)', fontSize: 13 }}><b>{info.title}</b><div style={{ color: 'var(--muted)', fontSize: 12 }}>{info.branch}{info.repos.length > 1 ? ` · ${t.repos(info.repos.length)}` : sourceId && info.repos[0] ? ` · ${info.repos[0].name}` : ''}</div></div>
    {info.sharedWith.length > 0 && <div style={box('ok')}>{t.sharedWith(info.sharedWith)}</div>}
    {risky ? <div style={box('danger')} role="alert"><b style={{ color: 'var(--danger)' }}>{t.lossTitle}</b>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {lossLines.map((repo) => <li key={repo.name}>{info.repos.length > 1 && <b>{repo.name}: </b>}{[repo.unpushed > 0 && t.unpushed(repo.unpushed), repo.files > 0 && t.uncommitted(repo.files)].filter(Boolean).join(' · ')}</li>)}
      </ul>
      {files > 0 && <div style={{ marginTop: 6 }}>{t.uncommittedLost}</div>}
      {unpushed > 0 && <div style={{ marginTop: 6 }}>{withBranch ? t.unpushedLost : t.unpushedKept}</div>}</div>
      : <div style={box('ok')}>{t.nothingLost}</div>}
    <label className="f" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 12px', fontSize: 13 }}><Checkbox checked={withBranch} onChange={setDeleteBranch} label={t.alsoBranch} /><span>{t.alsoBranchText(info.branch)}</span></label>
    {error && <p className="error" role="alert">{error}</p>}
  </div>
  return <ConfirmDialog eyebrow={t.eyebrow} title={sourceId ? t.titleOne(info.title, info.repos[0]?.name ?? '') : t.title(info.title)} text={t.text} ok={busy ? t.deleting : t.ok} danger okDisabled={busy} cancel={close} confirm={() => void confirm()} extra={extra} />
}
