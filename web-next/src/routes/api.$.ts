import { createFileRoute } from '@tanstack/react-router'
import { API_BASE } from '@/lib/api'

/**
 * Same-origin `/api` proxy — the one job nginx did for the SPA that the SSR
 * server has to keep doing. The browser can only safely send its Logto bearer
 * token to its own origin, and the Go API is only reachable inside the Docker
 * network, so browser calls have to land here and be forwarded.
 *
 * The Go API's routes are not prefixed, so `/api` is stripped, exactly as
 * `web/nginx.conf` did.
 */
async function proxy({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  // Rewritten by the fetch below; leaving them causes a length/host mismatch.
  headers.delete('host')
  headers.delete('content-length')
  // Skip compression so the upstream response can be returned untouched —
  // `fetch` decodes the body but leaves `content-encoding` on the headers.
  headers.delete('accept-encoding')

  return fetch(`${API_BASE}${url.pathname.slice('/api'.length)}${url.search}`, {
    method: request.method,
    headers,
    body: request.body,
    // Required by undici to stream a request body.
    duplex: 'half',
  } as RequestInit)
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: proxy,
      POST: proxy,
      PUT: proxy,
      PATCH: proxy,
      DELETE: proxy,
    },
  },
})
