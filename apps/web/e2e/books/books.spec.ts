import { test, expect, type Page } from '@playwright/test'

const origin = 'http://127.0.0.1:8796'
const localId = '00000000-0000-4000-8000-000000000001'
const importedId = '00000000-0000-4000-8000-000000000002'
const manualId = '00000000-0000-4000-8000-000000000003'
const userId = '00000000-0000-4000-8000-000000000010'
const local = { id: localId, title: '既存の本', author: null, coverUrl: null, isbn13: '9784101010014', publisher: null, totalPages: null, source: 'manual' }
const external = { title: '外部の本', author: '著者', coverUrl: null, isbn13: '9784101010014', totalPages: 100,
  localBookId: null, provider: 'google_books', providerId: 'external-volume-id' }
const imported = { ...local, id: importedId, title: '取り込んだ本', source: 'google_books' }

async function setup(page: Page, options: { failAuth?: boolean; failInit?: boolean; failManual?: boolean } = {}) {
  const events: string[] = []
  const imports: unknown[] = [], manuals: unknown[] = []
  let signup = 0, init = 0, searches = 0, details = 0, libraries = 0, manualCalls = 0
  const books = new Map([[localId, local], [importedId, imported]])
  await page.route('https://books-e2e.supabase.co/auth/v1/**', async (route) => {
    if (!route.request().url().endsWith('/signup')) return route.fulfill({ status: 204 })
    signup++; events.push('signup')
    if (options.failAuth) return route.fulfill({ status: 429, json: { code: 'over_request_rate_limit', msg: 'limited' } })
    const now = Math.floor(Date.now() / 1000)
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: now + 3600, iat: now, role: 'authenticated', aud: 'authenticated', is_anonymous: true })}.dGVzdA`
    await route.fulfill({ json: { access_token: token, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600,
      expires_at: now + 3600, user: { id: userId, is_anonymous: true, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } } })
  })
  await page.route(`${origin}/api/v1/**`, async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/v1/me' && request.method() === 'PUT') {
      init++; events.push('init')
      if (options.failInit && init === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: '一時的な失敗' } } })
      return route.fulfill({ json: { id: userId, displayName: 'ゲスト', avatarUrl: null, handle: null, bio: null, followersCount: 0, followingCount: 0, isAnonymous: true } })
    }
    if (url.pathname === '/api/v1/books/search') {
      searches++; events.push('search')
      const q = url.searchParams.get('q')
      if (q === '障害') return route.fulfill({ status: 502, json: { error: { code: 'BOOK_PROVIDER_UNAVAILABLE', message: 'provider' } } })
      if (q === '不正候補') return route.fulfill({ json: { items: [{ ...external, providerId: null }] } })
      const candidate = { ...local, localBookId: localId, provider: null, providerId: null }
      return route.fulfill({ json: { items: q === '0件' ? [] : q === '外部' ? [external] : [candidate] } })
    }
    if (url.pathname === '/api/v1/books/import') {
      imports.push(request.postDataJSON()); events.push('import')
      expect(Boolean(request.headers().authorization)).toBe(true)
      return route.fulfill({ status: imports.length === 1 ? 201 : 200, json: imported })
    }
    if (url.pathname === '/api/v1/books/manual') {
      manualCalls++; events.push('manual')
      manuals.push(request.postDataJSON())
      if (options.failManual && manualCalls === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'temporary' } } })
      const book = { ...local, ...request.postDataJSON(), id: manualId, isbn13: null }
      books.set(manualId, book)
      return route.fulfill({ status: 201, json: book })
    }
    if (url.pathname.startsWith('/api/v1/books/')) {
      details++; events.push('detail')
      const book = books.get(url.pathname.split('/').at(-1)!)
      return route.fulfill(book ? { json: book } : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'missing' } } })
    }
    if (url.pathname === '/api/v1/me/books') libraries++
    await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'unexpected endpoint' } } })
  })
  return { events, imports, manuals, counts: () => ({ signup, init, searches, details, libraries }) }
}
async function search(page: Page, q: string) {
  await page.getByLabel('書名・著者名・ISBN', { exact: true }).fill(q)
  await page.getByRole('button', { name: '検索する', exact: true }).click()
}

test('empty browsing sends no search/signup; title and ISBN candidates use localBookId', async ({ page }) => {
  const mock = await setup(page)
  await page.goto('/search')
  await page.getByLabel('書名・著者名・ISBN', { exact: true }).fill('  ')
  await expect(page.getByRole('button', { name: '検索する' })).toBeDisabled()
  expect(mock.counts().searches + mock.counts().signup).toBe(0)
  await search(page, '既存')
  await expect(page.getByRole('link', { name: '詳細を見る', exact: true })).toBeVisible()
  expect(mock.counts().signup).toBe(0)
  await page.getByRole('link', { name: '詳細を見る', exact: true }).click()
  await expect(page).toHaveURL(`/books/${localId}`)
  await expect(page.getByRole('img', { name: '書影なし' })).toBeVisible()
  expect(mock.imports).toHaveLength(0)
  await page.goto('/search')
  await search(page, '978-4-10-101001-4')
  await expect(page.getByRole('link', { name: '詳細を見る', exact: true })).toHaveAttribute('href', `/books/${localId}`)
})

test('external import authenticates, sends provider identity, and handles 201/200 with the same ID', async ({ page }) => {
  const mock = await setup(page)
  await page.goto('/search?q=外部')
  const button = page.getByRole('button', { name: '書籍情報を取り込む', exact: true })
  await expect(button).toBeVisible()
  expect(mock.counts().signup).toBe(0)
  await button.click()
  await expect(page).toHaveURL(`/books/${importedId}`)
  await expect(page.getByRole('heading', { name: '書籍詳細', exact: true })).toBeVisible()
  expect(mock.events.indexOf('signup')).toBeLessThan(mock.events.indexOf('init'))
  expect(mock.events.indexOf('init')).toBeLessThan(mock.events.indexOf('import'))
  expect(mock.imports[0]).toEqual({ provider: 'google_books', providerId: 'external-volume-id' })
  const library = page.getByRole('link', { name: '本棚への追加へ進む', exact: true })
  await expect(library).toHaveAttribute('href', `/library?bookId=${importedId}`)
  await page.getByRole('link', { name: '書籍検索へ戻る', exact: true }).click()
  await search(page, '外部')
  await page.getByRole('button', { name: '書籍情報を取り込む', exact: true }).click()
  await expect(page).toHaveURL(`/books/${importedId}`)
  expect(mock.imports).toHaveLength(2)
  expect(mock.counts().signup).toBe(1)
  expect(mock.counts().libraries).toBe(0)
})

test('manual registration validates before auth, retains inputs and retries the current edited values', async ({ page }) => {
  const mock = await setup(page, { failManual: true })
  await page.goto('/books/manual')
  await page.getByRole('button', { name: '書籍を登録する', exact: true }).click()
  await expect(page.getByText('タイトルを入力してください。', { exact: true })).toBeVisible()
  await page.getByLabel('タイトル（必須）').fill('新しい本')
  await page.getByLabel('総ページ数（任意）').fill('0')
  await page.getByRole('button', { name: '書籍を登録する', exact: true }).click()
  await expect(page.getByText('総ページ数は1〜2,147,483,647の整数で入力してください。', { exact: true })).toBeVisible()
  expect(mock.counts().signup).toBe(0)
  await page.getByLabel('総ページ数（任意）').fill('')
  await page.getByRole('button', { name: '書籍を登録する', exact: true }).click()
  await expect(page.getByRole('button', { name: 'もう一度試す', exact: true })).toBeVisible()
  await expect(page.getByLabel('タイトル（必須）')).toHaveValue('新しい本')
  await page.getByLabel('タイトル（必須）').fill(' 修正した本 ')
  await page.getByLabel('著者（任意）').fill(' 著者 ')
  await page.getByRole('button', { name: 'もう一度試す', exact: true }).click()
  await expect(page).toHaveURL(`/books/${manualId}`)
  await expect(page.getByText('ISBNなし', { exact: true })).toBeVisible()
  expect(mock.manuals[1]).toEqual({ title: '修正した本', author: '著者', totalPages: null })
  expect(mock.counts().signup).toBe(1)
})

test('initialization failure blocks import and can retry with the existing session', async ({ page }) => {
  const mock = await setup(page, { failInit: true })
  await page.goto('/search?q=外部')
  await page.getByRole('button', { name: '書籍情報を取り込む', exact: true }).click()
  await expect(page.getByRole('button', { name: 'もう一度試す', exact: true })).toBeVisible()
  expect(mock.imports).toHaveLength(0)
  await page.getByRole('button', { name: 'もう一度試す', exact: true }).click()
  await expect(page).toHaveURL(`/books/${importedId}`)
  expect(mock.counts().signup).toBe(1)
  expect(mock.counts().init).toBe(2)
})

test('auth failure prevents any book write', async ({ page }) => {
  const mock = await setup(page, { failAuth: true })
  await page.goto('/search?q=外部')
  await page.getByRole('button', { name: '書籍情報を取り込む', exact: true }).click()
  await expect(page.getByText(/匿名認証に失敗しました/)).toBeVisible()
  expect(mock.imports).toHaveLength(0)
  expect(mock.counts().init).toBe(0)
})

test('empty results, malformed candidates, 404, invalid IDs and 502 are actionable', async ({ page }) => {
  const mock = await setup(page)
  await page.goto('/search?q=0件')
  await expect(page.getByText('本が見つかりませんでした', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '手動登録へ', exact: true })).toHaveAttribute('href', '/books/manual')
  await search(page, '不正候補')
  await expect(page.getByText('取り込みに必要な識別情報がありません。検索し直してください。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '書籍情報を取り込む' })).toHaveCount(0)
  await search(page, '障害')
  await expect(page.getByText(/外部の書籍情報サービスを利用できません/)).toBeVisible({ timeout: 10_000 })
  await page.goto('/books/00000000-0000-4000-8000-000000000999')
  await expect(page.getByText('書籍が見つかりません', { exact: true })).toBeVisible()
  const count = mock.counts().details
  await page.goto('/books/9784101010014')
  await expect(page.getByText('書籍が見つかりません', { exact: true })).toBeVisible()
  expect(mock.counts().details).toBe(count)
})

test('user-specific flow link is only supplied for a valid explicit user ID', async ({ page }) => {
  await setup(page)
  await page.goto(`/books/${localId}`)
  await expect(page.getByRole('heading', { name: '書籍詳細' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'このユーザーの栞の流れを見る' })).toHaveCount(0)
  await page.goto(`/books/${localId}?userId=${userId}`)
  await expect(page.getByRole('link', { name: 'このユーザーの栞の流れを見る' }))
    .toHaveAttribute('href', `/users/${userId}/books/${localId}/bookmarks`)
})

test('360px keyboard search and URL back navigation preserve the submitted query', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await setup(page)
  await page.goto('/search')
  await page.getByLabel('書名・著者名・ISBN', { exact: true }).focus()
  await page.keyboard.type('既存')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('link', { name: '詳細を見る', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('link', { name: '詳細を見る', exact: true }).click()
  await page.goBack()
  await expect(page.getByLabel('書名・著者名・ISBN', { exact: true })).toHaveValue('既存')
})
