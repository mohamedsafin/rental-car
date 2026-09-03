import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Backend tests hit the DB; run them sequentially to keep state predictable.
    fileParallelism: false,
  },
});
