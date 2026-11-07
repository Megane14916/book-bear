import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const live = process.argv.includes('--project=live') || process.env.AUTH_E2E_LIVE === '1'
process.env.AUTH_E2E_LIVE = live ? '1' : '0'
function readSettings(path: string): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(resolve(import.meta.dirname, path), 'utf8').split(/\r?\n/)
      .filter((line) => /^\s*[A-Z][A-Z0-9_]*\s*=/.test(line))
      .map((line) => { const split = line.indexOf('='); return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/, '$2')] }))
  } catch { throw new Error('開発用接続設定が不足しています。src/lib/auth/README.mdを参照してください。') }
}

let authUrl = 'https://auth-e2e.supabase.co', key = 'sb_publishable_e2e_mock'
let databaseConnection = ''
if (live) {
  const auth = readSettings('../api/.env.auth.local')
  const api = readSettings('../api/.dev.vars')
  const deploy = readSettings('../api/.env.deploy.local')
  const db = readSettings('../api/.env.local')
  try {
    const url = new URL(auth.SUPABASE_URL)
    const database = new URL(db.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE)
    const ref = url.hostname.split('.')[0]
    const checks = {
      authUrl: url.protocol === 'https:' && /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) && !url.username && !url.password,
      authApiMatch: auth.SUPABASE_URL.replace(/\/$/, '') === api.SUPABASE_URL.replace(/\/$/, ''),
      authDeployMatch: auth.SUPABASE_URL.replace(/\/$/, '') === deploy.SUPABASE_URL.replace(/\/$/, ''),
      publishableKey: /^sb_publishable_[A-Za-z0-9_-]+$/.test(auth.SUPABASE_PUBLISHABLE_KEY) && !auth.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_'),
      databaseMatch: database.hostname === `db.${ref}.supabase.co` ||
        (database.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(database.username).endsWith(`.${ref}`)),
    }
    const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
    if (failed.length) throw new Error(`CONFIG:${failed.join(',')}`)
    authUrl = url.origin
    key = auth.SUPABASE_PUBLISHABLE_KEY
    databaseConnection = db.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
  } catch (error) {
    const reason = error instanceof Error && error.message.startsWith('CONFIG:') ? error.message : 'CONFIG:format'
    throw new Error(`開発用Auth/API/DBの接続設定を確認してください（${reason}）。値は出力しません。`)
  }
}
process.env.AUTH_E2E_AUTH_URL = authUrl
const apiOrigin = 'http://127.0.0.1:8795'
process.env.AUTH_E2E_API_ORIGIN = apiOrigin

export default defineConfig({
  projects: [{ name: live ? 'live' : 'mock' }],
  testDir: './e2e/auth', workers: 1, retries: 0, timeout: 45_000,
  reporter: 'list', outputDir: './test-results/auth',
  use: { baseURL: 'http://127.0.0.1:5190', channel: 'chrome', headless: true,
    trace: 'off', video: 'off', screenshot: 'off' },
  webServer: [
    ...(live ? [{ command: 'pnpm exec wrangler dev --port 8795 --inspector-port 9245 --var CORS_ORIGIN:http://127.0.0.1:5190',
      cwd: resolve(import.meta.dirname, '../api'), url: `${apiOrigin}/api/v1/health`, reuseExistingServer: false,
      timeout: 90_000, stdout: 'ignore' as const, stderr: 'ignore' as const,
      env: { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseConnection } }] : []),
    { command: 'pnpm exec vite --host 127.0.0.1 --port 5190 --strictPort',
      url: 'http://127.0.0.1:5190', reuseExistingServer: false, timeout: 30_000,
      stdout: 'ignore', stderr: 'ignore',
      env: { VITE_API_BASE_URL: apiOrigin, VITE_SUPABASE_URL: authUrl, VITE_SUPABASE_PUBLISHABLE_KEY: key } },
  ],
})
