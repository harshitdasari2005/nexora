/**
 * @nexora/app-web — Vite configuration.
 *
 * The dev server proxies `/api/*` to the modular monolith
 * (http://localhost:3001, or NEXORA_API_PORT) so the SPA and the API share an origin in
 * development — session cookies flow without CORS (SAD.md §13.1).
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env['NEXORA_API_PORT'] ?? '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
