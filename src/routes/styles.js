const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT style_code, name, tier FROM styles ORDER BY style_code');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { style_code, name, tier } = req.body;
    if (!style_code || !style_code.trim()) return res.status(400).json({ error: 'style_code is required' });
    if (tier && !['core', 'new_drop'].includes(tier)) {
      return res.status(400).json({ error: "tier must be 'core' or 'new_drop'" });
    }
    const { rows } = await db.query(
      `INSERT INTO styles (style_code, name, tier) VALUES ($1, $2, COALESCE($3, 'core'))
       ON CONFLICT (style_code) DO UPDATE SET name = EXCLUDED.name, tier = COALESCE($3, styles.tier), updated_at = now()
       RETURNING style_code, name, tier`,
      [style_code.trim(), name || null, tier || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
