import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { proxy } from './server.mjs';
export default defineConfig({
  plugins: [react(), { name: 'personal-api-proxy', configureServer(server) { server.middlewares.use(proxy); }, configurePreviewServer(server) { server.middlewares.use(proxy); } }],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist' }
});
