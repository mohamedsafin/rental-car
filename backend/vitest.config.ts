import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Backend tests hit the DB; run them sequentially to keep state predictable.
    fileParallelism: false,

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',

      // Only the code that carries business rules. Excluding the rest is not
      // about flattering the number - it is so the number MEANS something.
      // Route files are thin wiring already exercised end-to-end by Supertest;
      // counting them would inflate coverage while telling us nothing about
      // whether the pricing engine is tested.
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/config/**',
        'src/types/**',
        // Generated or vendor-shaped code.
        'src/**/*.d.ts',
      ],

      // A floor, not a target. It fails the build if coverage DROPS, which is
      // the useful property; chasing a higher number by testing getters is
      // not. Raise it when real gaps are closed, never to hit a round figure.
      thresholds: {
        lines: 65,
        functions: 65,
        statements: 65,
        branches: 60,
      },
    },
  },
});
