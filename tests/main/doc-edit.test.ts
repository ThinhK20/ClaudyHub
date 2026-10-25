import { describe, expect, it } from 'vitest'
import type { Doc } from '@shared/domain'
import type { AiEvent } from '@shared/ipc'
import { DOC_EDIT_MARKER, cleanAnswer, createDocEditService, docEditPrompt, type DocEditInput } from '../../src/main/modules/ai/doc-edit'
import { createJobRegistry } from '../../src/main/modules/ai/jobs'
import type { AiProvider, AiRunRequest, ProviderRegistry } from '../../src/main/modules/ai/provider'

const FRONTMATTER = { id: '000120', title: 'Reject invalid settings' }

function input(overrides: Partial<DocEditInput> = {}): DocEditInput {
  return {
    jobId: 'job-1',
    provider: 'claude',
    docPath: 'qa/test-cases/settings/Reject invalid settings.md',
    document: '## Summary\n\nInvalid values are refused.\n\n- [ ] Submit works',
    selection: 'Invalid values are refused.',
    inline: false,
    prompt: 'Make it more precise',
    previous: null,
    ...overrides
  }
}

describe('docEditPrompt', () => {
  it('prompt contains the document, the selection and the request', () => {
    const prompt = docEditPrompt(input(), FRONTMATTER)
    expect(prompt).toContain('- [ ] Submit works')
    expect(prompt).toContain('Invalid values are refused.')
    expect(prompt).toContain('Make it more precise')
    expect(prompt).toContain('000120')
  })

  it('prompt asks for inline text when inline is true', () => {
    expect(docEditPrompt(input({ inline: true }), FRONTMATTER)).toMatch(/inline/i)
    expect(docEditPrompt(input({ inline: false }), FRONTMATTER)).not.toMatch(/inline/i)
  })

  it('prompt with no selection asks for content to insert at the cursor', () => {
    const prompt = docEditPrompt(input({ selection: '' }), FRONTMATTER)
    expect(prompt).toMatch(/insert/i)
    expect(prompt).not.toMatch(/replac/i)
  })

  it('follow-up includes the previous proposal', () => {
    const prompt = docEditPrompt(input({ previous: 'OLD PROPOSAL', prompt: 'shorter' }), FRONTMATTER)
    expect(prompt).toContain('OLD PROPOSAL')
    expect(prompt).toContain('shorter')
  })

  it('trims a long document around the selection', () => {
    const filler = Array.from({ length: 7000 }, (_, index) => `line ${String(index).padStart(4, '0')}`).join('\n')
    const document = `${filler}\nTHE SELECTED LINE\nend`
    expect(document.length).toBeGreaterThan(70_000)
    const prompt = docEditPrompt(input({ document, selection: 'THE SELECTED LINE' }), FRONTMATTER)
    expect(prompt.length).toBeLessThan(62_000)
    expect(prompt).toContain('THE SELECTED LINE')
    expect(prompt).toMatch(/trimmed/i)
  })
})

describe('cleanAnswer', () => {
  it('strips one outer markdown fence', () => {
    expect(cleanAnswer('```markdown\n- [ ] a\n```')).toBe('- [ ] a')
    expect(cleanAnswer('```\nplain\n```\n')).toBe('plain')
    const inner = 'Intro\n\n```mermaid\nflowchart LR\n```\n\nOutro'
    expect(cleanAnswer(inner)).toBe(inner)
  })

  it('rejects an empty answer', () => {
    expect(() => cleanAnswer('  \n')).toThrow('The AI returned nothing')
  })
})

describe('createDocEditService', () => {
  it('edit runs the chosen provider without a codebase and emits done', async () => {
    const requests: AiRunRequest[] = []
    const provider: AiProvider = {
      id: 'claude',
      checkAvailability: async () => ({ id: 'claude', ok: true, detail: '' }),
      async run(request) {
        requests.push(request)
        request.onEvent({ kind: 'delta', text: 'partial' })
        return { text: '```md\nBetter text\n```', usage: { elapsedMs: 3 } }
      }
    }
    const events: AiEvent[] = []
    const service = createDocEditService({
      docs: { get: async () => ({ frontmatter: FRONTMATTER }) as unknown as Doc },
      providers: { claude: provider, copilot: provider } as ProviderRegistry,
      jobs: createJobRegistry(),
      emit: (event) => events.push(event)
    })

    const result = await service.edit(input())

    expect(result.text).toBe('Better text')
    expect(requests[0]?.codebase).toBeNull()
    expect(requests[0]?.output).toBe('text')
    expect(requests[0]?.instruction).toContain(DOC_EDIT_MARKER)
    expect(events).toContainEqual(expect.objectContaining({ jobId: 'job-1', kind: 'done' }))
  })
})
