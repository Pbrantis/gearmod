import React, { useState } from 'react'
import type { DocumentVersion } from '@agentboard/contracts'
import { Markdown } from './markdown'
import { dateLocale, useT } from './i18n'

/** Histórico de versões de um documento no lugar do editor: lista com "Ver" (prévia da versão) e "Restaurar". */
export function DocHistory({ title, versions, restore }: { title: string; versions: DocumentVersion[]; restore(version: DocumentVersion): void }): React.JSX.Element {
  const t = useT().board.docHistory
  const who = (actor: string): string => (actor === 'agent' ? t.agent : actor === 'system' ? t.system : t.you)
  const [viewing, setViewing] = useState<DocumentVersion>()
  if (viewing) return <div className="dochist view">
    <div className="dochist-head"><button type="button" className="mini secondary" onClick={() => setViewing(undefined)}>{t.backToList}</button><b>v{viewing.version}</b><small>{new Date(viewing.createdAt).toLocaleString(dateLocale())} · {who(viewing.actor)}</small><span className="grow1" /><button type="button" className="mini" onClick={() => restore(viewing)}>{t.restoreThis}</button></div>
    <div className="md descarea dochist-body">{viewing.contentMd.trim() ? <Markdown source={viewing.contentMd} /> : <p className="hint">{t.emptyVersion}</p>}</div>
  </div>
  return <div className="dochist">
    <div className="dochist-head"><b>{t.versionsOf(title)}</b><small>{t.savedCount(versions.length)}</small></div>
    <div className="dochist-list">{versions.length === 0 && <p className="hint">{t.noVersions}</p>}{versions.map((version) => <div key={version.id} className="dochist-row"><span className="dv">v{version.version}</span><span className="dm">{new Date(version.createdAt).toLocaleString(dateLocale())} · {who(version.actor)}</span><button type="button" className="mini secondary" onClick={() => setViewing(version)}>{t.view}</button><button type="button" className="mini secondary" onClick={() => restore(version)}>{t.restore}</button></div>)}</div>
  </div>
}
