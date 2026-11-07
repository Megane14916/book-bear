import { test, expect, type Page } from '@playwright/test'

// Real React/Auth SDK/API middleware, mocked development HTTP services only.
// No credentials, live accounts, browser storage or request headers are logged.
const origin = 'http://127.0.0.1:8797'
const bookId = '00000000-0000-4000-8000-000000000001'
const shelfId = '00000000-0000-4000-8000-000000000002'
const bookmarkId = '00000000-0000-4000-8000-000000000003'
const userId = '00000000-0000-4000-8000-000000000004'
const otherId = '00000000-0000-4000-8000-000000000005'
const book = { id: bookId, title: '栞をつける本', author: null, coverUrl: null, isbn13: null, publisher: null, totalPages: null, source: 'manual' }
const shelf = { id: shelfId, userId, book, status: 'reading', currentPage: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const initial = { id: bookmarkId, author: { id: userId, displayName: '読者', avatarUrl: null }, book,
  content: '以前の公開本文', pageNumber: 10, visibility: 'public', isSpoiler: false, likeCount: 0, replyCount: 0, likedByMe: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }

function session(id: string, anonymous: boolean) {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: now + 3600, iat: now, role: 'authenticated', aud: 'authenticated', is_anonymous: anonymous })}.dGVzdA`,
    refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    user: { id, is_anonymous: anonymous, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
}

async function setup(page: Page, options: { signedIn?: boolean; anonymous?: boolean; otherUser?: boolean; private?: boolean; failSave?: boolean; failInit?: boolean; denyPublic?: boolean; paginated?: boolean } = {}) {
  const events: string[] = [], bodies: Record<string, unknown>[] = []
  let signup = 0, saves = 0, adds = 0, deletes = 0, libraryPages = 0, init = 0
  let current: typeof initial | null = { ...initial, visibility: options.private ? 'private' : 'public' }
  let identity: string | null = options.signedIn ? (options.otherUser ? otherId : userId) : null
  if (options.signedIn) await page.addInitScript((value) => {
    localStorage.setItem('sb-bookmarks-e2e-auth-token', JSON.stringify(value))
  }, session(identity!, options.anonymous ?? false))
  await page.route('https://bookmarks-e2e.supabase.co/auth/v1/**', async (route) => {
    if (!route.request().url().endsWith('/signup')) return route.fulfill({ status: 204 })
    signup++; identity = userId; events.push('signup')
    return route.fulfill({ json: session(userId, true) })
  })
  await page.route(`${origin}/api/v1/**`, async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    const missing = () => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '見つかりません' } } })
    if (url.pathname === '/api/v1/me' && method === 'PUT') {
      init++; events.push('init')
      if (options.failInit && init === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: '初期化を再試行してください' } } })
      return route.fulfill({ json: { id: identity, displayName: '読者', avatarUrl: null, handle: null, bio: null, followersCount: 0, followingCount: 0, isAnonymous: options.anonymous ?? !options.signedIn } })
    }
    if (url.pathname === `/api/v1/books/${bookId}`) return route.fulfill({ json: book })
    if (url.pathname === '/api/v1/me/preferences') return route.fulfill({ json: { feedContentMode: 'all' } })
    if (url.pathname === '/api/v1/feed') return route.fulfill({ json: {
      items: current?.visibility === 'public' ? [current] : [], nextCursor: null,
    } })
    if (url.pathname === '/api/v1/me/books') {
      if (method === 'POST') {
        adds++; events.push('shelf')
        expect(request.postDataJSON()).toEqual({ bookId })
        expect(Boolean(request.headers().authorization)).toBe(true)
        return route.fulfill({ status: 201, json: shelf })
      }
      libraryPages++
      return route.fulfill({ json: { items: options.paginated && !url.searchParams.has('cursor') ? [] : [shelf],
        nextCursor: options.paginated && !url.searchParams.has('cursor') ? 'next' : null } })
    }
    if (url.pathname === '/api/v1/bookmarks' && method === 'POST') {
      saves++; events.push('save')
      const body = request.postDataJSON(); bodies.push(body)
      expect(Boolean(request.headers().authorization)).toBe(true)
      if (options.failSave && saves === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: '一時的な保存失敗' } } })
      if (options.denyPublic && body.visibility === 'public') return route.fulfill({ status: 403, json: { error: { code: 'REGISTRATION_REQUIRED' } } })
      expect(body.userBookId).toBe(shelfId)
      current = { ...initial, ...body }
      return route.fulfill({ status: 201, json: current })
    }
    if (url.pathname === `/api/v1/bookmarks/${bookmarkId}`) {
      if (!current || (current.visibility === 'private' && identity !== userId)) return missing()
      if (method === 'GET') return route.fulfill({ json: current })
      if (method === 'PATCH') {
        const body = request.postDataJSON(); bodies.push(body)
        expect(identity === userId).toBe(true)
        current = { ...current, ...body }
        return route.fulfill({ json: current })
      }
      if (method === 'DELETE') { deletes++; current = null; return route.fulfill({ status: 204 }) }
    }
    return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: '想定外のAPI' } } })
  })
  return { events, bodies, counts: () => ({ signup, saves, adds, deletes, libraryPages }) }
}

test('guest browsing creates no account; first private save initializes auth, adds the book and saves once at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const mock = await setup(page)
  await page.goto(`/create?bookId=${bookId}`)
  await expect(page.getByRole('heading', { name: book.title })).toBeVisible()
  expect(mock.counts().signup).toBe(0)
  await page.getByRole('textbox', { name: /本文/ }).fill('初めての非公開栞')
  await page.getByLabel('公開範囲').selectOption('public')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page.getByRole('alert')).toContainText('正式登録')
  expect(mock.counts().signup).toBe(0)
  await page.getByLabel('公開範囲').selectOption('private')
  await page.getByLabel('ネタバレを含む').check()
  await page.locator('form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit() })
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts()).toMatchObject({ signup: 1, saves: 1, adds: 1 })
  expect(mock.events.indexOf('signup')).toBeLessThan(mock.events.indexOf('init'))
  expect(mock.events.indexOf('init')).toBeLessThan(mock.events.indexOf('shelf'))
  expect(mock.events.indexOf('shelf')).toBeLessThan(mock.events.indexOf('save'))
  await expect(page.getByText('初めての非公開栞', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /表示/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('初めての非公開栞', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '編集', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '栞の詳細' })).toBeVisible()
  expect(mock.counts().signup).toBe(1)
})

test('network failure keeps input and retries without duplicate shelf registration or automatic POST retry', async ({ page }) => {
  const mock = await setup(page, { failSave: true })
  await page.goto(`/create?bookId=${bookId}`)
  await page.getByRole('textbox', { name: /本文/ }).fill('消えない下書き')
  await expect(page.getByRole('button', { name: '栞を保存' })).toBeEnabled()
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page.getByRole('alert')).toContainText('一時的な保存失敗')
  expect(mock.counts().saves).toBe(1)
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveValue('消えない下書き')
  await page.getByRole('textbox', { name: /本文/ }).fill('修正して再試行')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await expect(page.getByText('修正して再試行', { exact: true })).toBeVisible()
  expect(mock.counts()).toMatchObject({ signup: 1, saves: 2, adds: 1 })
})

test('initialization failure preserves the draft and retry recovers the same anonymous session', async ({ page }) => {
  const mock = await setup(page, { failInit: true })
  await page.goto(`/create?bookId=${bookId}`)
  await page.getByRole('textbox', { name: /本文/ }).fill('認証失敗でも残す下書き')
  await expect(page.getByRole('button', { name: '栞を保存' })).toBeEnabled()
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page.getByRole('button', { name: 'もう一度試す' })).toBeVisible()
  expect(mock.counts()).toMatchObject({ signup: 1, saves: 0, adds: 0 })
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveValue('認証失敗でも残す下書き')
  await page.getByRole('button', { name: 'もう一度試す' }).click()
  await expect(page.getByRole('button', { name: 'もう一度試す' })).toHaveCount(0)
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts()).toMatchObject({ signup: 1, saves: 1, adds: 1 })
})

test('owner edits public to private, retains the new body on back navigation, then confirms DELETE 204', async ({ page }) => {
  const mock = await setup(page, { signedIn: true })
  await page.goto(`/bookmarks/${bookmarkId}`)
  await expect(page.getByText('以前の公開本文', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '編集', exact: true }).click()
  await page.getByRole('textbox', { name: /本文/ }).fill('更新した非公開本文')
  await page.getByLabel('公開範囲').selectOption('private')
  await page.getByLabel('ページ番号（任意）').fill('')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await expect(page.getByText('更新した非公開本文', { exact: true })).toBeVisible()
  await expect(page.getByText('以前の公開本文', { exact: true })).toHaveCount(0)
  expect(mock.bodies[0]).toEqual({ content: '更新した非公開本文', pageNumber: null, visibility: 'private', isSpoiler: false })
  await page.getByRole('link', { name: '編集', exact: true }).click()
  await page.getByLabel('公開範囲').selectOption('public')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page.getByText('公開', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  expect(mock.counts().deletes).toBe(0)
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  await expect(page).toHaveURL('/library')
  expect(mock.counts().deletes).toBe(1)
  await page.goto(`/bookmarks/${bookmarkId}`)
  await expect(page.getByRole('region', { name: '栞が見つかりません' })).toBeVisible()
})

test('another user receives private 404 and cannot edit or delete; public guests have no owner actions', async ({ page }) => {
  await setup(page, { signedIn: true, otherUser: true, private: true })
  await page.goto(`/bookmarks/${bookmarkId}/edit`)
  await expect(page.getByRole('region', { name: '栞が見つかりません' })).toBeVisible()
  await expect(page.getByRole('button', { name: '栞を保存' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
})

test('public guest reading exposes no owner actions and creates no account', async ({ page }) => {
  const mock = await setup(page)
  await page.goto(`/bookmarks/${bookmarkId}`)
  await expect(page.getByText('以前の公開本文', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '本文を表示', exact: true }).click()
  await expect(page.getByText('以前の公開本文', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '編集', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '削除', exact: true })).toHaveCount(0)
  expect(mock.counts().signup).toBe(0)
})

test('API registration-required also preserves inputs and offers private save', async ({ page }) => {
  const mock = await setup(page, { signedIn: true, denyPublic: true })
  await page.goto(`/create?bookId=${bookId}`)
  await page.getByRole('textbox', { name: /本文/ }).fill('公開を試した下書き')
  await page.getByLabel('公開範囲').selectOption('public')
  await expect(page.getByRole('button', { name: '栞を保存' })).toBeEnabled()
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page.getByRole('alert')).toContainText('正式登録')
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveValue('公開を試した下書き')
  await page.getByLabel('公開範囲').selectOption('private')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts().adds).toBe(1)
})

test('library selection supports later pages and uses its userBookId without registering again', async ({ page }) => {
  const mock = await setup(page, { signedIn: true, anonymous: true, paginated: true })
  await page.goto(`/create?userBookId=${shelfId}`)
  await page.getByRole('button', { name: '本棚の続きを読み込む' }).click()
  await expect(page.getByLabel('本棚から選ぶ')).toHaveValue(shelfId)
  await page.getByRole('textbox', { name: /本文/ }).fill('本棚からの栞')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts()).toMatchObject({ adds: 0, saves: 1, signup: 0 })
})

test('merged public feed drops cached private/deleted bookmarks and shows updated public content', async ({ page }) => {
  await setup(page, { signedIn: true })
  await page.goto(`/bookmarks/${bookmarkId}`)
  await expect(page.getByRole('link', { name: '編集', exact: true })).toBeVisible()
  const home = () => page.getByRole('link', { name: 'Book Bear ホーム' }).click()
  await home()
  await expect(page.getByText('以前の公開本文', { exact: true })).toBeVisible()
  await page.goBack()
  await page.getByRole('link', { name: '編集', exact: true }).click()
  await page.getByRole('textbox', { name: /本文/ }).fill('非公開に変更した本文')
  await page.getByLabel('公開範囲').selectOption('private')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await home()
  await expect(page.getByRole('region', { name: '栞はまだありません' })).toBeVisible()
  await expect(page.getByText('以前の公開本文', { exact: true })).toHaveCount(0)
  await expect(page.getByText('非公開に変更した本文', { exact: true })).toHaveCount(0)
  await page.goBack()
  await page.getByRole('link', { name: '編集', exact: true }).click()
  await page.getByRole('textbox', { name: /本文/ }).fill('再公開した新しい本文')
  await page.getByLabel('公開範囲').selectOption('public')
  await page.getByRole('button', { name: '栞を保存' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await home()
  await expect(page.getByText('再公開した新しい本文', { exact: true })).toBeVisible()
  await page.goBack()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('button', { name: '削除する', exact: true }).click()
  await expect(page).toHaveURL('/library')
  await home()
  await expect(page.getByRole('region', { name: '栞はまだありません' })).toBeVisible()
  await expect(page.getByText('再公開した新しい本文', { exact: true })).toHaveCount(0)
})
