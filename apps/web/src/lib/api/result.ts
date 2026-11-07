import { ApiError, isAbortError } from './errors'

// Retain openapi-fetch's inferred request/response types instead of rebuilding them.
export async function requestData<T>(
  request: () => Promise<{ data?: T; response: Response }>,
): Promise<T | null> {
  try {
    const { data, response } = await request()
    if (response.status === 204) return null
    if (data === undefined) throw new ApiError('response', 'APIの応答に必要なデータがありません。')
    return data
  } catch (error) {
    if (error instanceof ApiError || isAbortError(error)) throw error
    throw new ApiError('response', 'APIの応答を処理できませんでした。')
  }
}
