import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { CodebasesPage } from '@/features/codebases/codebases-page'
import { DocPage } from '@/features/library/doc-page'
import { LibraryPage } from '@/features/library/library-page'
import { SearchPage } from '@/features/library/search-page'
import { OverviewPage } from '@/features/overview/overview-page'
import { RunPage } from '@/features/runs/run-page'
import { RunsPage } from '@/features/runs/runs-page'
import { SettingsPage } from '@/features/settings/settings-page'
import type { DocSection } from '@shared/domain'

const rootRoute = createRootRoute({ component: AppShell })

const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage })

export interface LibrarySearch {
  section?: DocSection
  group?: string
  /** Which tab of a feature group is shown. */
  view?: 'documents' | 'diagram'
}

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    section: typeof search.section === 'string' ? (search.section as DocSection) : undefined,
    group: typeof search.group === 'string' ? search.group : undefined,
    view: search.view === 'diagram' ? 'diagram' : undefined
  }),
  component: LibraryPage
})

export const docRoute = createRoute({ getParentRoute: () => rootRoute, path: '/library/doc/$', component: DocPage })

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: (search: Record<string, unknown>): { q: string } => ({ q: typeof search.q === 'string' ? search.q : '' }),
  component: SearchPage
})

const runsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs', component: RunsPage })
export const runRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs/$runId', component: RunPage })
const codebasesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/codebases', component: CodebasesPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage })

export { libraryRoute }

const routeTree = rootRoute.addChildren([
  overviewRoute,
  libraryRoute,
  docRoute,
  searchRoute,
  runsRoute,
  runRoute,
  codebasesRoute,
  settingsRoute
])

export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: false })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
