import { describe, expect, it, vi } from 'vitest'
import { ApiError, HttpError } from '../api/errors'
import { createQueryClient, retryRead } from './client'
import { queryKeys } from './keys'

describe('query policy', () => {
  it.each([400, 401, 403, 404, 409, 429, 500, 501])('does not retry HTTP %s', (status) => {
    expect(retryRead(0, new HttpError(status))).toBe(false)
  })

  it.each([502, 503, 504])('limits transient HTTP %s to two retries', (status) => {
    expect([0, 1, 2].map((count) => retryRead(count, new HttpError(status)))).toEqual([true, true, false])
  })

  it('only retries network errors among non-HTTP failures', () => {
    expect(retryRead(0, new ApiError('network', 'offline'))).toBe(true)
    expect(retryRead(2, new ApiError('network', 'offline'))).toBe(false)
    for (const error of [new DOMException('aborted', 'AbortError'), new ApiError('auth', 'auth'), new ApiError('response', 'invalid'), new Error('unknown')]) {
      expect(retryRead(0, error)).toBe(false)
    }
  })

  it('retries a transient read at most twice in a real QueryClient', async () => {
    const client = createQueryClient()
    const queryFn = vi.fn().mockRejectedValue(new ApiError('network', 'offline'))
    await expect(client.fetchQuery({ queryKey: ['retry-test'], queryFn, retryDelay: 0 })).rejects.toBeInstanceOf(ApiError)
    expect(queryFn).toHaveBeenCalledTimes(3)
    client.clear()
  })

  it('does not automatically resend a failed mutation', async () => {
    const client = createQueryClient()
    const mutationFn = vi.fn().mockRejectedValue(new ApiError('network', 'offline'))
    const mutation = client.getMutationCache().build(client, { mutationFn })
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError)
    expect(mutationFn).toHaveBeenCalledOnce()
    client.clear()
  })
})

describe('query keys', () => {
  it('separates viewers, scope, targets and search conditions', () => {
    const keys = [
      queryKeys.health(), queryKeys.feed('all', null), queryKeys.feed('all', 'a'),
      queryKeys.feed('following', 'a'), queryKeys.feed('all', 'a', 30),
      queryKeys.myBooks('a'), queryKeys.myBooks('b'),
      queryKeys.bookmarkFlow('a', 'book1', null), queryKeys.bookmarkFlow('a', 'book1', 'a'),
      queryKeys.bookmarkFlow('b', 'book1', null), queryKeys.bookmarkFlow('a', 'book2', null),
      queryKeys.searchPosts('猫', null), queryKeys.searchPosts('犬', null),
      queryKeys.searchPosts('猫', 'a'), queryKeys.searchPosts('猫', null, 30),
    ]
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length)
    expect(queryKeys.searchPosts(' 猫 ', null)).toEqual(queryKeys.searchPosts('猫', null))
  })
})
