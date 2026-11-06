import { defineConfig } from 'playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.RESHIS_PYTHON || 'python';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    channel: process.env.BROWSER_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 18000`,
      cwd: root,
      url: 'http://127.0.0.1:18000/api/health',
      env: { COOKIE_SECURE: 'false', DB_PATH: path.join(root, 'frontend', 'test-results', 'e2e.sqlite3') },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5179 --strictPort',
      url: 'http://127.0.0.1:5179',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:18000' },
    },
  ],
});
