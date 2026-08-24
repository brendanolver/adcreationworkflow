-- WNDRR Meta Ads Creative & Spend Dashboard
-- Shared schema for all phases. Only Phase 1 (spend/stock/sales reporting),
-- the category mapping admin, and the promo calendar are wired up to routes
-- today. The remaining tables exist now so Phase 2+ builds on the same
-- style/SKU identifiers instead of a second source of truth.

-- Core entity: Style/Product, keyed by the same style/SKU code ApparelMagic uses.
CREATE TABLE IF NOT EXISTS styles (
  style_code   TEXT PRIMARY KEY,
  name         TEXT,
  tier         TEXT NOT NULL DEFAULT 'core' CHECK (tier IN ('core', 'new_drop')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Manually maintained categories. Spend/stock/sales are only ever grouped by
-- this table -- never derived from Meta campaign/ad set naming.
CREATE TABLE IF NOT EXISTS categories (
  id           SERIAL PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The category mapping table described in the brief: style -> category, and
-- Meta campaign/ad set -> category. Kept as one table with an entity_type
-- discriminator so it's a single admin screen, per "maintain this table
-- inside the app".
CREATE TABLE IF NOT EXISTS category_mappings (
  id            SERIAL PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('style', 'meta_campaign', 'meta_adset')),
  entity_id     TEXT NOT NULL, -- style_code, or Meta campaign_id / adset_id
  label         TEXT,          -- optional human-readable note (style name, campaign name at time of entry, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_category_mappings_category ON category_mappings(category_id);
CREATE INDEX IF NOT EXISTS idx_category_mappings_entity ON category_mappings(entity_type, entity_id);

-- Promotions calendar (the "known gap" flagged in the brief): a minimal
-- manual entry point so "what's promoting this week" isn't something only
-- one person remembers.
CREATE TABLE IF NOT EXISTS promotions (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  style_code    TEXT REFERENCES styles(style_code) ON DELETE SET NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);

-- ---------------------------------------------------------------------------
-- Phase 2+ tables. Schema only for now -- no routes/UI read or write these
-- yet. Defined here so the style/tier scheme and stage vocabulary are locked
-- in from the start rather than retrofitted.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS creative_assets (
  id                     SERIAL PRIMARY KEY,
  style_code             TEXT NOT NULL REFERENCES styles(style_code) ON DELETE CASCADE,
  status                 TEXT NOT NULL DEFAULT 'strategy_not_started' CHECK (status IN (
                           'strategy_not_started',
                           'awaiting_proven_concept',
                           'concept_script',
                           'filming',
                           'editing',
                           'qc',
                           'uploaded_live'
                         )),
  concept_classification TEXT NOT NULL CHECK (concept_classification IN ('tested_proven', 'new_experimental')),
  is_deliberate_trial    BOOLEAN NOT NULL DEFAULT false, -- explicit override for a New Drop style deliberately trialling a new concept
  format                 TEXT NOT NULL CHECK (format IN ('video', 'static')),
  stage_owner_strategist  TEXT,
  stage_owner_filmer      TEXT,
  stage_owner_editor      TEXT, -- generic role, not tied to a named person
  stage_owner_qc          TEXT,
  target_date            DATE,
  drive_folder_url       TEXT, -- Phase 5: source of the final approved video/static file
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creative_assets_style ON creative_assets(style_code);
CREATE INDEX IF NOT EXISTS idx_creative_assets_status ON creative_assets(status);

-- Phase 5: record of ads created (always paused/draft) from an approved
-- Creative Asset via the category mapping table, pending manual activation.
CREATE TABLE IF NOT EXISTS ad_drafts (
  id                 SERIAL PRIMARY KEY,
  creative_asset_id  INTEGER NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  meta_campaign_id   TEXT NOT NULL,
  meta_adset_id      TEXT NOT NULL,
  meta_ad_id         TEXT, -- set once created in Meta, always as PAUSED
  status             TEXT NOT NULL DEFAULT 'draft_created' CHECK (status IN ('draft_created', 'activated_manually', 'failed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
