import { describe, expect, it, vi } from 'vitest'
import { createBookProvider } from '../src/integrations/books'

const volume = { id: 'volume-1', volumeInfo: { title: '外部の本', authors: ['著者A', '著者B'], publisher: '出版社', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9784780802047' }], pageCount: 123, imageLinks: { thumbnail: 'https://example.com/cover.jpg' } } }

describe('書籍providerの正規化と障害', () => {
  it('Googleの公開書誌だけを取得し、APIキー・検索語・limitをエンコードする', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ totalItems: 1, items: [volume] }))
    const items = await createBookProvider(fetcher, 'test-key').search('本 & 著者', 20)
    expect(items).toEqual([{ provider: 'google_books', providerId: 'volume-1', isbn13: '9784780802047', title: '外部の本', author: '著者A, 著者B', publisher: '出版社', totalPages: 123, coverUrl: 'https://example.com/cover.jpg' }])
    const url = new URL(String(fetcher.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/books/v1/volumes')
    expect(Object.fromEntries(url.searchParams)).toEqual({ key: 'test-key', q: '本 & 著者', maxResults: '20' })
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
  })
  it('欠損・不正ISBN・危険な書影URL・不正ページ数はnull、タイトルなしの検索候補は除外', async () => {
    const fetcher: typeof fetch = async () => Response.json({ totalItems: 3, items: [
      { id: 'minimal', volumeInfo: { title: '最小情報' } },
      { ...volume, volumeInfo: { ...volume.volumeInfo, industryIdentifiers: [{ type: 'ISBN_13', identifier: '9784780802048' }], pageCount: 2147483648, imageLinks: { thumbnail: 'javascript:alert(1)' } } },
      { id: 'no-title', volumeInfo: {} },
    ] })
    const items = await createBookProvider(fetcher, 'key').search('本', 20)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ isbn13: null, coverUrl: null, totalPages: null, author: null, publisher: null })
    expect(items[1]).toMatchObject({ isbn13: null, coverUrl: null, totalPages: null })
  })
  it('openBD未収録ならGoogle ISBN検索へフォールバックし、異なるISBNを除外する', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => new URL(String(input)).hostname === 'api.openbd.jp'
      ? Response.json([null]) : Response.json({ totalItems: 2, items: [volume, { id: 'other', volumeInfo: { title: 'ISBN不明' } }] }))
    const items = await createBookProvider(fetcher, 'key').search('9784780802047', 20, '9784780802047')
    expect(items).toHaveLength(1)
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('isbn')).toBe('9784780802047')
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('q')).toBe('isbn:9784780802047')
  })
  it('openBDはISBNの一致を検証し、書影なし・任意項目なしを許容する', async () => {
    const fetcher: typeof fetch = async () => Response.json([{ summary: { isbn: '9784780802047', title: '日本語の本' } }])
    expect(await createBookProvider(fetcher).find('openbd', '9784780802047')).toEqual({ provider: 'openbd', providerId: '9784780802047', isbn13: '9784780802047', title: '日本語の本', author: null, publisher: null, coverUrl: null, totalPages: null })
    await expect(createBookProvider(fetcher).find('openbd', '9784101010014')).rejects.toMatchObject({ status: 502, code: 'BOOK_PROVIDER_UNAVAILABLE' })
  })
  it('importではGoogle候補を再取得し、要求IDとの一致を検証する', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(volume))
    expect(await createBookProvider(fetcher, 'key').find('google_books', 'volume-1')).toMatchObject({ title: '外部の本' })
    await expect(createBookProvider(fetcher, 'key').find('google_books', 'other')).rejects.toMatchObject({ status: 502 })
    await expect(createBookProvider(fetcher, 'key').find('google_books', '..')).rejects.toMatchObject({ status: 400 })
    await createBookProvider(async (url) => {
      expect(new URL(String(url)).pathname).toBe('/books/v1/volumes/https%3A%2F%2Fevil.invalid%2Fa%3Fx%3Dy')
      return new Response(null, { status: 404 })
    }, 'key').find('google_books', 'https://evil.invalid/a?x=y')
  })
  it.each([404, 429, 500, 503])('Google検索のHTTP %sを空結果と区別する', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('upstream private detail', { status }))
    await expect(createBookProvider(fetcher, 'key').search('本', 20)).rejects.toMatchObject({ status: 502, message: '書籍情報サービスを利用できません' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['json', 'shape', 'network', 'timeout'])('不正応答・通信障害を安全な502にする: %s', async (kind) => {
    const fetcher: typeof fetch = async () => {
      if (kind === 'network' || kind === 'timeout') throw new DOMException('private detail', kind === 'timeout' ? 'TimeoutError' : 'NetworkError')
      return kind === 'json' ? new Response('{') : Response.json({ items: 'invalid' })
    }
    await expect(createBookProvider(fetcher, 'key').search('本', 20)).rejects.toMatchObject({ status: 502, code: 'BOOK_PROVIDER_UNAVAILABLE' })
  })
  it('timeout signalを5秒でabortし、通信を再試行しない', async () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      expect(ms).toBe(5000)
      const controller = new AbortController()
      setTimeout(() => controller.abort(), ms)
      return controller.signal
    })
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')), { once: true })
    }))
    try {
      const assertion = expect(createBookProvider(fetcher, 'key').search('本', 20)).rejects.toMatchObject({ status: 502 })
      await vi.advanceTimersByTimeAsync(5000)
      await assertion
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { timeout.mockRestore(); vi.useRealTimers() }
  })
  it('importの未発見はnull、検索の正常0件は空配列、APIキー欠落は安全な障害', async () => {
    const missing: typeof fetch = async () => new Response(null, { status: 404 })
    expect(await createBookProvider(missing, 'key').find('google_books', 'missing')).toBeNull()
    expect(await createBookProvider(async () => Response.json({ totalItems: 0 }), 'key').search('本', 20)).toEqual([])
    await expect(createBookProvider(missing).search('本', 20)).rejects.toMatchObject({ status: 502 })
  })
})
