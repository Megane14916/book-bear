import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { confirmTarget, readCloudConfig } from '../scripts/cloud-test/config'
import { runCloudTest, type Report } from '../scripts/cloud-test/runner'
import type { Observer } from '../scripts/cloud-test/database'

const projectRef = 'abcdefghijklmnopqrst'
const userId = randomUUID()
const env = {
  CLOUD_TEST_ENVIRONMENT: 'development', CLOUD_TEST_API_ORIGIN: 'https://book-bear-dev.example.com',
  CLOUD_TEST_SUPABASE_PROJECT_REF: projectRef, SUPABASE_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', CLOUD_TEST_USER_ID: userId,
  CLOUD_TEST_ACCESS_TOKEN: 'secret.payload.signature',
  CLOUD_TEST_DATABASE_URL: `postgresql://book_bear_api:password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt`,
}
const config = readCloudConfig(env)
const answers = { origin: config.apiOrigin, projectRef, workerName: 'book-bear-api',
  deploymentVersion: randomUUID(), hyperdriveId: '1234567890abcdef1234567890abcdef', checked: 'development verified' }
const manual = confirmTarget(config, answers)

function fixture(options: { fail?: string; wrongBook?: boolean; staleDeleted?: boolean; repeatCursor?: boolean; lostCreate?: boolean } = {}) {
  const bookId = randomUUID(), shelfId = randomUUID(), otherId = randomUUID()
  let title = '', hasBook = false, hasShelf = false, updated = false
  const snapshots: Report[] = []
  const paths: string[] = []
  const book = () => ({ id: bookId, title, isbn13: null, author: null, coverUrl: null, publisher: null, totalPages: null, source: 'manual' })
  const shelf = (id = shelfId) => ({ id, userId, book: { id: options.wrongBook ? otherId : bookId, title, isbn13: null, author: null, coverUrl: null },
    status: updated ? 'reading' : 'want_to_read', currentPage: updated ? 10 : null,
    createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' })
  const observedBook = () => ({ id: bookId, title, isbn13: null, created_by_user_id: userId })
  const observedShelf = () => ({ id: shelfId, user_id: userId, book_id: bookId,
    status: updated ? 'reading' : 'want_to_read', current_page: updated ? 10 : null })
  const db: Observer = {
    book: vi.fn(async (id) => hasBook && id === bookId ? observedBook() : undefined),
    shelf: vi.fn(async (id) => hasShelf && id === shelfId ? observedShelf() : undefined),
    recover: vi.fn(async () => ({ books: hasBook ? [observedBook()] : [], shelves: hasShelf ? [observedShelf()] : [] })),
    close: vi.fn(async () => {}),
  }
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET'
    const route = `${method} ${url.pathname}`
    paths.push(`${route}${url.search}`)
    expect(init?.redirect).toBe('manual')
    if (route === options.fail) return json({ secret: env.CLOUD_TEST_DATABASE_URL }, 503)
    if (url.pathname === '/auth/v1/user') return json({ id: userId, is_anonymous: false })
    if (url.pathname.includes('/health')) return json({ status: 'ok' })
    if (route === 'PUT /api/v1/me') return json({ id: userId, isAnonymous: false })
    if (route === 'POST /api/v1/books/manual') {
      title = JSON.parse(String(init?.body)).title
      hasBook = true
      return json(book(), 201)
    }
    if (route === `GET /api/v1/books/${bookId}`) return json(book())
    if (route === 'POST /api/v1/me/books') {
      hasShelf = true
      if (options.lostCreate) throw new Error(`transport secret ${env.CLOUD_TEST_DATABASE_URL}`)
      return json(shelf(), 201)
    }
    if (route === `PATCH /api/v1/me/books/${shelfId}`) { updated = true; return json(shelf()) }
    if (route === `DELETE /api/v1/me/books/${shelfId}`) { hasShelf = false; return new Response(null, { status: 204 }) }
    if (route === 'GET /api/v1/me/books') {
      // Both phases require another page. A deleted target may be stale on
      // page two: checking only the first page must never pass this case.
      if (!url.searchParams.has('cursor')) return json({ items: [shelf(otherId)], nextCursor: 'next-page' })
      return json({ items: hasShelf || options.staleDeleted ? [shelf()] : [], nextCursor: options.repeatCursor ? 'next-page' : null })
    }
    throw new Error(`Unexpected fixture route: ${route}`)
  })
  const execute = (overrides: Partial<Parameters<typeof runCloudTest>[2]> = {}) => runCloudTest(config, manual, {
    fetcher, openDatabase: async () => db, commit: 'fixture', save: async (report) => { snapshots.push(structuredClone(report)) }, ...overrides,
  })
  return { execute, fetcher, db, snapshots, paths, bookId, shelfId, hasShelf: () => hasShelf }
}

