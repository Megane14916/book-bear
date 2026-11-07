import { queryOptions } from '@tanstack/react-query'
import { api } from './client'
import { ApiError } from './errors'
import { requestData } from './result'
import { queryKeys } from '../query/keys'

export async function getHealth(signal?: AbortSignal) {
  const data = await requestData(() => api.GET('/api/v1/health', { signal }))
  if (data?.status !== 'ok') throw new ApiError('response', 'APIの稼働状態を確認できませんでした。')
  return data
}

export const healthQueryOptions = () => queryOptions({
  queryKey: queryKeys.health(),
  queryFn: ({ signal }) => getHealth(signal),
})
