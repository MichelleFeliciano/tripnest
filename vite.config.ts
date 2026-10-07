import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Writes dist/sw.js after a production build: a tiny service worker that caches every built file so the
 * app opens with no connection. Same-origin files are served from the cache (updated on each deploy);
 * everything else (map tiles, place lookups) always goes to the network and is never cached.
 */
function offlineServiceWorker(): Plugin {
  let outDir = 'dist';
  let base = '/';
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  return {
    name: 'tripnest-offline-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; base = c.base; },
    closeBundle() {
      const files = walk(outDir).map((f) => relative(outDir, f).replace(/\\/g, '/')).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const urls = [base, ...files.map((f) => base + f)];
      const version = createHash('sha256').update(files.map((f) => `${f}:${statSync(join(outDir, f)).size}`).join('|')).digest('hex').slice(0, 12);
      writeFileSync(join(outDir, 'sw.js'), `// generated at build time\nconst CACHE = 'tripnest-${version}';\nconst FILES = ${JSON.stringify(urls)};\n${SW_BODY}`);
    },
  };
}

const SW_BODY = `
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tripnest-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, place lookups: network only
  if (req.mode === 'navigate') {
    // Online: always fetch the newest page. Offline: serve the cached app shell for any route.
    event.respondWith(fetch(req).catch(() => caches.match(self.registration.scope, { ignoreVary: true }).then((r) => r || Response.error())));
    return;
  }
  // ignoreVary: module scripts are requested with an Origin header, which some servers vary on; we cache one copy.
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
`;

export default defineConfig({
  // '/' locally and on a custom domain; '/tripnest/' on GitHub Pages (set by the deploy workflow).
  base: process.env.VITE_BASE || '/',
  plugins: [react(), offlineServiceWorker()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
