# WNDRR Meta Ads Creative & Spend Dashboard

One system feeding the weekly "what gets shot this week" decision, built in
phases on shared data rather than as separate tools. See the build brief for
full context; this README covers what's implemented and how to run it.

## Status

**Implemented (Phase 1 + prerequisites):**
- Category mapping admin (style / Meta campaign / Meta ad set → category),
  the manual source of truth for grouping. Style → category can be synced
  live from ApparelMagic's own `products.category` field (button on the
  Category Mapping tab, `POST /api/mappings/sync-from-am`) — that's a real
  structured field ApparelMagic maintains per style (same field the
  `demandplanning` app's V2 branch already treats as authoritative), not
  name-parsing.
- Category spend dashboard: Meta spend share vs. ApparelMagic stock share vs.
  ApparelMagic sales share, by category, with an underspend flag (spend share
  below stock share). Sales share is always shown alongside a flag so a
  low-spend/high-stock category can be checked against whether it's actually
  selling before assuming it needs more budget.
  **Spend attribution order per ad:** (1) a manual mapping on its ad set or
  campaign, if one exists, always wins; (2) otherwise, `src/routes/
  dashboard.js: deriveCategoryFromAdName` looks for a category name as its
  own underscore-delimited token in the individual *ad's* name (e.g.
  `..._SWEATS_...`) — WNDRR's naming convention reliably encodes category at
  the ad level, confirmed against real examples, but not at the ad
  set/campaign level. This only ever matches against the app's own known
  category list (never a free-text guess), so an ad whose name doesn't
  contain a recognized category token falls through to "unmapped spend"
  rather than being attributed wrong. The dashboard reports both
  `unmapped_spend` and `auto_matched_by_name_spend` so it's visible how much
  of the total came from which path. This is a deliberate exception to "never
  derive category from Meta naming" — made because this account's naming is
  consistent enough at the ad level to trust, unlike ad set/campaign names.
- Promotions calendar: a minimal manual entry point so "what's promoting this
  week" isn't left to memory.
- Style Spend tab: product-level spend lookup, one level below category. Map
  Meta campaigns/ad sets to a specific product (colours condensed
  automatically -- ApparelMagic's own `description` field follows a
  "PRODUCT NAME - COLOUR" convention, same split point already proven in the
  demandplanning app), then search/filter spend per product to compare e.g.
  Halo Baggy Trackpant vs Hoxton V2 Tech Trackpant.

**Not built yet (do not build all five phases at once):** creative pipeline
tracker (Phase 2), stock-gated shoot list (Phase 3), combined weekly view
(Phase 4), automated Meta draft-ad upload (Phase 5). The database schema for
Phase 2/5 entities (`styles`, `creative_assets`, `ad_drafts`) already exists
in `migrations/001_init.sql` so those phases build on the same style/SKU
identifiers instead of a second source of truth — but no routes or UI read or
write them yet.

## Stack

Node/Express + Postgres, deployed on Railway via `nixpacks.toml` — the same
pattern used by the `aminventory` (scan-to-verify) app. No frontend build
step: `public/index.html` is a single static page with vanilla JS calling the
JSON API.

## Before Phase 1 can report anything real

1. **Meta API app.** Create a Meta app with Marketing API access
   (developers.facebook.com) and generate a long-lived access token. Only the
   `ads_read` permission is needed right now — do not request
   `ads_management` until Phase 5 actually starts. Set `META_ACCESS_TOKEN`
   and `META_AD_ACCOUNT_ID` (the `act_...` id).
2. **ApparelMagic credentials.** Reuses the integration pattern from
   `aminventory`/`wholesalescan`: signed requests to
   `https://{subdomain}.app.apparelmagic.com/api/json/{endpoint}`. Set
   `AM_SUBDOMAIN`, `AM_TOKEN`, and `AM_WAREHOUSE_IDS` (which warehouse(s)
   count as sellable/on-hand stock).
3. **Populate the category mapping table** for at least the currently-live
   campaigns, under the "Category Mapping" tab, before the dashboard has
   anything meaningful to show.

Until Meta/ApparelMagic are configured, the dashboard still loads and shows a
clear warning banner instead of crashing or silently reporting zeros as real
data.

## Running locally

```
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum; Meta/AM optional locally
npm run migrate
npm start
```

Then open `http://localhost:3333`.

## Known caveat: ApparelMagic sales endpoint

Stock (`inventory` + `sku_warehouse`) mirrors the exact pattern already
proven in `aminventory/server.js`. The sales-by-style query
(`src/apparelmagic.js: getSalesByStyle`) uses ApparelMagic's `order_items`
endpoint and tries the plausible field name variants for style and quantity,
but the exact schema hasn't been verified against a live ApparelMagic
instance. If it doesn't match your instance's field names, the dashboard
degrades gracefully (shows "sales share unavailable" with a warning) rather
than reporting wrong numbers — update the field-name lists in that function
once you can confirm the real schema.

## Schema

See `migrations/001_init.sql`. Key decisions:
- `styles.tier` is `core` or `new_drop`, matching the brief's Core/Proven vs.
  New Drop/Unproven distinction — this is what Phase 2 will hang the
  "New Drop can only move into Filming if its Creative Asset is
  Tested/Proven, unless marked a deliberate trial" rule on.
- `category_mappings` is one table with an `entity_type` discriminator
  (`style` / `meta_campaign` / `meta_adset`) rather than three separate
  tables, so it's a single admin screen per the brief ("maintain this table
  inside the app").
- `creative_assets.stage_owner_editor` is a free-text role field, not a
  foreign key to a named person — Sheridan is the QC checkpoint regardless of
  who edits.
