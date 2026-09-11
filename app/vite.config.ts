/**
 * Vite is started as `vite app`, so this directory is the project root and
 * `app/index.html` is the entry document.
 *
 * The one thing worth understanding here is the proxy. Everything under /api
 * is forwarded to the node:http server, which means the browser only ever
 * issues same-origin requests: no CORS preflight to configure, no server
 * origin baked into the bundle, and — the reason it matters — no reason for
 * anything client-side to know a Kaafil API key exists. The key is read by
 * `tsx --env-file=.env` in server/ and tools/ and is never exposed to Vite,
 * which is also why nothing below references `process.env`.
 */

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Only PORT is read, and only to build the proxy target. loadEnv's third
  // argument is the prefix allowlist: '' would load every variable in .env
  // including the API key, so it is named explicitly instead.
  const env = loadEnv(mode, process.cwd(), ['PORT']);
  const serverPort = Number.parseInt(env.PORT ?? '4000', 10);

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${serverPort}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
