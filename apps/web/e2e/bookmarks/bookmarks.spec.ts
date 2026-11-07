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
const shelf = { id: shelfId, userId, book, status: 'want_to_read', currentPage: null, latestBookmarkPage: null as number | null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
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

async function setup(page: Page, options: { signedIn?: boolean; anonymous?: boolean; otherUser?: boolean; private?: boolean; failSave?: boolean; failInit?: boolean; denyPublic?: boolean; paginated?: boolean; manyBooks?: boolean; history?: boolean } = {}) {
  const events: string[] = [], bodies: Record<string, unknown>[] = []
  let signup = 0, saves = 0, adds = 0, deletes = 0, libraryPages = 0, init = 0
  let feedContentMode = 'all'
  let current: typeof initial | null = { ...initial, visibility: options.private ? 'private' : 'public' }
  let libraryBook = shelf
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
    if (url.pathname === `/api/v1/users/${userId}/books/${bookId}/bookmarks`) return route.fulfill({ json: {
      author: initial.author, book, items: options.history ? [
        { ...initial, content: '前に残した栞', visibility: 'private' },
        { ...initial, id: '00000000-0000-4000-8000-000000000006', content: '過去のネタバレ本文', isSpoiler: true },
      ] : [], nextCursor: null,
    } })
    if (url.pathname === '/api/v1/me/preferences') {
      if (method === 'PATCH') feedContentMode = request.postDataJSON().feedContentMode
      return route.fulfill({ json: { feedContentMode } })
    }
    if (url.pathname === `/api/v1/bookmarks/${bookmarkId}/replies` && method === 'GET') {
      return current?.visibility === 'public' ? route.fulfill({ json: { items: [], nextCursor: null } }) : missing()
    }
    if (url.pathname === '/api/v1/feed') return route.fulfill({ json: {
      items: current?.visibility === 'public' ? [current] : [], nextCursor: null,
    } })
    if (url.pathname === '/api/v1/me/books') {
      if (method === 'POST') {
        adds++; events.push('shelf')
        expect(request.postDataJSON()).toEqual({ bookId })
        expect(Boolean(request.headers().authorization)).toBe(true)
        return route.fulfill({ status: 201, json: libraryBook })
      }
      libraryPages++
      const hasNext = ((options.paginated && !url.searchParams.has('sort')) || options.manyBooks) && !url.searchParams.has('cursor')
      const items = options.manyBooks && hasNext ? Array.from({ length: 15 }, (_, index) => {
        const id = `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`
        return { ...shelf, id, book: { ...book, id, title: index === 0 ? '書名が長くてもカードの高さがそろう本' : `本棚の本 ${index + 1}` } }
      }) : hasNext ? [] : [libraryBook]
      const status = url.searchParams.get('status')
      return route.fulfill({ json: { items: items.filter((item) => !status || item.status === status), nextCursor: hasNext ? 'next' : null } })
    }
    if (url.pathname === '/api/v1/bookmarks' && method === 'POST') {
      saves++; events.push('save')
      const body = request.postDataJSON(); bodies.push(body)
      expect(Boolean(request.headers().authorization)).toBe(true)
      if (options.failSave && saves === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: '一時的な保存失敗' } } })
      if (options.denyPublic && body.visibility === 'public') return route.fulfill({ status: 403, json: { error: { code: 'REGISTRATION_REQUIRED' } } })
      expect(body.userBookId).toBe(shelfId)
      current = { ...initial, ...body }
      libraryBook = { ...libraryBook, status: 'reading', latestBookmarkPage: body.pageNumber ?? null }
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

