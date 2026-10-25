import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowUp, RotateCw, Sparkles, Square, X } from 'lucide-react'
import type { AiUsage, ProviderId } from '@shared/domain'
import { diffLines } from '@shared/line-diff'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { call } from '@/lib/ipc'
import { useAiJob } from '@/lib/use-ai-job'
import { cn, errorText } from '@/lib/utils'
import type { CapturedSelection } from './apply-proposal'
import type { AiRequest } from './shortcuts'
import type { AiEngine } from './use-ai-engine'
import { useDragOffset } from './use-drag-offset'

const PANEL_WIDTH = 520
const PANEL_GAP = 8
const VIEWPORT_MARGIN = 16
/** Room the panel needs below the selection before it opens above it instead. */
const PANEL_ROOM = 440

interface AiPanelProps {
  editor: Editor
  docPath: string
  engine: AiEngine
  request: AiRequest
  selection: CapturedSelection
  onApply: (markdown: string, mode: 'insert' | 'replace') => void
  onClose: () => void
}

interface Proposal {
  text: string
  usage: AiUsage | null
  provider: ProviderId
}

interface RunInput {
  prompt: string
  previous: string | null
}

/** Centered for a whole-document request; otherwise below the selection when there is room, else above it; always inside the window. */
function panelPosition(editor: Editor, selection: CapturedSelection): React.CSSProperties {
  if (selection.wholeDocument) return { left: '50%', top: '50%' }
  const start = editor.view.coordsAtPos(Math.min(selection.from, editor.state.doc.content.size))
  const end = editor.view.coordsAtPos(Math.min(selection.to, editor.state.doc.content.size))
  const left = Math.max(VIEWPORT_MARGIN, Math.min(start.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN))
  if (end.bottom + PANEL_ROOM < window.innerHeight) return { left, top: end.bottom + PANEL_GAP }
  return { left, bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - start.top + PANEL_GAP) }
}

function usageLabel(proposal: Proposal, engine: AiEngine): string {
  const name = proposal.usage?.model ?? engine.label(proposal.provider)
  const tokens = (proposal.usage?.inputTokens ?? 0) + (proposal.usage?.outputTokens ?? 0)
  if (tokens > 0) return `${name} · ${tokens.toLocaleString()} tokens`
  return proposal.usage?.elapsedMs ? `${name} · ${(proposal.usage.elapsedMs / 1000).toFixed(1)}s` : name
}

