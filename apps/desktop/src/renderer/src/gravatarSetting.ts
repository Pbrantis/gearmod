/** Opt-in (Settings → General): without it no email hash leaves the app. The value is cached; the settings screen updates it when it changes. */
let enabled: Promise<boolean> | null = null
export function setGravatarEnabled(value: boolean): void { enabled = Promise.resolve(value) }
export function gravatarEnabled(): Promise<boolean> {
  enabled ??= window.gearmod.invoke('settings:get', undefined).then((settings) => settings.fotosGravatar).catch(() => false)
  return enabled
}
