-- Product-level spend lookup: "how much is going to Halo Baggy Trackpants
-- vs Hoxton V2 Tech Trackpants", with colours condensed into one product.
--
-- product_name is parsed from ApparelMagic's own `products.description`
-- field, which already follows a "PRODUCT NAME - COLOUR" convention --
-- confirmed by the same split (last " - ") already used successfully in
-- the demandplanning app to group Shopify variants by product. Populated
-- by the same "Sync from ApparelMagic" action that fills in category.

ALTER TABLE styles ADD COLUMN IF NOT EXISTS product_name TEXT;
CREATE INDEX IF NOT EXISTS idx_styles_product_name ON styles(product_name);

-- Meta campaign/ad set -> product_name. Separate from category_mappings
-- (rather than reusing entity_type='style') because a campaign/ad set may
-- need to be tagged with both a category (Phase 1 dashboard) and a specific
-- product (this lookup) at once, and category_mappings' UNIQUE(entity_type,
-- entity_id) would block that overlap.
CREATE TABLE IF NOT EXISTS product_spend_mappings (
  id            SERIAL PRIMARY KEY,
  product_name  TEXT NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('meta_campaign', 'meta_adset')),
  entity_id     TEXT NOT NULL,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_product_spend_mappings_product ON product_spend_mappings(product_name);
