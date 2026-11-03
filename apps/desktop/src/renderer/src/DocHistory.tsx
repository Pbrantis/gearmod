import React, { useMemo, useState } from 'react'
import type { DocumentVersion } from '@gearmod/contracts'
import { Markdown } from './markdown'
import { DiffLines } from './gitDiff'
import { unifiedDiff } from './docDiff'
import { dateLocale, useT } from './i18n'

type Mode = 'text' | 'prev' | 'current'

/** Histórico de versões de um documento no lugar do editor: lista com "Ver", "Mudanças" (diff) e "Restaurar"; a última versão é a atual. */
export function DocHistory({ title, versions, restore }: { title: string; versions: DocumentVersion[]; restore(version: DocumentVersion): void }): React.JSX.Element {
  const t = useT().board.docHistory
  const who = (actor: string): string => (actor === 'agent' ? t.agent : actor === 'system' ? t.system : t.you)
  const [viewing, setViewing] = useState<{ version: DocumentVersion; mode: Mode }>()
  const ordered = useMemo(() => [...versions].sort((x, y) => x.version - y.version), [versions])
  const latest = ordered[ordered.length - 1]
  const previousOf = (version: DocumentVersion): DocumentVersion | undefined => ordered[ordered.findIndex((item) => item.id === version.id) - 1]
  const open = (version: DocumentVersion, mode: Mode): void => setViewing({ version, mode })
  if (viewing) {
    const { version, mode } = viewing, isLatest = version.id === latest?.id, previous = previousOf(version)
    const against = mode === 'current' ? latest : previous, diff = mode === 'text' ? '' : unifiedDiff(against?.contentMd ?? '', version.contentMd)
    return <div className="dochist view">
      <div className="dochist-head"><button type="button" className="mini secondary" onClick={() => setViewing(undefined)}>{t.backToList}</button><b>v{version.version}</b>{isLatest && <span className="dv-current">{t.current}</span>}<small>{new Date(version.createdAt).toLocaleString(dateLocale())} · {who(version.actor)}</small><span className="grow1" />{!isLatest && <button type="button" className="mini" onClick={() => restore(version)}>{t.restoreThis}</button>}</div>
      <div className="dochist-modes" role="tablist"><button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'on' : ''} onClick={() => open(version, 'text')}>{t.text}</button>
        <button type="button" role="tab" aria-selected={mode === 'prev'} className={mode === 'prev' ? 'on' : ''} onClick={() => open(version, 'prev')}>{previous ? t.vsPrevious(previous.version) : t.firstVersion}</button>
        {!isLatest && latest && <button type="button" role="tab" aria-selected={mode === 'current'} className={mode === 'current' ? 'on' : ''} onClick={() => open(version, 'current')}>{t.vsCurrent(latest.version)}</button>}</div>
      {mode === 'text' ? <div className="md descarea dochist-body">{version.contentMd.trim() ? <Markdown source={version.contentMd} /> : <p className="hint">{t.emptyVersion}</p>}</div>
        : <div className="dochist-body dochist-diff">{mode === 'current' && latest && <small className="hint">{t.currentDirection(latest.version, version.version)}</small>}{diff ? <DiffLines text={diff} /> : <p className="hint">{t.noChanges}</p>}</div>}
    </div>
  }
  return <div className="dochist">
    <div className="dochist-head"><b>{t.versionsOf(title)}</b><small>{t.savedCount(versions.length)}</small></div>
    <div className="dochist-list">{versions.length === 0 && <p className="hint">{t.noVersions}</p>}{[...ordered].reverse().map((version) => { const isLatest = version.id === latest?.id
      return <div key={version.id} className={`dochist-row ${isLatest ? 'current' : ''}`}><span className="dv">v{version.version}</span>{isLatest && <span className="dv-current">{t.current}</span>}<span className="dm">{new Date(version.createdAt).toLocaleString(dateLocale())} · {who(version.actor)}</span><button type="button" className="mini secondary" onClick={() => open(version, 'text')}>{t.view}</button><button type="button" className="mini secondary" onClick={() => open(version, 'prev')}>{t.changes}</button>{!isLatest && <button type="button" className="mini secondary" onClick={() => restore(version)}>{t.restore}</button>}</div> })}</div>
  </div>
}
