const express = require('express');
const db = require('../db');
const am = require('../apparelmagic');
const meta = require('../meta');

const router = express.Router();

const VALID_TYPES = ['style', 'meta_campaign', 'meta_adset'];

// Pulls every style's category straight from ApparelMagic's own `category`
// field and upserts styles + categories + style->category mappings from it.
// Meta campaign/ad set -> category mappings are NOT touched here -- there's
// no live source for those, they stay manual.
router.post('/sync-from-am', async (req, res) => {
  if (!am.configured()) {
    return res.status(400).json({ error: 'ApparelMagic is not configured (set AM_SUBDOMAIN and AM_TOKEN)' });
  }
  try {
    const styleDetails = await am.getStyleDetails();
    let stylesSeen = 0;
    let categoriesTouched = 0;
    const categoryIds = new Map();

    for (const [style, { category: categoryName, productName }] of styleDetails) {
      await db.query(
        `INSERT INTO styles (style_code, product_name) VALUES ($1, $2)
         ON CONFLICT (style_code) DO UPDATE SET product_name = EXCLUDED.product_name, updated_at = now()`,
        [style, productName]
      );

      if (categoryName) {
        let categoryId = categoryIds.get(categoryName);
        if (!categoryId) {
          const { rows } = await db.query(
            `INSERT INTO categories (name) VALUES ($1)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [categoryName]
          );
          categoryId = rows[0].id;
          categoryIds.set(categoryName, categoryId);
          categoriesTouched++;
        }

        await db.query(
          `INSERT INTO category_mappings (category_id, entity_type, entity_id, label)
           VALUES ($1, 'style', $2, $3)
           ON CONFLICT (entity_type, entity_id) DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()`,
          [categoryId, style, null]
        );
      }
      stylesSeen++;
    }

    res.json({ styles_synced: stylesSeen, categories_touched: categoriesTouched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct product names (colours condensed) for the search/typeahead on
// the Style Spend tab.
router.get('/products', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const { rows } = await db.query(
      q
        ? `SELECT DISTINCT product_name FROM styles WHERE product_name ILIKE $1 ORDER BY product_name LIMIT 50`
        : `SELECT DISTINCT product_name FROM styles WHERE product_name IS NOT NULL ORDER BY product_name LIMIT 200`,
      q ? [`%${q}%`] : []
    );
    res.json(rows.map((r) => r.product_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Meta campaign/ad set -> product_name mappings (separate dimension from
// category_mappings -- see migration comment).
router.get('/products/mappings', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, product_name, entity_type, entity_id, label, created_at, updated_at
       FROM product_spend_mappings ORDER BY product_name, entity_type, entity_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products/mappings', async (req, res) => {
  try {
    const { product_name, entity_type, entity_id, label } = req.body;
    if (!product_name || !entity_type || !entity_id) {
      return res.status(400).json({ error: 'product_name, entity_type and entity_id are required' });
    }
    if (!['meta_campaign', 'meta_adset'].includes(entity_type)) {
      return res.status(400).json({ error: "entity_type must be 'meta_campaign' or 'meta_adset'" });
    }
    const { rows } = await db.query(
      `INSERT INTO product_spend_mappings (product_name, entity_type, entity_id, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET product_name = EXCLUDED.product_name, label = EXCLUDED.label, updated_at = now()
       RETURNING id, product_name, entity_type, entity_id, label, created_at, updated_at`,
      [product_name.trim(), entity_type, String(entity_id).trim(), label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/mappings/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM product_spend_mappings WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Spend per product for the date range, using product_spend_mappings.
router.get('/products/spend', async (req, res) => {
  if (!meta.configured()) {
    return res.status(400).json({ error: 'Meta Marketing API is not configured (set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID)' });
  }
  try {
    const end = req.query.end || new Date().toISOString().slice(0, 10);
    const startDefault = new Date();
    startDefault.setDate(startDefault.getDate() - 27);
    const start = req.query.start || startDefault.toISOString().slice(0, 10);

    const { rows: mappingRows } = await db.query(
      `SELECT product_name, entity_type, entity_id FROM product_spend_mappings`
    );
    const adsetToProduct = new Map();
    const campaignToProduct = new Map();
    for (const m of mappingRows) {
      if (m.entity_type === 'meta_adset') adsetToProduct.set(m.entity_id, m.product_name);
      else campaignToProduct.set(m.entity_id, m.product_name);
    }

    const adsetRows = await meta.getSpendByAdSet(start, end);
    const spendByProduct = new Map();
    for (const row of adsetRows) {
      const productName = adsetToProduct.get(row.adset_id) || campaignToProduct.get(row.campaign_id);
      if (!productName) continue;
      spendByProduct.set(productName, (spendByProduct.get(productName) || 0) + row.spend);
    }

    const results = [...spendByProduct.entries()]
      .map(([product_name, spend]) => ({ product_name, spend: Math.round(spend * 100) / 100 }))
      .sort((a, b) => b.spend - a.spend);

    res.json({ range: { start, end }, products: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT m.id, m.category_id, c.name AS category_name, m.entity_type, m.entity_id, m.label, m.created_at, m.updated_at
      FROM category_mappings m
      JOIN categories c ON c.id = m.category_id
      ORDER BY c.name, m.entity_type, m.entity_id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { category_id, entity_type, entity_id, label } = req.body;
    if (!category_id || !entity_type || !entity_id) {
      return res.status(400).json({ error: 'category_id, entity_type and entity_id are required' });
    }
    if (!VALID_TYPES.includes(entity_type)) {
      return res.status(400).json({ error: `entity_type must be one of ${VALID_TYPES.join(', ')}` });
    }
    const { rows } = await db.query(
      `INSERT INTO category_mappings (category_id, entity_type, entity_id, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET category_id = EXCLUDED.category_id, label = EXCLUDED.label, updated_at = now()
       RETURNING id, category_id, entity_type, entity_id, label, created_at, updated_at`,
      [category_id, entity_type, String(entity_id).trim(), label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM category_mappings WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
