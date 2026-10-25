import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, Run } from '@shared/domain'
import type { AiEvent } from '@shared/ipc'
import { createCaseGenerator, parseAiCases } from '../../src/main/modules/ai/case-generator'
import { createChatService, type ChatService } from '../../src/main/modules/ai/chat-service'
import { createJobRegistry, type JobRegistry } from '../../src/main/modules/ai/jobs'
import { askPrompt, assistantPrompt, clip, draftCasesPrompt } from '../../src/main/modules/ai/prompts'
import type { AiProvider, AiRunRequest, ProviderRegistry } from '../../src/main/modules/ai/provider'
import { createStubProvider } from '../../src/main/modules/ai/stub-provider'
import { createCodebaseService, type CodebaseService } from '../../src/main/modules/codebases/codebase-service'
import { createRunService, type RunService } from '../../src/main/modules/runs/run-service'
import { completeCase, memoryDb, tempDir } from '../helpers'

/** Provider whose answers are scripted per test; records every request it receives. */
function scriptedProvider(answer: (req: AiRunRequest) => Promise<string>): AiProvider & { requests: AiRunRequest[] } {
  const requests: AiRunRequest[] = []
  return {
    id: 'copilot',
    requests,
    checkAvailability: async () => ({ id: 'copilot', ok: true, detail: '' }),
    async run(req) {
      requests.push(req)
      req.onEvent({ kind: 'delta', text: 'partial' })
      return { text: await answer(req), usage: { elapsedMs: 5 } }
    }
  }
}

let root: string
let runs: RunService
let codebases: CodebaseService
let jobs: JobRegistry
let events: AiEvent[]
let db: ReturnType<typeof memoryDb>

beforeEach(async () => {
  root = await tempDir()
  db = memoryDb()
  runs = createRunService(db, { workspaceCaseIds: () => new Set(), activeWorkspaceId: () => null, defaultCodebaseId: () => null })
  codebases = createCodebaseService(db, async () => ({ isGitRepo: false, branch: null, head: null }))
  jobs = createJobRegistry()
  events = []
})
afterEach(() => rm(root, { recursive: true, force: true }))

const chatWith = (provider: AiProvider): ChatService =>
  createChatService({
    db,
    runs,
    codebases,
    providers: { copilot: provider, claude: provider } as ProviderRegistry,
    jobs,
    emit: (event) => events.push(event)
  })

const runningRun = (): Run => {
  const run = runs.create({ title: 'Chat run', analysis: 'Fixes saving' })
  runs.saveCases(run.id, [completeCase()])
  runs.transition(run.id, 'approve')
  return runs.transition(run.id, 'start')
}

