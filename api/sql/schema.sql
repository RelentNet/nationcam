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
