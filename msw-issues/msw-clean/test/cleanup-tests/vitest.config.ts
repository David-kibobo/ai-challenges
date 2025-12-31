// test/cleanup-tests/vitest.config.ts 
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    dir: './test/cleanup-tests',
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './setup-sse.ts')],
    testTimeout: 20000,
  },
});