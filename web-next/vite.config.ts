import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import type { Plugin } from 'vite'

const API_ORIGIN = 'https://nationcam.com'

/**
 * The Go API does not run locally, so dev reads live data from production.
 * Vite's own `server.proxy` never sees these requests — the Nitro dev handler
 * claims them first — so this registers as middleware ahead of Nitro instead.
 *
 * Production is the real database: anything other than a read is refused here
 * rather than trusted not to happen.
 */
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
        fetch(`${API_ORIGIN}/api${req.url ?? ''}`)
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
  plugins: [
    devApiProxy(),
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
