import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App.tsx'
import { AdminErrorBoundary } from './ErrorBoundary.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

createRoot(document.getElementById('root')!).render(
  <AdminErrorBoundary>
    <StrictMode>
      <MantineProvider theme={{ primaryColor: 'orange', defaultRadius: 'xs' }}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MantineProvider>
    </StrictMode>
  </AdminErrorBoundary>,
)
