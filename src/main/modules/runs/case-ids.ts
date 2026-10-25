/**
 * Allocates `count` new case numbers above every number already in use (workspace test-case files and runs),
 * the same rule qa-portal uses so numbers never collide with published cases.
 */
export function allocateCaseNumbers(count: number, used: ReadonlySet<number>): number[] {
  const start = Math.max(0, ...used) + 1
  return Array.from({ length: count }, (_, index) => start + index)
}

/** Display form used in files and the UI, e.g. 42 → "000042". */
export function formatCaseNumber(caseNo: number | null): string {
  return caseNo === null ? 'new' : String(caseNo).padStart(6, '0')
}
