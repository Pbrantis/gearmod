import { defineConfig } from 'vitest/config'

// Os testes de Git e do SDD criam repositórios reais; com a suíte inteira em paralelo (e nas máquinas do CI) passam dos 30s.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } })
