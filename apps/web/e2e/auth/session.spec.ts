import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// Never write storageState, HAR, traces, headers or session bodies to artifacts.
const live = process.env.AUTH_E2E_LIVE === '1'
const authUrl = process.env.AUTH_E2E_AUTH_URL!
const apiOrigin = process.env.AUTH_E2E_API_ORIGIN!
let context: BrowserContext, page: Page
let signupCount = 0, putCount = 0, sequence = 0, currentUser = '', initialized = false
let firstUid = ''
const profile = (id: string) => ({ id, displayName: 'ゲスト', avatarUrl: null, handle: null, bio: null,
  followersCount: 0, followingCount: 0, isAnonymous: true })
function mockSession(newUser: boolean) {
  if (newUser) { currentUser = `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`; initialized = false }
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: currentUser, exp: now + 3600, iat: now,
    role: 'authenticated', aud: 'authenticated', is_anonymous: true, jti: String(++sequence) })}.dGVzdA`
  return { access_token: token, refresh_token: `mock-refresh-${sequence}`, token_type: 'bearer', expires_in: 3600,
    expires_at: now + 3600, user: { id: currentUser, is_anonymous: true, aud: 'authenticated', role: 'authenticated',
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
}
async function sessionSnapshot() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('sb-') && name.endsWith('-auth-token'))
    if (!key) return null
    try { const data = JSON.parse(localStorage.getItem(key)!); return { uid: String(data.user.id), token: String(data.access_token) } }
    catch { return null }
  })
}
async function ready() {
  await expect(page.getByText('本人データ取得：許可')).toBeVisible()
}
async function prepare() {
  await page.getByRole('button', { name: '保存前処理を確認', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('保存前の認証・初期化・認証付きGET /meが成功しました。')
  await ready()
}

test.describe.serial(live ? 'development services' : 'mock services', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    if (!live) {
      await context.route(`${authUrl}/auth/v1/**`, async (route) => {
        const path = new URL(route.request().url()).pathname
        const json = path.endsWith('/signup') ? mockSession(true) : path.endsWith('/token') ? mockSession(false) : null
        await route.fulfill(json ? { status: 200, json } : { status: 204 })
      })
      await context.route(`${apiOrigin}/api/v1/**`, async (route) => {
        const request = route.request()
        if (new URL(request.url()).pathname.endsWith('/health')) return route.fulfill({ json: { status: 'ok' } })
        if (request.method() === 'PUT') initialized = true
        await route.fulfill(initialized ? { json: profile(currentUser) }
          : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'プロフィールがありません。' } } })
      })
    }
    context.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin === authUrl && url.pathname.endsWith('/signup')) signupCount++
      if (url.origin === apiOrigin && url.pathname === '/api/v1/me' && request.method() === 'PUT') putCount++
    })
    page = await context.newPage()
  })
  test.afterAll(async () => { await context?.close() })

  test('1 browsing does not create an anonymous user', async () => {
    await page.goto('/?auth-check=1')
    await expect(page.getByText(/状態：guest/)).toBeVisible()
    await page.getByRole('link', { name: '検索', exact: true }).click()
    await expect(page.getByRole('heading', { name: '本を探す' })).toBeVisible()
    expect(signupCount === 0 && putCount === 0).toBe(true)
    expect(await sessionSnapshot() === null).toBe(true)
    await page.goto('/?auth-check=1')
  })

  test('2 first save preparation signs in and initializes through the real client', async () => {
    await prepare()
    const session = await sessionSnapshot()
    expect(Boolean(session?.uid)).toBe(true)
    firstUid = session!.uid
    expect(signupCount === 1 && putCount >= 1).toBe(true)
  })

  test('3 reload keeps the same UID without another signup', async () => {
    await page.reload()
    await ready()
    expect((await sessionSnapshot())?.uid === firstUid).toBe(true)
    expect(signupCount === 1).toBe(true)
    await prepare()
  })

  test('4 refreshes JWT and authenticates the next API request', async () => {
    const before = await sessionSnapshot()
    const response = page.waitForResponse((response) => response.url() === `${apiOrigin}/api/v1/me` && response.request().method() === 'GET')
    await page.getByRole('button', { name: 'JWT更新を確認', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('JWT更新後の本人確認が成功しました。')
    const after = await sessionSnapshot()
    const me = await response
    expect(Boolean(before && after && before.uid === after.uid && before.token !== after.token)).toBe(true)
    expect(me.ok()).toBe(true)
    expect((await me.request().allHeaders()).authorization === `Bearer ${after!.token}`).toBe(true)
  })

  test('5 signout and a different user cannot retain the old cache', async () => {
    await page.getByRole('button', { name: '検証キャッシュを作成', exact: true }).click()
    await expect(page.getByText('検証キャッシュ件数：3')).toBeVisible()
    await page.getByRole('button', { name: 'サインアウト', exact: true }).click()
    await expect(page.getByText(/状態：guest/)).toBeVisible()
    await expect(page.getByText('検証キャッシュ件数：0')).toBeVisible()
    await prepare()
    expect((await sessionSnapshot())?.uid !== firstUid).toBe(true)
    await expect(page.getByText('検証キャッシュ件数：0')).toBeVisible()
  })

  test('6 retries initialization after an injected 503 without another signup', async () => {
    await page.getByRole('button', { name: 'サインアウト', exact: true }).click()
    await expect(page.getByText(/状態：guest/)).toBeVisible()
    let injected = false
    await page.route(`${apiOrigin}/api/v1/me`, async (route) => {
      if (!injected && route.request().method() === 'PUT') {
        injected = true
        return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: '検証用の一時的な初期化失敗' } } })
      }
      await route.fallback()
    })
    let getCount = 0
    const onRequest = (request: import('@playwright/test').Request) => {
      if (request.url() === `${apiOrigin}/api/v1/me` && request.method() === 'GET') getCount++
    }
    page.on('request', onRequest)
    await page.getByRole('button', { name: '保存前処理を確認', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('検証用の一時的な初期化失敗')
    expect(injected && getCount === 0).toBe(true)
    const countBefore = signupCount
    await prepare()
    expect(signupCount === countBefore).toBe(true)
    page.off('request', onRequest)
    await page.getByRole('button', { name: 'サインアウト', exact: true }).click()
    await expect(page.getByText(/状態：guest/)).toBeVisible()
  })
})
