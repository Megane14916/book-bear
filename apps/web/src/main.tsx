import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './lib/query/client'
import { HealthCheck } from './lib/api/HealthCheck'
import { AuthProvider } from './lib/auth/AuthProvider'
import { AuthCheck } from './lib/auth/AuthCheck'
import './styles.css'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {import.meta.env.DEV && new URLSearchParams(window.location.search).has('api-check') && <HealthCheck />}
        {import.meta.env.DEV && new URLSearchParams(window.location.search).has('auth-check') && <AuthCheck />}
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
