import { test, expect, type Page } from '@playwright/test'

const id = '00000000-0000-4000-8000-000000000001'
async function setup(page: Page) {
  const calls: string[] = []
  const book = { id, title: '物語のつづきを探して', author: '本の著者', coverUrl: null, isbn13: null, totalPages: null, publisher: null, source: 'manual' }
  await page.route('http://127.0.0.1:8796/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    calls.push(url.pathname)
    if (url.pathname === '/api/v1/books/search') return route.fulfill({ json: { items: Array.from({ length: 5 }, (_, index) => ({
      ...book, title: `${book.title} ${index + 1}`, localBookId: id, provider: null, providerId: null,
    })) } })
    if (url.pathname === '/api/v1/search/posts') return route.fulfill({ json: { items: [], nextCursor: null } })
    if (url.pathname === '/api/v1/search/users') return route.fulfill({ json: { items: [], nextCursor: null } })
    if (url.pathname === `/api/v1/books/${id}`) return route.fulfill({ json: book })
    return route.fulfill({ status: 404 })
  })
  return calls
}

for (const width of [360, 1024]) test(`search layout, fixed scanner action and existing tabs at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  const calls = await setup(page)
  await page.goto('/search')
  await expect(page.getByText('次に読む一冊を探しましょう')).toBeVisible()
  expect(calls).toHaveLength(0)
  const search = page.getByRole('search'), tabs = page.getByRole('navigation', { name: '検索対象' })
  const results = page.getByRole('region', { name: '検索結果' })
  const scanner = page.getByRole('button', { name: 'バーコードを読み取る', exact: true })
  const nav = page.getByRole('navigation', { name: 'メインメニュー' })
  const formBox = await search.boundingBox(), tabsBox = await tabs.boundingBox(), resultsBox = await results.boundingBox()
  const scannerBox = await scanner.boundingBox(), navBox = await nav.boundingBox()
  expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(tabsBox!.y)
  expect(tabsBox!.y + tabsBox!.height).toBeLessThanOrEqual(resultsBox!.y)
  expect(resultsBox!.y + resultsBox!.height).toBeLessThanOrEqual(scannerBox!.y)
  expect(scannerBox!.y + scannerBox!.height).toBeLessThanOrEqual(navBox!.y)
  expect(scannerBox!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: `test-results/search-empty-${width}.png` })
  await page.getByRole('searchbox').focus()
  await expect(scanner).toHaveCount(0)
  await page.getByRole('searchbox').fill('物語')
  await page.keyboard.press('Enter')
  await expect(scanner).toBeVisible()
  await expect(page.getByRole('link', { name: '詳細を見る', exact: true })).toHaveCount(5)
  await page.screenshot({ path: `test-results/search-results-${width}.png` })
  const last = page.getByRole('link', { name: '詳細を見る', exact: true }).last()
  await last.scrollIntoViewIfNeeded()
  expect((await scanner.boundingBox())!.y).toBe(scannerBox!.y)
  expect((await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThanOrEqual(scannerBox!.y)
  await last.click()
  await expect(page).toHaveURL(`/books/${id}`)
  await page.goBack()
  await expect(page.getByRole('searchbox')).toHaveValue('物語')
  await tabs.getByRole('link', { name: '栞', exact: true }).click()
  await expect(page.getByText('「物語」に一致する公開栞は見つかりませんでした。')).toBeVisible()
  await expect(scanner).toHaveCount(0)
  await tabs.getByRole('link', { name: 'ユーザー', exact: true }).click()
  await expect(page.getByText('「物語」に一致するユーザーは見つかりませんでした。')).toBeVisible()
  await tabs.getByRole('link', { name: '書籍', exact: true }).click()
  await expect(scanner).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('camera permission failure still focuses manual ISBN input', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class {
      static async getSupportedFormats() { return ['ean_13'] }
    } })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('denied', 'NotAllowedError') } })
  })
  await page.goto('/search')
  await page.getByRole('button', { name: 'バーコードを読み取る', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('カメラの利用が許可されませんでした。')
  await expect(page.getByRole('searchbox')).toBeFocused()
  await expect(page.getByRole('button', { name: 'バーコードを読み取る', exact: true })).toHaveCount(0)
})

test('scanner action stays hidden while the visual viewport is reduced by a keyboard', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: innerHeight, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
  await page.goto('/search')
  const scanner = page.getByRole('button', { name: 'バーコードを読み取る', exact: true })
  await expect(scanner).toBeVisible()
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: innerHeight - 260 })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect(scanner).toHaveCount(0)
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: innerHeight })
    window.visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect(scanner).toBeVisible()
})
