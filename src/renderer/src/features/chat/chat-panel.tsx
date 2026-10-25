import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eraser, Send, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { AiUsage, ChatMessage, ChatThread, ProviderId } from '@shared/domain'
import { Markdown } from '@/components/markdown'
import { CodebaseSelect, PROVIDER_LABELS, ProviderSelect } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/fields'
import { Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useChat, useCodebases } from '@/lib/queries'
import { useAiJob } from '@/lib/use-ai-job'
import { cn, errorText } from '@/lib/utils'

function usageLine(usage: AiUsage | null): string {
  if (!usage) return ''
  const parts = [
    usage.model,
    usage.inputTokens !== undefined ? `${usage.inputTokens.toLocaleString()} in / ${(usage.outputTokens ?? 0).toLocaleString()} out` : '',
    usage.premiumRequests ? `${usage.premiumRequests} premium request${usage.premiumRequests === 1 ? '' : 's'}` : '',
    usage.costUsd !== undefined ? `$${usage.costUsd.toFixed(3)}` : '',
    `${(usage.elapsedMs / 1000).toFixed(1)}s`
  ]
  return parts.filter(Boolean).join(', ')
}

const STATUS_NOTE: Partial<Record<ChatMessage['status'], string>> = {
  error: 'The AI request failed.',
  cancelled: 'Cancelled.',
  interrupted: 'Interrupted when the app closed.'
}

function MessageView({ message, caseLabel }: { message: ChatMessage; caseLabel?: (caseId: string) => string }): React.JSX.Element {
  const codebases = useCodebases().data ?? []
  if (message.role === 'user') {
    return (
      <div className="ml-6 rounded-lg bg-accent-soft px-3 py-2">
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.caseId && caseLabel ? <p className="mt-1 text-[11.5px] text-muted">About {caseLabel(message.caseId)}</p> : null}
      </div>
    )
  }
  const codebase = codebases.find((item) => item.id === message.codebaseId)
  const note = STATUS_NOTE[message.status]
  return (
    <div className="flex flex-col gap-1">
      {note ? <p className={cn('text-[12px]', message.status === 'error' ? 'text-fail' : 'text-muted')}>{note}</p> : null}
      {message.status === 'done' ? <Markdown text={message.text} className="text-[13px]" /> : <p className="whitespace-pre-wrap text-[12.5px] text-muted">{message.text}</p>}
      <p className="text-[11px] text-faint">
        {[message.provider ? PROVIDER_LABELS[message.provider] : '', codebase ? `read ${codebase.name}` : 'no codebase', usageLine(message.usage)].filter(Boolean).join(' · ')}
      </p>
    </div>
  )
}

interface ChatPanelProps {
  runId: string
  thread: ChatThread
  title: string
  intro: string
  /** For the Test Assistant: the case the tester is looking at (null = Final summary). */
  caseId?: string | null
  caseLabel?: (caseId: string) => string
  defaultCodebaseId: string | null
  defaultProvider: ProviderId
  disabledReason?: string
  className?: string
}

/** AI conversation beside a run. The codebase and engine can change per question; access is always read-only. */
export function ChatPanel(props: ChatPanelProps): React.JSX.Element {
  const { runId, thread } = props
  const client = useQueryClient()
  const history = useChat(runId, thread)
  const job = useAiJob()
  const [question, setQuestion] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [codebaseId, setCodebaseId] = useState<string | null>(props.defaultCodebaseId)
  const [provider, setProvider] = useState<ProviderId>(props.defaultProvider)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => setCodebaseId(props.defaultCodebaseId), [props.defaultCodebaseId])
  useEffect(() => setProvider(props.defaultProvider), [props.defaultProvider])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [history.data?.length, pendingQuestion, job.streamed])

  const send = async (): Promise<void> => {
    const text = question.trim()
    if (!text || job.running) return
    setQuestion('')
    setPendingQuestion(text)
    try {
      await job.run((jobId) => call('chat:send', { runId, thread, caseId: props.caseId ?? null, question: text, codebaseId, provider, jobId }))
    } catch (error) {
      toast.error(errorText(error))
      setQuestion(text)
    } finally {
      setPendingQuestion(null)
      await client.invalidateQueries({ queryKey: keys.chat(runId, thread) })
    }
  }

  const clear = async (): Promise<void> => {
    try {
      await call('chat:clear', { runId, thread })
      await client.invalidateQueries({ queryKey: keys.chat(runId, thread) })
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const messages = history.data ?? []
  const disabled = Boolean(props.disabledReason)

  return (
    <section className={cn('flex min-h-0 flex-col bg-surface', props.className)} aria-label={props.title}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold">{props.title}</h2>
        {messages.length ? (
          <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={job.running}>
            <Eraser /> Clear
          </Button>
        ) : null}
      </div>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {!messages.length && !pendingQuestion ? <p className="text-[12.5px] text-muted">{props.intro}</p> : null}
        {messages.map((message) => (
          <MessageView key={message.id} message={message} caseLabel={props.caseLabel} />
        ))}
        {pendingQuestion ? (
          <>
            <div className="ml-6 rounded-lg bg-accent-soft px-3 py-2 whitespace-pre-wrap">{pendingQuestion}</div>
            <div className="flex flex-col gap-1">
              {job.streamed ? <Markdown text={job.streamed} className="text-[13px]" /> : null}
              <p className="flex items-center gap-2 text-[12px] text-muted">
                <Spinner className="size-3.5" /> {job.status || 'Thinking…'}
              </p>
            </div>
          </>
        ) : null}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        {disabled ? <p className="text-[12px] text-muted">{props.disabledReason}</p> : null}
        <Textarea
          rows={3}
          value={question}
          disabled={disabled}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder="Ask a question (Enter to send, Shift+Enter for a new line)"
          aria-label="Question"
        />
        <div className="flex flex-wrap items-center gap-2">
          <CodebaseSelect value={codebaseId} onChange={setCodebaseId} className="h-7 flex-1 text-[12px]" disabled={job.running || disabled} />
          <ProviderSelect value={provider} onChange={setProvider} className="h-7 text-[12px]" disabled={job.running || disabled} />
          {job.running ? (
            <Button size="sm" variant="danger" onClick={job.cancel}>
              <Square /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" type="submit" disabled={!question.trim() || disabled}>
              <Send /> Ask
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
