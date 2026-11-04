import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@gearmod/contracts'] })],
    // the code index runs in its own utility process (out/main/codeIndexHost.js)
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), codeIndexHost: resolve(__dirname, 'src/main/code-index/host.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@gearmod/contracts', 'zod'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [
      react(),
      {
        // The dev server needs localhost/ws for HMR; the packaged app needs neither.
        name: 'gearmod-production-csp',
        apply: 'build',
        transformIndexHtml: (html) => html.replace(" http://localhost:* ws://localhost:*", '')
      }
    ]
  }
})
