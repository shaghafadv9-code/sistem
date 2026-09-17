import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: './',
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': 'http://127.0.0.1:3847',
      '/uploads': 'http://127.0.0.1:3847'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
