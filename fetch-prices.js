/* ============================================================================
   fetch-prices.js – column-renamed version
============================================================================ */
const fs      = require('fs');
const csv     = require('csv-parser');
const { writeToPath } = require('fast-csv');
const axios   = require('axios');
const cheerio = require('cheerio');

const DELAY_MS = 1000;   // tweak if you add many SKUs

// ── helper: fetch page & pull price ──────────────────────────────────────────
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

    const mJson = html.match(/"price"\s*:\s*"?(\d{4,11})"?/);
    if (mJson) return parseInt(mJson[1], 10);

    const $ = cheerio.load(html);
    const vis = $('[data-testid="lblPDPDetailProductPrice"]').text().replace(/[^\d]/g, '');
    if (vis) return parseInt(vis, 10);

    console.error('⚠️  price not found in HTML:', url);
    return '';
  } catch {
    console.error('❌  fetch failed:', url);
    return '';
  }
}

const pct = (self, other) => other ? (((self - other) / other) * 100).toFixed(1) : '';

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const rows = [];
  fs.createReadStream('sku_map.csv')
    .pipe(csv())
    .on('data', d => rows.push(d))
    .on('end', async () => {
      const out = [];
      for (const r of rows) {
        const sku = r.sku_code;

        const priceOur   = await getPrice(r.Daily_Bike);
        const priceChar  = await getPrice(r.Charlie);
        const priceHobby = await getPrice(r.Hobby_One);

        out.push({
          sku,
          Daily_Bike: priceOur,
          Charlie:    priceChar,
          Hobby_One:  priceHobby,
          diffPctCharlie:  pct(priceOur, priceChar),
          diffPctHobbyOne: pct(priceOur, priceHobby)
        });

        await new Promise(res => setTimeout(res, DELAY_MS));
      }

      writeToPath('today.csv', out, { headers: true })
        .on('finish', () => console.log('✅  today.csv written'));
    });
})();
