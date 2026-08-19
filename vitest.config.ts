import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Deliberately standalone: the app's Vite config loads the TanStack Start and
// React Compiler plugins, none of which the pure-logic tests need.
export default defineConfig({
  resolve: {
    alias: { 
      '#': fileURLToPath(new URL('./src', import.meta.url)),
      '#tests': fileURLToPath(new URL('./tests', import.meta.url))  
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setupVitest.ts']
  },
});
