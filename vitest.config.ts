import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      BOT_OWNER_NUMBER: '59170000001',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'error',
    },
  },
});
