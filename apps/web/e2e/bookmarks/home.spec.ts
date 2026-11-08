import { test, expect } from '@playwright/test'

for (const width of [360, 1024]) test(`home timeline tabs, reveal and card navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  const scopes: string[] = []
  let signup = 0
  await page.route('https://bookmarks-e2e.supabase.co/**', (route) => { signup++; return route.fulfill({ status: 500 }) })
  const post = (index: number) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    author: { id: '00000000-0000-4000-8000-000000000090', displayName: '読書が好きな人', avatarUrl: null },
    book: { id: '00000000-0000-4000-8000-000000000080', title: 'ゆっくり読みたい、物語のつづき', author: '本の著者', coverUrl: null, isbn13: null },
    content: index === 2 ? 'ネタバレの本文' : `読書の記録${index}。心に残った言葉を、ここに少しずつ書き留めます。`,
    pageNumber: 42, visibility: 'public', isSpoiler: index === 2, likeCount: 3, replyCount: 1, likedByMe: false,
    createdAt: '2026-11-07T09:30:00Z', updatedAt: '2026-11-07T09:30:00Z',
  })
  await page.route('http://127.0.0.1:8797/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/feed') {
      scopes.push(url.searchParams.get('scope')!)
      return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [post(5)] : [post(1), post(2), post(3), post(4)],
        nextCursor: url.searchParams.has('cursor') ? null : 'next' } })
    }
    if (url.pathname === `/api/v1/bookmarks/${post(1).id}`) return route.fulfill({ json: post(1) })
    if (url.pathname.endsWith('/books/00000000-0000-4000-8000-000000000080/bookmarks')) {
      return route.fulfill({ json: { author: post(1).author, book: post(1).book, items: [post(1)], nextCursor: null } })
    }
    if (url.pathname.endsWith('/replies')) return route.fulfill({ json: { items: [], nextCursor: null } })
    return route.fulfill({ status: 404 })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ホーム', exact: true })).toHaveCount(0)
  const timeline = page.getByRole('region', { name: '投稿一覧' })
  const tabs = timeline.getByRole('tablist')
  const latest = tabs.getByRole('tab', { name: '新着順', exact: true })
  const following = tabs.getByRole('tab', { name: 'フォロー中', exact: true })
  const nav = page.getByRole('navigation', { name: 'メインメニュー' })
  const cards = timeline.getByRole('article', { name: '栞', exact: true })
  const first = cards.first()
  const firstBody = first.getByText(/読書の記録1。/)
  await expect(latest).toHaveAttribute('aria-selected', 'true')
  const underline = (tab: typeof latest) => tab.locator('span').evaluate((element) => getComputedStyle(element, '::after').backgroundColor)
  expect(await underline(latest)).toBe('rgb(52, 104, 75)')
  expect(await underline(following)).toBe('rgba(0, 0, 0, 0)')
  await expect(cards).toHaveCount(4)
  await expect(firstBody).toHaveCount(0)
  await first.getByRole('button', { name: '本文を表示', exact: true }).click()
  await expect(firstBody).toBeVisible()
  await expect(first.getByRole('button', { name: /本文を(閉じる|表示)/ })).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('ネタバレの本文', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '本文：タップして表示', exact: true }).click()
  const toggle = page.getByRole('button', { name: '本文：すべて表示', exact: true })
  await expect(toggle).toBeVisible()
  await expect(firstBody).toBeVisible()
  const firstPost = await first.boundingBox()
  expect(firstPost!.height).toBeLessThan(330)
  const book = first.getByRole('article', { name: /^書籍：/ })
  await expect(book).toContainText('42ページ')
  expect((await firstBody.boundingBox())!.y).toBeLessThan((await book.boundingBox())!.y)
  await expect(first.getByText('公開', { exact: true })).toHaveCount(0)
  const share = first.getByRole('link', { name: 'Xで共有' })
  const shareUrl = new URL((await share.getAttribute('href'))!)
  expect(shareUrl.searchParams.get('url')).toBe(new URL(`/bookmarks/${post(1).id}`, page.url()).href)
  await expect(share).toHaveAttribute('target', '_blank')
  await expect(page.getByText('ネタバレの本文', { exact: true })).toHaveCount(0)
  const area = (await timeline.boundingBox())!, control = (await toggle.boundingBox())!, navigation = (await nav.boundingBox())!
  expect(control.y + control.height).toBeLessThan(area.y + area.height)
  expect(control.y + control.height).toBeLessThan(navigation.y)
  expect(control.height).toBeGreaterThanOrEqual(44)
  expect((await latest.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: `test-results/home-${width}.png` })
  const spoiler = cards.nth(1).getByRole('button', { name: 'ネタバレ本文を表示', exact: true })
  await spoiler.click()
  await expect(page.getByText('ネタバレの本文', { exact: true })).toBeVisible()
  await expect(spoiler).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)

  await expect(timeline.getByRole('button', { name: 'もっと見る', exact: true })).toHaveCount(0)
  expect(scopes).toHaveLength(1)
  const banner = page.getByRole('banner')
  const header = (await banner.boundingBox())!
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2)
  await page.mouse.wheel(0, 500)
  expect(await timeline.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(cards).toHaveCount(5)
  const lastLike = timeline.getByRole('button', { name: 'いいね（3）', exact: true }).last()
  await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect.poll(async () => {
    const box = (await tabs.boundingBox())!
    return box.y + box.height
  }).toBeLessThanOrEqual(area.y)
  expect((await lastLike.boundingBox())!.y).toBeLessThan(control.y)
  await lastLike.click()
  await expect(page.getByText('この操作にはGoogleでの登録とログインが必要です。')).toBeVisible()
  await timeline.evaluate((element) => { element.scrollTop -= 50 })
  await expect.poll(async () => (await tabs.boundingBox())!.y).toBeGreaterThanOrEqual(area.y)
  await expect(toggle).toBeInViewport()
  await latest.focus()
  await page.keyboard.press('ArrowRight')
  await expect(following).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'フォロー中の栞を見るには登録が必要です' })).toBeVisible()
  await latest.click()
  expect(scopes.every((value) => value === 'all')).toBe(true)
  await page.reload()
  await expect(toggle).toBeVisible()
  expect(signup).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(nav.getByRole('link')).toHaveCount(5)
  await expect(first.getByRole('link', { name: '返信（1）' })).toHaveAttribute('href', `/bookmarks/${post(1).id}#replies`)
  await expect(firstBody).toBeVisible()
  const body = (await firstBody.boundingBox())!
  await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)
  await expect(page).toHaveURL(`/bookmarks/${post(1).id}`)
  await expect(page.getByRole('link', { name: '栞の流れ', exact: true })).toBeVisible()

  await page.setViewportSize({ width, height: 420 })
  await page.goto('/books/manual')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await nav.getByRole('link', { name: 'ホーム', exact: true }).click()
  await expect(timeline).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect((await banner.boundingBox())!.y).toBe(0)
})