function ChangesView({ before, after }: { before: string; after: string }): React.JSX.Element {
  return (
    <div className="font-mono text-[12px] leading-5">
      {diffLines(before, after).map((line, index) => (
        <div
          key={index}
          className={cn(
            'whitespace-pre-wrap px-2',
            line.kind === 'added' && 'bg-pass/10 text-pass',
            line.kind === 'removed' && 'bg-fail/10 text-fail line-through'
          )}
        >
          {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
          {line.text || ' '}
        </div>
      ))}
    </div>
  )
}

const SKELETON_WIDTHS = ['92%', '78%', '85%', '54%']

/** Shown while the AI works: what it is doing, for how long, then the answer as it streams in. */
function AiProgress({ status, streamed }: { status: string; streamed: string }): React.JSX.Element {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex min-h-0 flex-col gap-2 rounded-md border border-line p-3" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Sparkles className="size-3.5 text-accent motion-safe:animate-pulse" aria-hidden />
        <span className="truncate">{status || 'Thinking…'}</span>
        <span className="ml-auto tabular-nums text-faint">{seconds}s</span>
      </div>
      {streamed ? (
        <div className="max-h-56 overflow-auto text-[12.5px] whitespace-pre-wrap text-ink">{streamed}</div>
      ) : (
        <div className="flex flex-col gap-2 py-1" aria-hidden>
          {SKELETON_WIDTHS.map((width, index) => (
            <div
              key={width}
              className="h-2.5 rounded-full bg-sunken motion-safe:animate-pulse"
              style={{ width, animationDelay: `${index * 150}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Floating AI assistant: asks for a change, shows the proposal, and applies it only when the user chooses to. */
export function AiPanel({ editor, docPath, engine, request, selection, onApply, onClose }: AiPanelProps): React.JSX.Element {
  const job = useAiJob()
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useDragOffset(panelRef)
  const [position] = useState(() => panelPosition(editor, selection))
  const centering = selection.wholeDocument ? '-50%' : '0px'
  const transform = `translate(calc(${centering} + ${drag.offset.x}px), calc(${centering} + ${drag.offset.y}px))`
  const [prompt, setPrompt] = useState(request.prompt)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [lastRun, setLastRun] = useState<RunInput | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'result' | 'changes'>('result')
  const canReplace = !request.insertOnly && selection.replaceable

  const submit = async (input: RunInput): Promise<void> => {
    if (!input.prompt.trim() || job.running) return
    const provider = engine.provider
    setError('')
    setLastRun(input)
    try {
      const result = await job.run((jobId) =>
        call('ai:editDoc', {
          jobId,
          provider,
          docPath,
          document: editor.getMarkdown(),
          // The document is already sent in full, so a whole-document request has no separate selection.
          selection: selection.wholeDocument ? '' : selection.markdown,
          inline: selection.inline,
          wholeDocument: selection.wholeDocument,
          prompt: input.prompt,
          previous: input.previous
        })
      )
      setProposal({ text: result.text, usage: result.usage, provider })
      setPrompt('')
      setTab('result')
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  // Shortcuts send their prompt straight away. Closing the panel (or leaving the editor) cancels a running request.
  const { cancel } = job
  useEffect(() => {
    const timer = request.autoSubmit ? setTimeout(() => void submit({ prompt: request.prompt, previous: null })) : undefined
    return () => {
      clearTimeout(timer)
      cancel()
    }
    // Runs once per panel: the request never changes while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (): void => void submit({ prompt, previous: proposal?.text ?? null })

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="AI assistant"
      className="fixed z-40 flex max-h-[min(640px,calc(100vh-32px))] flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-xl"
      style={{ ...position, width: PANEL_WIDTH, transform }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div
        {...drag.handleProps}
        title="Drag to move"
        data-testid="ai-panel-handle"
        className={cn('-m-1 flex touch-none items-center gap-2 rounded p-1 select-none', drag.dragging ? 'cursor-grabbing' : 'cursor-grab')}
      >
        <Sparkles className="size-4 text-accent" />
        <span className="text-[13px] font-semibold">AI assistant</span>
        {selection.wholeDocument ? <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">Whole document</span> : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="ml-auto grid size-6 place-items-center rounded text-muted hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      {proposal && !job.running ? (
        <>
          <div className="flex items-center gap-2">
            <div role="tablist" className="flex rounded-md bg-sunken p-0.5 text-[12px]">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'result'}
                onClick={() => setTab('result')}
                className={cn('rounded px-2.5 py-1', tab === 'result' ? 'bg-surface shadow-sm' : 'text-muted')}
              >
                Result
              </button>
              {selection.markdown ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'changes'}
                  onClick={() => setTab('changes')}
                  className={cn('rounded px-2.5 py-1', tab === 'changes' ? 'bg-surface shadow-sm' : 'text-muted')}
                >
                  Changes
                </button>
              ) : null}
            </div>
            <span className="ml-auto truncate text-[11.5px] text-faint">{usageLabel(proposal, engine)}</span>
            <button
              type="button"
              onClick={() => lastRun && void submit(lastRun)}
              aria-label="Regenerate"
              title="Regenerate"
              className="grid size-7 place-items-center rounded text-muted hover:bg-sunken hover:text-ink"
            >
              <RotateCw className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line p-3" data-testid="ai-result">
            {tab === 'result' ? <Markdown text={proposal.text} docPath={docPath} /> : <ChangesView before={selection.markdown} after={proposal.text} />}
          </div>
        </>
      ) : null}

      {job.running ? <AiProgress status={job.status} streamed={job.streamed} /> : null}

      <div className="rounded-md border border-line bg-canvas p-2 focus-within:border-accent">
        <textarea
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={proposal ? 'Ask for a change to this result, then press Enter' : 'Describe a change then press Enter'}
          aria-label="AI request"
          className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-2">
          <select
            value={engine.provider}
            onChange={(event) => engine.setProvider(event.target.value as ProviderId)}
            aria-label="AI engine"
            className="max-w-60 truncate rounded bg-transparent py-0.5 text-[12px] text-muted outline-none hover:text-ink"
          >
            {(['claude', 'copilot'] as const).map((id) => {
              const status = engine.providers.find((item) => item.id === id)
              return (
                <option key={id} value={id} disabled={status ? !status.ok : false}>
                  {engine.label(id)}
                </option>
              )
            })}
          </select>
          {job.running ? (
            <button
              type="button"
              onClick={job.cancel}
              aria-label="Stop"
              title="Stop"
              className="ml-auto grid size-7 place-items-center rounded-full bg-sunken text-ink hover:bg-line"
            >
              <Square className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!prompt.trim()}
              aria-label="Send"
              title="Send (Enter)"
              className="ml-auto grid size-7 place-items-center rounded-full bg-accent text-white disabled:bg-sunken disabled:text-faint"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-fail">
          {error}
        </p>
      ) : null}

      {proposal && !job.running ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => onApply(proposal.text, 'insert')}>
            Insert below
          </Button>
          {canReplace ? (
            <Button size="sm" variant="primary" onClick={() => onApply(proposal.text, 'replace')}>
              {selection.wholeDocument ? 'Replace document' : 'Replace'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
