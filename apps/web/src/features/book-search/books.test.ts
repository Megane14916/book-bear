// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api/client'
import { ApiError, HttpError } from '../../lib/api/errors'
import { searchBooks, getBook, importBook, createManualBook, externalIdentity, type SearchBook } from './api'
import { validateManualBook, isUuid } from './validation'
import { bookErrorMessage } from './errors'
import { queryKeys } from '../../lib/query/keys'

afterEach(() => vi.restoreAllMocks())
const id = '00000000-0000-4000-8000-000000000001'
const book = { id, title: '本', author: null, coverUrl: null, isbn13: '9784101010014', publisher: null, totalPages: null, source: 'openbd' as const }
const candidate: SearchBook = { title: '本', author: null, coverUrl: null, isbn13: '9784101010014', totalPages: null,
  localBookId: null, provider: 'openbd', providerId: '9784101010014' }

describe('book API and identity contract', () => {
  it('sends trimmed search terms with a limit and cancellation', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: { items: [] }, response: Response.json({ items: [] }) })
    const signal = new AbortController().signal
    await expect(searchBooks(' 本 ', signal)).resolves.toEqual({ items: [] })
    expect(get).toHaveBeenCalledWith('/api/v1/books/search', { params: { query: { q: '本', limit: 20 } }, signal })
  })
  it('uses the internal book ID for detail requests', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: book, response: Response.json(book) })
    await getBook(id)
    expect(get).toHaveBeenCalledWith('/api/v1/books/{bookId}', { params: { path: { bookId: id } }, signal: undefined })
  })
  it.each([200, 201])('accepts import HTTP %s and uses the returned permanent ID', async (status) => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: book, response: Response.json(book, { status }) })
    const body = externalIdentity(candidate)!
    const signal = new AbortController().signal
    const result = await importBook(body, signal)
    expect(result.id).toBe(id)
    expect(post).toHaveBeenCalledWith('/api/v1/books/import', { body: { provider: 'openbd', providerId: '9784101010014' }, signal })
  })
  it('does not infer an import identity for local or malformed candidates', () => {
    expect(externalIdentity({ ...candidate, localBookId: id })).toBeNull()
    expect(externalIdentity({ ...candidate, provider: null })).toBeNull()
    expect(externalIdentity({ ...candidate, providerId: null })).toBeNull()
    expect(externalIdentity({ ...candidate, providerId: ' ' })).toBeNull()
  })
  it('uses only allowed manual fields', async () => {
    const post = vi.spyOn(api, 'POST').mockResolvedValue({ data: book, response: Response.json(book, { status: 201 }) })
    const input = validateManualBook({ title: ' 本 ', author: '', totalPages: '' })
    await createManualBook(input.data!, new AbortController().signal)
    expect(post.mock.calls[0][0]).toBe('/api/v1/books/manual')
    expect(post).toHaveBeenCalledWith('/api/v1/books/manual', {
      body: { title: '本', author: null, totalPages: null }, signal: expect.any(AbortSignal),
    })
  })
  it('rejects a bodyless book API success', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({ response: new Response(null, { status: 204 }) })
    await expect(getBook(id)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('manual form validation', () => {
  it.each(['0', '-1', '1.2', '1e2', '2147483648', 'abc'])('rejects invalid pages %s', (totalPages) => {
    expect(validateManualBook({ title: '本', author: '', totalPages }).errors?.totalPages).toBeTruthy()
  })
  it.each(['1', '2147483647'])('accepts page boundary %s', (totalPages) => {
    expect(validateManualBook({ title: ' 本 ', author: ' 著者 ', totalPages }).data).toEqual({ title: '本', author: '著者', totalPages: Number(totalPages) })
  })
  it('rejects blank titles before saving', () => {
    expect(validateManualBook({ title: '  ', author: '', totalPages: '' }).errors?.title).toBeTruthy()
  })
  it('does not confuse ISBN or provider IDs with internal UUIDs', () => {
    expect(isUuid(id)).toBe(true)
    expect(isUuid('9784101010014')).toBe(false)
    expect(isUuid('external-volume-id')).toBe(false)
  })
})

describe('error UI and query keys', () => {
  it('distinguishes missing books, provider failure, validation and auth', () => {
    expect(bookErrorMessage(new HttpError(404))).toContain('見つかりません')
    expect(bookErrorMessage(new HttpError(502))).toContain('外部')
    expect(bookErrorMessage(new HttpError(400), 'search')).toContain('ISBN')
    expect(bookErrorMessage(new HttpError(400))).not.toContain('ISBN')
    expect(bookErrorMessage(new HttpError(401))).toContain('認証')
    expect(bookErrorMessage(new DOMException('', 'AbortError'))).toContain('中断')
  })
  it('separates searches, details and limits', () => {
    expect(queryKeys.bookSearch(' 本 ')).toEqual(queryKeys.bookSearch('本'))
    expect(queryKeys.bookSearch('本')).not.toEqual(queryKeys.bookSearch('別の本'))
    expect(queryKeys.bookSearch('本')).not.toEqual(queryKeys.bookSearch('本', 30))
    expect(queryKeys.book(id)).not.toEqual(queryKeys.bookSearch(id))
  })
})
