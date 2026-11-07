import { test, expect } from '@playwright/test'

for (const width of [360, 1024]) test(`user results show only lazily loaded public books at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  const requests: string[] = [], loaded: string[] = []
  const userId = '00000000-0000-4000-8000-000000000001'
  const book = { id: '00000000-0000-4000-8000-000000000080', title: '公開栞のある本', author: '著者', coverUrl: null, isbn13: null }
  await page.route('http://127.0.0.1:8796/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url.pathname)
    if (url.pathname === '/api/v1/search/users') return route.fulfill({ json: { items: Array.from({ length: 30 }, (_, index) => ({
      id: index === 0 ? userId : `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      displayName: `公開範囲を守る読者 ${index + 1}`, avatarUrl: null, handle: null,
    })), nextCursor: null } })
    if (url.pathname.match(/\/users\/[^/]+\/books$/)) {
      loaded.push(url.pathname)
      expect(url.searchParams.get('limit')).toBe('6')
      if (url.pathname.includes(userId)) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        return route.fulfill({ json: { items: Array.from({ length: 6 }, (_, index) => ({ ...book,
          id: `00000000-0000-4000-8000-${String((url.searchParams.has('cursor') ? 200 : 100) + index).padStart(12, '0')}`,
          title: `公開栞のある本 ${url.searchParams.has('cursor') ? 7 + index : 1 + index}`,
        })), nextCursor: url.searchParams.has('cursor') ? null : 'next' } })
      }
      return route.fulfill({ json: { items: [], nextCursor: null } })
    }
    if (url.pathname.startsWith('/api/v1/books/')) return route.fulfill({ json: { ...book, id: url.pathname.split('/').at(-1), publisher: null, totalPages: null, source: 'manual' } })
    return route.fulfill({ status: 404 })
  })
  await page.goto('/search?type=users&q=読者')
  await expect(page.getByRole('link', { name: '公開範囲を守る読者 1', exact: true })).toBeVisible()
  const first = page.getByRole('link', { name: '公開範囲を守る読者 1', exact: true }).locator('..')
  await expect(first.getByRole('link', { name: '書籍詳細：公開栞のある本 1', exact: true })).toBeVisible()
  expect(loaded.length).toBeLessThan(30)
  await first.getByRole('button', { name: '本の続きを見る' }).click()
  const last = first.getByRole('link', { name: '書籍詳細：公開栞のある本 12', exact: true })
  await expect(last).toBeAttached()
  const strip = first.getByLabel('公開した本のプレビュー')
  expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  await last.scrollIntoViewIfNeeded()
  expect(await strip.evaluate((node) => node.scrollLeft > 0)).toBe(true)
  await page.screenshot({ path: `test-results/user-books-${width}.png` })
  const target = await last.getAttribute('href')
  await last.click()
  await expect(page).toHaveURL(target!)
  expect(requests.some((path) => path.startsWith('/api/v1/me/books'))).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
