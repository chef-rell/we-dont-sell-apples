import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Agent worktrees under .claude/ contain full repo copies — without this
    // exclude, vitest runs their test suites too and inflates the count.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
})
