import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/bookmarks', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:5194', channel: 'chrome', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  outputDir: './test-results/bookmarks', reporter: 'list',
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5194 --strictPort', url: 'http://127.0.0.1:5194',
    reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore',
    env: { VITE_API_BASE_URL: 'http://127.0.0.1:8797', VITE_SUPABASE_URL: 'https://bookmarks-e2e.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_bookmarks_mock' } },
})
