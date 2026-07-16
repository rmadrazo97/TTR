import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The console app renders server-side JSX via hono/jsx; transform .tsx accordingly.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
  },
  test: {
    // Unit tests only; DB/S3/SMTP integration is exercised by the live pipeline, not vitest.
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
    passWithNoTests: true,
  },
});
