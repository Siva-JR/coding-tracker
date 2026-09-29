import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: reach the API through /backend so the session cookie stays same-origin (no CORS or SameSite setup needed locally).
    proxy: { '/backend': { target: process.env.BACKEND_URL || 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/backend/, '') } },
  },
});
