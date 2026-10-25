import path from 'node:path'
import matter from 'gray-matter'
import type { Doc, DocSection } from '@shared/domain'

// Ported from qa-portal/server.js (classify + buildIndex) so both apps file documents the same way.
export function classify(relativePath: string): { section: DocSection; group: string } {
  const parts = relativePath.split('/')
  if (parts[0] === 'qa' && parts[1] === 'test-cases') return { section: 'test-cases', group: parts.slice(2, -1).join('/') }
  if (parts[0] === 'qa' && parts[1] === 'regression-assets') {
    return { section: 'assets', group: parts.length > 3 ? (parts[2] ?? '') : '' }
  }
  if (parts[0] === 'qa' && (parts[1] === 'releases' || parts[1] === 'release-runs')) {
    return { section: 'releases', group: parts[1] }
  }
  if (parts[0] === 'qa' && parts[1] === 'test-runs') return { section: 'test-runs', group: parts.length > 3 ? (parts[2] ?? '') : '' }
  return { section: 'guides', group: parts.length > 1 ? parts.slice(0, -1).join('/') : '' }
}

/** Makes YAML values safe to store as JSON and send over IPC (dates become YYYY-MM-DD). */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalizeValue(inner)]))
  }
  return value
}

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string; parsed: boolean } {
  try {
    // An empty options object disables gray-matter's cache, which would otherwise keep every file in memory.
    const parsed = matter(text, {})
    return { frontmatter: normalizeValue(parsed.data) as Record<string, unknown>, body: parsed.content, parsed: true }
  } catch {
    // Malformed YAML (the vault has some double-frontmatter files): show the raw text rather than fail.
    return { frontmatter: {}, body: text, parsed: false }
  }
}

export function analyzeMarkdown(relativePath: string, text: string): Doc {
  const { frontmatter, body, parsed } = splitFrontmatter(text)
  const heading = /^#\s+(.+)$/m.exec(body)
  const checks = body.match(/^\s*[-*] \[[ xX]\]/gm) ?? []
  const done = checks.filter((item) => /\[[xX]\]/.test(item)).length
  const steps = (body.match(/^\|\s*\d+\s*\|/gm) ?? []).length
  const title =
    (typeof frontmatter.title === 'string' && frontmatter.title.trim()) ||
    heading?.[1]?.trim() ||
    path.posix.basename(relativePath, '.md')
  return { path: relativePath, ...classify(relativePath), title, frontmatter, checks: checks.length, done, steps, body, editable: parsed }
}
