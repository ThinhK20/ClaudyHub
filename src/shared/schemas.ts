import { z } from 'zod'

// Limits carried over from qa-portal (qa-runs.js) so data moves between the two apps unchanged.
export const LIMITS = {
  maxCases: 40,
  docBody: 2_000_000,
  maxSteps: 40,
  maxPreconditions: 30,
  title: 300,
  text: 12000,
  precondition: 1000,
  step: 3000,
  analysis: 30000,
  coverageNote: 12000,
  evidenceLinks: 10,
  evidenceLabel: 200,
  question: 4000,
  aiPrompt: 4000,
  aiSelection: 60000,
  aiAddedCases: 5,
  runTitle: 500
} as const

export const providerIdSchema = z.enum(['copilot', 'claude'])
export const idSchema = z.string().min(1).max(100)
export const threadSchema = z.enum(['ask', 'assistant'])

export const caseStepSchema = z.object({
  detail: z.string().max(LIMITS.step),
  expected: z.string().max(LIMITS.step)
})

/** A case as edited in a draft. Incomplete values are allowed; approval enforces completeness. */
export const caseDraftSchema = z.object({
  id: idSchema.optional(),
  title: z.string().max(LIMITS.title),
  summary: z.string().max(LIMITS.text),
  preconditions: z.array(z.string().max(LIMITS.precondition)).max(LIMITS.maxPreconditions),
  steps: z.array(caseStepSchema).max(LIMITS.maxSteps),
  previousBehavior: z.string().max(LIMITS.text),
  expectedBehavior: z.string().max(LIMITS.text),
  priority: z.enum(['', 'high'])
})
export type CaseDraft = z.infer<typeof caseDraftSchema>

export const evidenceLinkSchema = z.object({
  url: z
    .string()
    .max(2000)
    .refine((value) => /^https?:\/\//i.test(value.trim()), 'Evidence links must be http(s) URLs'),
  label: z.string().max(LIMITS.evidenceLabel)
})

/** Exact JSON shape the AI must return when asked to add cases. */
export const aiCasesSchema = z.object({
  cases: z
    .array(
      z.object({
        title: z.string().min(1).max(LIMITS.title),
        summary: z.string().min(1).max(LIMITS.text),
        previousBehavior: z.string().max(LIMITS.text).default(''),
        expectedBehavior: z.string().min(1).max(LIMITS.text),
        preconditions: z.array(z.string().min(1).max(LIMITS.precondition)).max(LIMITS.maxPreconditions),
        steps: z
          .array(z.object({ detail: z.string().min(1).max(LIMITS.step), expected: z.string().min(1).max(LIMITS.step) }))
          .min(1)
          .max(LIMITS.maxSteps)
      })
    )
    .max(LIMITS.aiAddedCases)
})
export type AiCases = z.infer<typeof aiCasesSchema>
