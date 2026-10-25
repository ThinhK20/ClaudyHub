import { Children, isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useNavigate } from '@tanstack/react-router'
import { call } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { MermaidDiagram } from './mermaid-diagram'

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : ''))
    .join('')
}

/** Resolves a link or image path written inside a workspace document, relative to that document. */
export function resolveRelative(docPath: string, target: string): string {
  const base = docPath.split('/').slice(0, -1)
  for (const part of decodeURIComponent(target.split('#')[0] ?? '').split('/')) {
    if (part === '..') base.pop()
    else if (part && part !== '.') base.push(part)
  }
  return base.join('/')
}

interface MarkdownProps {
  text: string
  /** Workspace-relative path of the document, enabling relative links and images. */
  docPath?: string
  className?: string
}

/** Safe Markdown: raw HTML is never rendered; web links open in the system browser. */
export function Markdown({ text, docPath, className }: MarkdownProps): React.JSX.Element {
  const navigate = useNavigate()

  const heading =
    (Tag: 'h1' | 'h2' | 'h3') =>
    ({ children }: { children?: ReactNode }) => <Tag id={slugify(textOf(children))}>{children}</Tag>

  const components: Components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    a: ({ href = '', children }) => (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault()
          if (/^https?:\/\//i.test(href)) void call('shell:openExternal', { url: href })
          else if (href.startsWith('#')) document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' })
          else if (docPath && /\.md(#|$)/i.test(href)) void navigate({ to: '/library/doc/$', params: { _splat: resolveRelative(docPath, href) } })
        }}
      >
        {children}
      </a>
    ),
    img: ({ src = '', alt = '' }) => {
      const source = typeof src === 'string' ? src : ''
      if (!docPath || /^[a-z]+:/i.test(source)) return <span className="text-faint">[{alt || 'image'}]</span>
      const url = `qa-workspace://file/${encodeURIComponent(resolveRelative(docPath, source))}`
      return <img src={url} data-src={source} alt={alt} loading="lazy" className="max-w-full rounded border border-line" />
    },
    // A ```mermaid fence becomes a diagram, so drop the <pre> code-block frame around it.
    pre: ({ children }) => {
      const child = Children.toArray(children)[0]
      const isMermaid = isValidElement<{ className?: string; children?: ReactNode }>(child) && Boolean(child.props.className?.includes('language-mermaid'))
      // data-mermaid keeps the source, so copying the diagram as Markdown gives back its code.
      return isMermaid ? (
        <div className="my-4" data-mermaid={textOf(child.props.children).trim()}>
          {children}
        </div>
      ) : (
        <pre>{children}</pre>
      )
    },
    code: ({ className: codeClass, children }) => {
      if (codeClass?.includes('language-mermaid')) return <MermaidDiagram code={textOf(children).trim()} />
      return <code className={codeClass}>{children}</code>
    }
  }

  return (
    <div className={cn('prose-qa', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** h2/h3 headings of a Markdown document, for a table of contents. */
export function extractHeadings(markdown: string): { depth: 2 | 3; text: string; id: string }[] {
  let inFence = false
  return markdown.split(/\r?\n/).flatMap((line) => {
    if (/^\s*```/.test(line)) inFence = !inFence
    const match = !inFence && /^(#{2,3})\s+(.+?)\s*#*$/.exec(line)
    if (!match) return []
    const text = (match[2] ?? '').replace(/[*_`]/g, '')
    return [{ depth: (match[1]?.length ?? 2) as 2 | 3, text, id: slugify(text) }]
  })
}
