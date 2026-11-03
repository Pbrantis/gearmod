import React, { useState } from 'react'
import type { SkillEntry, SkillScope } from '@gearmod/contracts'
import { ProviderLogo } from './AgentIcon'
import { tasks } from './backgroundTasks'
import { plainError } from './NoticeDialog'
import { useEscape } from './useEscape'
import { useT } from './i18n'

const providerName = { claude: 'Claude', codex: 'Codex' } as const
const providerMaker = { claude: 'Anthropic', codex: 'OpenAI' } as const
const offered = ['claude', 'codex'] as const
export const skillSlug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)

/**
 * Diálogo de importar skill, usado nas skills globais (Configurações) e nas do projeto.
 * `one`: uma pasta de skill ou um SKILL.md; `folder`: uma pasta com várias skills.
 */
export function ImportSkillDialog({ mode, scope, projectId, close, imported }: {
  mode: 'one' | 'folder'
  scope: SkillScope
  projectId?: string
  close(): void
  imported(skills: SkillEntry[], notice?: string): void
}): React.JSX.Element {
  const t = useT(), ts = t.settings.skills
  const [source, setSource] = useState(''), [name, setName] = useState(''), [origin, setOrigin] = useState<'claude' | 'codex'>('claude'), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEscape(close, !busy)
  const choose = async (): Promise<void> => {
    const picked = await window.gearmod.invoke(mode === 'folder' ? 'skills:choose-folder' : 'skills:choose-source', undefined)
    if (!picked) return
    setSource(picked)
    if (mode === 'one' && !name) setName(skillSlug(picked.replace(/[\\/]SKILL\.md$/i, '').split(/[\\/]/).pop() ?? ''))
  }
  const run = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      await tasks.track({ title: mode === 'folder' ? ts.importFolderTitle : ts.importOneTitle(name), detail: source }, async () => {
        if (mode === 'folder') {
          const result = await window.gearmod.invoke('skills:import-folder', { scope, projectId, folderPath: source, provider: origin })
          imported(result.skills, ts.imported(result.imported.length, result.skipped.length))
        } else imported(await window.gearmod.invoke('skills:import', { scope, projectId, sourcePath: source, name, provider: origin }))
      }).promise
      close()
    } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  return <div className="overlay" role="dialog" aria-label={mode === 'folder' ? ts.folderSkills : ts.oneSkill}><div className="modal impdialog">
    <header><div><div className="eyebrow">{scope === 'project' ? ts.scopeProject : ts.scopeGlobal}</div><h2>{mode === 'folder' ? ts.folderSkills : ts.oneSkill}</h2></div><button type="button" className="x" onClick={close} aria-label={t.common.close}>×</button></header>
    <div className="stack">
      <button type="button" className="filepick" onClick={() => void choose()}>📄 {source || (mode === 'folder' ? ts.chooseFolder : ts.chooseOne)}<small>{source ? ts.selected : ts.clickToChoose}</small></button>
      {mode === 'one' && <label className="f">{t.common.name}<input className="in" value={name} placeholder={ts.namePlaceholder} onChange={(e) => setName(skillSlug(e.target.value))} /></label>}
      <div className="f"><span>{mode === 'folder' ? ts.whichAgentFolder : ts.whichAgentOne}</span><div className="provcards">{offered.map((provider) => <button type="button" key={provider} className={origin === provider ? 'sel' : ''} onClick={() => setOrigin(provider)}><i className={`av lg ${provider}`}><ProviderLogo provider={provider} /></i><span><b>{providerName[provider]}</b><small>{providerMaker[provider]}</small></span></button>)}</div></div>
      {error && <p className="error">{error}</p>}
    </div>
    <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={close}>{t.common.cancel}</button><button type="button" disabled={busy || !source || (mode === 'one' && !name)} onClick={() => void run()}>{ts.import}</button></div>
  </div></div>
}