describe('cloud test configuration and manual guard', () => {
  it('accepts the application role with verified TLS and matching project', () => {
    expect(config.database.user).toBe('book_bear_api')
    const pooler = env.CLOUD_TEST_DATABASE_URL.replace(`book_bear_api:password@db.${projectRef}.supabase.co`, `book_bear_api.${projectRef}:password@aws-0-ap-northeast-1.pooler.supabase.com`)
    expect(readCloudConfig({ ...env, CLOUD_TEST_DATABASE_URL: pooler }).database.user).toBe(`book_bear_api.${projectRef}`)
  })
  it.each([
    { CLOUD_TEST_ENVIRONMENT: 'production' },
    { CLOUD_TEST_API_ORIGIN: 'http://localhost:8787' },
    { CLOUD_TEST_API_ORIGIN: 'https://127.0.0.1' },
    { CLOUD_TEST_API_ORIGIN: 'https://example.com/api' },
    { SUPABASE_URL: 'https://different.supabase.co' },
    { CLOUD_TEST_DATABASE_URL: env.CLOUD_TEST_DATABASE_URL.replace('book_bear_api:', 'postgres:') },
    { CLOUD_TEST_DATABASE_URL: env.CLOUD_TEST_DATABASE_URL.replace('verify-full', 'disable') },
    { CLOUD_TEST_DATABASE_URL: `${env.CLOUD_TEST_DATABASE_URL}&sslcert=unapproved.pem` },
    { SUPABASE_PUBLISHABLE_KEY: 'service_role_secret' },
  ])('rejects unsafe/inconsistent settings without exposing values', (patch) => {
    expect(() => readCloudConfig({ ...env, ...patch })).toThrow('Invalid cloud test settings')
    try { readCloudConfig({ ...env, ...patch }) } catch (error) {
      expect(String(error)).not.toContain('password@')
      expect(String(error)).not.toContain(env.CLOUD_TEST_ACCESS_TOKEN)
    }
  })
  it('requires exact approved origin/ref and an explicit Dashboard confirmation', () => {
    expect(() => confirmTarget(config, { ...answers, checked: 'yes' })).toThrow()
    expect(() => confirmTarget(config, { ...answers, origin: 'https://other.example.com' })).toThrow()
    expect(() => confirmTarget(config, { ...answers, projectRef: 'other' })).toThrow()
    expect(() => confirmTarget(config, { ...answers, hyperdriveId: '0'.repeat(32) })).toThrow()
  })
})

