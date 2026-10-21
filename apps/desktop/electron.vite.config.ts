import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@agentboard/contracts'] })] },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@agentboard/contracts', 'zod'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { plugins: [react()] }
})
