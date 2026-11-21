import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: { host: true, proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } } },
});
