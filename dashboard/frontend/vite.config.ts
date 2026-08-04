/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Photino host serves the built app and the API from one origin, so a
// relative base keeps asset URLs working when loaded from the host's server.
//
// For `npm run dev`, run the host on the port below (DASHBOARD_PORT) and Vite
// proxies /api to it, so the same relative fetches in src/api/client.ts work
// against the real endpoints during frontend iteration.
const DEV_HOST_PORT = 5170;

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${DEV_HOST_PORT}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
