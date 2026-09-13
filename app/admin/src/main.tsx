import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { RenderI18nProvider } from '@manifold/render'
import { useTranslation } from 'react-i18next'
import 'dayjs/locale/zh-cn'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './app/App.tsx'
import { AdminErrorBoundary } from './app/ErrorBoundary.tsx'
import './i18n'
import { activeLocale } from './i18n/format'
import { toDayjsLocale } from './i18n/locale'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function LocalizedProviders() {
  const { i18n } = useTranslation()
  const locale = activeLocale(i18n.resolvedLanguage ?? i18n.language)
  return <MantineProvider theme={{ primaryColor: 'orange', defaultRadius: 'xs' }}>
    <DatesProvider settings={{ locale: toDayjsLocale(locale) }}>
      <RenderI18nProvider locale={locale}>
        <QueryClientProvider client={queryClient}>
          <AdminErrorBoundary>
            <App />
          </AdminErrorBoundary>
        </QueryClientProvider>
      </RenderI18nProvider>
    </DatesProvider>
  </MantineProvider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocalizedProviders />
  </StrictMode>,
)
