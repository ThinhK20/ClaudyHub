import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { DocSection, RunStatus } from '@shared/domain'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function newJobId(): string {
  return crypto.randomUUID()
}

export function caseNumber(caseNo: number | null, position: number): string {
  return caseNo === null ? `#${position + 1}` : String(caseNo).padStart(6, '0')
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60]
]

export function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export const SECTION_LABELS: Record<DocSection, string> = {
  'test-cases': 'Test cases',
  assets: 'Regression checklists',
  releases: 'Releases',
  'test-runs': 'Test run reports',
  guides: 'Guides and wiki'
}

export const SECTION_ORDER: DocSection[] = ['test-cases', 'assets', 'releases', 'test-runs', 'guides']

export const STATUS_LABELS: Record<RunStatus, string> = {
  draft: 'Draft',
  ready: 'Ready to test',
  running: 'Testing',
  completed: 'Completed',
  rejected: 'Rejected'
}

/** Human label for a folder-style group path, e.g. "web-content-management/rich-text" → "Web content management / Rich text". */
export function groupLabel(group: string): string {
  if (!group) return 'General'
  return group
    .split('/')
    .map((part) => part.replace(/[-_]+/g, ' ').replace(/^\w/, (char) => char.toUpperCase()))
    .join(' / ')
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
