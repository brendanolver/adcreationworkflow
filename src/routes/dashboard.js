const express = require('express');
const db = require('../db');
const meta = require('../meta');
const am = require('../apparelmagic');

const router = express.Router();

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 27); // trailing 4 weeks, matches a weekly review cadence
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

// Phase 1: Meta spend by category vs stock share vs sales share.
// Flag = category's spend share is below its stock share. Sales share is
// always returned alongside so a flagged category can be checked against
// whether it's actually selling before assuming it needs more budget.
router.get('/', async (req, res) => {
  try {
    await handleDashboard(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function handleDashboard(req, res) {
  const { start, end } = { ...defaultDateRange(), ...pickDates(req.query) };

  const warnings = [];
  const { rows: mappingRows } = await db.query(
    `SELECT m.entity_type, m.entity_id, c.id AS category_id, c.name AS category_name
     FROM category_mappings m JOIN categories c ON c.id = m.category_id`
  );
  const adsetToCategory = new Map();
  const campaignToCategory = new Map();
  const styleToCategory = new Map();
  for (const m of mappingRows) {
    if (m.entity_type === 'meta_adset') adsetToCategory.set(m.entity_id, m);
    else if (m.entity_type === 'meta_campaign') campaignToCategory.set(m.entity_id, m);
    else if (m.entity_type === 'style') styleToCategory.set(m.entity_id, m);
  }

  // --- Spend (Meta) ---
  // Attribution order per ad: (1) an explicit manual mapping on its ad set
  // or campaign always wins; (2) otherwise, look for a category name as its
  // own underscore-delimited token in the ad's name (e.g. "..._SWEATS_...")
  // -- matched only against the known category vocabulary already in the
  // app, never a free-text guess, so a non-match just falls through to
  // unmapped rather than being attributed wrong. Category isn't reliably
  // encoded at the ad set/campaign level in this account, only per-ad.
  const { rows: categoryNameRows } = await db.query('SELECT id, name FROM categories');
  const categoryByName = new Map(
    categoryNameRows.map((c) => [c.name.toUpperCase(), { category_id: c.id, category_name: c.name }])
  );

  const spendByCategory = new Map(); // category_id -> spend
  const adsByCategory = new Map(); // category_id -> [{ ad_name, spend, source }]
  let unmappedSpend = 0;
  let autoMatchedByName = 0;
  if (meta.configured()) {
    try {
      const adRows = await meta.getSpendByAd(start, end);
      for (const row of adRows) {
        let mapping = adsetToCategory.get(row.adset_id) || campaignToCategory.get(row.campaign_id);
        let source = 'manual';
        if (!mapping) {
          const derived = deriveCategoryFromAdName(row.ad_name, categoryByName);
          if (derived) {
            mapping = derived;
            source = 'auto';
            autoMatchedByName += row.spend;
          }
        }
        if (!mapping) {
          unmappedSpend += row.spend;
          continue;
        }
        spendByCategory.set(mapping.category_id, (spendByCategory.get(mapping.category_id) || 0) + row.spend);
        if (!adsByCategory.has(mapping.category_id)) adsByCategory.set(mapping.category_id, []);
        adsByCategory.get(mapping.category_id).push({ ad_name: row.ad_name, spend: round(row.spend), source });
      }
    } catch (err) {
      warnings.push(`Meta spend unavailable: ${err.message}`);
    }
  } else {
    warnings.push('Meta Marketing API is not configured (set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID).');
  }

  // --- Stock (ApparelMagic) ---
  const stockByCategory = new Map();
  let unmappedStockStyles = 0;
  if (am.configured()) {
    try {
      const stockByStyle = await am.getStockByStyle();
      for (const [style, qty] of stockByStyle) {
        const mapping = styleToCategory.get(style);
        if (!mapping) { unmappedStockStyles++; continue; }
        stockByCategory.set(mapping.category_id, (stockByCategory.get(mapping.category_id) || 0) + qty);
      }
    } catch (err) {
      warnings.push(`ApparelMagic stock unavailable: ${err.message}`);
    }
  } else {
    warnings.push('ApparelMagic is not configured (set AM_SUBDOMAIN and AM_TOKEN).');
  }

  // --- Sales (ApparelMagic), for context only -- never drives the flag ---
  const salesByCategory = new Map();
  let salesAvailable = am.configured();
  if (am.configured()) {
    try {
      const salesByStyle = await am.getSalesByStyle(start, end);
      for (const [style, qty] of salesByStyle) {
        const mapping = styleToCategory.get(style);
        if (!mapping) continue;
        salesByCategory.set(mapping.category_id, (salesByCategory.get(mapping.category_id) || 0) + qty);
      }
    } catch (err) {
      salesAvailable = false;
      warnings.push(`ApparelMagic sales data unavailable: ${err.message}`);
    }
  }

  const { rows: categories } = await db.query('SELECT id, name FROM categories ORDER BY name');
  const totalSpend = sumValues(spendByCategory);
  const totalStock = sumValues(stockByCategory);
  const totalSales = sumValues(salesByCategory);

  const categoryRows = categories.map((c) => {
    const spend = spendByCategory.get(c.id) || 0;
    const stock = stockByCategory.get(c.id) || 0;
    const sales = salesByCategory.get(c.id) || 0;
    const spendShare = totalSpend > 0 ? spend / totalSpend : 0;
    const stockShare = totalStock > 0 ? stock / totalStock : 0;
    const salesShare = salesAvailable && totalSales > 0 ? sales / totalSales : null;
    const ads = (adsByCategory.get(c.id) || []).sort((a, b) => b.spend - a.spend);
    return {
      category_id: c.id,
      category_name: c.name,
      spend,
      spend_share: round(spendShare),
      stock_units: stock,
      stock_share: round(stockShare),
      sales_units: salesAvailable ? sales : null,
      sales_share: salesShare === null ? null : round(salesShare),
      // Only flag categories that actually carry stock -- a zero-stock category
      // can't be "underweighted on spend relative to stock".
      flagged: totalStock > 0 && stock > 0 && spendShare < stockShare,
      ad_count: ads.length,
      ads,
    };
  });

  categoryRows.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return (b.stock_share - b.spend_share) - (a.stock_share - a.spend_share);
  });

  res.json({
    range: { start, end },
    categories: categoryRows,
    totals: {
      spend: round(totalSpend),
      stock_units: totalStock,
      sales_units: salesAvailable ? totalSales : null,
    },
    unmapped_spend: round(unmappedSpend),
    auto_matched_by_name_spend: round(autoMatchedByName),
    unmapped_stock_styles: unmappedStockStyles,
    sales_available: salesAvailable,
    warnings,
  });
}

// Only matches against the known category vocabulary already in the app
// (never free-text) -- an ad name that doesn't contain one of these exact
// segments falls through to unmapped rather than being guessed at.
function deriveCategoryFromAdName(adName, categoryByName) {
  if (!adName) return null;
  const tokens = adName.split('_').map((t) => t.trim().toUpperCase()).filter(Boolean);
  for (const token of tokens) {
    const match = categoryByName.get(token);
    if (match) return match;
  }
  return null;
}

function pickDates(query) {
  const out = {};
  if (query.start) out.start = query.start;
  if (query.end) out.end = query.end;
  return out;
}

function sumValues(map) {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

module.exports = router;
