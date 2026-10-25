import { Fragment, useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'
import { Input } from '@/components/ui/fields'
import { EmptyState, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys } from '@/lib/queries'
import { SECTION_LABELS } from '@/lib/utils'

const route = getRouteApi('/search')

/** Renders an FTS snippet, turning \u0002…\u0003 markers into <mark> without using HTML. */
function Snippet({ text }: { text: string }): React.JSX.Element {
  // The control characters are SQLite FTS highlight markers, chosen because they never occur in document text.
  // eslint-disable-next-line no-control-regex
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('\u0002') ? (
          <mark key={index} className="hit">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  )
}

export function SearchPage(): React.JSX.Element {
  const { q } = route.useSearch()
  const navigate = useNavigate()
  const query = useDeferredValue(q.trim())
  const results = useQuery({ queryKey: keys.search(query), queryFn: () => call('docs:search', { query, limit: 100 }), enabled: query.length > 0 })

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Search the library">
        <Input
          autoFocus
          className="mt-3 max-w-xl"
          value={q}
          placeholder="Words from a title or body, e.g. rollup filter"
          aria-label="Search"
          onChange={(event) => void navigate({ to: '/search', search: { q: event.target.value }, replace: true })}
        />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!query ? (
          <p className="text-muted">Every word must match; partial words match the start of a word.</p>
        ) : results.isPending ? (
          <Spinner />
        ) : results.data?.length ? (
          <ol className="flex max-w-3xl flex-col gap-1">
            {results.data.map((hit) => (
              <li key={hit.path}>
                <Link to="/library/doc/$" params={{ _splat: hit.path }} className="block rounded-md px-3 py-2 hover:bg-surface">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{hit.title}</span>
                    <span className="shrink-0 text-[11.5px] text-faint">{SECTION_LABELS[hit.section]}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">
                    <Snippet text={hit.snippet} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title={`No documents match “${query}”`}>Try fewer or shorter words.</EmptyState>
        )}
      </div>
    </div>
  )
}
