import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // against a real Postgres (TEST_DATABASE_URL) every file resets the one
    // shared database, so run the files one after another; PGlite files each
    // have their own in-memory database and can run side by side
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
