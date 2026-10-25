import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CaseDraft } from '@shared/schemas'
import { openDatabase, type Db } from '../src/main/db/connection'
import type { SecretCipher } from '../src/main/modules/settings/settings-service'

export function memoryDb(): Db {
  return openDatabase(':memory:')
}

export const fakeCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`).toString('base64'),
  decrypt: (encoded) => Buffer.from(encoded, 'base64').toString('utf8').replace(/^enc:/, '')
}

export function tempDir(prefix = 'qa-hub-test-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

/** Writes root-relative files (POSIX paths) under root. */
export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, ...relative.split('/'))
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
}

export function completeCase(overrides: Partial<CaseDraft> = {}): CaseDraft {
  return {
    title: 'Save valid settings',
    summary: 'Saving valid settings persists them.',
    preconditions: ['Signed in as admin'],
    steps: [{ detail: 'Open settings and save', expected: 'A confirmation appears' }],
    previousBehavior: 'Settings were lost on save.',
    expectedBehavior: 'Settings persist after save.',
    priority: '',
    ...overrides
  }
}

export const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
