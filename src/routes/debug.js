const express = require('express');
const am = require('../apparelmagic');

const router = express.Router();

const ALLOWED_ENDPOINTS = ['products', 'inventory', 'sku_warehouse', 'order_items'];

// Temporary diagnostic route: shows exactly what ApparelMagic returns for a
// given endpoint/page, including pagination meta -- this API's pagination
// behavior isn't documented anywhere accessible, and guessing parameter
// names has already been wrong twice. Truncates the row list so this is
// safe to hit from a browser without dumping a whole catalog page.
router.get('/am', async (req, res) => {
  if (!am.configured()) {
    return res.status(400).json({ error: 'ApparelMagic is not configured (set AM_SUBDOMAIN and AM_TOKEN)' });
  }
  const endpoint = req.query.endpoint || 'products';
  if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({ error: `endpoint must be one of ${ALLOWED_ENDPOINTS.join(', ')}` });
  }
  const pageSize = req.query.page_size || '200';
  const pageNumber = req.query.page_number || '1';

  try {
    const result = await am.rawRequest(endpoint, {
      'pagination[page_size]': pageSize,
      'pagination[page_number]': pageNumber,
    });
    const rows = result.data?.response || [];
    res.json({
      status: result.status,
      meta: result.data?.meta ?? null,
      row_count_this_page: rows.length,
      sample_rows: rows.slice(0, 2),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
