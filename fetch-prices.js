// ------------ fetch-prices.js  (HTML-scrape version, no numeric ID needed) ----
const fs      = require('fs');
const csv     = require('csv-parser');
const { writeToPath } = require('fast-csv');
const axios   = require('axios');
const cheerio = require('cheerio');

// ── helper: get price straight from HTML ──────────────────────────────────────
async function getPrice(url) {
  if (!url) return '';
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)' }
    });
    // Tokopedia injects a JSON blob; parse the first "price":123456 style number
    const m = html.match(/"price"\s*:\s*"?(\d{4,11})"?/);  // 10k – 999,999,999
    if (m) return parseInt(m[1], 10);
    console.error('⚠️  price not found in HTML:', url);
    return '';
  } catch (err) {
    console.error('❌  fetch failed:', url);
    return '';
  }
}

// ── main routine ─────────────────────────────────────────────────────────────
(async () => {
  const rows = [];
  fs.createReadStream('sku_map.csv')
    .pipe(csv())
    .on('data', d => rows.push(d))
    .on('end', async () => {
      const out = [];
      for (const r of rows) {
        const sku    = r.sku_code;
        const ourP   = await getPrice(r.our_url);
        const priceA = await getPrice(r.compA_url);
        const priceB = await getPrice(r.compB_url);

        const pct = (self, other) =>
          other ? (((self - other) / other) * 100).toFixed(1) : '';

        out.push({
          sku,
          ourPrice:  ourP,
          priceA:   priceA,
          priceB:   priceB,
          diffPctA: pct(ourP, priceA),
          diffPctB: pct(ourP, priceB)
        });
      }
      writeToPath('today.csv', out, { headers: true })
        .on('finish', () => console.log('✅  today.csv written'));
    });
})();
