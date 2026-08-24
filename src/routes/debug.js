const express = require('express');
const am = require('../apparelmagic');

const router = express.Router();

const ALLOWED_ENDPOINTS = ['products', 'inventory', 'sku_warehouse', 'order_items'];

function summarize(result) {
  const rows = result?.data?.response || [];
  const ids = rows.map((r) => r.product_id ?? r.sku_id ?? r.id).filter((v) => v != null);
  return {
    status: result?.status ?? null,
    meta: result?.data?.meta ?? null,
    row_count: rows.length,
    first_id: ids[0] ?? null,
    last_id: ids[ids.length - 1] ?? null,
  };
}

// Temporary diagnostic route. Single-request mode (endpoint + arbitrary
// passthrough params) forwards straight to ApparelMagic. Probe mode
// (?probe=1&endpoint=products&after_id=1113) fires several candidate
// pagination schemes at once and reports them side by side, since this
// API's pagination isn't documented anywhere and guessing one at a time
// has been slow: page_number (wrong), pagination[last_id] (500 error).
router.get('/am', async (req, res) => {
  if (!am.configured()) {
    return res.status(400).json({ error: 'ApparelMagic is not configured (set AM_SUBDOMAIN and AM_TOKEN)' });
  }
  const { endpoint = 'products', probe, after_id, ...passthroughParams } = req.query;
  if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
    return res.status(400).json({ error: `endpoint must be one of ${ALLOWED_ENDPOINTS.join(', ')}` });
  }

  if (!probe) {
    try {
      const result = await am.rawRequest(endpoint, passthroughParams);
      res.json({ params_sent: passthroughParams, ...summarize(result) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  const idField = endpoint === 'products' ? 'product_id' : 'sku_id';
  const cursor = after_id || '0';
  const candidates = {
    bare_last_id: { last_id: cursor },
    pagination_offset: { 'pagination[offset]': cursor },
    generic_filter_gt: {
      'parameters[0][field]': idField,
      'parameters[0][operator]': '>',
      'parameters[0][value]': cursor,
    },
    generic_filter_gte_pagesize: {
      'pagination[page_size]': '200',
      'parameters[0][field]': idField,
      'parameters[0][operator]': '>',
      'parameters[0][value]': cursor,
    },
  };

  const results = {};
  for (const [name, params] of Object.entries(candidates)) {
    try {
      results[name] = { params_sent: params, ...summarize(await am.rawRequest(endpoint, params)) };
    } catch (err) {
      results[name] = { params_sent: params, error: err.message };
    }
  }
  res.json(results);
});

module.exports = router;
