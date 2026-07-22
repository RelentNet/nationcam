# AGENTS.md

## Project Overview

NationCam — a live camera aggregation platform. React 19 + TanStack Start (SSR on Nitro) in `web-next/`, backed by a custom Go API (Chi router) with PostgreSQL and Redis. The original client-only SPA in `web/` (nginx) is kept built and running purely as a rollback target. Authentication via self-hosted Logto (OIDC), deployed as a separate Coolify service. The main stack is deployed via Docker Compose on Coolify.

## Architecture

```
Browser ──▶ web-next (TanStack Start SSR on Nitro)
               │
               ├── /api/*  ──▶  Go API (Chi) ──▶ PostgreSQL + Redis
               │                  └─ /api/streams/* ──▶ Restreamer Core API
               │
               └── /*      ──▶  server-rendered React
                                (/dashboard, /admin, /callback are ssr:false —
                                 shell renders, page mounts client-side)

Server loaders ──▶ http://api:8080 (internal, never the public URL)

Browser ──▶ auth.nationcam.com ──▶ Logto (separate Coolify service, not in this compose)
```

### Services (Docker Compose — 5 total)

| Service    | Image / Build            | Purpose                          | Port  |
| ---------- | ------------------------ | -------------------------------- | ----- |
| `postgres` | postgres:17-alpine       | App database (states, videos)     | 5432  |
| `redis`    | redis:7-alpine           | Response cache (5-min TTL)        | 6379  |
| `api`      | ./api (Go, built)        | Custom REST API                   | 8080  |
| `web-next` | ./web-next (Node/Nitro)  | SSR frontend + /api/ proxy        | 3000  |
| `web`      | ./web (nginx + SPA)      | Legacy SPA — rollback target only | 80    |

**Cutover / rollback.** The domain `https://nationcam.com` lives on `web-next`.
To roll back, move that domain back onto `web` in Coolify's general tab and
redeploy — both services stay built and running, so it is a config flip with no
code change.

### Auth Flow

1. User clicks "Sign In" on admin page
2. Browser redirects to Logto at `auth.nationcam.com` (`/callback` route handles return)
3. Logto issues access token scoped to API resource (`https://api.nationcam.com`)
4. Frontend sends `Authorization: Bearer <token>` on admin write requests
5. Go API validates JWT via Logto's JWKS endpoint (cached 1 hour), checking `exp`/`nbf`/`iss`/`aud`
6. `RequireAdmin` requires the `admin` permission in the token's `scope` claim (space-delimited) — write endpoints fail closed with 403 without it

**Admin RBAC — required Logto console setup.** `RequireAdmin` keys on the `scope`
claim of the API-resource access token. Logto only puts a permission there if it
is (a) defined on the API resource, (b) granted to the user via a role, **and**
(c) requested by the client. All three are required:

1. API resources → `https://api.nationcam.com` → Permissions → add `admin`
   ("Full administrative access to NationCam write endpoints").
