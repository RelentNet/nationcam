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

# Optional — snapshot archive location (docker-compose mounts the `snapshots` volume here)
SNAPSHOTS_DIR=/app/data/snapshots

# Optional — Logto management connection (admin console Users panel + Home)
LOGTO_M2M_APP_ID=<Logto machine-to-machine app ID>
LOGTO_M2M_APP_SECRET=<Logto machine-to-machine app secret>
OPS_API_KEY=<32+ random chars — X-API-Key for /api/admin/* endpoints>

# Optional — satellite lightning (NOAA GOES GLM, public S3, no credentials)
LIGHTNING_ENABLED=true          # false turns the job off; the endpoint then answers 503
LIGHTNING_BUCKET=noaa-goes19    # GOES-East; noaa-goes18 (GOES-West) has the same layout
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
        stream.go                     # CRUD handlers for /streams (Restreamer proxy)
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
- **sublocations**: `sublocation_id`, `name`, `description`, `state_id` (FK), `slug`, `lat`/`lng` (nullable, unlock the weather panel), `host_name`, `host_url`, `host_since` (nullable date), `address`, `noaa_station_id`/`usgs_site_id` (nullable, pin or disable the conditions page's tide station / river gauge — see API Endpoints), `created_at`, `updated_at`
- **videos**: `video_id`, `title`, `src`, `type`, `state_id` (FK), `sublocation_id` (nullable FK), `status`, `created_by`, `created_at`, `updated_at`
- **ads**: `ad_id`, `name`, `video_url`, `click_url`, `weight`, `starts_at`, `ends_at`, `enabled`, `state_id` / `sublocation_id` / `video_id` (all nullable FKs — at most one set, this is the targeting scope), `created_by`, `created_at`, `updated_at`
- **ad_impressions**: `impression_id`, `ad_id` (FK), `video_id` (nullable FK), `kind` (`impression` | `click`), `created_at`
- **videos**: `video_id`, `title`, `src`, `type`, `state_id` (FK), `sublocation_id` (nullable FK), `status`, `slug`, `view_count`, `created_by`, `created_at`, `updated_at`
- **posts**: `post_id`, `title`, `slug`, `body_md`, `excerpt`, `cover_url`, `state_id` / `sublocation_id` / `video_id` (all nullable FKs, `ON DELETE SET NULL` — at most one set, this is the "Field notes" attachment), `status` (`draft` | `published`), `published_at` (nullable), `created_by`, `created_at`, `updated_at`
- **events**: `event_id`, `title`, `description_md`, `starts_at` (`TIMESTAMPTZ NOT NULL`), `ends_at` (nullable), `url` (nullable), `sublocation_id` (FK, `NOT NULL ON DELETE CASCADE` — an event always belongs to one place), `video_id` (nullable FK, `ON DELETE SET NULL` — an optional "watch here" pointer to a camera in that sublocation), `created_by`, `created_at`, `updated_at`

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
| GET    | `/videos/{state}/{sub}/{slug}/snapshot.jpg` | Latest still, watermarked (60s Redis cache) — the stable URL for Windy/Ventusky | None |
| GET    | `/videos/{state}/{sub}/{slug}/stream.m3u8`  | 302 to the camera's current HLS manifest | None |
| GET    | `/videos/{state}/{sub}/{slug}/frames?day=YYYY-MM-DD` | Archived stills for one local day (default today), sorted by time | None |
| GET    | `/videos/{state}/{sub}/{slug}/frames/days`  | Days with at least one archived still, newest first | None |
| GET    | `/snapshots/{video_id}/{day}/{HHMM}.jpg` | One archived still (immutable, 1-year cache header) | None |
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
| GET    | `/admin/users?page=&page_size=`  | Logto users, newest role data resolved per user | Admin (Logto) or Ops key |
| GET    | `/admin/users/stats`             | `{ total, new_7d, new_30d, admins }` | Admin (Logto) or Ops key |
| GET    | `/admin/roles`                   | Every Logto role + user count + scopes | Admin (Logto) or Ops key |

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
