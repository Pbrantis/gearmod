import type { AppLanguage } from '@gearmod/contracts'
import { ptBR } from './pt-BR'
import { en } from './en'

/** Textos que o processo principal mostra ao usuário (bandeja, notificações, diálogos, erros). Prompts para agentes NÃO entram aqui. */
export type MainMessages = typeof ptBR

const dictionaries: Record<AppLanguage, MainMessages> = { 'pt-BR': ptBR, en }
let locale: AppLanguage = 'pt-BR'
const listeners = new Set<(locale: AppLanguage) => void>()

/** Chamado na inicialização e quando `idioma` muda. */
export function setMainLocale(next: AppLanguage): void {
  if (next === locale) return
  locale = next
  for (const listener of listeners) listener(next)
}

export const getMainLocale = (): AppLanguage => locale

/** Para refazer o que já foi montado com texto (ex.: menu da bandeja). */
export function onMainLocaleChange(listener: (locale: AppLanguage) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Textos no idioma atual. Chame na hora de usar (ex.: ao lançar o erro), nunca no topo do módulo. */
export const tm = (): MainMessages => dictionaries[locale]
