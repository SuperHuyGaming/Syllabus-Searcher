import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production CloudFront sends /api/* to Lambda, so the client always calls
// same-origin /api. Locally Vite forwards those calls to the API dev server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    // e2e/ holds Playwright tests, which run in a real browser instead.
    include: ['src/**/*.test.{js,jsx}'],
  },
});
