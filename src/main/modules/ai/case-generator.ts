import type { ProviderId, Run, TestCase } from '@shared/domain'
import type { AiEvent } from '@shared/ipc'
import { aiCasesSchema, type CaseDraft } from '@shared/schemas'
import { UserError } from '../../errors'
import type { CodebaseService } from '../codebases/codebase-service'
import type { RunService } from '../runs/run-service'
import { executeJob, type JobRegistry } from './jobs'
import { draftCasesPrompt } from './prompts'
import type { ProviderRegistry } from './provider'

/** Extracts and validates the {"cases": [...]} object, tolerating Markdown fences or stray prose around it. */
export function parseAiCases(text: string): CaseDraft[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new UserError('The AI did not return any cases. Try rephrasing the request.')
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new UserError('The AI returned malformed JSON. Try again.')
  }
  const parsed = aiCasesSchema.safeParse(raw)
  if (!parsed.success) throw new UserError('The AI returned cases in an unexpected shape. Try again.')
  return parsed.data.cases.map((item) => ({ ...item, priority: '' as const }))
}

export interface GenerateCasesInput {
  runId: string
  request: string
  codebaseId: string | null
  provider: ProviderId
  jobId: string
}

export function createCaseGenerator(deps: {
  runs: RunService
  codebases: CodebaseService
  providers: ProviderRegistry
  jobs: JobRegistry
  emit: (event: AiEvent) => void
}) {
  return {
    async generate(input: GenerateCasesInput): Promise<{ run: Run; added: TestCase[] }> {
      const run = deps.runs.get(input.runId)
      if (run.status !== 'draft') throw new UserError('AI can only add cases to a draft')
      const codebase = deps.codebases.resolveForAi(input.codebaseId)
      const result = await executeJob({
        jobs: deps.jobs,
        jobId: input.jobId,
        provider: deps.providers[input.provider],
        instruction: '',
        prompt: draftCasesPrompt({ run, request: input.request }, codebase),
        codebase,
        output: 'json',
        emit: deps.emit
      })
      const cases = parseAiCases(result.text)
      if (!cases.length) throw new UserError('The AI could not propose cases from the available information.')
      return deps.runs.addCases(input.runId, cases)
    }
  }
}

export type CaseGenerator = ReturnType<typeof createCaseGenerator>
