import { QueryClient } from '@tanstack/react-query'
import { ApiError, HttpError } from '../api/errors'

export function retryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false
  return error instanceof HttpError
    ? [502, 503, 504].includes(error.status)
    : error instanceof ApiError && error.kind === 'network'
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryRead,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}
