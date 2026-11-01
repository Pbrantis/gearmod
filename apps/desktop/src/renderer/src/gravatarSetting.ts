/** Opt-in (Configurações → Geral): sem ele nenhum hash de e-mail sai do app. O valor fica em cache; a tela de configurações o atualiza ao mudar. */
let enabled: Promise<boolean> | null = null
export function setGravatarEnabled(value: boolean): void { enabled = Promise.resolve(value) }
export function gravatarEnabled(): Promise<boolean> {
  enabled ??= window.agentboard.invoke('settings:get', undefined).then((settings) => settings.fotosGravatar).catch(() => false)
  return enabled
}
