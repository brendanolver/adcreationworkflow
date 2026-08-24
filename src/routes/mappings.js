const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_TYPES = ['style', 'meta_campaign', 'meta_adset'];

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