2. Roles → create `admin` → assign the `admin` permission from that API resource.
3. Users → your account → Roles → assign `admin`.
4. `web-next/src/components/LogtoProvider.tsx` (and `web/`'s copy) → `scopes`
   must include `'admin'`.
   Logto's *scope subset rule* means a token can only carry scopes the client
   asked for at sign-in, so without this the claim is empty no matter what roles
   the user has. Existing sessions must sign out and back in after this changes.

Symptom if any step is missing: every admin write endpoint returns
`403 {"error":"forbidden","detail":"missing required permission: admin"}`, and
the API logs `WARN admin access denied` with the scopes it actually saw.

Logto is a **separate Coolify service** (not part of this docker-compose stack). The Go API reaches Logto via the public URL (`https://auth.nationcam.com`), not an internal Docker network address.

### Deployment (Coolify)

**Domains** — set in Coolify's general tab per service (NOT env vars):
- `web-next`: `https://nationcam.com` (port 3000)
- `web`: no domain — legacy SPA kept only as a rollback target
- `api`: `https://api.nationcam.com` (optional — the frontend reaches the API via the same-origin `/api/*` proxy)

Logto is deployed as a separate Coolify service with its own domains:
- Auth endpoint: `https://auth.nationcam.com`
- Admin console: `https://admin.auth.nationcam.com`

Coolify auto-generates `SERVICE_URL_WEB`, `SERVICE_URL_API`, etc. The docker-compose references `SERVICE_URL_WEB` for CORS origins.

**Custom env vars** — 4 required + 4 optional for streaming:
```
POSTGRES_PASSWORD=<strong password>
LOGTO_ENDPOINT=https://auth.nationcam.com
LOGTO_APP_ID=<from Logto admin console>
LOGTO_API_RESOURCE=https://api.nationcam.com
API_URL=http://api:8080   # internal Go API address for SSR; web-next 500s without it in production

# Optional — enable RTSP-to-HLS stream management
RESTREAMER_URL=https://streamer.nationcam.com
RESTREAMER_USER=admin
RESTREAMER_PASS=<Restreamer password>
STREAMER_API_KEY=<secret key for /api/streams/* endpoints>
```

**First deploy steps:**
1. Deploy Logto as a separate Coolify service first
2. Open Logto admin console (`admin.auth.nationcam.com`)
3. Create a "React" application, set redirect URI to `https://nationcam.com/callback`
4. Set post sign-out redirect URI to `https://nationcam.com`
5. Set CORS allowed origins to `https://nationcam.com`
6. Create an API resource with identifier `https://api.nationcam.com`, add the
   `admin` permission to it, and assign it via an `admin` role (see Auth Flow above)
7. Copy the App ID → set `LOGTO_APP_ID` in Coolify env vars → redeploy the main stack

**Technical notes:**
- **Go API LOGTO_ENDPOINT**: Points to the public Logto URL (`https://auth.nationcam.com`). The API fetches JWKS from `{LOGTO_ENDPOINT}/oidc/.well-known/openid-configuration` to validate JWTs.
- **Go API DATABASE_URL**: Uses pgx key-value DSN format (`host=... password=...`) instead of URL format to avoid issues with special characters in passwords.
- **Web Dockerfile build args**: `VITE_LOGTO_ENDPOINT`, `VITE_LOGTO_APP_ID`, and `VITE_LOGTO_API_RESOURCE` are passed as build args and baked into the client bundle at build time — for both `web` and `web-next`.
- **web-next API_URL**: read at *runtime*, not baked in, so one image works anywhere. It has no production fallback on purpose: a deploy that forgot it would otherwise silently round-trip every server render out to the public internet, so `web-next` returns 500 with `API_URL is not set...` instead.

## Commands

### Frontend (from `web/` directory, npm)

```bash
npm run dev          # Vite dev server on port 3000
npm run build        # Production build (outputs to dist/)
npm run preview      # Preview production build
npm run test         # Run vitest
npm run lint         # ESLint check
npm run check        # Prettier write + ESLint fix
```

### Go API (from `api/` directory)

```bash
go build ./...                    # Compile all packages
go run ./cmd/server               # Run the API server locally
go test ./...                     # Run tests (when added)
```

**Important:** Go is installed at `$HOME/.local/go/bin` — you may need:
```bash
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
```

### sqlc (from `api/` directory)

```bash
sqlc generate        # Regenerate Go code from SQL queries
```

sqlc binary is at `$HOME/go/bin/sqlc`.

### Docker (from repo root)

```bash
docker compose up -d             # Start all services
docker compose up -d --build     # Rebuild and start
docker compose down              # Stop all services
docker compose logs -f api       # View Go API logs
docker compose logs -f web       # View nginx/SPA logs
```

## Project Structure

```
new-nationcam/                        # Repo root
  AGENTS.md                           # This file
  docker-compose.yml                  # 4 services: postgres, redis, api, web
  .env.example                        # Docker env vars template
  .gitignore
  api/                                # Go API
    go.mod / go.sum
    sqlc.yaml                         # sqlc config (generates internal/db/)
    Dockerfile                        # Multi-stage Go build → alpine runtime
    cmd/
      server/
        main.go                       # Entry point: config, DB pool, Redis, router, HTTP server
    sql/
      schema.sql                      # Source of truth for DB schema
      queries/                        # sqlc query files
        states.sql
        sublocations.sql
        videos.sql
        ads.sql
    internal/
      config/config.go                # Env var loading
      cache/redis.go                  # Redis client wrapper (GET/SET/Invalidate)
      db/                             # GENERATED BY sqlc — DO NOT EDIT
        db.go
        models.go
        states.sql.go
        sublocations.sql.go
        videos.sql.go
      middleware/
        auth.go                       # Logto JWT validation via JWKS + RequireAdmin
        apikey.go                     # X-API-Key verification for stream endpoints
        ratelimit.go                  # Sliding-window rate limiter
        cors.go                       # CORS middleware
        logger.go                     # Request logging (slog)
      restreamer/
        client.go                     # Restreamer API client + JWT token lifecycle
        types.go                      # Request/response types for Restreamer Core API
        validate.go                   # Stream name + RTSP URL validation
      handler/
        router.go                     # Chi router wiring all routes
        health.go                     # GET /health
        state.go                      # GET/POST /states
        sublocation.go                # GET/POST /sublocations
        video.go                      # GET/POST /videos
        ad.go                         # /ads/next, impression + click tracking, admin CRUD
        stream.go                     # CRUD handlers for /streams (Restreamer proxy)
        json.go                       # JSON read/write helpers
        cached.go                     # Response caching wrapper
  web/                                # React SPA
    package.json
    Dockerfile                        # Multi-stage: npm build → nginx serve
    nginx.conf                        # SPA + /api/ proxy to Go API
    .env.example                      # Frontend env vars (VITE_LOGTO_*)
    vite.config.ts
    tsconfig.json
    src/
      main.tsx                        # Client-side mount
      router.tsx                      # Router factory
      routeTree.gen.ts                # AUTO-GENERATED by TanStack Router — DO NOT EDIT
      styles.css                      # Tailwind v4 + Observatory theme
      components/
        AdvertisementLayout.tsx       # Ad placement layout
        Button.tsx                    # Generic button
        ContactCTA.tsx                # Contact call-to-action section
        Dropdown.tsx                  # Custom select
        Footer.tsx                    # 4-column footer
        GrainOverlay.tsx              # Film grain visual effect
        LiveBadge.tsx                 # "LIVE" indicator badge
        LocationsHeroSection.tsx      # Hero section for locations pages
        Logo.tsx                      # NationCam logo component
        LogtoProvider.tsx             # Logto OIDC config + provider wrapper
        Navbar.tsx                    # Main nav
        Reveal.tsx                    # Scroll animation wrapper
        StreamPlayer.tsx              # HLS/MP4 player
        ThemeProvider.tsx             # Dark/light theme context
      hooks/
        useAuth.ts                    # Logto auth wrapper (login, logout, getToken)
        useReveal.ts                  # IntersectionObserver hook
      lib/
        api.ts                        # Go API fetch wrapper (GET/POST with token)
        buttonRedirects.ts            # Button link/redirect config
        types.ts                      # TypeScript interfaces (State, Sublocation, Video)
        utils.ts                      # Utility functions
      routes/
        __root.tsx                    # Root layout (LogtoProvider → ThemeProvider → Navbar)
        index.tsx                     # Home page
        callback.tsx                  # Logto sign-in callback handler
        admin.tsx                     # Admin dashboard (Logto-protected)
        contact.tsx                   # Contact form
        locations/
          index.tsx                   # States grid
          $slug.tsx                   # State detail (videos by sublocation)
          $slug.$sublocationSlug.tsx  # Sublocation detail (video grid)
    public/                           # Static assets
      ads/                            # Advertisement images
      buttons/                        # Button assets
      logos/                          # Logo variations
      videos/                         # Video assets
      favicon.ico
      favicon.svg
      logo192.png
      logo512.png
      manifest.json                   # PWA manifest
      robots.txt
```

### Generated Files — Do NOT Edit

- `web/src/routeTree.gen.ts` — Auto-generated by TanStack Router plugin
- `api/internal/db/*` — Generated by sqlc from `api/sql/queries/`

## Database Schema

5 tables (no users table — Logto handles authentication):

- **states**: `state_id`, `name`, `description`, `slug`, `created_at`, `updated_at`
- **sublocations**: `sublocation_id`, `name`, `description`, `state_id` (FK), `slug`, `created_at`, `updated_at`
- **videos**: `video_id`, `title`, `src`, `type`, `state_id` (FK), `sublocation_id` (nullable FK), `status`, `created_by`, `created_at`, `updated_at`
- **ads**: `ad_id`, `name`, `video_url`, `click_url`, `weight`, `starts_at`, `ends_at`, `enabled`, `state_id` / `sublocation_id` / `video_id` (all nullable FKs — at most one set, this is the targeting scope), `created_by`, `created_at`, `updated_at`
- **ad_impressions**: `impression_id`, `ad_id` (FK), `video_id` (nullable FK), `kind` (`impression` | `click`), `created_at`
- **videos**: `video_id`, `title`, `src`, `type`, `state_id` (FK), `sublocation_id` (nullable FK), `status`, `slug`, `view_count`, `created_by`, `created_at`, `updated_at`

Video slugs are generated from `title` and are unique per `(state_id, sublocation_id)`;
duplicate titles get a `-2`, `-3`, … suffix. Columns added after the first production
deploy live in the "Column additions" section of `schema.sql` as
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, since `CREATE TABLE IF NOT EXISTS` is a
no-op against an existing table.

Slugs are auto-generated by database triggers on INSERT/UPDATE.

## API Endpoints

All endpoints are under `/api/` (nginx strips the prefix before forwarding to Go API).

| Method | Endpoint                         | Description                    | Auth          |
| ------ | -------------------------------- | ------------------------------ | ------------- |
| GET    | `/health`                        | Liveness check                 | None          |
| GET    | `/states`                        | List all states + video counts | None          |
| GET    | `/states/{slug}`                 | Single state by slug           | None          |
| POST   | `/states`                        | Create state                   | Admin (Logto) |
| GET    | `/states/{slug}/sublocations`    | Sublocations for a state       | None          |
| GET    | `/sublocations/{slug}`           | Single sublocation by slug     | None          |
| POST   | `/sublocations`                  | Create sublocation             | Admin (Logto) |
| GET    | `/videos`                        | All active videos              | None          |
| GET    | `/videos?state_id=N`             | Videos by state                | None          |
| GET    | `/videos?sublocation_id=N`       | Videos by sublocation          | None          |
| GET    | `/videos/{state}/{sub}/{slug}`   | Single camera + related cameras | None         |
| POST   | `/videos`                        | Create video                   | Admin (Logto) |
| GET    | `/streams`                       | List all active streams        | API Key       |
| POST   | `/streams`                       | Create RTSP-to-HLS stream      | API Key       |
| GET    | `/streams/{id}`                  | Get stream status              | API Key       |
| DELETE | `/streams/{id}`                  | Remove a stream                | API Key       |
| POST   | `/streams/{id}/restart`          | Restart a stream               | API Key       |
| GET    | `/ads/next?video_id=N`           | Ad to play before this camera  | None          |
| POST   | `/ads/{id}/impression?video_id=N`| Record one impression          | None          |
| GET    | `/ads/{id}/click?video_id=N`     | Record a click, then redirect  | None          |
| GET    | `/ads`                           | All ads + impression counts    | Admin (Logto) |
| POST   | `/ads`                           | Create ad                      | Admin (Logto) |
| PUT    | `/ads/{id}`                      | Update ad                      | Admin (Logto) |
| DELETE | `/ads/{id}`                      | Delete ad (409 once it billed) | Admin (Logto) |

### Ads

Ads are sold by locality. Which of `video_id` / `sublocation_id` / `state_id` is set
on the row *is* the targeting scope; all three NULL is a global house ad. `/ads/next`
takes the most specific scope that has any eligible ad — camera, then sublocation,
then state, then global — and picks among that scope's ads by weight.

- **Caching**: Redis holds the winning scope's *candidate set* (60s TTL), not the
  chosen ad, so the weighted draw still happens per request. Cached rows are
  re-checked against their active window, and an empty result re-queries live so a
  broader scope can take over the moment a narrower one expires. Ad writes flush `ads:*`.
- **Impressions and clicks** are written straight to Postgres, one row per event.
  They bill advertisers, so they never use the approximate Redis-buffered counter
  that backs `videos.view_count`.

### Stream Management

The `/streams` endpoints proxy to a self-hosted datarhei Restreamer instance. They are only
available when `RESTREAMER_URL` and `STREAMER_API_KEY` are configured. Auth is via `X-API-Key`
header (not Logto). Stream creation is rate-limited to 10 requests per minute.

- **HLS output**: Streams are accessible at `{RESTREAMER_URL}/memfs/{streamId}.m3u8`
- **Codec**: Passthrough (`-codec:v copy -codec:a copy`) by default — no re-encoding
- **Reconnect**: Auto-reconnect on failure with 15-second delay
- **Token management**: The Go API manages Restreamer JWT tokens internally (auto-refresh)

### Caching

- GET responses cached in Redis with 5-min TTL
- POST operations invalidate related cache keys (e.g., creating a video invalidates `videos:*` and `states:*`)

## Code Style

### Frontend (Prettier + ESLint)

- No semicolons, single quotes, trailing commas everywhere
- `import type { X }` for type-only imports
- Generic array syntax: `Array<string>` not `string[]`
- Functional components only, default exports for components
- Named exports for route definitions (`export const Route = ...`)
- Tailwind CSS v4 for all styling
- Lucide React for icons

### Go API

- Standard Go formatting (`gofmt`)
- Structured logging via `slog` (JSON output)
- Handler functions return `http.HandlerFunc` closures
- sqlc for type-safe database queries (no hand-written SQL in Go code)

## Dependencies of Note

### Frontend

| Package                  | Purpose                              |
| ------------------------ | ------------------------------------ |
| `@tanstack/react-router` | File-based routing with type safety  |
| `@logto/react`           | Logto OIDC React SDK                |
| `tailwindcss` v4         | Styling                              |
| `lucide-react`           | Icons                                |
| `hls.js`                 | HLS streaming                        |

### Go API

| Package                  | Purpose                              |
| ------------------------ | ------------------------------------ |
| `go-chi/chi/v5`          | HTTP router                          |
| `jackc/pgx/v5`           | PostgreSQL driver (via sqlc)         |
| `redis/go-redis/v9`      | Redis client                         |
| `go-jose/go-jose/v4`     | JWT/JWKS validation                  |