test('my page, bookmark flow and reply controls work at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setup(page, { signedIn: true })
  const profilePath = `/api/v1/users/${userId}`
  const flowPath = `/users/${userId}/books/${bookId}/bookmarks`
  await page.route(`${origin}${profilePath}`, (route) => route.fulfill({ json: {
    ...initial.author, handle: 'reader', bio: '読書記録です。', followersCount: 0, followingCount: 0, publicBookmarkCount: 1, followedByMe: false,
  } }))
  await page.route(`${origin}${profilePath}/books?**`, (route) => route.fulfill({ json: { items: [book], nextCursor: null } }))
  await page.route(`${origin}/api/v1/me/bookmarks?**`, (route) => {
    expect(Boolean(route.request().headers().authorization)).toBe(true)
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    return route.fulfill({ json: cursor ? {
      items: [{ ...initial, id: '00000000-0000-4000-8000-000000000007', content: '自分だけの読書メモ', visibility: 'private' }], nextCursor: null,
    } : { items: [initial], nextCursor: 'next' } })
  })
  await page.route(`${origin}/api/v1${flowPath}?**`, (route) => route.fulfill({ json: {
    author: initial.author, book, items: [
      { ...initial, likeCount: 2, likedByMe: true, replyCount: 3 },
      { ...initial, id: '00000000-0000-4000-8000-000000000006', content: '流れのネタバレ本文', isSpoiler: true },
    ], nextCursor: null,
  } }))
  await page.route(`${origin}/api/v1/bookmarks/${bookmarkId}/replies?**`, (route) => route.fulfill({ json: { items: [], nextCursor: null } }))

  await page.goto('/library')
  await page.getByRole('link', { name: 'マイページ' }).click()
  await expect(page).toHaveURL('/me')
  const name = page.getByRole('heading', { name: '読者' })
  await expect(name).toBeVisible()
  await expect(name.locator('..').getByText('公開栞 1件', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '戻る' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'プロフィールの操作' })).toHaveCSS('border-top-width', '0px')
  await expect(page.getByRole('link', { name: '編集' })).toHaveAttribute('href', '/me/edit')
  await expect(page.getByRole('link', { name: '編集' }).locator('svg')).toBeVisible()
  await expect(page.getByRole('link', { name: '設定' }).locator('svg')).toBeVisible()
  const profileTabs = page.getByRole('tablist', { name: 'マイページの表示' })
  const posts = profileTabs.getByRole('tab', { name: '投稿', exact: true })
  const books = profileTabs.getByRole('tab', { name: '栞がある本', exact: true })
  await expect(posts).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(initial.content, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'もっと見る', exact: true }).click()
  await expect(page.getByText('自分だけの読書メモ', { exact: true })).toBeVisible()
  await expect(page.getByText('非公開', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/my-profile-360.png' })
  await page.getByRole('link', { name: '設定' }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page).toHaveURL('/me')

  await books.click()
  await expect(books).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('自分だけの読書メモ', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: book.title }).click()
  await expect(page).toHaveURL(flowPath)
  const bookInfo = page.getByRole('article', { name: `書籍：${book.title}`, exact: true })
  await expect(bookInfo).toHaveCSS('border-top-width', '1px')
  await expect(bookInfo.locator('..')).toHaveCSS('border-top-width', '0px')
  await expect(page.getByRole('link', { name: '読者', exact: true }).locator('svg')).toBeVisible()
  await page.screenshot({ path: 'test-results/bookmark-flow-360.png' })
  const card = page.getByRole('article', { name: '栞', exact: true }).first()
  const body = card.getByText(initial.content)
  await expect(body).toBeVisible()
  const spoilerBody = page.getByText('流れのネタバレ本文', { exact: true })
  await expect(spoilerBody).toHaveCount(0)
  await page.getByRole('button', { name: '本文：すべて表示', exact: true }).click()
  await expect(body).toHaveCount(0)
  await card.getByRole('button', { name: '本文を表示', exact: true }).click()
  await expect(body).toBeVisible()
  await expect(card.getByRole('button', { name: '本文を閉じる' })).toHaveCount(0)
  await page.getByRole('button', { name: 'ネタバレ本文を表示', exact: true }).click()
  await expect(spoilerBody).toBeVisible()
  const like = card.getByRole('button', { name: 'いいねを解除（2）' })
  await expect(like).toHaveText('2')
  await expect(like.locator('svg')).toHaveAttribute('fill', 'currentColor')
  const reply = card.getByRole('link', { name: '返信（3）' })
  await expect(reply).toHaveText('3')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
  await reply.click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}#replies`)
  await expect(page.getByRole('region', { name: '返信', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page).toHaveURL(flowPath)
  await card.scrollIntoViewIfNeeded()
  const bounds = (await card.boundingBox())!
  await page.mouse.click(bounds.x + 8, bounds.y + 8)
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page).toHaveURL(flowPath)
  await page.getByRole('button', { name: '戻る' }).click()
  await expect(page).toHaveURL('/me')
})

