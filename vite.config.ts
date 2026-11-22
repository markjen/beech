import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/beech/), any static
// host, and inside the Capacitor native shells (file-like origin).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
});
