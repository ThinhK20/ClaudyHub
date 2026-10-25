import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/main/modules/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/modules/**/watcher.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 }
    }
  }
})