test('bookmark detail opens at the current post and expands later bookmarks above replies', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setup(page, { signedIn: true })
  const previous = { ...initial, id: '00000000-0000-4000-8000-000000000011', content: 'ひとつ前の栞',
    createdAt: '2025-12-31T00:00:00Z', visibility: 'private' }
  const following = { ...initial, id: '00000000-0000-4000-8000-000000000012', content: 'ひとつ後の栞',
    createdAt: '2026-01-02T00:00:00Z', pageNumber: 12 }
  const cursors: (string | null)[] = []
  await page.route(`${origin}/api/v1/users/${userId}/books/${bookId}/bookmarks?**`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    cursors.push(cursor)
    const [item, nextCursor] = cursor === 'current' ? [initial, 'following'] : cursor === 'following' ? [following, null] : [previous, 'current']
    return route.fulfill({ json: { author: initial.author, book, items: [item], nextCursor } })
  })
  await page.route(`${origin}/api/v1/bookmarks/${bookmarkId}/replies?**`, (route) => route.fulfill({ json: { items: [], nextCursor: null } }))

  await page.goto(`/bookmarks/${bookmarkId}`)
  const thread = page.getByRole('region', { name: '前後の栞と返信' })
  const cards = thread.getByRole('article', { name: '栞', exact: true })
  await expect(cards).toHaveCount(2)
  expect(cursors).toEqual([null, 'current'])
  await expect(cards.nth(0)).toContainText(previous.content)
  await expect(cards.nth(1)).toContainText(initial.content)
  await expect(thread.getByText(following.content, { exact: true })).toHaveCount(0)
  const viewport = (await thread.boundingBox())!
  const current = cards.nth(1)
  const replies = thread.getByRole('region', { name: '返信', exact: true })
  expect(Math.abs((await current.boundingBox())!.y - viewport.y)).toBeLessThanOrEqual(1)
  await expect(page.getByRole('link', { name: '栞の流れ', exact: true })).toHaveAttribute('href', `/users/${userId}/books/${bookId}/bookmarks`)
  await expect(page.getByRole('heading', { name: '栞の詳細', exact: true })).toHaveClass('sr-only')
  const replyInput = replies.getByRole('textbox', { name: '返信本文（1,000文字以内）' })
  await expect(replyInput).toBeInViewport()
  await expect(replies.locator('form')).toHaveCSS('border-top-width', '0px')
  const initialHeight = (await replyInput.boundingBox())!.height
  await replyInput.fill('横幅に合わせて折り返す返信です。'.repeat(12))
  expect((await replyInput.boundingBox())!.height).toBeGreaterThan(initialHeight)
  await replyInput.fill('')
  expect((await replyInput.boundingBox())!.height).toBe(initialHeight)
  await expect(current.getByRole('link', { name: 'Xで共有' })).toBeVisible()
  await expect(cards.nth(0).getByRole('link', { name: 'Xで共有' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'URLをコピー' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/bookmark-thread-360.png' })
  const more = thread.getByRole('button', { name: 'もっと見る', exact: true })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  const dots = more.locator('..').locator('circle')
  await expect(dots).toHaveCount(4)
  const lineColor = await current.locator('..').locator(':scope > span').evaluate((element) => getComputedStyle(element).backgroundColor)
  await expect(dots.first()).toHaveCSS('fill', lineColor)
  await more.click()
  await expect(cards).toHaveCount(3)
  await expect(more).toHaveCount(0)
  await expect(thread.getByRole('button', { name: '後の栞を閉じる' })).toHaveCount(0)
  expect(cursors).toEqual([null, 'current', 'following'])
  await expect(cards.nth(2)).toContainText(following.content)
  expect((await replies.boundingBox())!.y).toBeGreaterThan((await cards.nth(2).boundingBox())!.y)
  await thread.evaluate((element) => { element.scrollTop = 0 })
  await expect(cards.nth(0)).toBeInViewport()
  await cards.nth(2).scrollIntoViewIfNeeded()
  await expect(cards.nth(2)).toBeInViewport()
})

test('the compact bookshelf shows reading progress after posting and reloading', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setup(page, { signedIn: true, paginated: true })
  await page.goto('/library')
  const card = page.getByRole('article', { name: book.title })
  const status = card.getByRole('combobox', { name: '読書状態' })
  const sort = page.getByRole('combobox', { name: '並べ替え' })
  await expect(sort).toHaveValue('read_recent')
  await expect(sort.locator('..').locator('svg')).toBeVisible()
  const filters = page.getByRole('tablist', { name: '絞り込み' })
  await expect(filters.getByRole('tab', { name: 'すべて', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(status).toHaveValue('want_to_read')
  await expect(card.getByText('未設定')).toBeVisible()
  await expect(card.getByRole('button', { name: '本棚から削除' }).locator('svg')).toBeVisible()
  await expect(page.getByRole('link', { name: '本を探す', exact: true })).toHaveCount(0)
  await expect(page.getByText('MY BOOKSHELF', { exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)

  await sort.selectOption({ label: '最近読んでない' })
  const filterApplied = page.waitForRequest((request) => {
    const query = new URL(request.url()).searchParams
    return query.get('sort') === 'read_oldest' && query.get('status') === 'reading' && !query.has('cursor')
  })
  const reading = filters.getByRole('tab', { name: '読書中', exact: true })
  await reading.click()
  await filterApplied
  await expect(reading).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: '条件に一致する本がありません' })).toBeVisible()
  await reading.press('ArrowLeft')
  await expect(filters.getByRole('tab', { name: '読みたい', exact: true })).toBeFocused()
  await card.getByRole('link', { name: '栞を残す', exact: true }).click()
  await page.getByRole('textbox', { name: /本文/ }).fill('本棚から残した栞')
  await page.getByLabel('ページ番号（任意）').fill('42')
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: '本棚', exact: true }).click()
  await expect(status).toHaveValue('reading')
  await expect(card.getByText('42ページ', { exact: true })).toBeVisible()
  await page.reload()
  await expect(status).toHaveValue('reading')
  await expect(card.getByText('42ページ', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/library-360.png' })
  await page.setViewportSize({ width: 1024, height: 800 })
  expect((await card.boundingBox())!.width).toBeLessThan(360)
  await page.screenshot({ path: 'test-results/library-1024.png' })
})

test('bookshelf tabs hide while reading further and reappear when scrolling back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await setup(page, { signedIn: true, manyBooks: true })
  await page.goto('/library')
  const scroller = page.getByRole('region', { name: '本棚の一覧' })
  const tabs = scroller.getByRole('tablist', { name: '絞り込み' })
  const selected = tabs.getByRole('tab', { selected: true })
  await expect(selected).toHaveText('すべて')
  expect(await selected.locator('span').evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(52, 104, 75)')
  await expect(scroller.getByRole('listitem')).toHaveCount(15)

  const top = (await scroller.boundingBox())!.y
  await scroller.evaluate((element) => { element.scrollTop = 260 })
  await expect.poll(async () => {
    const box = (await tabs.boundingBox())!
    return box.y + box.height
  }).toBeLessThanOrEqual(top)
  await scroller.evaluate((element) => { element.scrollTop -= 50 })
  await expect.poll(async () => (await tabs.boundingBox())!.y).toBeGreaterThanOrEqual(top)
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test('guest browsing creates no account; first private save initializes auth, adds the book and saves once at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const mock = await setup(page)
  await page.goto(`/create?bookId=${bookId}`)
  await expect(page.getByRole('heading', { name: book.title })).toBeVisible()
  await expect(page.getByLabel('公開範囲')).toHaveValue('private')
  expect(mock.counts().signup).toBe(0)
  await page.getByRole('textbox', { name: /本文/ }).fill('初めての非公開栞')
  await page.getByLabel('公開範囲').selectOption('public')
  await page.getByRole('button', { name: '栞を投稿' }).click()
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
  await expect(page.getByRole('link', { name: '栞の流れ', exact: true })).toBeVisible()
  expect(mock.counts().signup).toBe(1)
})

test('network failure keeps input and retries without duplicate shelf registration or automatic POST retry', async ({ page }) => {
  const mock = await setup(page, { failSave: true })
  await page.goto(`/create?bookId=${bookId}`)
  await page.getByRole('textbox', { name: /本文/ }).fill('消えない下書き')
  await expect(page.getByRole('button', { name: '栞を投稿' })).toBeEnabled()
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page.getByRole('alert')).toContainText('一時的な保存失敗')
  expect(mock.counts().saves).toBe(1)
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveValue('消えない下書き')
  await page.getByRole('textbox', { name: /本文/ }).fill('修正して再試行')
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  await expect(page.getByText('修正して再試行', { exact: true })).toBeVisible()
  expect(mock.counts()).toMatchObject({ signup: 1, saves: 2, adds: 1 })
})

test('initialization failure preserves the draft and retry recovers the same anonymous session', async ({ page }) => {
  const mock = await setup(page, { failInit: true })
  await page.goto(`/create?bookId=${bookId}`)
  await page.getByRole('textbox', { name: /本文/ }).fill('認証失敗でも残す下書き')
  await expect(page.getByRole('button', { name: '栞を投稿' })).toBeEnabled()
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page.getByRole('button', { name: 'もう一度試す' })).toBeVisible()
  expect(mock.counts()).toMatchObject({ signup: 1, saves: 0, adds: 0 })
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveValue('認証失敗でも残す下書き')
  await page.getByRole('button', { name: 'もう一度試す' }).click()
  await expect(page.getByRole('button', { name: 'もう一度試す' })).toHaveCount(0)
  await page.getByRole('button', { name: '栞を投稿' }).click()
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
  await expect(page.getByRole('link', { name: 'Xで共有' })).toBeVisible()
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
  await expect(page.getByRole('button', { name: '栞を投稿' })).toBeEnabled()
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page.getByRole('alert')).toContainText('正式登録')
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveValue('公開を試した下書き')
  await page.getByLabel('公開範囲').selectOption('private')
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts().adds).toBe(1)
})

