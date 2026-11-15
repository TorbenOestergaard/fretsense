import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { commitHash, version } from './build-info.js';

export default defineConfig({
  // Relative asset paths, so the build works at a domain root and under /fretsense/ on GitHub Pages.
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commitHash()),
  },
  server: { port: 5183, strictPort: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
