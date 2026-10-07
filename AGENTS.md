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
7. `RequireUser` (the owner endpoints under `/me`) accepts any validated token that carries a `sub`, whatever its scope — the `sub` is the owner id — and answers 401 otherwise. See "Owner accounts and review" below

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

# Optional — snapshot archive location (docker-compose mounts the `snapshots` volume here)
SNAPSHOTS_DIR=/app/data/snapshots

# Optional — Logto management connection (admin console Users panel + Home)
LOGTO_M2M_APP_ID=<Logto machine-to-machine app ID>
LOGTO_M2M_APP_SECRET=<Logto machine-to-machine app secret>
OPS_API_KEY=<32+ random chars — X-API-Key for /api/admin/* endpoints>

# Optional — satellite lightning (NOAA GOES GLM, public S3, no credentials)
LIGHTNING_ENABLED=true          # false turns the job off; the endpoint then answers 503
LIGHTNING_BUCKET=noaa-goes19    # GOES-East; noaa-goes18 (GOES-West) has the same layout

# Signed HLS URLs (DAN-242) — set it in production
HLS_SIGNING_KEY=<32+ random chars — HMAC key for /api/hls tokens and signed URLs>
                                # unset: random per-process key + one WARN line; streams play,
                                # but issued URLs die on restart and differ across replicas
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
On some machines Go instead lives at `$HOME/.gotoolchain/go/bin` (it does on
this one) — run `go version` first to check which applies before assuming
Go is missing.

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
        me.sql                        # Owner (/me) queries — DAN-39
        review.sql                    # Admin review queue + reject cascade — DAN-39
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
        auth.go                       # Logto JWT validation via JWKS + RequireAdmin / RequireUser / IsAdmin
        apikey.go                     # X-API-Key verification for stream endpoints
        ratelimit.go                  # Sliding-window rate limiter
        cors.go                       # CORS middleware
        logger.go                     # Request logging (slog)
      restreamer/
        client.go                     # Restreamer API client + JWT token lifecycle
        types.go                      # Request/response types for Restreamer Core API
        validate.go                   # Stream name + RTSP URL validation
      logtoadmin/
        client.go                     # Logto Management API client (M2M token lifecycle)
      lightning/                      # NOAA GOES GLM satellite lightning (DAN-34)
        lightning.go                  # Flash/Site types, haversine, the 10 mi/30 mi/30 min policy
        reader.go                     # Pure-Go NetCDF4 parser for GLM LCFA files
        store.go                      # 60-min in-memory flash buffer + Redis mirror
        s3.go                         # Public-bucket lister/fetcher, hour prefixes, key parsing
        job.go                        # 60s tick: list → fetch (4-wide) → parse → store → mirror
        testdata/                     # One real GLM LCFA file (~230 KB)
      handler/
        router.go                     # Chi router wiring all routes
        health.go                     # GET /health
        state.go                      # GET/POST /states
        sublocation.go                # GET/POST /sublocations
        video.go                      # GET/POST /videos
        ad.go                         # /ads/next, impression + click tracking, admin CRUD
        stream.go                     # CRUD handlers for /streams (Restreamer proxy); createIngestStream shared with /me/videos
        me.go                         # Owner endpoints: GET /me, /me/sublocations, /me/videos, pause/resume (DAN-39)
        review.go                     # GET /review, approve/reject for videos and sublocations (DAN-39)
        status.go                     # Owner limits + the status transition tables (the one place they live)
        ownerstore.go                 # ownerStore interface (sqlc queries + Tx) so handler tests run on a fake
        admin_users.go                # GET /admin/users, /admin/users/stats, /admin/roles (Logto management)
        json.go                       # JSON read/write helpers
        cached.go                     # Response caching wrapper
        lightning.go                  # GET /sublocations/{slug}/lightning
        alerts.go                     # GET /sublocations/{slug}/alerts
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
- **sublocations**: `sublocation_id`, `name`, `description`, `state_id` (FK), `slug`, `lat`/`lng` (nullable, unlock the weather panel), `host_name`, `host_url`, `host_since` (nullable date), `address`, `noaa_station_id`/`usgs_site_id` (nullable, pin or disable the conditions page's tide station / river gauge — see API Endpoints), `status` (`pending` | `approved` | `rejected`, default `approved`), `owner_id` (Logto `sub`; `''` = admin-owned), `review_note`, `created_at`, `updated_at`
- **videos**: `video_id`, `title`, `src`, `type`, `state_id` (FK), `sublocation_id` (nullable FK), `status` (`pending` | `active` | `inactive` | `paused` | `rejected`), `owner_id` (Logto `sub`; `''` = admin-owned), `stream_id` (nullable — the Restreamer process UUID when the API created the ingest), `review_note`, `created_by`, `created_at`, `updated_at`
- **ads**: `ad_id`, `name`, `video_url`, `click_url`, `weight`, `starts_at`, `ends_at`, `enabled`, `state_id` / `sublocation_id` / `video_id` (all nullable FKs — at most one set, this is the targeting scope), `created_by`, `created_at`, `updated_at`
- **ad_impressions**: `impression_id`, `ad_id` (FK), `video_id` (nullable FK), `kind` (`impression` | `click`), `created_at`
- **videos**: `video_id`, `title`, `src`, `type`, `state_id` (FK), `sublocation_id` (nullable FK), `status`, `slug`, `view_count`, `created_by`, `created_at`, `updated_at`
- **posts**: `post_id`, `title`, `slug`, `body_md`, `excerpt`, `cover_url`, `state_id` / `sublocation_id` / `video_id` (all nullable FKs, `ON DELETE SET NULL` — at most one set, this is the "Field notes" attachment), `status` (`draft` | `published`), `published_at` (nullable), `created_by`, `created_at`, `updated_at`
- **events**: `event_id`, `title`, `description_md`, `starts_at` (`TIMESTAMPTZ NOT NULL`), `ends_at` (nullable), `url` (nullable), `sublocation_id` (FK, `NOT NULL ON DELETE CASCADE` — an event always belongs to one place), `video_id` (nullable FK, `ON DELETE SET NULL` — an optional "watch here" pointer to a camera in that sublocation), `created_by`, `created_at`, `updated_at`
- **audio_stations**: `audio_station_id`, `name`, `stream_url` (https only), `enabled`, `sort_order`, `state_id` / `sublocation_id` (both nullable FKs, `ON DELETE CASCADE` — at most one set, optional single-level scope; no per-camera scope), `created_at`, `updated_at`

- **submissions**: `submission_id`, `name`, `email`, `message` (readable summary, always kept), `kind` (`construction` | `free-camera` | `camera` from /contact | default `contact`), `handled`, `company`, `phone`, `site_city`, `site_state` (all `TEXT NOT NULL DEFAULT ''`), `details` (`JSONB NOT NULL DEFAULT '{}'` — a flat object of readable per-form answers, DAN-226), `created_at`; index on `(kind, created_at DESC)`. The DAN-226 `ALTER ... ADD COLUMN IF NOT EXISTS` statements sit right after the table in its own schema.sql section (the "Column additions" section runs before the table exists on a fresh DB). Old rows keep the empty defaults.

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
| GET    | `/sublocations/{slug}/weather`   | Current conditions plus outdoor-activity estimates — dew point, UV, wet-bulb, heat stress, cloud cover, visibility, pressure + trend, precip, rain next hour, storm potential, US AQI (Open-Meteo, 10-min Redis cache; every added field is nullable and best-effort — see "Outdoor-activity stats" below); 404 without lat/lng | None |
| GET    | `/sublocations/{slug}/conditions` | 3-day forecast, a 12-hour hourly strip (temp/rain/wind/UV), plus NOAA tide predictions and USGS river stage from the nearest station/gauge (30-min Redis cache), or from the sublocation's `noaa_station_id`/`usgs_site_id` when set (`none` disables that source); 404 without lat/lng | None |
| GET    | `/sublocations/{slug}/lightning` | Satellite lightning status from NOAA GOES-19 GLM — `status` (`clear`/`caution`/`alert`), nearest strike (mi), last strike time, strike counts within 10 mi/30 mi over 30 min, `all_clear_at` (see "Lightning" below); evaluated per request from the in-memory store, never Redis-cached; 404 without lat/lng, 503 `{error, updated_at}` when the feed is older than 5 min | None |
| GET    | `/sublocations/{slug}/alerts` | Active NWS watches/warnings/advisories for the sublocation's coordinates (api.weather.gov), most severe then soonest-ending first (5-min Redis cache); 404 without lat/lng, upstream failure/timeout answers `{ alerts: [] }` rather than an error | None |
| POST   | `/sublocations`                  | Create sublocation             | Admin (Logto) |
| GET    | `/videos`                        | All active videos              | None          |
| GET    | `/videos?state_id=N`             | Videos by state                | None          |
| GET    | `/videos?sublocation_id=N`       | Videos by sublocation          | None          |
| GET    | `/videos/{state}/{sub}/{slug}`   | Single camera + related cameras | None         |
| GET    | `/videos/{state}/{sub}/{slug}/snapshot.jpg` | Latest still, watermarked (60s Redis cache) — the stable URL for Windy/Ventusky. `?w=320` or `?w=640` returns a JPEG resized to that width (aspect kept, never upscaled; cached 60s per width; any other `w` is 400) | None |
| GET    | `/videos/{state}/{sub}/{slug}/stream.m3u8`  | 302 (`Cache-Control: no-store`) to a **signed** `/api/hls/{id}/index.m3u8?exp=&sig=` valid 12 h, whose rewrite carries signed segment URIs — works in any plain HLS player; 404 for non-Restreamer cameras | None |
| GET    | `/videos/{id}/stream-token`      | Uncached (`no-store`) player token: `{ video_id, token, header: "X-HLS-Token", expires_at, ttl_seconds: 300, manifest_url, signed_manifest_url, native_ttl_seconds: 3600 }`; 404 unless the camera is public and proxied. DAN-205 adds its permission check here | None |
| GET    | `/hls/{video_id}/index.m3u8`     | Proxied HLS manifest, URIs rewritten; 403 without a valid unexpired signature (player token + Referer/Origin, or a signed URL); 404 unless the camera is public | Signed (see "HLS proxy") |
| GET    | `/hls/{video_id}/{segment}`      | Proxied variant playlist / segment, same gate | Signed |
| GET    | `/hls/{video_id}/poster.jpg`     | Latest watermarked still for a Restreamer camera | None |
| GET    | `/videos/{state}/{sub}/{slug}/frames?day=YYYY-MM-DD` | Archived stills for one local day (default today), sorted by time | None |
| GET    | `/videos/{state}/{sub}/{slug}/frames/days`  | Days with at least one archived still, newest first | None |
| GET    | `/snapshots/{video_id}/{day}/{HHMM}.jpg` | One archived still (immutable, 1-year cache header). `?w=320` or `?w=640` serves a resized copy, made on first request and kept at `{video_id}/{day}/thumbs/{HHMM}.w{W}.jpg` (retention deletes thumbs with the frame; other `w` is 400) | None |
| POST   | `/videos`                        | Create video                   | Admin (Logto) |
| GET    | `/me`                            | `{ user_id, is_admin, limits: { max_cameras, per_day }, counts: { sublocations, videos } }` | User (Logto) |
| GET    | `/me/sublocations`               | The caller's sublocations, any status, with `review_note` | User (Logto) |
| POST   | `/me/sublocations`               | `{ name, description, state_id, address?, lat?, lng?, host_name?, host_url?, host_since? }` → status `pending` | User (Logto) |
| PUT    | `/me/sublocations/{id}`          | Same fields; status unchanged (403 on someone else's) | User (Logto) |
| DELETE | `/me/sublocations/{id}`          | Only while it has no cameras (409 otherwise) | User (Logto) |
| GET    | `/me/videos`                     | The caller's cameras, any status, with `review_note` and `sublocation_status` | User (Logto) |
| POST   | `/me/videos`                     | `{ title, rtsp_url, sublocation_id (must be the caller's), about? }` → validates RTSP, creates the Restreamer ingest, status `pending`; 429 past 10 cameras or 5 per 24 h; 503 without Restreamer | User (Logto) |
| PUT    | `/me/videos/{id}`                | `{ title, about }`             | User (Logto) |
| POST   | `/me/videos/{id}/pause`          | `active → paused`; Restreamer `stop` (409 otherwise) | User (Logto) |
| POST   | `/me/videos/{id}/resume`         | `paused → active`; Restreamer `start` (409 otherwise) | User (Logto) |
| DELETE | `/me/videos/{id}`                | Deletes the Restreamer process when `stream_id` is set (404 ignored), then the row | User (Logto) |
| GET    | `/review`                        | `{ sublocations: [pending…], videos: [pending… with owner_id + sublocation] }` | Admin (Logto) |
| POST   | `/videos/{id}/approve`           | `pending → active`; a pending sublocation is approved in the same transaction | Admin (Logto) |
| POST   | `/videos/{id}/reject`            | `{ note? }` — `pending`/`active`/`paused → rejected`; Restreamer process stopped (not deleted) | Admin (Logto) |
| POST   | `/sublocations/{id}/approve`     | `pending → approved`; its cameras stay pending | Admin (Logto) |
| POST   | `/sublocations/{id}/reject`      | `{ note? }` — `pending → rejected`; its pending cameras are rejected too and their processes stopped | Admin (Logto) |
| POST   | `/submissions`                   | Public form submit (rate-limited, 16 KB cap): `{ name, email, message, kind?, company?, phone?, site_city?, site_state?, details? }`. Caps: company 200, phone 40, city 100, state 60 chars; `details` = flat object, ≤30 keys matching `^[a-z0-9_]{1,40}$`, values string (≤500) / number / boolean / array of ≤20 strings (≤100 each), else 400 | None |
| GET    | `/submissions?kind=a,b`          | Latest 200 submissions, newest first, with the structured fields; optional comma-separated `kind` filter (each ≤40 chars) | Admin (Logto) |
| PATCH  | `/submissions/{id}`              | `{ handled }`                  | Admin (Logto) |
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
| GET    | `/posts?limit=&offset=`          | Published posts, newest first (default limit 20) | None |
| GET    | `/posts/{slug}`                  | Single published post (404 if draft/missing) | None |
| GET    | `/posts?video_id=\|sublocation_id=\|state_id=` | Published posts for that scope, limit 3 (related notes) | None |
| GET    | `/posts/all`                     | Every post, any status          | Admin (Logto) |
| POST   | `/posts`                         | Create post                    | Admin (Logto) |
| PUT    | `/posts/{id}`                    | Update post                    | Admin (Logto) |
| DELETE | `/posts/{id}`                    | Delete post                    | Admin (Logto) |
| GET    | `/events?upcoming=1`             | Every upcoming event sitewide, soonest first (limit 50) | None |
| GET    | `/events?sublocation_id=\|video_id=` | Upcoming events for that scope, limit 3 ("Upcoming" block) | None |
| GET    | `/events/all`                    | Every event, upcoming or past, newest starts_at first | Admin (Logto) |
| POST   | `/events`                        | Create event                   | Admin (Logto) |
| PUT    | `/events/{id}`                   | Update event                   | Admin (Logto) |
| DELETE | `/events/{id}`                   | Delete event                   | Admin (Logto) |
| GET    | `/audio/stations?video_id=N`     | DB-backed stations (scoped to that camera's state/sublocation, plus unscoped) then AzuraCast's list, same JSON shape | None |
| GET    | `/audio/stations/all`            | Every DB-backed station, any scope | Admin (Logto) |
| POST   | `/audio/stations`                | Create station                 | Admin (Logto) |
| PUT    | `/audio/stations/{id}`           | Update station                 | Admin (Logto) |
| DELETE | `/audio/stations/{id}`           | Delete station                 | Admin (Logto) |
| GET    | `/admin/users?page=&page_size=`  | Logto users, newest role data resolved per user | Admin (Logto) or Ops key |
| GET    | `/admin/users/stats`             | `{ total, new_7d, new_30d, admins }` | Admin (Logto) or Ops key |
| GET    | `/admin/roles`                   | Every Logto role + user count + scopes | Admin (Logto) or Ops key |

### Owner accounts and review

Any signed-in Logto user can add their own sublocations and cameras (DAN-39).
Both enter review and stay invisible to every public endpoint until an admin
approves them; owners pause, resume, edit and delete their own cameras; admins
work a queue. Admin-only writes (`POST/PUT/DELETE /videos`, `/sublocations`,
everything else in the table above marked Admin) are unchanged.

- **Auth**: `/me/*` is behind `RequireUser` — a validated token with a `sub`,
  any scope (the frontend must request an API-resource token for these calls
  too). `owner_id` on a row is that `sub`; every `/me` lookup 403s on someone
  else's row and 404s on none. Admin-owned legacy rows have `owner_id = ''`
  and are unreachable under `/me` by construction. `GET /me` works for admins
  and reports `is_admin` from the scope claim. `/review` and the four
  approve/reject endpoints are `RequireAdmin`.
- **Statuses** (tables in `handler/status.go`; anything not drawn is a 409):

  ```
  videos:        pending ──approve──▶ active ──pause──▶ paused
                    │                   ▲                 │
                    │                   └────resume───────┘
                    └──reject──▶ rejected ◀──reject── active | paused
                 ('inactive' is the pre-existing admin switch-off; no owner or
                  review action produces or leaves it)

  sublocations:  pending ──approve──▶ approved
                    └──────reject───▶ rejected
  ```

  Approving a camera whose sublocation is still `pending` approves the
  sublocation in the same transaction; a camera in a `rejected` sublocation
  cannot be approved. Rejecting a sublocation rejects its still-pending
  cameras with the same note (its active ones are left alone). Reject
  **stops** the Restreamer process (best-effort — the moderation decision
  lands even if Restreamer is down); the owner's delete **removes** it
  (a 404 from Restreamer is fine). Pause/resume send `stop`/`start` and
  fail without changing the row if Restreamer refuses, so the row never
  claims a state the stream is not in.
- **Public visibility**: a camera is public when `status IN ('active',
  'paused')` **and** its sublocation (if any) is `approved`; a sublocation is
  public when `approved`. The predicate lives in every public query in
  `videos.sql`/`sublocations.sql` — lists (which feed the sitemap and the
  search index), the per-camera page and everything keyed off
  `GetVideoBySlug` (frames, snapshot.jpg, stream.m3u8), related cameras, the
  popular/newest sorts, and the sublocation slug lookup behind
  weather/conditions/lightning — so a pending sublocation's slug 404s. Paused
  cameras list (the player shows a placeholder, DAN-40) but do not count in
  `video_count`/`first_src`, and the snapshot archive (`ListArchiveSources`)
  captures active cameras only.
- **Creating a camera** (`POST /me/videos`) validates the RTSP URL with the
  same `restreamer.ValidateRTSPURL` as `/streams`, creates the ingest through
  the same `createIngestStream` (passthrough codec, auto-reconnect, UI
  metadata), stores `stream_id` and `src = rc.HLSURL(id)`, and files it under
  the sublocation's state. Limits are constants in `status.go`: **10 cameras
  per owner** (any status; deleting frees a slot) and **5 creations per owner
  per rolling 24 h**, both 429 with a clear message, checked before anything
  is created on Restreamer; the same 10/min limiter as `/streams` sits in
  front. If the row insert fails after the process was created, the process
  is deleted again.
- **Caches**: nothing under `/me` or `/review` is cached (per user / live
  queue). Every owner write and every transition flushes `videos:*`,
  `sublocations:*` and `states:*`.
- **Tests**: `handler/me_test.go` and `review_test.go` run the real handlers
  on an in-memory `ownerStore` (`owner_fakes_test.go`) with a fake Restreamer
  and the fake Redis; `status_test.go` pins the transition tables;
  `sql/owner_review_test.go` checks the visibility predicate and the CHECKs
  against a scratch Postgres when `TEST_DATABASE_URL` is set.

### Owner dashboard and admin console

The frontend for the owner-accounts API above (DAN-41): a signed-in user gets
an owner dashboard for only their own rows, and an admin gets the full
console with a review queue and a users panel. Both routes are `ssr:false`
(see Architecture) and live in `web-next/src/routes/`.

- **`/dashboard`** (`routes/dashboard.tsx`) — owner dashboard. Behind the
  same sign-in gate as before; any signed-in user lands here (Sign In always
  redirects to `/dashboard`, see `routes/callback.tsx`). Sections: a limits
  line from `GET /me` ("3 of 10 cameras"), a link to `/admin` when the
  caller's token carries the admin scope, a "How review works" note,
  **My locations** (`components/owner/MyLocationsPanel.tsx` — `GET/POST/PUT/
  DELETE /me/sublocations`, status pill + review note, delete only while it
  has no cameras) and **My cameras** (`components/owner/MyCamerasPanel.tsx`
  — `GET/POST/PUT /me/videos` + pause/resume, status pill, a location picker
  scoped to the owner's own `/me/sublocations`, an "Embed code" box once a
  camera is not pending/rejected). `components/owner/ownerUi.tsx` holds the
  shared `StatusPill`/`ReviewNote`.
- **`/admin`** (`routes/admin.tsx`) — the full console, guarded by `isAdmin`
  (`useAuth`'s token-scope check); a signed-in non-admin is redirected to
  `/dashboard`, a signed-out visitor sees a sign-in prompt. Ten tabs: the
  original Cameras/States/Sublocations/Streams/Ads/Notes/Events panels
  (moved, unchanged, into `components/admin/*Panel.tsx`), the existing
  `SubmissionsInbox`, **Review queue** (`components/admin/
  ReviewQueuePanel.tsx` — `GET /review`, an HLS preview of a pending camera
  via `StreamPlayer`, Approve / Reject-with-note calling the four
  approve/reject endpoints) and **Users** (`components/admin/
  UsersPanel.tsx` — `GET /admin/users(/stats)` + `/admin/roles`; renders
  "Not configured" when those 404, since the Logto management connection is
  optional server-side config).
- **Shared UI**: `components/dashboardUi.tsx` holds every building block
  used by more than one panel — `PanelHeader`, `CreatePanel`, `AboutField`,
  `FormField`/`FormFooter`, `ConfirmDeleteDialog`/`ModalShell`, `ToggleRow`,
  `StatusDot`/`ActionBtn`, the `toISO`/`toLocalInput` datetime helpers (Ads +
  Events), and the branding form (`useBranding`, `UploadField`,
  `BrandingFields`, shared by States + Sublocations). A panel-local helper
  (a form's own field list, its row component, its edit modal) stays in that
  panel's own file.
- **Errors**: the owner/review/admin API functions in `lib/api.ts` (`fetchMe`,
  `fetchMy*`, `create/update/deleteMy*`, `pause/resumeMyVideo`,
  `fetchReviewQueue`, `approve/rejectVideo`, `approve/rejectSublocation`,
  `fetchAdminUsers`/`fetchAdminUserStats`/`fetchAdminRoles`) throw the API's
  own `detail`/`error` message (via `apiErrorMessage`) rather than a generic
  "request failed" string, so a 401/403/409/429 shows inline as the exact
  reason — a missing permission, a camera limit, an invalid status
  transition, a sublocation that still has cameras.
- **Navbar/UserMenu**: `components/UserMenu.tsx`'s dropdown shows "My
  cameras" → `/dashboard` for every signed-in user, and "Admin" → `/admin`
  only when `isAdmin`. `Navbar.tsx` itself carries no auth-aware links (both
  its desktop and mobile menus render `UserMenu`).

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
- **Google AdSense** fills the banner slots behind direct-sold ads. The publisher
  ID (`ca-pub-…`) lives in three places that must match: `ADSENSE_CLIENT` and the
  `google-adsense-account` meta tag in `web-next/src/routes/__root.tsx`, and
  `web-next/public/ads.txt`, served at `/ads.txt`. The meta tag and ads.txt are
  what Google's site verification checks. The library itself is loaded by the
  `AdSenseLoader` effect after hydration, on public pages only (not
  `/dashboard`, `/admin`, `/callback`) — never as a server-rendered
  `<script async src>`, because the AdSense library inserts its own script
  before the first `<script>` in the document, and if that happens mid-hydration
  it breaks React's positional matching of the inline theme/JSON-LD scripts.
  Ad units are created in the AdSense console
  and pasted into Dashboard → Ads as `banner_html` House ads with a placement;
  `injectCreative` drops the loader tag from pasted unit code because the root
  layout already loads it once. Do not enable AdSense Auto ads: they place anchor
  and vignette ads over the player and the search dialog.

### Field notes

A small blog ("Field notes"), written in the dashboard's Notes panel and published
at `/notes`. Each post is optionally attached to one state, sublocation, or camera —
whichever of `state_id`/`sublocation_id`/`video_id` is set on the row is the
attachment, same "at most one" CHECK as ads — and shows up as a "Field notes" block
(up to 3 posts) on that camera/sublocation page; all three NULL is an unscoped post,
visible only in the main `/notes` feed. `status` is `draft` or `published`, no
scheduling; publishing a post fills `published_at` the first time only (a later
edit or a draft/republish cycle never resets it). The body is written as the same
light markdown `EditorialText` renders elsewhere on the site, and the cover image
reuses the existing upload flow (`POST /uploads`). Public listings and the
single-post lookup only ever return `status = 'published'` rows, so a draft's slug
is never reachable outside the dashboard; writes flush `posts:*`.

### Events

Hosts' events (tournaments, rodeos, festivals) written in the dashboard's Events
panel, shown on the cameras that can watch them and at the sitewide `/events`
page. Unlike ads/posts, the attachment is not "at most one of three":
`sublocation_id` is required (an event always belongs to one place) and
`video_id` is an optional, additional "watch here" pointer to a specific camera
in that sublocation — the API rejects a `video_id` that doesn't belong to the
chosen `sublocation_id`. `starts_at`/`ends_at` are stored as `timestamptz` and
rendered in the viewer's own local time zone on the frontend, not the camera's.
An event counts as "upcoming" until it ends (or, with no end time, until it
starts) — `GET /events?upcoming=1` backs the sitewide page (limit 50, soonest
first) and the two scoped listings back the "Upcoming" block on a
camera/sublocation page (limit 3); writes flush `events:*`.

### Outdoor-activity stats

`GET /sublocations/{slug}/weather` answers "is it safe and pleasant to be
outside here right now" alongside the existing temp/wind/humidity fields, all
from Open-Meteo and cached the same 10 minutes. Every added field is a
`*float64`/pointer type in Go (nullable JSON, omitted when unavailable) —
each is independent best-effort: a source Open-Meteo doesn't offer for that
model/region, or an upstream call that fails, only nulls that one field and
never fails the response.

- **Fields**: `dew_point_f`, `uv_index` (current, falling back to the nearest
  hourly reading when the model doesn't offer it in `current`), `uv_index_max`
  (today), `wet_bulb_f`, `heat_stress` (`{level, label}`), `cloud_cover_pct`,
  `visibility_mi`, `pressure_inhg`, `pressure_trend` (`rising`/`steady`/
  `falling` vs. the hourly reading ~3h ago), `precip_last_hour_in`,
  `rain_next_hour_pct` (from the 15-minutely forecast where Open-Meteo offers
  it, else the next hourly reading), `storm_potential` (`{level}`), `us_aqi`
  (`{value, category}`).
- **Sources**: the same Open-Meteo forecast call's `current`/`hourly`/`daily`/
  `minutely_15` blocks, plus one extra call to the Air Quality API
  (`air-quality-api.open-meteo.com`) for `us_aqi` — the only new upstream
  request DAN-32 adds.
- **Heat stress** is a standard WBGT flag-condition estimate from wet-bulb
  temperature when the forecast offers it, else apparent ("feels like")
  temperature as a stand-in: low < 80°F, moderate 80–84.9°F, high 85–87.9°F,
  extreme ≥ 88°F. Every label says "(estimate)" — this is a forecast reading,
  not a measured globe-thermometer WBGT.
- **Storm potential** is CAPE-based: low < 500 J/kg, moderate 500–1500 J/kg
  (or any 15-minutely lightning potential > 0), high > 1500 J/kg. This is a
  forecast-model signal, not real strike detection — Open-Meteo has no
  lightning sensor network, so the wording (API and frontend both) must never
  imply live lightning detection or an on-site station.
- **US AQI category** follows the standard EPA bands (Good/Moderate/Unhealthy
  for Sensitive Groups/Unhealthy/Very Unhealthy/Hazardous).
- **NowPanel** shows these as a second row of color-coded tiles (Heat stress,
  UV, Air quality, Rain next hour, Storm potential — tiles with a null value
  are omitted, the whole row is omitted when every one is) with a one-line
  legend, plus dew point/pressure+trend/visibility/cloud cover added to the
  existing detail stats. The conditions page's 12-hour strip (hour, temp,
  rain %, wind, UV) is server-rendered from `GET .../conditions`'s `hourly`
  array, which reuses the same forecast call as the 3-day forecast.
- Active NWS watches/warnings for the same coordinates are a separate
  endpoint (`GET .../alerts`, see API Endpoints) — official NWS products
  from api.weather.gov, not an Open-Meteo forecast estimate like the fields
  above, so they are never folded into this response.

### Logto management connection

`api/internal/logtoadmin` reads Logto's user/role data server-side through a
Logto **machine-to-machine (M2M) app**, so the admin console's Users panel
(and Home) can answer "how many users, who is admin, is any role a default"
without console access. It is entirely optional: unset `LOGTO_M2M_APP_ID`/
`LOGTO_M2M_APP_SECRET` and the `/admin/*` routes below are not mounted at
all (a request 404s, same as any undefined route) — the API logs one info
line at startup either way, and never logs the app secret or an issued token.

- **Token lifecycle**: `logtoadmin.Client` exchanges the M2M app's
  credentials for a Management API access token via the `client_credentials`
  grant (`POST {LOGTO_ENDPOINT}/oidc/token`, HTTP Basic auth = app ID/secret,
  `resource=https://default.logto.app/api`, `scope=all`), caches it, and
  refreshes 60s before expiry. A request that still gets a 401 (revoked
  token, clock skew) invalidates the cache and retries once. Every request —
  token exchange and each Management API call — has its own 10s timeout.
- **Endpoints**: `GET /admin/users`, `/admin/users/stats`, and `/admin/roles`
  (see API Endpoints above) are guarded by `RequireAPIKeyOrAdmin(OPS_API_KEY)`
  — the same pattern as `/streams` — so either a signed-in Logto user or the
  `X-API-Key: $OPS_API_KEY` header gets in; with `OPS_API_KEY` unset, only a
  signed-in Logto user does. Per-user and per-role role/scope lookups run
  with bounded concurrency (5 at a time) since Logto has no batch endpoint
  for "roles for these users". Responses are cached 60s in Redis
  (`admin:users:*`, `admin:roles`), shorter than the usual 5 minutes since
  this backs a live admin console.
- **Console setup**: Logto admin console → Applications → Create application
  → **Machine-to-machine** → name it (e.g. "NationCam API") → in the new
  app's **Roles** tab, assign the built-in **"Logto Management API access"**
  role → copy the **App ID** and **App Secret** → set `LOGTO_M2M_APP_ID` /
  `LOGTO_M2M_APP_SECRET` in Coolify → generate an `OPS_API_KEY` (32+ random
  chars) and set it too → redeploy the `api` service.

### Lightning

`api/internal/lightning` turns NOAA's GOES-East Geostationary Lightning Mapper
into a live per-sublocation status (DAN-34). This is the real strike feed the
storm-potential tile above explicitly is not — but it is **satellite**
detection, informational only. The API, the UI copy and this file must never
call it ground-based detection or a certified safety system; the card's
footnote ("Satellite-detected (NOAA GOES). Informational only — not a
certified safety system.") is part of the contract.

- **Source**: GLM Level-2 LCFA files on NOAA Open Data — public S3
  (`https://noaa-goes19.s3.amazonaws.com`, `LIGHTNING_BUCKET`), no
  credentials, no SDK. One ~230 KB NetCDF4 file per 20-second window under
  `GLM-L2-LCFA/YYYY/DDD/HH/` (UTC day-of-year and hour), appearing ~20 s after
  the window ends; the key encodes the window as `sYYYYDDDHHMMSSt`. GOES-19
  covers all of CONUS. Parsed with a pure-Go NetCDF4/HDF5 reader
  (`github.com/batchatco/go-native-netcdf`, no CGO): `flash_lat`/`flash_lon`,
  `flash_time_offset_of_first_event` (an `_Unsigned` int16 with
  `scale_factor`/`add_offset`, seconds since the epoch in its `units`),
  `flash_quality_flag` (only `0` = good is kept). Flashes in a file are ordered
  by id, not time.
- **Cadence**: `lightning.Job` (started from `main.go`, same lifecycle as the
  snapshot job) ticks once at boot and then every 60 s on the minute. It
  lists the current UTC hour prefix — plus the previous hour within 2 min of
  the boundary, and every hour back to the last processed key, floored at 60
  min (so a cold start fills the whole buffer) — fetches keys newer than the
  last processed one four at a time with a 15 s per-request timeout, and
  files the good flashes within **100 km of any sublocation with
  coordinates** (site list refreshed every 10 min) into a 60-minute in-memory
  buffer. One file or listing failing is one warn line and never stops the
  tick; each tick logs one `lightning tick` info line (files, failed,
  flashes, kept, buffered, newest_age). The buffer is mirrored to Redis
  (`lightning:store`, one JSON value, 65-min TTL) after every tick and loaded
  at startup, so a restart does not blank the status. `LIGHTNING_ENABLED=false`
  skips the job; the route still mounts and answers 503.
- **Policy** (constants in `lightning.go`, the one place they live): `alert` =
  any flash within **10 mi** in the last **30 min**, with `all_clear_at` = the
  latest such flash + 30 min; `caution` = any flash within **30 mi** in the
  last 30 min; `clear` otherwise. `nearest_mi` is the closest flash within 30
  mi in the window, `last_strike_at` the most recent; both null when there
  were none. Distances are haversine, reported in statute miles. The endpoint
  answers 503 when the newest successful fetch is older than 5 min, so a
  stalled feed reads "unavailable" rather than a false "clear".
- **UI**: `LightningCard` in `NowPanel.tsx` — one card above the outdoor row on
  the sublocation and camera pages, and on the conditions page with the two
  strike counts. Server-rendered from the route loader's `fetchLightning`
  (null on 404 → no card; `'unavailable'` on 503 → muted card), then
  re-polled every 60 s while mounted; the alert state shows a live mm:ss
  countdown to `all_clear_at` and refetches the moment it hits zero. Times
  are the viewer's local time and are only rendered after mount (the server
  cannot know the viewer's zone). Colors reuse the theme's calm/caution/
  alert tone tokens.

### Embed widget

`web-next/src/routes/embed.$slug.$sublocationSlug.$cameraSlug.tsx` (route
`/embed/{state}/{sublocation}/{camera}`, DAN-33) renders a self-contained
card — still (or live player with `?player=1`), a compact conditions row,
`LightningCard` when available, and a "Watch live on NationCam" link — meant
to sit in another site's `<iframe>`. It reuses `__root.tsx`'s single root
route rather than a second document shell: `isEmbedSurface` there strips the
navbar/footer/ad slots/AdSense/PostHog/devtools for `/embed/*` and sets the
theme class straight from `?theme=` (default dark) instead of localStorage,
so every viewer of a host's page sees the same theme. Fetching the camera is
what records the view (same endpoint the camera page loader uses), and there
is no ad slot in the card, so an embed load never touches the ad-impression
path. `web-next/vite.config.ts`'s `nitro({ routeRules })` sets
`Content-Security-Policy: frame-ancestors 'self'` on `/**` and
`frame-ancestors *` on `/embed/**` (the more specific rule wins), so no
NationCam page except the embed can be iframed on another origin (DAN-241; no
`X-Frame-Options` is set anywhere). **Licensing rule:** the route's loader
reads the framing page from the SSR request (`Referer`, plus `Sec-Fetch-Dest`
to tell a frame from a direct visit; `document.referrer` on a client
navigation) and compares its host (ignoring `www.`) to the sublocation's
`host_url` domain; nationcam.com and localhost always pass. A mismatch — or a
framed request with no Referer — renders a "This camera is not licensed for
this site" card with a link to the camera page and no player, still or
conditions. A sublocation with no `host_url` (free-camera hosts) may be
embedded anywhere, and a page opened directly is always shown. The live
player inside a licensed embed streams through `/api/hls/...` (see "HLS
proxy" below); the player runs on nationcam.com, so its Referer passes, and
fetches its own short-lived token at mount like every other player. `EmbedSnippet.tsx` builds the `<iframe>` snippet
(400×360 default) and a copy-to-clipboard box shown behind "Embed this
camera" on the camera page and an "Embed code" button on Dashboard →
Cameras. Embed pages are not in the sitemap and set
`<meta name="robots" content="noindex">`.

### HLS proxy

Restreamer-backed cameras are never handed out by their public Restreamer URL
(DAN-241). Every public video response — `GET /videos...`, the camera page,
related cameras — carries `src` = `/api/hls/{video_id}/index.m3u8`
(`hlsPublicSrc` in `handler/hls.go`); that URL plays nothing by itself — see
"Signed URLs" below. External HLS/MP4 sources are left as stored. `snapshot.jpg`, the snapshot archive and `first_src` keep reading
Restreamer directly server-side and stay public (Windy/Ventusky). Admin
`PUT /videos/{id}` treats a `src` equal to the proxy form as "unchanged" and
keeps the stored URL, since the admin list reads the public endpoint.

- **Routes**: `/hls/{video_id}/index.m3u8` (manifest), `/hls/{video_id}/{segment}`
  (variant playlists, segments, init maps — filename must match
  `^[A-Za-z0-9][A-Za-z0-9._-]*\.(m3u8|ts|m4s|mp4|aac|mp3|vtt|webvtt)$`) and
  `/hls/{video_id}/poster.jpg` (watermarked still, public, 60 s Redis cache;
  what `streamPoster` returns for a proxied src).
- **Upstream is pinned**: the URL comes from `videos.src` (via
  `GetPublicVideoSource`, the same visibility predicate as `GetVideoBySlug`;
  anything else is 404), the segment resolves to a file beside the manifest,
  redirects are not followed. Manifests (≤1 MB) are rewritten so each URI
  becomes `/api/hls/{id}/{file}` (URIs leaving the directory/host are
  dropped); segments are streamed (≤50 MB, 15 s timeout) through one pooled
  32 KB buffer (`hlsCopy`, no body buffering) with `Cache-Control: private`
  and `Vary: Origin, Referer`. id → src is memoized in memory for 10 s
  (`hlsSrcCache`), so a segment costs no Postgres round trip; a rejected or
  paused camera stops being served within that window. The upstream client
  has its own transport (256 idle conns per host — the default 2 would open
  a new connection per segment under load).
- **Signed URLs** (DAN-242, `handler/hlssign.go`; `hlsGuard` is the single
  verification hook). HMAC-SHA256 with `HLS_SIGNING_KEY` over
  `(video_id, path, exp)`, compared constant-time, accepted up to 30 s past
  `exp` (clock skew) and never with an `exp` further out than 12 h + 1 min.
  A request carries one of two shapes, else 403 (`missing stream signature`
  / `invalid stream signature` / `stream link expired`):
  - **Player token** — header `X-HLS-Token: {exp}.{sig}` signed over path
    `*` (any file of that camera), 5 min, from the uncached
    `GET /videos/{id}/stream-token`. `StreamPlayer` fetches it at mount for any
    `/api/hls/{id}/index.m3u8` src, attaches it to every manifest/segment
    request via hls.js `xhrSetup`, renews it 60 s before expiry, and renews
    immediately on a fatal network error (a laptop waking from sleep). These
    requests must **also** pass the Referer/Origin gate below (defence in
    depth). A live viewer watches for hours; a copied URL carries no token,
    and a copied token is dead within ~5 min.
  - **Signed URL** — `?exp=&sig=` signed over that exact file name. Used by the
    `stream.m3u8` 302 (manifest valid **12 h**) and by `StreamPlayer`'s
    native-HLS fallback for browsers without MSE/MMS (`signed_manifest_url`,
    1 h). The proxy rewrites such a manifest with a signed URI per entry:
    playlists inherit the manifest's `exp`, segments/init maps get
    `min(now + 2 min, manifest exp)`, re-signed on every manifest fetch, so a
    plain HLS player keeps playing while a copied segment URL dies in 2 min.
    These requests **skip** the Referer gate on purpose: their consumers
    (third-party players behind `stream.m3u8`) send no nationcam Referer, and
    the file-bound, expiring signature is the gate. Why 12 h: consumers
    re-resolve the stable `stream.m3u8` URL each time they start playback, so
    the window only has to cover one long session (a wall display through a
    working day) while a URL copied out of the redirect still dies the same
    day. The redirect is public, so its signature buys expiry, not exclusivity.
  - Unset `HLS_SIGNING_KEY` → random per-process key + one WARN at boot; URLs
    die on restart and differ across replicas (fails closed). Rotating the key
    ends every outstanding token/URL; live players recover by renewing.
  - `/hls/{id}/poster.jpg`, `snapshot.jpg` and the snapshot archive stay
    unsigned and public. Admin/owner/review previews play the raw `src` from
    `/review` and `/me` through `/api/stream-proxy`, unchanged.
- **Referer/Origin gate** (player-token requests only): a request must carry a
  Referer or Origin and
  every one it carries must be nationcam.com / www.nationcam.com, localhost /
  127.0.0.1 (dev), or a licensed embed host; otherwise 403. Licensed hosts are
  the `host_url` domains of approved sublocations
  (`ListLicensedHostURLs`), compared without `www.`, cached in memory for 5
  minutes (same TTL as the stream-proxy allow-list, stale set kept if a refresh
  fails). Spoofing the header alone no longer fetches anything.
- **Load** (`hls_load_test.go`): `HLS_LOAD=1 go test ./internal/handler -run
  TestHLSLoadHarness -v` relays a 512 KB segment from a fake upstream through
  the proxy at 50 and 200 concurrent clients and compares with direct upstream
  fetches; `go test ./internal/handler -run '^$' -bench HLSSegment -benchmem`
  reports per-segment allocations.

### Stream Management

The `/streams` endpoints proxy to a self-hosted datarhei Restreamer instance. They are only
available when `RESTREAMER_URL` and `STREAMER_API_KEY` are configured. Auth is via `X-API-Key`
header (not Logto). Stream creation is rate-limited to 10 requests per minute.

- **HLS output**: Streams are accessible at `{RESTREAMER_URL}/memfs/{streamId}.m3u8`
- **Codec**: Passthrough (`-codec:v copy -codec:a copy`) by default — no re-encoding
- **Reconnect**: Auto-reconnect on failure with 15-second delay
- **Token management**: The Go API manages Restreamer JWT tokens internally (auto-refresh)

### Snapshot archive

`api/internal/archive` keeps a browsable history of every camera's watermarked
stills on the `snapshots` Docker volume (`SNAPSHOTS_DIR`, default
`/app/data/snapshots`, `./snapshots` outside Docker). A background job started
from `main.go` runs on the server's root context and stops with it:

- **Capture**: every 15 minutes, aligned to :00/:15/:30/:45, one still per active
  video via the same `SnapshotForSource` pipeline as `snapshot.jpg` (Restreamer
  `memfs/{id}.jpg` + watermark; non-Restreamer sources are skipped). Written to
  `{video_id}/{YYYY-MM-DD}/{HHMM}.jpg` with day and time in **America/Chicago**,
  atomically (temp file + rename). Four captures run at once, each with a 20s
  timeout; one camera failing is logged and never stops the rest.
- **Retention** runs hourly: frames older than 14 days are deleted except the
  frame closest to 12:00 local per day, which is kept for 365 days. Empty day and
  camera directories are removed.
- **Reads**: the directory tree is the only index — no table backs it. The two
  `/frames` listings are cached under `videos:*` (today's frame list for 60s,
  everything else the usual 5 min); frame URLs in the JSON are `/api/snapshots/...`,
  the same browser-facing form as `/api/uploads/...`. `/snapshots/*` only serves a
  path that matches `{digits}/{YYYY-MM-DD}/{HHMM}.jpg` exactly, so traversal never
  reaches the filesystem.

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
| `batchatco/go-native-netcdf` | Pure-Go NetCDF4/HDF5 reader for GOES GLM files (no CGO) |

## Home

Rules learned while running Home sessions on this repo; every worker reads them.

- **Trace public API field changes to the frontend before opening a PR.** The local
  preview proxies the *production* API, so a new API behaviour is invisible there. When
  a PR changes a field the browser consumes (`src`, poster URLs, image URLs), grep its
  consumers (`StreamPlayer.tsx`, `lib/seo.ts`, `PosterTile.tsx`, `CameraPlayer.tsx`,
  the embed route) and update them in the same PR. DAN-241 shipped a relative
  `/api/hls/...` `src` that `StreamPlayer` wrapped in `/api/stream-proxy?url=`, which
  400s on a relative URL; DAN-242 had to fix it.
- **No Docker on the dev machine.** The Go API cannot run locally (no Postgres/Redis);
  API changes are verified with `go test` and then in production after deploy. Say so
  in the PR body instead of skipping the acceptance line silently.
- **Deploy order for API-plus-frontend changes is api first, then web-next.** A
  frontend that asks for an endpoint the API does not have yet 404s every tile.
- **New env vars** go in `api/internal/config`, `docker-compose.yml`, `.env.example`
  and the env list at the top of this file, and are called out in the PR body so they
  are set in Coolify before the deploy (`HLS_SIGNING_KEY`, 2026-10-07).
