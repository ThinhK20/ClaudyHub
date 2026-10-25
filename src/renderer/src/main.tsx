import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { router } from './app/router'
import { useAppEventInvalidation } from './lib/queries'
import { useThemeSync } from './lib/theme'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false },
    mutations: { retry: false }
  }
})

function App(): React.JSX.Element {
  useAppEventInvalidation()
  const theme = useThemeSync()
  return (
    <>
      <RouterProvider router={router} />
      <Toaster theme={theme} position="bottom-right" closeButton richColors />
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