describe('chat service', () => {
  it('answers with the selected codebase and keeps history', async () => {
    const codeDir = path.join(root, 'app')
    await mkdir(codeDir)
    const codebase = await codebases.add({ path: codeDir, name: 'App' })
    const provider = scriptedProvider(async () => 'It saves to disk.')
    const chat = chatWith(provider)
    const run = runs.create({ title: 'Draft run' })

    const answer = await chat.send({ runId: run.id, thread: 'ask', caseId: null, question: 'Where?', codebaseId: codebase.id, provider: 'copilot', jobId: 'j1' })
    expect(answer).toMatchObject({ role: 'assistant', status: 'done', text: 'It saves to disk.', codebaseId: codebase.id })
    expect(provider.requests[0]!.codebase).toEqual({ id: codebase.id, name: 'App', path: codeDir })
    expect(provider.requests[0]!.prompt).toContain(`the codebase "App" is available at ${codeDir}`)
    expect(events).toEqual([
      { jobId: 'j1', kind: 'delta', text: 'partial' },
      { jobId: 'j1', kind: 'done', usage: { elapsedMs: 5 } }
    ])

    await chat.send({ runId: run.id, thread: 'ask', caseId: null, question: 'Follow-up', codebaseId: null, provider: 'copilot', jobId: 'j2' })
    expect(provider.requests[1]!.codebase).toBeNull()
    expect(provider.requests[1]!.prompt).toContain('### QA\nWhere?')
    expect(chat.history(run.id, 'ask').map((message: ChatMessage) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    chat.clear(run.id, 'ask')
    expect(chat.history(run.id, 'ask')).toEqual([])
  })

  it('limits the Test Assistant to running windows and their cases', async () => {
    const chat = chatWith(scriptedProvider(async () => 'ok'))
    const draft = runs.create({ title: 'Draft' })
    await expect(
      chat.send({ runId: draft.id, thread: 'assistant', caseId: null, question: 'q', codebaseId: null, provider: 'copilot', jobId: 'j' })
    ).rejects.toThrow('while the test window is running')
    const run = runningRun()
    await expect(
      chat.send({ runId: run.id, thread: 'assistant', caseId: 'nope', question: 'q', codebaseId: null, provider: 'copilot', jobId: 'j' })
    ).rejects.toThrow('Case not found')
    const answer = await chat.send({ runId: run.id, thread: 'assistant', caseId: run.cases[0]!.id, question: 'q', codebaseId: null, provider: 'copilot', jobId: 'j' })
    expect(answer.caseId).toBe(run.cases[0]!.id)
  })

  it('allows one question per thread at a time and supports cancellation', async () => {
    let release: () => void = () => {}
    const provider = scriptedProvider(
      (req) =>
        new Promise((resolve, reject) => {
          release = () => resolve('late')
          req.signal.addEventListener('abort', () => reject(new Error('Cancelled')))
        })
    )
    const chat = chatWith(provider)
    const run = runs.create({ title: 'Busy' })
    const first = chat.send({ runId: run.id, thread: 'ask', caseId: null, question: 'one', codebaseId: null, provider: 'copilot', jobId: 'busy' })
    await expect(
      chat.send({ runId: run.id, thread: 'ask', caseId: null, question: 'two', codebaseId: null, provider: 'copilot', jobId: 'other' })
    ).rejects.toThrow('Wait for the current answer')
    expect(() => chat.clear(run.id, 'ask')).toThrow('Wait for the current answer')
    expect(jobs.cancel('busy')).toBe(true)
    expect((await first).status).toBe('cancelled')
    expect(jobs.cancel('busy')).toBe(false)
    release()
  })

  it('stores provider errors on the answer', async () => {
    const chat = chatWith(scriptedProvider(async () => Promise.reject(new Error('quota exceeded'))))
    const run = runs.create({ title: 'Errors' })
    const answer = await chat.send({ runId: run.id, thread: 'ask', caseId: null, question: 'q', codebaseId: null, provider: 'claude', jobId: 'e' })
    expect(answer).toMatchObject({ status: 'error', text: 'quota exceeded' })
  })

  it('marks answers left pending by a previous session as interrupted', () => {
    const run = runs.create({ title: 'Crash' })
    db.prepare(
      "INSERT INTO chat_messages (id, run_id, thread, role, text, status, created_at) VALUES ('m1', ?, 'ask', 'assistant', '', 'pending', '2026-01-01')"
    ).run(run.id)
    const chat = chatWith(createStubProvider('copilot'))
    expect(chat.markInterrupted()).toBe(1)
    expect(chat.history(run.id, 'ask')[0]!.status).toBe('interrupted')
  })
})

describe('case generator', () => {
  it('parses fenced JSON and validates the shape', () => {
    const fenced = '```json\n{"cases":[{"title":"T","summary":"S","expectedBehavior":"E","preconditions":["P"],"steps":[{"detail":"D","expected":"X"}]}]}\n```'
    expect(parseAiCases(fenced)).toEqual([
      { title: 'T', summary: 'S', previousBehavior: '', expectedBehavior: 'E', preconditions: ['P'], steps: [{ detail: 'D', expected: 'X' }], priority: '' }
    ])
    expect(parseAiCases('{"cases":[]}')).toEqual([])
    expect(() => parseAiCases('no json here')).toThrow('did not return any cases')
    expect(() => parseAiCases('{"cases": [}')).toThrow('malformed JSON')
    expect(() => parseAiCases('{"cases":[{"title":""}]}')).toThrow('unexpected shape')
  })

  it('adds AI cases to a draft only', async () => {
    const generator = createCaseGenerator({
      runs,
      codebases,
      providers: { copilot: createStubProvider('copilot'), claude: createStubProvider('claude') },
      jobs,
      emit: (event) => events.push(event)
    })
    const run = runs.create({ title: 'Generate' })
    const { added, run: updated } = await generator.generate({ runId: run.id, request: 'edge cases', codebaseId: null, provider: 'claude', jobId: 'g' })
    expect(added.map((item) => item.title)).toEqual(['Stub generated case'])
    expect(updated.cases).toHaveLength(1)

    const empty = createCaseGenerator({
      runs,
      codebases,
      providers: { copilot: scriptedProvider(async () => '{"cases":[]}'), claude: createStubProvider('claude') },
      jobs,
      emit: () => {}
    })
    await expect(empty.generate({ runId: run.id, request: 'x', codebaseId: null, provider: 'copilot', jobId: 'g2' })).rejects.toThrow('could not propose')

    const started = runningRun()
    await expect(generator.generate({ runId: started.id, request: 'x', codebaseId: null, provider: 'claude', jobId: 'g3' })).rejects.toThrow('only add cases to a draft')
  })
})

describe('prompts', () => {
  it('clips long text', () => {
    expect(clip('abcdef', 3)).toBe('abc\n…[truncated]')
    expect(clip('ab', 3)).toBe('ab')
  })

  it('explains when no codebase is connected', () => {
    const run = runningRun()
    expect(askPrompt({ run, history: [], question: 'Why?' }, null)).toContain('You cannot see any codebase')
    const final = assistantPrompt({ run, caseId: null, history: [], question: 'Summary?' }, null)
    expect(final).toContain('Final summary')
    expect(final).toContain('Progress: 0 of 1')
    const selected = assistantPrompt({ run, caseId: run.cases[0]!.id, history: [], question: 'q' }, { id: 'c', name: 'App', path: '/app' })
    expect(selected).toContain('### Case ')
    expect(selected).toContain('may not match the build under test')
  })

  it('includes existing cases and the request when drafting', () => {
    const run = runs.create({ title: 'Draft', analysis: 'A'.repeat(20) })
    runs.saveCases(run.id, [completeCase({ title: 'Existing one' })])
    const prompt = draftCasesPrompt({ run: runs.get(run.id), request: 'more negatives' }, { id: 'c', name: 'App', path: '/app' })
    expect(prompt).toContain('"title":"Existing one"')
    expect(prompt).toContain('more negatives')
    expect(prompt).toContain('The codebase "App" is available at /app (read-only). Search it only')
    expect(draftCasesPrompt({ run: runs.get(run.id), request: 'x' }, null)).toContain('No codebase is connected')
  })
})
