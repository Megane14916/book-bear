import { test, expect } from '@playwright/test'

for (const width of [360, 1024]) test(`home timeline controls and content do not overlap at ${width}px`, async ({ page }) => {
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
      return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [post(4)] : [post(1), post(2), post(3)],
        nextCursor: url.searchParams.has('cursor') ? null : 'next' } })
    }
    return route.fulfill({ status: 404 })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ホーム', exact: true })).toBeVisible()
  const timeline = page.getByRole('region', { name: '投稿一覧' })
  const dock = page.getByRole('group', { name: 'タイムラインの表示設定' })
  const nav = page.getByRole('navigation', { name: 'メインメニュー' })
  await expect(timeline.getByRole('article', { name: '栞', exact: true })).toHaveCount(3)
  await expect(page.getByText('ネタバレの本文', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '本文：タップして表示', exact: true }).click()
  await expect(page.getByRole('button', { name: '本文：すべて表示', exact: true })).toBeVisible()
  await expect(page.getByText(/読書の記録1。/)).toBeVisible()
  await expect(page.getByText('ネタバレの本文', { exact: true })).toHaveCount(0)
  const area = await timeline.boundingBox(), controls = await dock.boundingBox(), navigation = await nav.boundingBox()
  expect(Boolean(area && controls && navigation && area.y + area.height <= controls.y + 1 && controls.y + controls.height <= navigation.y + 1)).toBe(true)
  for (const name of ['表示範囲：全体', '本文：すべて表示']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.screenshot({ path: `test-results/home-${width}.png` })
  await page.getByRole('button', { name: 'もっと見る', exact: true }).click()
  await expect(timeline.getByRole('article', { name: '栞', exact: true })).toHaveCount(4)
  const lastLike = timeline.getByRole('button', { name: 'いいね（3）', exact: true }).last()
  await lastLike.scrollIntoViewIfNeeded()
  const like = await lastLike.boundingBox()
  expect(like!.y + like!.height).toBeLessThanOrEqual(controls!.y + 1)
  await lastLike.click()
  await expect(page.getByText('この操作にはGoogleでの登録とログインが必要です。')).toBeVisible()
  const scope = page.getByRole('button', { name: '表示範囲：全体', exact: true })
  await scope.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'フォロー中の栞を見るには登録が必要です' })).toBeVisible()
  await page.getByRole('button', { name: '表示範囲：フォロー中', exact: true }).click()
  expect(scopes.every((value) => value === 'all')).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: '本文：すべて表示', exact: true })).toBeVisible()
  expect(signup).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(nav.getByRole('link')).toHaveCount(5)
})
