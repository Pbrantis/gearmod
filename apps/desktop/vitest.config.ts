import { defineConfig } from 'vitest/config'

// Os testes de Git e do SDD criam repositórios reais; com a suíte inteira rodando em paralelo passavam dos 5s padrão.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } })
