import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node', setupFiles: ['fake-indexeddb/auto'], testTimeout: 20000 }
});
