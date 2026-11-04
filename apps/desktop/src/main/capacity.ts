import { cpus, totalmem } from 'node:os'

/** Memory a run usually takes: the agent CLI plus what it runs in the worktree (build, tests). */
const GB_PER_RUN = 3
const MAX_RECOMMENDED = 8

/** How many simultaneous agents this machine can handle: half the cores and ~3 GB of RAM per run, between 1 and 8. */
export function recommendedConcurrency(cores = cpus().length, memoryBytes = totalmem()): number {
  const byMemory = Math.floor(memoryBytes / 1024 ** 3 / GB_PER_RUN), byCpu = Math.floor(cores / 2)
  return Math.max(1, Math.min(byMemory, byCpu, MAX_RECOMMENDED))
}

export const machineInfo = (): { cores: number; memoryGb: number } => ({ cores: cpus().length, memoryGb: Math.round(totalmem() / 1024 ** 3) })
