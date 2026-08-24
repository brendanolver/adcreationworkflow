// ApparelMagic API client.
//
// Reuses the integration pattern proven in the scan-to-verify app
// (aminventory/server.js, wholesalescan/netlify/functions/am-proxy.js):
// signed GET/POST requests to https://{subdomain}.app.apparelmagic.com/api/json/{endpoint}
// with a `time` (unix seconds) + `token` query param.
//
// Credentials come from AM_SUBDOMAIN / AM_TOKEN env vars -- never hardcode
// them here (unlike the reference apps, which had a dev token baked in).

const https = require('https');

const AM_SUBDOMAIN = process.env.AM_SUBDOMAIN;
const AM_TOKEN = process.env.AM_TOKEN;
const WAREHOUSE_IDS = (process.env.AM_WAREHOUSE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function configured() {
  return Boolean(AM_SUBDOMAIN && AM_TOKEN);
}

function amRequest(method, endpoint, params = {}, body = null) {
  if (!configured()) {
    return Promise.reject(new Error('ApparelMagic is not configured (AM_SUBDOMAIN / AM_TOKEN missing)'));
  }
  const t = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({ time: t, token: AM_TOKEN, ...params }).toString();
  const url = `https://${AM_SUBDOMAIN}.app.apparelmagic.com/api/json/${endpoint}/?${qs}`;

  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify({ time: t, token: AM_TOKEN, ...body }) : null;
    const req = https.request(url, {
      method,
      headers: {
        'User-Agent': 'WNDRR-Ads-Dashboard/1.0',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ApparelMagic's pagination is cursor-based on the record's own numeric id,
// not page-number based -- confirmed live: `pagination[page_number]` and
// `pagination[last_id]` are both silently ignored (or error outright), but
// filtering `parameters[0][field]=<id field>&parameters[0][operator]=>&
// parameters[0][value]=<last id seen>` correctly advances, and page_size is
// only honored once that filter is present. First page has no filter; each
// subsequent page filters on whatever id field the first page's rows carry.
const ID_FIELD_CANDIDATES = ['product_id', 'sku_id', 'order_item_id', 'id'];

async function fetchAllPages(endpoint, params, maxPages = 500) {
  const pageSize = 200;
  const rows = [];
  let afterId = null;
  let idField = null;

  for (let i = 0; i < maxPages; i++) {
    const requestParams = { 'pagination[page_size]': pageSize, ...params };
    if (idField != null && afterId != null) {
      requestParams['parameters[0][field]'] = idField;
      requestParams['parameters[0][operator]'] = '>';
      requestParams['parameters[0][value]'] = afterId;
    }

    const result = await amRequest('GET', endpoint, requestParams);
    if (result.status !== 200) {
      throw new Error(`ApparelMagic ${endpoint} returned status ${result.status}: ${JSON.stringify(result.data)}`);
    }
    const batch = result.data?.response || [];
    rows.push(...batch);
    if (!batch.length) break;

    if (idField == null) {
      idField = ID_FIELD_CANDIDATES.find((f) => batch[0][f] !== undefined) || null;
      if (idField == null) break; // no usable id field -- can't page further, this is all we get
    }

    afterId = batch[batch.length - 1][idField];
    if (batch.length < pageSize) break; // short page -- reached the end
  }
  return rows;
}

// Sellable on-hand stock per style, summed across configured warehouses.
// inventory -> { sku_id, style_number } ; sku_warehouse -> { sku_id, warehouse_id, qty_inventory }
async function getStockByStyle() {
  const skuRows = await fetchAllPages('inventory', {});
  const styleBySku = new Map();
  for (const row of skuRows) {
    if (row.sku_id != null && row.style_number) {
      styleBySku.set(String(row.sku_id), row.style_number);
    }
  }

  const whParams = WAREHOUSE_IDS.length === 1 ? { warehouse_id: WAREHOUSE_IDS[0] } : {};
  const whRows = await fetchAllPages('sku_warehouse', whParams);

  const stockByStyle = new Map();
  for (const row of whRows) {
    if (WAREHOUSE_IDS.length > 1 && !WAREHOUSE_IDS.includes(String(row.warehouse_id))) continue;
    const style = styleBySku.get(String(row.sku_id));
    if (!style) continue;
    const qty = parseFloat(row.qty_inventory) || 0;
    stockByStyle.set(style, (stockByStyle.get(style) || 0) + qty);
  }
  return stockByStyle; // Map<style_code, units on hand>
}

// Units sold per style within a date range, via order_items.
// Field names on order_items are unconfirmed against a live ApparelMagic
// instance -- this tries the plausible variants and degrades gracefully
// (throws a clearly-labelled error) rather than silently reporting zero.
async function getSalesByStyle(startDate, endDate) {
  const rows = await fetchAllPages('order_items', {
    date_from: startDate,
    date_to: endDate,
  });

  if (!rows.length) return new Map();

  const styleField = ['style_number', 'style_code'].find((f) => rows[0][f] !== undefined);
  const qtyField = ['qty_ordered', 'qty', 'quantity'].find((f) => rows[0][f] !== undefined);

  if (!styleField || !qtyField) {
    throw new Error(
      'Unrecognized order_items schema from ApparelMagic -- expected a style and quantity field. ' +
      'Verify field names against the live API and update getSalesByStyle() in src/apparelmagic.js.'
    );
  }

  const salesByStyle = new Map();
  for (const row of rows) {
    const style = row[styleField];
    if (!style) continue;
    const qty = parseFloat(row[qtyField]) || 0;
    salesByStyle.set(style, (salesByStyle.get(style) || 0) + qty);
  }
  return salesByStyle; // Map<style_code, units sold in range>
}

// Live category per style, straight from ApparelMagic's own `products.category`
// field -- the same field the demand-planning app (V2 branch) already treats
// as authoritative. This is a real structured field, not name-parsing, so it
// doesn't conflict with "never derive category from naming": that rule is
// specifically about Meta campaign/ad set names, which have no such field.
async function getStyleCategories() {
  const rows = await fetchAllPages('products', {});
  const map = new Map();
  for (const row of rows) {
    const style = (row.style_number || '').trim();
    const category = (row.category || '').trim().toUpperCase();
    if (style && category) map.set(style, category);
  }
  return map; // Map<style_code, category name>
}

// Exposed only for the /api/debug/am diagnostic route -- lets us see the
// raw response shape (pagination meta, field names) from a live account
// without guessing, since this API's pagination behavior wasn't documented
// anywhere and none of the sibling apps had ever paginated a full endpoint.
async function rawRequest(endpoint, params) {
  const result = await amRequest('GET', endpoint, params);
  return result;
}

module.exports = { configured, getStockByStyle, getSalesByStyle, getStyleCategories, rawRequest };
