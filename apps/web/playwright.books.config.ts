import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/books', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:5193', channel: 'chrome', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  outputDir: './test-results/books', reporter: 'list',
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5193 --strictPort', url: 'http://127.0.0.1:5193',
    reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore',
    env: { VITE_API_BASE_URL: 'http://127.0.0.1:8796', VITE_SUPABASE_URL: 'https://books-e2e.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_books_mock' } },
})
