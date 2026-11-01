import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@agentboard/contracts'] })],
    // o índice de código roda num processo utilitário próprio (out/main/codeIndexHost.js)
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), codeIndexHost: resolve(__dirname, 'src/main/code-index/host.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@agentboard/contracts', 'zod'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { plugins: [react()] }
})
