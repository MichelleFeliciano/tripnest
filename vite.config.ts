import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // '/' locally and on a custom domain; '/tripnest/' on GitHub Pages (set by the deploy workflow).
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
