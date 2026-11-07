import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/shared-ui', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:5191', channel: 'chrome', headless: true, trace: 'off' },
  outputDir: './test-results/shared-ui', reporter: 'list',
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort',
    url: 'http://127.0.0.1:5191', reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore' },
})
