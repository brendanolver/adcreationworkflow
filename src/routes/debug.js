const express = require('express');
const am = require('../apparelmagic');

const router = express.Router();

const ALLOWED_ENDPOINTS = ['products', 'inventory', 'sku_warehouse', 'order_items'];

// Temporary diagnostic route: shows exactly what ApparelMagic returns for a
// given endpoint/set of params, including pagination meta -- this API's
// pagination behavior isn't documented anywhere accessible. Forwards every
// query param except `endpoint` straight through to ApparelMagic so we can
// test cursor params (e.g. `pagination[last_id]`) without another deploy.
// Truncates the row list so this is safe to hit from a browser.
router.get('/am', async (req, res) => {
  if (!am.configured()) {
    return res.status(400).json({ error: 'ApparelMagic is not configured (set AM_SUBDOMAIN and AM_TOKEN)' });
  }
  const { endpoint = 'products', ...passthroughParams } = req.query;
  if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({ error: `endpoint must be one of ${ALLOWED_ENDPOINTS.join(', ')}` });
  }

  try {
    const result = await am.rawRequest(endpoint, passthroughParams);
    const rows = result.data?.response || [];
    const productIds = rows.map((r) => r.product_id ?? r.sku_id ?? r.id).filter((v) => v != null);
    res.json({
      status: result.status,
      params_sent: passthroughParams,
      meta: result.data?.meta ?? null,
      row_count_this_page: rows.length,
      first_id_this_page: productIds[0] ?? null,
      last_id_this_page: productIds[productIds.length - 1] ?? null,
      sample_rows: rows.slice(0, 2),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
