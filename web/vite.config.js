import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev-only: the backend sends no CORS headers yet, so talk to it same-origin via /backend.
    proxy: { '/backend': { target: process.env.BACKEND_URL || 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/backend/, '') } },
  },
});
