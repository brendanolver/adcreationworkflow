// Meta Marketing API client.
//
// Uses its own app + long-lived access token (META_ACCESS_TOKEN /
// META_AD_ACCOUNT_ID env vars) -- deliberately separate from any chat-based
// Meta Ads connector. Only ads_read is required for Phases 1-4; ads_management
// is only needed once Phase 5 (draft ad creation) starts.

const https = require('https');

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID; // e.g. act_1234567890
const API_VERSION = process.env.META_API_VERSION || 'v21.0';

function configured() {
  return Boolean(ACCESS_TOKEN && AD_ACCOUNT_ID);
}

function fetchUrl(fullUrl) {
  return new Promise((resolve, reject) => {
    https.get(fullUrl, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.error) {
            reject(new Error(`Meta API error: ${data.error.message}`));
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(new Error(`Meta API returned non-JSON response (status ${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

function get(pathAndQuery) {
  if (!configured()) {
    return Promise.reject(new Error('Meta Marketing API is not configured (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID missing)'));
  }
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url = `https://graph.facebook.com/${API_VERSION}/${pathAndQuery}${sep}access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
  return fetchUrl(url);
}

// Spend for the given date range, broken out per ad set (and its parent
// campaign) so it can be joined against category_mappings on either level.
async function getSpendByAdSet(startDate, endDate) {
  const fields = 'campaign_id,campaign_name,adset_id,adset_name,spend';
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }));

  const rows = [];
  let page = await get(`${AD_ACCOUNT_ID}/insights?level=adset&fields=${fields}&time_range=${timeRange}&limit=500`);
  rows.push(...(page.data || []));

  // paging.next is a full, already-authenticated URL -- fetch it directly.
  while (page.paging && page.paging.next) {
    page = await fetchUrl(page.paging.next);
    rows.push(...(page.data || []));
  }

  return rows.map((r) => ({
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    spend: parseFloat(r.spend) || 0,
  }));
}

module.exports = { configured, getSpendByAdSet };
