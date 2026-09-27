-- NationCam — App Database Schema

-- ────────────────────────────────────────────────
-- Functions
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_slug(input TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN lower(regexp_replace(regexp_replace(trim(input), '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION set_slug_from_name() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_slug(NEW.name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Videos use `title` rather than `name`, and their slugs must be unique within
-- (state_id, sublocation_id) so /locations/{state}/{sublocation}/{camera} resolves
-- to exactly one row. Duplicate titles get a -2, -3, … suffix instead of erroring.
-- ponytail: the EXISTS loop is not concurrency-safe — two simultaneous inserts of the
-- same title in the same sublocation can pick the same suffix, and the unique index
-- below rejects the loser. Writes are admin-only and rare; add an advisory lock if
-- camera creation ever becomes automated/bulk.
CREATE OR REPLACE FUNCTION set_video_slug() RETURNS TRIGGER AS $$
DECLARE
  base TEXT;
  n    INT := 1;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := generate_slug(NEW.title);
    IF base = '' THEN
      base := 'camera';
    END IF;
    NEW.slug := base;
    WHILE EXISTS (
      SELECT 1 FROM videos
      WHERE slug = NEW.slug
        AND state_id = NEW.state_id
        AND sublocation_id IS NOT DISTINCT FROM NEW.sublocation_id
        AND video_id IS DISTINCT FROM NEW.video_id
    ) LOOP
      n := n + 1;
      NEW.slug := base || '-' || n;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS states (
  state_id    SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  slug        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sublocations (
  sublocation_id SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  state_id       INTEGER NOT NULL REFERENCES states(state_id) ON DELETE CASCADE,
  slug           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_id, slug)
);

CREATE TABLE IF NOT EXISTS videos (
  video_id       SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  src            TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'application/x-mpegURL',
  state_id       INTEGER NOT NULL REFERENCES states(state_id) ON DELETE CASCADE,
  sublocation_id INTEGER REFERENCES sublocations(sublocation_id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'inactive', 'paused', 'rejected')),
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────
-- Column additions
--
-- CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so columns
-- added after the first production deploy live here instead. Every statement is
-- idempotent and non-destructive — nothing is ever dropped or recreated.
-- ────────────────────────────────────────────────

ALTER TABLE videos ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT '';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;

-- Per-location branding (hero banner, round logo, sponsor button). Both states
-- and sublocations carry the same five fields; empty means "use the site default"
-- (the frontend falls back to /videos/nc_default_hero.webm and
-- /logos/nc_default_logo.webp). hero_kind is 'image' (uploaded) or 'video' (a
-- pasted 3rd-party URL). URLs are validated in the API before write.
ALTER TABLE states ADD COLUMN IF NOT EXISTS hero_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE states ADD COLUMN IF NOT EXISTS hero_kind    TEXT NOT NULL DEFAULT 'video';
ALTER TABLE states ADD COLUMN IF NOT EXISTS logo_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE states ADD COLUMN IF NOT EXISTS sponsor_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE states ADD COLUMN IF NOT EXISTS sponsor_link TEXT NOT NULL DEFAULT '';

ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS hero_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS hero_kind    TEXT NOT NULL DEFAULT 'video';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS logo_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS sponsor_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS sponsor_link TEXT NOT NULL DEFAULT '';

-- Editorial "About this location / camera" copy, written in the dashboard and
-- rendered on the public state, sublocation and camera pages. Light markdown:
-- '## ' headings, blank-line-separated paragraphs, '- ' bullets. Empty means the
-- page renders no About section at all. Length-capped in the API before write.
ALTER TABLE states ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';

-- A state with a camera confirmed but not yet live. Set in the dashboard; it only
-- promotes the state on /locations (a prominent card instead of a coming-soon
-- pill) and softens the state page's empty-state copy.
ALTER TABLE states ADD COLUMN IF NOT EXISTS upcoming BOOLEAN NOT NULL DEFAULT FALSE;

-- A wordmark that replaces the hero's text title when set (the sponsor image
-- is a separate, optional "Sponsored by" credit).
ALTER TABLE states ADD COLUMN IF NOT EXISTS title_url TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS title_url TEXT NOT NULL DEFAULT '';

-- Official tourism site for the area, shown as a pill at the top of the hero.
-- A sublocation with an empty tourism_url inherits its state's.
ALTER TABLE states       ADD COLUMN IF NOT EXISTS tourism_name TEXT NOT NULL DEFAULT '';
ALTER TABLE states       ADD COLUMN IF NOT EXISTS tourism_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS tourism_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS tourism_url  TEXT NOT NULL DEFAULT '';

-- Host and visit details for a sublocation. lat/lng drive the "Right now"
-- weather panel (fetched server-side from Open-Meteo, which also supplies the
-- timezone, so none is stored). host_* and address feed the "Plan a visit" card
-- and the hosted-by row; empty / NULL means the page renders neither.
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS lat        DOUBLE PRECISION;
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS lng        DOUBLE PRECISION;
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS host_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS host_url   TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS host_since DATE;
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS address    TEXT NOT NULL DEFAULT '';

-- Per-sublocation override for which NOAA tide station and USGS river gauge the
-- conditions page uses, instead of always taking the nearest one — the nearest
-- pick can be on the wrong body of water (DAN-28: a Mississippi River levee
-- camera picking up a lake tide station and a lake river gauge, both merely
-- within the distance limits). NULL/empty means "no opinion, use the nearest
-- lookup"; the sentinel value 'none' disables that source for the sublocation
-- entirely rather than pinning it to a station/gauge.
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS noaa_station_id TEXT;
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS usgs_site_id    TEXT;

-- Owner accounts and review (DAN-39). Any signed-in user can add their own
-- sublocations and cameras; both enter review and stay invisible to public
-- endpoints until an admin approves them.
--
--   videos.status:       pending → active ⇄ paused; pending/active/paused → rejected
--                        ('inactive' is the pre-existing admin-only switch-off)
--   sublocations.status: pending → approved | rejected
--
-- owner_id is the Logto `sub` of the account that created the row; '' marks
-- the admin-owned legacy rows. stream_id is the Restreamer process UUID when
-- the API created the ingest itself (NULL for externally hosted HLS), so
-- pause/resume/reject/delete can drive the process. review_note is the
-- admin's reason on reject, shown to the owner. Existing rows stay valid:
-- videos keep their status and sublocations default to 'approved'.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the widened status CHECK
-- is re-asserted with drop-then-add (same pattern as ads_type_check). Both
-- tables are small; the re-validation on every startup is free.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS owner_id    TEXT NOT NULL DEFAULT '';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS stream_id   TEXT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_status_check;
ALTER TABLE videos ADD CONSTRAINT videos_status_check
  CHECK (status IN ('pending', 'active', 'inactive', 'paused', 'rejected'));

ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS owner_id    TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE sublocations DROP CONSTRAINT IF EXISTS sublocations_status_check;
ALTER TABLE sublocations ADD CONSTRAINT sublocations_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- ────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_states_slug ON states(slug);
CREATE INDEX IF NOT EXISTS idx_sublocations_state_id ON sublocations(state_id);
CREATE INDEX IF NOT EXISTS idx_videos_state_id ON videos(state_id);
CREATE INDEX IF NOT EXISTS idx_videos_sublocation_id ON videos(sublocation_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_owner_id ON videos(owner_id);
CREATE INDEX IF NOT EXISTS idx_sublocations_status ON sublocations(status);
CREATE INDEX IF NOT EXISTS idx_sublocations_owner_id ON sublocations(owner_id);

-- ────────────────────────────────────────────────
-- Ads
--
-- Self-contained section (tables + indexes + trigger together) so it drops in
-- without interleaving with the sections above, which other in-flight schema
-- work is editing. Everything here is CREATE ... IF NOT EXISTS / OR REPLACE, so
-- a restart against a database that already has these tables is a no-op.
-- ────────────────────────────────────────────────

-- Ad inventory. Scope is whichever of the three nullable FKs is set:
--   video_id       → this one camera
--   sublocation_id → every camera in that sublocation
--   state_id       → every camera in that state
--   all NULL       → global / house ad
-- At most one may be set. The resolver takes the most specific scope that has
-- any eligible ad and picks among that scope's ads by weight.
CREATE TABLE IF NOT EXISTS ads (
  ad_id          SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  video_url      TEXT NOT NULL,
  click_url      TEXT NOT NULL DEFAULT '',
  weight         INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  state_id       INTEGER REFERENCES states(state_id) ON DELETE CASCADE,
  sublocation_id INTEGER REFERENCES sublocations(sublocation_id) ON DELETE CASCADE,
  video_id       INTEGER REFERENCES videos(video_id) ON DELETE CASCADE,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ads_single_scope CHECK (num_nonnulls(state_id, sublocation_id, video_id) <= 1)
);

-- One durable row per delivered impression or click — never buffered, never
-- sampled. These counts bill advertisers, unlike videos.view_count which is a
-- deliberately approximate Redis-buffered page counter. video_id records which
-- camera the ad ran on, so "how many times did ad X run on camera Y last month"
-- is a single indexed query.
--
-- ad_id is ON DELETE RESTRICT on purpose: deleting an ad must not silently erase
-- what an advertiser was billed for. Ads that have run can only be disabled.
CREATE TABLE IF NOT EXISTS ad_impressions (
  impression_id BIGSERIAL PRIMARY KEY,
  ad_id         INTEGER NOT NULL REFERENCES ads(ad_id) ON DELETE RESTRICT,
  video_id      INTEGER REFERENCES videos(video_id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'impression' CHECK (kind IN ('impression', 'click')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_video_id ON ads(video_id);
CREATE INDEX IF NOT EXISTS idx_ads_sublocation_id ON ads(sublocation_id);
CREATE INDEX IF NOT EXISTS idx_ads_state_id ON ads(state_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_report ON ad_impressions(ad_id, video_id, created_at);

CREATE OR REPLACE TRIGGER trg_ads_updated
  BEFORE UPDATE ON ads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- P3b: one ads table, two creative types. `type` discriminates a video pre-roll
-- from a banner whose creative is an admin-authored HTML/JS snippet (AdSense-style
-- paste). Banners share the same scope columns and most-specific-wins ladder as
-- video. `is_override` is the top rung: an enabled, in-window override beats the
-- whole ladder for its type (someone renting all inventory).
--
-- Idempotent + non-destructive against the live table: type defaults to
-- 'preroll_video', so every existing (all-video) row is classified correctly with
-- no backfill. video_url keeps NOT NULL but gains a '' default so banner rows —
-- which have no video — satisfy it; the ads_type_fields CHECK then guarantees a
-- pre-roll row actually carries a video_url and a banner row carries html_code and
-- a real placement slot.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS type        TEXT NOT NULL DEFAULT 'preroll_video';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS html_code   TEXT NOT NULL DEFAULT '';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS placement   TEXT NOT NULL DEFAULT '';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS is_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ads ALTER COLUMN video_url SET DEFAULT '';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so re-assert with drop-then-add.
-- ponytail: this re-validates the ads table on every startup; ads is tiny and
-- write-rare so a full scan is free. If ads ever grows large, gate each ADD behind
-- a pg_constraint lookup so it runs once.
ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_type_check;
ALTER TABLE ads ADD CONSTRAINT ads_type_check CHECK (type IN ('preroll_video', 'banner_html'));
ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_type_fields;
ALTER TABLE ads ADD CONSTRAINT ads_type_fields CHECK (
  (type = 'preroll_video' AND video_url <> '')
  OR (type = 'banner_html' AND html_code <> '' AND placement IN ('left', 'right', 'mobile'))
);

CREATE INDEX IF NOT EXISTS idx_ads_type ON ads(type);
CREATE INDEX IF NOT EXISTS idx_ads_override ON ads(is_override) WHERE is_override;

-- ────────────────────────────────────────────────
-- Submissions
--
-- Contact / "Add Your Camera" form submissions. Self-contained (table + index)
-- and CREATE ... IF NOT EXISTS, so a restart against a database that already has
-- it is a no-op. The public POST /submissions endpoint writes here; the dashboard
-- reads it. `message` is the free-text body — the camera-application form packs
-- its structured fields (cameras, internet, address, timeline) into it client-side
-- so this stays one generic contact table. Stored as data only and rendered as
-- plain text; nothing here is ever executed.
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS submissions (
  submission_id BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  message       TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'contact',
  handled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at DESC);

-- ────────────────────────────────────────────────
-- Field notes (posts) — DAN-25
--
-- A lightweight blog written in the dashboard, published at /notes. Each post
-- is optionally attached to one state, sublocation, or camera (the same
-- "at most one of three" scope CHECK as ads) so a related-notes block can show
-- it on that page; all three NULL is an unscoped post, visible only at /notes.
-- Self-contained (function + table + index + trigger) so it drops in without
-- interleaving with the sections above; everything here is
-- CREATE ... IF NOT EXISTS / OR REPLACE, so a restart against a database that
-- already has it is a no-op.
-- ────────────────────────────────────────────────

-- Posts use `title` rather than `name`, and the slug is unique across the
-- whole table (there is no per-scope partitioning the way videos have). Same
-- dedup-by-suffix approach and the same concurrency caveat as set_video_slug:
-- writes are admin-only and rare.
CREATE OR REPLACE FUNCTION set_post_slug() RETURNS TRIGGER AS $$
DECLARE
  base TEXT;
  n    INT := 1;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := generate_slug(NEW.title);
    IF base = '' THEN
      base := 'post';
    END IF;
    NEW.slug := base;
    WHILE EXISTS (
      SELECT 1 FROM posts
      WHERE slug = NEW.slug
        AND post_id IS DISTINCT FROM NEW.post_id
    ) LOOP
      n := n + 1;
      NEW.slug := base || '-' || n;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS posts (
  post_id        SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL DEFAULT '',
  body_md        TEXT NOT NULL DEFAULT '',
  excerpt        TEXT NOT NULL DEFAULT '',
  cover_url      TEXT NOT NULL DEFAULT '',
  state_id       INTEGER REFERENCES states(state_id) ON DELETE SET NULL,
  sublocation_id INTEGER REFERENCES sublocations(sublocation_id) ON DELETE SET NULL,
  video_id       INTEGER REFERENCES videos(video_id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at   TIMESTAMPTZ,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT posts_single_scope CHECK (num_nonnulls(state_id, sublocation_id, video_id) <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_state_id ON posts(state_id);
CREATE INDEX IF NOT EXISTS idx_posts_sublocation_id ON posts(sublocation_id);
CREATE INDEX IF NOT EXISTS idx_posts_video_id ON posts(video_id);
-- Backs both "published, newest first" (the public list) and "is this post
-- live" checks in one shape.
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at DESC);

CREATE OR REPLACE TRIGGER trg_posts_slug
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_post_slug();

CREATE OR REPLACE TRIGGER trg_posts_updated
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────
-- Events — DAN-27
--
-- Hosts' events (tournaments, rodeos, festivals) shown on the cameras that
-- can watch them and on the sitewide /events page. Unlike ads/posts, the
-- attachment is not "at most one of three": sublocation_id is required (an
-- event always belongs to one place) and video_id is an optional, additional
-- "watch here" pointer to a specific camera in that sublocation — the API
-- rejects a video_id that doesn't belong to the chosen sublocation_id rather
-- than enforcing it here, since that check needs a join. Times are stored as
-- timestamptz and rendered in the viewer's local time by the frontend.
-- Self-contained (table + indexes + trigger) so it drops in without
-- interleaving with the sections above; everything here is
-- CREATE ... IF NOT EXISTS / OR REPLACE, so a restart against a database that
-- already has it is a no-op.
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  event_id       SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ,
  url            TEXT,
  sublocation_id INTEGER NOT NULL REFERENCES sublocations(sublocation_id) ON DELETE CASCADE,
  video_id       INTEGER REFERENCES videos(video_id) ON DELETE SET NULL,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_sublocation_id ON events(sublocation_id);
CREATE INDEX IF NOT EXISTS idx_events_video_id ON events(video_id);
-- Backs "upcoming, soonest first" on all three listings (sitewide, by
-- sublocation, by camera) and "newest first" on the admin listing.
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);

CREATE OR REPLACE TRIGGER trg_events_updated
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────
-- Triggers
-- ────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER trg_states_slug
  BEFORE INSERT OR UPDATE ON states
  FOR EACH ROW EXECUTE FUNCTION set_slug_from_name();

CREATE OR REPLACE TRIGGER trg_states_updated
  BEFORE UPDATE ON states
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_sublocations_slug
  BEFORE INSERT OR UPDATE ON sublocations
  FOR EACH ROW EXECUTE FUNCTION set_slug_from_name();

CREATE OR REPLACE TRIGGER trg_sublocations_updated
  BEFORE UPDATE ON sublocations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_videos_slug
  BEFORE INSERT OR UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION set_video_slug();

CREATE OR REPLACE TRIGGER trg_videos_updated
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────
-- Backfills
--
-- Runs after the triggers exist so the UPDATE below fires trg_videos_slug and
-- reuses its dedup logic. Matches no rows once every video has a slug, so it is
-- a no-op on subsequent startups.
-- ────────────────────────────────────────────────

UPDATE videos SET slug = '' WHERE slug = '';

-- Unique per (state_id, sublocation_id, slug). NULLS NOT DISTINCT (PG 15+) makes
-- the sublocation-less rows of a state compare equal instead of always-unique.
-- Created after the backfill so it never sees duplicate slugs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_slug_scope
  ON videos (state_id, sublocation_id, slug) NULLS NOT DISTINCT;
