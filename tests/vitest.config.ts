import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['../mcp-server/src/**/*'],
      exclude: ['node_modules/', 'build/', 'coverage/']
    },
    globalSetup: './src/utils/global-setup.ts'
  }
});
