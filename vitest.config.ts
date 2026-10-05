/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./__tests__/setupIndexedDb.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/.claude/**'],
  },
});
