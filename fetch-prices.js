/* ============================================================================
   fetch-prices.js  –  HTML-scrape version (URL-only)
   --------------------------------------------------------------------------
   • Reads sku_map.csv   (sku_code, our_url, compA_url, compB_url, note)
   • Pulls each URL’s HTML, extracts price, saves today.csv
   • Adjustable delay between requests (DELAY_MS) for polite scraping
============================================================================ */

const fs      = require('fs');
const csv     = require('csv-parser');
const { writeToPath } = require('fast-csv');
const axios   = require('axios');
const cheerio = require('cheerio');

/* ———————————————————————————————————————————————
   CONFIG – adjust delay if you add many SKUs
   (1 000 ms = 1 second)
——————————————————————————————————————————————— */
const DELAY_MS = 1000;    // set to 500 ms or 2000 ms if needed

/* ———————————————————————————————————————————————
   Helper: fetch a product page & extract price
——————————————————————————————————————————————— */
async function getPrice(url) {
  if (!url) return '';

  try {
    const { data: html } = await axios.get(url, {
      maxRedirects: 5,
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        Referer: 'https://www.tokopedia.com/'
      }
    });

    /* Strategy A – JSON blob  "price":123456 */
    const mJson = html.match(/"price"\s*:\s*"?(\d{4,11})"?/);
    if (mJson) return parseInt(mJson[1], 10);

    /* Strategy B – Visible price tag (rare templates) */
    const $ = cheerio.load(html);
    const visible = $('[data-testid="lblPDPDetailProductPrice"]').text();
    const mVis = visible.replace(/[^\d]/g, '');
    if (mVis) return parseInt(mVis, 10);

    console.error('⚠️  price not found in HTML:', url);
    return '';
  } catch (err) {
    console.error('❌  fetch failed:', url);
    return '';
  }
}

/* ———————————————————————————————————————————————
   Helper: percentage difference
——————————————————————————————————————————————— */
const pctDiff = (self, other) =>
  other ? (((self - other) / other) * 100).toFixed(1) : '';

/* ———————————————————————————————————————————————
   MAIN
——————————————————————————————————————————————— */
(async () => {
  const rows = [];
  fs.createReadStream('sku_map.csv')
    .pipe(csv())
    .on('data', d => rows.push(d))
    .on('end', async () => {
      const out = [];

      for (const r of rows) {
        const sku = r.sku_code;

        const ourP  = await getPrice(r.our_url);
        const prA   = await getPrice(r.compA_url);
        const prB   = await getPrice(r.compB_url);

        out.push({
          sku,
          ourPrice:  ourP,
          priceA:    prA,
          priceB:    prB,
          diffPctA:  pctDiff(ourP, prA),
          diffPctB:  pctDiff(ourP, prB)
        });

        /* Polite throttle */
        await new Promise(res => setTimeout(res, DELAY_MS));
      }

      writeToPath('today.csv', out, { headers: true })
        .on('finish', () => console.log('✅  today.csv written'));
    });
})();
