// ---------- fetch-prices.js ----------
// Scrapes price from any Tokopedia product URL via GraphQL
// Outputs today.csv  →  sku, ourPrice, priceA, priceB, diffPctA, diffPctB
// Uses only URL columns (no numeric item-ID needed)

const fs   = require('fs');
const csv  = require('csv-parser');
const { writeToPath } = require('fast-csv');
const tp   = require('tokopedia-gql');    // free wrapper: npm i tokopedia-gql

// ── tiny helper ────────────────────────────────────────────────────────────────
async function getPrice(url) {
  if (!url) return '';                           // blank cell in CSV = skip
  try {
    const info  = await tp.getProduct(url);
    const price = info.basic.price.value;       // integer (without “Rp”)
    return parseInt(price, 10);
  } catch (err) {
    console.error('❌ price fetch failed:', url);
    return '';
  }
}

// ── main routine ───────────────────────────────────────────────────────────────
(async () => {
  const rows = [];
  fs.createReadStream('sku_map.csv')
    .pipe(csv())
    .on('data', data => rows.push(data))
    .on('end', async () => {
      const out = [];

      for (const r of rows) {
        const sku       = r.sku_code;
        const ourP      = await getPrice(r.our_url);
        const compAP    = await getPrice(r.compA_url);
        const compBP    = await getPrice(r.compB_url);

        // % diff helper
        const pctDiff = (self, other) =>
          other ? (((self - other) / other) * 100).toFixed(1) : '';

        out.push({
          sku,
          ourPrice:  ourP,
          priceA:   compAP,
          priceB:   compBP,
          diffPctA: pctDiff(ourP, compAP),
          diffPctB: pctDiff(ourP, compBP)
        });
      }

      writeToPath('today.csv', out, { headers: true })
        .on('finish', () => console.log('✅ today.csv written'));
    });
})();