test('library selection supports later pages and uses its userBookId without registering again', async ({ page }) => {
  const mock = await setup(page, { signedIn: true, anonymous: true, paginated: true })
  await page.goto(`/create?userBookId=${shelfId}`)
  await page.getByRole('button', { name: '本棚の続きを読み込む' }).click()
  await expect(page.getByRole('heading', { name: book.title })).toBeVisible()
  await page.getByRole('textbox', { name: /本文/ }).fill('本棚からの栞')
  await page.getByRole('button', { name: '栞を投稿' }).click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts()).toMatchObject({ adds: 0, saves: 1, signup: 0 })
})

for (const width of [360, 1024]) test(`composer steps, history and submit placement at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  const mock = await setup(page, { signedIn: true, manyBooks: true, history: true })
  await page.route(`${origin}/api/v1/me/preferences`, (route) => route.fulfill({ json: { feedContentMode: 'tap' } }))
  await page.goto('/create')
  const steps = page.getByRole('list', { name: '投稿の手順' })
  await expect(steps.locator('[aria-current="step"]').getByRole('heading', { name: '本を選ぶ' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '栞を残す' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /本文/ })).toHaveCount(0)
  const searchBox = await page.getByRole('button', { name: '検索', exact: true }).boundingBox()
  const scanBox = await page.getByRole('button', { name: 'バーコード', exact: true }).boundingBox()
  expect(scanBox!.x).toBeGreaterThan(searchBox!.x)
  expect(scanBox!.y).toBe(searchBox!.y)

  const lastBook = page.getByRole('button', { name: '投稿する本：本棚の本 15', exact: true })
  await lastBook.scrollIntoViewIfNeeded()
  const heights = await page.getByRole('region', { name: '本棚', exact: true }).getByRole('button', { name: /^投稿する本：/ })
    .evaluateAll((books) => books.map((book) => book.getBoundingClientRect().height))
  expect(new Set(heights).size).toBe(1)
  await page.getByRole('button', { name: `投稿する本：${book.title}`, exact: true }).click()
  await expect.poll(() => mock.counts().libraryPages).toBeGreaterThanOrEqual(2)
  await expect(page).toHaveURL(`/create?userBookId=${shelfId}`)
  await expect(steps.locator('[aria-current="step"]').getByRole('heading', { name: '投稿する' })).toBeVisible()
  await expect(page.getByRole('heading', { name: book.title })).toBeVisible()
  await expect(page.getByLabel('公開範囲')).toHaveValue('public')

  await expect(page.getByText('前に残した栞')).toHaveCount(0)
  const history = page.locator('details')
  const historyToggle = history.locator('summary')
  await expect(historyToggle.locator('svg')).toBeVisible()
  await historyToggle.click()
  await expect(page.getByText('前に残した栞')).toBeVisible()
  await expect(history.locator('time').first()).toHaveAttribute('datetime', initial.createdAt)
  await expect(page.getByText('過去のネタバレ本文')).toBeVisible()
  await expect(history.getByRole('button', { name: /本文を(表示|閉じる)/ })).toHaveCount(0)
  await historyToggle.click()
  await expect(page.getByText('過去のネタバレ本文')).toHaveCount(0)

  const field = page.getByRole('textbox', { name: /本文/ })
  const originalHeight = (await field.boundingBox())!.height
  for (const input of [field, page.getByLabel('ページ番号（任意）'), page.getByLabel('公開範囲')]) {
    await input.focus()
    await expect(input).toHaveCSS('outline-offset', '-2px')
    await expect(input).toHaveCSS('outline-width', '2px')
  }
  await field.fill('複数行の栞を書きます。\n'.repeat(10))
  expect((await field.boundingBox())!.height).toBeGreaterThan(originalHeight)
  await expect(field).toHaveCSS('resize', 'none')
  await field.fill('短い栞')
  expect((await field.boundingBox())!.height).toBe(originalHeight)

  const submit = page.getByRole('button', { name: '栞を投稿', exact: true })
  const spoiler = await page.getByLabel('ネタバレを含む').boundingBox()
  expect((await submit.boundingBox())!.y).toBeGreaterThan(spoiler!.y + spoiler!.height)
  expect(await submit.evaluate((button) => {
    for (let node: Element | null = button; node; node = node.parentElement) {
      if (['fixed', 'sticky'].includes(getComputedStyle(node).position)) return false
    }
    return true
  })).toBe(true)
  await submit.click()
  await expect(page).toHaveURL(`/bookmarks/${bookmarkId}`)
  expect(mock.counts()).toMatchObject({ saves: 1, adds: 0 })
  expect(mock.bodies[0]).toMatchObject({ content: '短い栞', visibility: 'public' })
})

test('selecting a search result opens the composer without starting a guest session', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const mock = await setup(page)
  await page.route(`${origin}/api/v1/books/search?**`, (route) => {
    expect(new URL(route.request().url()).searchParams.get('q')).toBe('栞')
    return route.fulfill({ json: { items: [{ ...book, localBookId: bookId, provider: null, providerId: null }] } })
  })
  await page.goto('/create')
  await page.getByRole('button', { name: '検索', exact: true }).click()
  const query = page.getByLabel('書名・著者名・ISBN')
  await query.focus()
  await expect(query).toHaveCSS('outline-offset', '-2px')
  await expect(query).toHaveCSS('outline-width', '2px')
  await query.fill('栞')
  await page.getByRole('button', { name: '検索する', exact: true }).click()
  await page.getByRole('button', { name: `投稿する本：${book.title}`, exact: true }).click()
  await expect(page).toHaveURL(`/create?bookId=${bookId}`)
  await expect(page.getByRole('heading', { name: '投稿する' })).toBeFocused()
  expect(mock.counts().signup).toBe(0)
  await page.getByRole('button', { name: '本を選ぶ', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本を選ぶ' })).toBeFocused()
})

test('a single scanned ISBN is imported and opens the composer', async ({ page }) => {
  const isbn = '9784101010014'
  await setup(page)
  await page.addInitScript((isbn) => {
    class Detector {
      static async getSupportedFormats() { return ['ean_13'] }
      async detect() { return [{ rawValue: isbn }] }
    }
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: Detector })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() { document.documentElement.dataset.cameraStopped = 'true' } }] }),
    } })
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA })
    HTMLMediaElement.prototype.play = async () => {}
  }, isbn)
  await page.route(`${origin}/api/v1/books/search?**`, (route) => {
    expect(new URL(route.request().url()).searchParams.get('q')).toBe(isbn)
    return route.fulfill({ json: { items: [{ ...book, isbn13: isbn, localBookId: null, provider: 'openbd', providerId: isbn }] } })
  })
  await page.route(`${origin}/api/v1/books/import`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'openbd', providerId: isbn })
    return route.fulfill({ status: 201, json: { ...book, isbn13: isbn, source: 'openbd' } })
  })
  await page.goto('/create')
  await page.getByRole('button', { name: 'バーコード', exact: true }).click()
  await expect(page).toHaveURL(`/create?bookId=${bookId}`)
  await expect(page.getByRole('heading', { name: '投稿する' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'true')
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
