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
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
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

-- ────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_states_slug ON states(slug);
CREATE INDEX IF NOT EXISTS idx_sublocations_state_id ON sublocations(state_id);
CREATE INDEX IF NOT EXISTS idx_videos_state_id ON videos(state_id);
CREATE INDEX IF NOT EXISTS idx_videos_sublocation_id ON videos(sublocation_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

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
