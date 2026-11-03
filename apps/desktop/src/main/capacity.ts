import { cpus, totalmem } from 'node:os'

/** Memória que uma execução costuma ocupar: o CLI do agente mais o que ele roda na worktree (build, testes). */
const GB_PER_RUN = 3
const MAX_RECOMMENDED = 8

/** Quantos agentes simultâneos esta máquina aguenta: metade dos núcleos e ~3 GB de RAM por execução, entre 1 e 8. */
export function recommendedConcurrency(cores = cpus().length, memoryBytes = totalmem()): number {
  const byMemory = Math.floor(memoryBytes / 1024 ** 3 / GB_PER_RUN), byCpu = Math.floor(cores / 2)
  return Math.max(1, Math.min(byMemory, byCpu, MAX_RECOMMENDED))
}

export const machineInfo = (): { cores: number; memoryGb: number } => ({ cores: cpus().length, memoryGb: Math.round(totalmem() / 1024 ** 3) })
