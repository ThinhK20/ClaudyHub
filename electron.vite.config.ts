import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(import.meta.dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preloads must be a single CommonJS file: no ESM, no node_modules requires.
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@': resolve(import.meta.dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
