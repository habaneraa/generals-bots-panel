import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEV_WEB_PORT, LOOPBACK_HOST, parseApiPort } from '../../config/runtime.js';

const apiPort = parseApiPort(process.env.PORT);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    host: LOOPBACK_HOST,
    port: DEV_WEB_PORT,
    strictPort: true,
    proxy: { '/api': { target: `http://${LOOPBACK_HOST}:${apiPort}`, changeOrigin: true } },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
