import React, { useState } from 'react'
import type { DocumentVersion } from '@agentboard/contracts'
import { Markdown } from './markdown'

const who = (actor: string): string => (actor === 'agent' ? 'agente' : actor === 'system' ? 'sistema' : 'você')

/** Histórico de versões de um documento no lugar do editor: lista com "Ver" (prévia da versão) e "Restaurar". */
export function DocHistory({ title, versions, restore }: { title: string; versions: DocumentVersion[]; restore(version: DocumentVersion): void }): React.JSX.Element {
  const [viewing, setViewing] = useState<DocumentVersion>()
  if (viewing) return <div className="dochist view">
    <div className="dochist-head"><button type="button" className="mini secondary" onClick={() => setViewing(undefined)}>← Voltar à lista</button><b>v{viewing.version}</b><small>{new Date(viewing.createdAt).toLocaleString('pt-BR')} · {who(viewing.actor)}</small><span className="grow1" /><button type="button" className="mini" onClick={() => restore(viewing)}>Restaurar esta versão</button></div>
    <div className="md descarea dochist-body">{viewing.contentMd.trim() ? <Markdown source={viewing.contentMd} /> : <p className="hint">Esta versão estava vazia.</p>}</div>
  </div>
  return <div className="dochist">
    <div className="dochist-head"><b>Versões de {title}</b><small>{versions.length} salva{versions.length === 1 ? '' : 's'}</small></div>
    <div className="dochist-list">{versions.length === 0 && <p className="hint">Sem versões salvas ainda.</p>}{versions.map((version) => <div key={version.id} className="dochist-row"><span className="dv">v{version.version}</span><span className="dm">{new Date(version.createdAt).toLocaleString('pt-BR')} · {who(version.actor)}</span><button type="button" className="mini secondary" onClick={() => setViewing(version)}>Ver</button><button type="button" className="mini secondary" onClick={() => restore(version)}>Restaurar</button></div>)}</div>
  </div>
}
