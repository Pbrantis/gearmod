import type { AgentBoardApi } from '@agentboard/contracts'

declare global {
  interface Window { agentboard: AgentBoardApi }
}

export {}
