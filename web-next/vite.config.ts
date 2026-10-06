import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import type { Plugin } from 'vite'

/**
 * Dev reads live data from production unless `API_URL` points at a local Go API
 * (the same variable the SSR loaders use). Vite's own `server.proxy` never sees
 * these requests — the Nitro dev handler claims them first — so this registers
 * as middleware ahead of Nitro instead.
 *
 * Production is the real database: anything other than a read is refused here
 * rather than trusted not to happen.
 */
const DEV_API = process.env.API_URL ?? 'https://nationcam.com/api'

function devApiProxy(): Plugin {
  return {
    name: 'nationcam-dev-api-proxy',
    apply: 'serve',
    configureServer(server) {
      // Mounting on '/api' strips the prefix, so req.url is e.g. '/videos?x=1'.
      server.middlewares.use('/api', (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.end('dev api proxy is read-only')
          return
        }
        fetch(`${DEV_API}${req.url ?? ''}`)
          .then(async (upstream) => {
            res.statusCode = upstream.status
            const contentType = upstream.headers.get('content-type')
            if (contentType) res.setHeader('content-type', contentType)
            res.end(Buffer.from(await upstream.arrayBuffer()))
          })
          .catch(next)
      })
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    // Maps are emitted for error tooling but never referenced from the bundles
    // (no `//# sourceMappingURL`), so browsers don't fetch them (DAN-239).
    sourcemap: 'hidden',
  },
  plugins: [
    devApiProxy(),
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      // The embed widget (DAN-33) is meant to sit inside another site's
      // `<iframe>`, so only that route gets a permissive frame-ancestors CSP
      // (and no X-Frame-Options is ever set — Nitro doesn't add one by
      // default) — every other route keeps today's headers unchanged.
      //
      // Cache lifetimes (DAN-239). Hashed bundles under /assets/ already get
      // `max-age=31536000, immutable` from Nitro's static handler; HTML gets
      // no Cache-Control and stays uncached. Uploads and archived snapshot
      // frames are immutable by construction (a new file gets a new name),
      // so browsers may keep them for a year too.
      routeRules: {
        '/embed/**': {
          headers: { 'Content-Security-Policy': 'frame-ancestors *' },
        },
        '/api/uploads/**': {
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
        },
        '/api/snapshots/**': {
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
        },
        // Bundled hero videos and their poster stills: not content-hashed,
        // so a day, then revalidated in the background.
        '/videos/**': {
          headers: {
            'Cache-Control':
              'public, max-age=86400, stale-while-revalidate=604800',
          },
        },
      },
      // Pre-compressed .br/.gz copies of the static assets, served when the
      // browser accepts them — smaller than the proxy's on-the-fly gzip.
      compressPublicAssets: { gzip: true, brotli: true },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
