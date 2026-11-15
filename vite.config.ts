import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the build works at a domain root and under /fretsense/ on GitHub Pages.
  base: './',
  plugins: [react()],
  server: { port: 5183, strictPort: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
