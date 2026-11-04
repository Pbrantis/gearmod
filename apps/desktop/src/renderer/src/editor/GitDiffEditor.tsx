import React, { useEffect, useMemo, useState } from 'react'
import { plainError } from '../NoticeDialog'
import { DiffEditor } from './DiffEditor'
import { usePreferences } from './preferences'
import { useT } from '../i18n'

type Versions = { before: string | null; after: string | null; binary: boolean; truncated: boolean }

/**
 * Diff of a Git file (unstaged, staged or from a commit) in the `DiffEditor`, read-only. `auto` shows the unstaged one and, if there is none,
 * the staged one. Binary or too large falls back to the text diff from `git:diff`/`git:commit-diff`.
 */
export function GitDiffEditor({ sourceId, cardId, path, hash, mode = 'auto', review, reloadKey = 0 }: {
  sourceId: string; cardId: string | null; path: string; hash?: string | undefined; mode?: 'auto' | 'unstaged' | 'staged'; review?: { path: string; send(prompt: string): boolean | Promise<boolean> } | undefined; reloadKey?: number
}): React.JSX.Element {
  const t = useT().git.editor
  const [preferences, change] = usePreferences(), [data, setData] = useState<{ versions: Versions; text: string }>(), [error, setError] = useState('')
  const options = useMemo(() => ({ wrap: preferences.wrap, tabSize: preferences.tabSize, indentWithTab: preferences.indent, whitespace: preferences.whitespace, guides: preferences.guides, scrollPastEnd: preferences.beyond }), [preferences.wrap, preferences.tabSize, preferences.indent, preferences.whitespace, preferences.guides, preferences.beyond])
  useEffect(() => {
    let alive = true; setData(undefined); setError('')
    const fetchVersions = (kind: 'unstaged' | 'staged' | 'commit'): Promise<Versions> => window.gearmod.invoke('git:file-versions', { sourceId, cardId, path, mode: kind, ...(hash ? { hash } : {}) })
    const fallback = (versions: Versions, staged: boolean): Promise<string> => versions.binary || versions.truncated ? (hash ? window.gearmod.invoke('git:commit-diff', { sourceId, hash, path }) : window.gearmod.invoke('git:diff', { sourceId, cardId, path, staged })) : Promise.resolve('')
    void (async () => {
      if (hash) { const versions = await fetchVersions('commit'); return { versions, text: await fallback(versions, false) } }
      let versions = await fetchVersions(mode === 'staged' ? 'staged' : 'unstaged'), staged = mode === 'staged'
      if (mode === 'auto' && !versions.binary && !versions.truncated && versions.before === versions.after) { versions = await fetchVersions('staged'); staged = true }
      return { versions, text: await fallback(versions, staged) }
    })().then((result) => { if (alive) setData(result) }).catch((reason: unknown) => { if (alive) setError(plainError(reason)) })
    return () => { alive = false }
  }, [sourceId, cardId, path, hash, mode, reloadKey])
  if (error) return <p className="fv-note err">{error}</p>
  if (!data) return <p className="fv-note"><span className="spin sm" /> {t.opening}</p>
  const { versions } = data
  if (!versions.binary && !versions.truncated && versions.before === versions.after) return <p className="fv-note">{t.noDifferences}</p>
  return <div className="wf-diffview"><DiffEditor key={`${sourceId}:${path}:${hash ?? mode}:${reloadKey}`} before={versions.before} after={versions.after} path={path} layout={preferences.diffLayout} editable={false} options={options} onToggleLayout={() => change({ diffLayout: preferences.diffLayout === 'split' ? 'unified' : 'split' })} fallbackDiff={data.text} {...(versions.binary ? { unavailable: 'binary' as const } : versions.truncated ? { unavailable: 'truncated' as const } : {})} {...(review ? { review } : {})} /></div>
}
