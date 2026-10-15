// Fixtures Playwright : site en mode local (config.js remplacé), CDN bloqués hors ligne, erreurs JS collectées.
'use strict';
const base = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_CONFIG = 'window.PY_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", DEFAULT_DRIVER: "yacine", STATION: { name: "Station DRUM", lat: 45.885, lon: -72.49 }, HOME: { name: "Sherbrooke", lat: 45.40, lon: -71.89 }, FUEL_PRICE: 1.90 };';
const OFFLINE = process.env.PY_OFFLINE === '1';
const PDFJS = process.env.PY_PDFJS_DIR || '';

const test = base.test.extend({
  // Mode local : pas de Supabase, données dans le navigateur. Les tests sur le site déployé gardent sa config.
  localMode: [true, { option: true }],
  errors: async ({ page }, use) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    await use(errors);
  },
  page: async ({ page, localMode }, use) => {
    if (localMode) await page.route('**/js/config.js', r => r.fulfill({ contentType: 'text/javascript', body: LOCAL_CONFIG }));
    if (OFFLINE) {
      await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net|leaflet|supabase/, r => r.abort());
      await page.route(/pdf\.js\/3\.11\.174\/pdf\.min\.js/, r => PDFJS ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(PDFJS, 'build', 'pdf.min.js')) }) : r.abort());
      await page.route(/pdf\.js\/3\.11\.174\/pdf\.worker\.min\.js/, r => PDFJS ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(PDFJS, 'build', 'pdf.worker.min.js')) }) : r.abort());
    }
    await use(page);
  }
});

/** Entre dans l'application depuis l'accueil, en sautant le brief du matin. */
async function enter(page, tab) {
  await page.goto('./');
  await page.locator('#btnExplore').click();
  const skip = page.locator('#briefSkip'); if (await skip.isVisible().catch(() => false)) await skip.click();
  if (tab) await page.locator(`nav.tabs button[data-v="${tab}"]`).click();
}

module.exports = { test, expect: base.expect, enter, OFFLINE };
