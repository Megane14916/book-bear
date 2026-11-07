import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 360, height: 740 } })
test.beforeEach(async ({ page }) => { await page.goto('/e2e/shared-ui/fixture.html') })

test('book card links and actions work with the keyboard above fixed navigation', async ({ page }) => {
  const title = page.getByRole('link', { name: '長い書名'.repeat(30), exact: true }).first()
  await title.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#book$/)
  await page.keyboard.press('Tab')
  const action = page.getByRole('button', { name: '本棚に追加', exact: true })
  await expect(action).toBeFocused()
  const button = await action.boundingBox()
  const nav = await page.getByRole('navigation', { name: 'メインメニュー' }).boundingBox()
  expect(Boolean(button && nav && button.height >= 44 && button.y + button.height <= nav.y)).toBe(true)
  await page.keyboard.press('Space')
  await expect(page.getByText('書籍操作を受け付けました')).toBeVisible()
})

test('360px cards wrap and keyboard disclosure protects spoiler text', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const body = page.getByRole('article', { name: '栞', exact: true }).first().getByRole('button')
  await expect(page.getByText('ネタバレの本文', { exact: false })).toHaveCount(0)
  await body.focus()
  await page.keyboard.press('Enter')
  await expect(body).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('ネタバレの本文', { exact: false })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(body).toHaveAttribute('aria-expanded', 'false')
  await page.getByLabel('すべて表示', { exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByText('通常の本文', { exact: true })).toBeVisible()
  await expect(page.getByText('ネタバレの本文', { exact: false })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByLabel('タップして表示')).toBeChecked()
  await expect(page.getByText('通常の本文', { exact: true })).toHaveCount(0)
})

test('retry, last action and fixed navigation remain keyboard accessible', async ({ page }) => {
  const retry = page.getByRole('button', { name: 'もう一度試す' })
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('再試行を受け付けました')).toBeVisible()
  const action = page.getByRole('link', { name: '本を探す', exact: true })
  await action.focus()
  await action.scrollIntoViewIfNeeded()
  await expect(action).toBeFocused()
  const actionBox = await action.boundingBox()
  const navBox = await page.getByRole('navigation', { name: 'メインメニュー' }).boundingBox()
  expect(Boolean(actionBox && navBox && actionBox.y + actionBox.height <= navBox.y)).toBe(true)
  expect(await action.evaluate((element) => getComputedStyle(element).outlineStyle !== 'none')).toBe(true)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'ホーム', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '検索', exact: true })).toBeFocused()
})

test('bottom navigation crossfades to the rendered page and respects reduced motion', async ({ page }) => {
  await page.addInitScript(() => {
    const startTransition = document.startViewTransition.bind(document)
    document.startViewTransition = (update) => {
      const transition = startTransition(update)
      const root = document.documentElement
      root.dataset.transitions = String(Number(root.dataset.transitions ?? 0) + 1)
      void transition.ready.then(() => {
        root.dataset.destination = document.querySelector('main h1')?.textContent ?? ''
        root.dataset.outgoing = getComputedStyle(root, '::view-transition-old(root)').animationName
        root.dataset.incoming = getComputedStyle(root, '::view-transition-new(root)').animationName
      }, () => {})
      return transition
    }
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: '新着順', exact: true })).toBeVisible()
  await expect(page.getByRole('banner')).toHaveCSS('height', '60px')
  await expect(page.getByText('読書の足あと', { exact: true })).toHaveCount(0)
  const nav = page.getByRole('navigation', { name: 'メインメニュー' })
  await expect(nav.locator('svg')).toHaveCount(5)
  const post = nav.getByRole('link', { name: '投稿', exact: true })
  await expect(post.locator('span[aria-hidden]')).toHaveCSS('background-color', 'rgb(52, 104, 75)')

  const root = page.locator('html')
  for (const [label, heading] of [['検索', '本を探す'], ['投稿', '本を選ぶ'], ['本棚', '本棚'], ['マイページ', 'マイページ']]) {
    const link = nav.getByRole('link', { name: label, exact: true })
    await link.click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(link).toHaveAttribute('aria-current', 'page')
    await expect(root).toHaveAttribute('data-destination', new RegExp(`${heading}$`))
  }
  await expect(root).toHaveAttribute('data-outgoing', /fade-out/)
  await expect(root).toHaveAttribute('data-incoming', /fade-in/)
  await expect(root).toHaveAttribute('data-transitions', '4')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await nav.getByRole('link', { name: 'ホーム', exact: true }).click()
  await expect(page.getByRole('tab', { name: '新着順', exact: true })).toBeVisible()
  await expect(root).toHaveAttribute('data-transitions', '4')
})
