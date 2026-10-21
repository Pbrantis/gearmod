import React, { useState } from 'react'
import type { AppLanguage, AppSettings, AppTheme, VoiceModel } from '@agentboard/contracts'

export const themes: ReadonlyArray<{ value: AppTheme; label: string; swatches: [string, string, string] }> = [
  { value: 'green', label: 'Verde escuro', swatches: ['#8db99a', '#2f5a40', '#1b2b21'] },
  { value: 'purple', label: 'Roxo escuro', swatches: ['#a99bd9', '#4a3f6e', '#211d30'] },
  { value: 'blue', label: 'Azul escuro', swatches: ['#8fb3d9', '#345273', '#1a2430'] },
  { value: 'orange', label: 'Laranja escuro', swatches: ['#d9a477', '#6b4a33', '#2a2019'] }
]
const voiceOptions: ReadonlyArray<{ value: VoiceModel; label: string }> = [{ value: 'small', label: 'Small (466 MB, rápido)' }, { value: 'large-v3-turbo', label: 'Large v3 Turbo (1,6 GB, mais preciso)' }]
const languages: ReadonlyArray<{ value: AppLanguage; label: string }> = [{ value: 'pt-BR', label: 'Português (Brasil)' }, { value: 'en', label: 'English' }]

export function applySettings(settings: AppSettings): void {
  document.documentElement.dataset.accent = settings.tema
  document.documentElement.lang = settings.idioma
}

export function Appearance({ settings, changed }: { settings: AppSettings; changed(settings: AppSettings): void }): React.JSX.Element {
  const [error, setError] = useState('')
  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    try { setError(''); changed(await window.agentboard.invoke('settings:update', patch)) } catch (reason) { setError(String(reason)) }
  }
  return <section className="appearance">
    <p className="hint">Escolha a cor de destaque do sistema. Só muda a tonalidade; o tema continua escuro.</p>
    <div className="themes">{themes.map((theme) => <button type="button" key={theme.value} className={`themeopt ${settings.tema === theme.value ? 'on' : ''}`} style={{ '--c': theme.swatches[0] } as React.CSSProperties} aria-pressed={settings.tema === theme.value} onClick={() => void save({ tema: theme.value })}><span className="sw3">{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>{theme.label}</button>)}</div>
    <label>Idioma dos agentes<select value={settings.idioma} onChange={(e) => void save({ idioma: e.target.value as AppLanguage })}>{languages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>
    <p className="hint">Tudo o que o agente escreve segue este idioma. A interface continua em português por enquanto.</p>
    <label>Ditado por voz (Whisper local)<select value={settings.voz} onChange={(e) => void save({ voz: e.target.value as VoiceModel })}>{voiceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <p className="hint">O modelo é baixado só quando você usa o microfone do chat pela primeira vez e fica na pasta de dados do AgentBoard.</p>
    {error && <p className="error">{error}</p>}
  </section>
}
