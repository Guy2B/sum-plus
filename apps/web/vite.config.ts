/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version: string };

/**
 * Hosts without custom headers (GitHub Pages) still get the Content Security
 * Policy: at build time it is copied from firebase.json into a <meta> tag
 * (frame-ancestors is header-only and is dropped there).
 */
function cspMeta(): Plugin {
  const firebase = JSON.parse(readFileSync(resolve(__dirname, '../../firebase.json'), 'utf8')) as {
    hosting: { headers: { headers: { key: string; value: string }[] }[] };
  };
  const policy = firebase.hosting.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy')
    ?.value.split(';')
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith('frame-ancestors'))
    .join('; ');
  return {
    name: 'sigma-csp-meta',
    apply: 'build',
    transformIndexHtml: (html) =>
      policy
        ? html.replace(
            '<meta name="viewport"',
            `<meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="viewport"`,
          )
        : html,
  };
}

// GitHub Pages serves the app under /<repo>/; Firebase Hosting serves it at the root.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  plugins: [
    preact(),
    cspMeta(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Σ Life OS',
        short_name: 'Σ Life OS',
        description: 'Explainable daily decisions from your tasks, calendar, mail and life signals.',
        lang: 'fr',
        start_url: 'app.html',
        scope: './',
        display: 'standalone',
        background_color: '#0f1222',
        theme_color: '#4f46e5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // The optional semantic-model chunk is large; it is fetched on demand only.
        globIgnores: ['**/transformers*.js', '**/ort*.wasm'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: `${base}app.html`,
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
        impressum: resolve(__dirname, 'legal/impressum.html'),
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