describe('explicit cloud smoke runner (mock services only)', () => {
  it('follows pages for presence and absence, uses item.book.id, and records DB checks separately', async () => {
    const f = fixture()
    const report = await f.execute()
    expect(report.result).toBe('passed')
    expect(report.cleanup).toBe('deleted')
    expect(report.retainedBook).toBe(true)
    expect(f.hasShelf()).toBe(false)
    expect(f.paths.filter((path) => path.startsWith('GET /api/v1/me/books'))).toEqual([
      'GET /api/v1/me/books', 'GET /api/v1/me/books?cursor=next-page',
      'GET /api/v1/me/books', 'GET /api/v1/me/books?cursor=next-page',
    ])
    expect(report.steps.filter((step) => step.via === 'db-direct').map((step) => step.stage))
      .toEqual(['db-preflight', 'db-created', 'db-updated', 'db-deleted-book-retained'])
    expect(f.db.shelf).toHaveBeenCalledWith(f.shelfId)
    expect(f.snapshots.some((report) => report.userBookId === f.shelfId && report.cleanup === 'pending')).toBe(true)
    const serialized = JSON.stringify(f.snapshots)
    expect(serialized).not.toContain(env.CLOUD_TEST_ACCESS_TOKEN)
    expect(serialized).not.toContain(env.CLOUD_TEST_DATABASE_URL)
  })
  it('fails if the deleted target occurs on a later page', async () => {
    const report = await fixture({ staleDeleted: true }).execute()
    expect(report.result).toBe('failed')
    expect(report.failure?.reason).toBe('deleted-shelf-still-present')
  })
  it('fails rather than treating an incomplete cursor traversal as absence', async () => {
    const report = await fixture({ repeatCursor: true }).execute()
    expect(report.result).toBe('failed')
    expect(report.failure?.reason).toBe('repeated-cursor')
  })
  it('rejects a response with the wrong nested book ID', async () => {
    const f = fixture({ wrongBook: true })
    expect((await f.execute()).result).toBe('failed')
    expect(f.hasShelf()).toBe(false)
  })
  it.each(['GET /auth/v1/user', 'GET /api/v1/health', 'GET /api/v1/health/db'])(
    'does not write when preflight fails at %s', async (fail) => {
      const f = fixture({ fail })
      expect((await f.execute()).result).toBe('failed')
      expect(f.paths.every((path) => path.startsWith('GET '))).toBe(true)
    })
  it('does not write when observation DB preflight fails and suppresses raw errors', async () => {
    const f = fixture()
    const report = await f.execute({ openDatabase: async () => { throw new Error(env.CLOUD_TEST_DATABASE_URL) } })
    expect(report.failure).toEqual({ stage: 'db-preflight', reason: 'unavailable' })
    expect(f.paths.every((path) => path.startsWith('GET '))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('password@')
  })
  it('cleans up only the generated shelf after failure and preserves the original failure', async () => {
    const f = fixture({ fail: 'PATCH /api/v1/me/books' })
    // Failure route includes the generated ID; inject a fetch failure there.
    const fetcher: typeof fetch = async (input, init) => init?.method === 'PATCH'
      ? new Response('secret raw body', { status: 500 }) : f.fetcher(input, init)
    const report = await f.execute({ fetcher })
    expect(report.failure).toEqual({ stage: 'update-shelf', reason: 'unexpected-status', status: 500 })
    expect(report.cleanup).toBe('deleted')
    expect(f.paths.filter((path) => path.startsWith('DELETE '))).toEqual([`DELETE /api/v1/me/books/${f.shelfId}`])
    expect(JSON.stringify(report)).not.toContain('secret raw body')
  })
  it('recovers an ambiguous POST by this run title/UID without replaying the POST', async () => {
    const f = fixture({ lostCreate: true })
    const report = await f.execute()
    expect(report.result).toBe('failed')
    expect(report.uncertainWrite).toBe(true)
    expect(report.cleanup).toBe('deleted')
    expect(f.db.recover).toHaveBeenCalledWith(`cloud-test-${report.runId}`, userId)
    expect(f.paths.filter((path) => path === 'POST /api/v1/me/books')).toHaveLength(1)
  })
  it('does not delete if DB ownership differs from the generated fixture', async () => {
    const f = fixture()
    vi.mocked(f.db.shelf).mockResolvedValue({ id: f.shelfId, user_id: randomUUID(), book_id: f.bookId, status: 'want_to_read', current_page: null })
    const report = await f.execute()
    expect(report.cleanup).toBe('failed')
    expect(f.paths.some((path) => path.startsWith('DELETE '))).toBe(false)
  })
  it('does not start network operations if the initial result record cannot be saved', async () => {
    const f = fixture()
    await expect(f.execute({ save: async () => { throw new Error('private path') } })).rejects.toMatchObject({ stage: 'record' })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
})
