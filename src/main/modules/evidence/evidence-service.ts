import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Attachment, Run } from '@shared/domain'
import { UserError } from '../../errors'
import type { RunRepo } from '../runs/run-repo'
import { newId } from '../util'

// Limits and magic-byte signatures ported from qa-portal (qa-runs.js EVIDENCE_TYPES).
export const MAX_EVIDENCE_BYTES = 32 * 1024 * 1024
export const MAX_CASE_FILES = 20
export const MAX_RUN_FILES = 50

const startsWith = (data: Uint8Array, bytes: number[]): boolean => bytes.every((byte, index) => data[index] === byte)
const ascii = (data: Uint8Array, start: number, end: number): string => Buffer.from(data.subarray(start, end)).toString('ascii')

interface EvidenceType {
  extensions: readonly string[]
  signature: (data: Uint8Array) => boolean
}

export const EVIDENCE_TYPES: Record<string, EvidenceType> = {
  'image/png': { extensions: ['.png'], signature: (d) => d.length >= 8 && startsWith(d, [137, 80, 78, 71, 13, 10, 26, 10]) },
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], signature: (d) => d.length >= 3 && startsWith(d, [255, 216, 255]) },
  'image/gif': { extensions: ['.gif'], signature: (d) => d.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(d, 0, 6)) },
  'image/webp': { extensions: ['.webp'], signature: (d) => d.length >= 12 && ascii(d, 0, 4) === 'RIFF' && ascii(d, 8, 12) === 'WEBP' },
  'video/mp4': { extensions: ['.mp4'], signature: (d) => d.length >= 12 && ascii(d, 4, 8) === 'ftyp' },
  'video/quicktime': { extensions: ['.mov'], signature: (d) => d.length >= 12 && ascii(d, 4, 8) === 'ftyp' },
  'video/webm': { extensions: ['.webm'], signature: (d) => d.length >= 4 && startsWith(d, [0x1a, 0x45, 0xdf, 0xa3]) }
}

/** Picks the media type from the file extension and confirms the content really is that type. */
export function detectEvidenceType(name: string, data: Uint8Array): { mime: string; extension: string } {
  const extension = path.extname(name).toLowerCase()
  const entry = Object.entries(EVIDENCE_TYPES).find(([, type]) => type.extensions.includes(extension))
  if (!entry) throw new UserError('Attach PNG, JPEG, GIF, WebP, MP4, WebM or MOV files')
  const [mime, type] = entry
  if (!type.signature(data)) throw new UserError(`${name} is not a valid ${extension.slice(1).toUpperCase()} file`)
  return { mime, extension: type.extensions[0] as string }
}

export interface EvidenceService {
  add(input: { runId: string; caseId: string; name: string; bytes: Uint8Array }): Promise<Attachment>
  remove(runId: string, caseId: string, attachmentId: string): Promise<void>
  /** Absolute path of a stored file, or null. Used by the qa-evidence:// protocol. */
  filePath(runId: string, attachmentId: string): string | null
  removeFiles(runId: string, attachmentIds: readonly string[]): Promise<void>
  removeRunFolder(runId: string): Promise<void>
}

/** Stores evidence files under root/<runId>/<attachmentId><ext>; metadata lives in the attachments table. */
export function createEvidenceService(root: string, repo: RunRepo, getRun: (id: string) => Run): EvidenceService {
  const runFolder = (runId: string): string => path.join(root, runId)
  const storagePath = (runId: string, storageKey: string): string => path.join(runFolder(runId), path.basename(storageKey))

  return {
    async add({ runId, caseId, name, bytes }) {
      const run = getRun(runId)
      if (run.status !== 'running') throw new UserError('Evidence can only be attached while the test window is running')
      if (!run.cases.some((item) => item.id === caseId)) throw new UserError('Case not found in this run')
      if (bytes.length === 0) throw new UserError('The file is empty')
      if (bytes.length > MAX_EVIDENCE_BYTES) throw new UserError('Each file must be 32 MB or smaller')
      if (repo.countAttachments(runId, caseId) >= MAX_CASE_FILES) throw new UserError(`A case can have at most ${MAX_CASE_FILES} files`)
      if (repo.countAttachments(runId) >= MAX_RUN_FILES) throw new UserError(`A run can have at most ${MAX_RUN_FILES} files`)
      const { mime, extension } = detectEvidenceType(name, bytes)
      const id = newId()
      const storageKey = `${id}${extension}`
      await mkdir(runFolder(runId), { recursive: true })
      await writeFile(storagePath(runId, storageKey), bytes, { flag: 'wx' })
      const safeName = path.basename(name).slice(0, 255)
      return repo.insertAttachment({ id, caseId, runId, name: safeName, mime, size: bytes.length, storageKey })
    },

    async remove(runId, caseId, attachmentId) {
      const run = getRun(runId)
      if (run.status !== 'running') throw new UserError('Evidence can only be removed while the test window is running')
      const attachment = repo.findAttachment(runId, attachmentId)
      if (!attachment || attachment.caseId !== caseId) throw new UserError('Attachment not found')
      repo.deleteAttachment(runId, attachmentId)
      await rm(storagePath(runId, attachment.storageKey), { force: true })
    },

    filePath(runId, attachmentId) {
      const attachment = repo.findAttachment(runId, attachmentId)
      if (!attachment) return null
      const file = storagePath(runId, attachment.storageKey)
      return existsSync(file) ? file : null
    },

    async removeFiles(runId, attachmentIds) {
      const folder = runFolder(runId)
      if (!existsSync(folder)) return
      const names = await readdir(folder)
      await Promise.all(
        names
          .filter((file) => attachmentIds.some((id) => file.startsWith(id)))
          .map((file) => rm(path.join(folder, file), { force: true }))
      )
    },

    async removeRunFolder(runId) {
      await rm(runFolder(runId), { recursive: true, force: true, maxRetries: 3 })
    }
  }
}
