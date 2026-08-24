const express = require('express');
const db = require('../db');

const router = express.Router();

// Default to promotions active in the current week (plus a lookahead) unless
// explicit dates are given -- this is what the Monday meeting needs to see.
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (from && to) {
      const { rows } = await db.query(
        `SELECT p.*, c.name AS category_name FROM promotions p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.start_date <= $2 AND p.end_date >= $1
         ORDER BY p.start_date`,
        [from, to]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(`
      SELECT p.*, c.name AS category_name FROM promotions p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.start_date DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, category_id, style_code, start_date, end_date, notes, created_by } = req.body;
    if (!title || !start_date || !end_date) {
      return res.status(400).json({ error: 'title, start_date and end_date are required' });
    }
    const { rows } = await db.query(
      `INSERT INTO promotions (title, category_id, style_code, start_date, end_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, category_id || null, style_code || null, start_date, end_date, notes || null, created_by || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM promotions WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
