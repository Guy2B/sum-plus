/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Σ Life OS',
        short_name: 'Σ Life OS',
        description: 'Explainable daily decisions from your tasks, calendar, mail and life signals.',
        lang: 'fr',
        start_url: '/app.html',
        scope: '/',
        display: 'standalone',
        background_color: '#0f1222',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // The optional semantic-model chunk is large; it is fetched on demand only.
        globIgnores: ['**/transformers*.js', '**/ort*.wasm'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/app.html',
        navigateFallbackDenylist: [/^\/legal\//, /^\/__\//, /^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
        privacy: resolve(__dirname, 'legal/privacy.html'),
        terms: resolve(__dirname, 'legal/terms.html'),
        support: resolve(__dirname, 'legal/support.html'),
      },
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    // Date-sensitive tests are written against Europe/Paris; pin it so CI (UTC) matches.
    env: { TZ: 'Europe/Paris' },
    coverage: { provider: 'v8', include: ['src/domain/**', 'src/data/**'] },
  },
});
