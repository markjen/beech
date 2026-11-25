import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // Each Vitest worker owns its own Postgres schema (when TEST_DATABASE_URL
    // is set) or its own reused PGlite instance (via test/testDb.ts), so files
    // run in parallel in both modes without booting a fresh DB per file.
    fileParallelism: true,
    isolate: false,
  },
});
