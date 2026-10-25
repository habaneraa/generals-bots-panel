import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import {
  DEFAULT_API_PORT,
  DEV_WEB_PORT,
  LOOPBACK_HOST,
  parseApiPort,
} from '../../config/runtime.js';

export default defineConfig(({ command }) => {
  // 构建静态产物不需要监听端口，只有开发代理才读取运行环境。
  const apiPort = command === 'serve' ? parseApiPort(process.env.PORT) : DEFAULT_API_PORT;
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react(), tailwindcss()],
    server: {
      host: LOOPBACK_HOST,
      port: DEV_WEB_PORT,
      strictPort: true,
      proxy: { '/api': { target: `http://${LOOPBACK_HOST}:${apiPort}`, changeOrigin: true } },
    },
    build: { outDir: '../../dist/web', emptyOutDir: true },
  };
});
