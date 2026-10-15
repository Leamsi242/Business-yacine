// Chargeur minimal pour la logique pure : évalue des fichiers de js/ dans un contexte vm avec un faux window,
// sans DOM. Plus rapide que jsdom ; réservé aux modules qui ne touchent pas la page au chargement
// (util, data, tariffs, db, pdf-import, features). Les scripts gardent leur nom (js/x.js) pour la couverture.
// Les objets renvoyés viennent d'un autre realm : comparer avec plain() (JSON) plutôt que deepEqual direct.
'use strict';
process.env.TZ = process.env.TZ || 'America/Toronto';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..', '..');

function memStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), get size() { return m.size; } }; }

/**
 * load(['util', 'db'], { config, localStorage, document, navigator }) → window
 * window, document, localStorage, sessionStorage, navigator, setInterval et console sont les globaux du contexte.
 */
function load(names, opts = {}) {
  const window = opts.window || {};
  window.PY_CONFIG = window.PY_CONFIG || Object.assign({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', DEFAULT_DRIVER: 'yacine', STATION: { lat: 45.885, lon: -72.49 }, HOME: { lat: 45.40, lon: -71.89 }, FUEL_PRICE: 1.90 }, opts.config || {});
  const localStorage = opts.localStorage || memStorage(); const sessionStorage = opts.sessionStorage || memStorage();
  const document = opts.document || { querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} } }, addEventListener() {} };
  const navigator = opts.navigator || {};
  const ctx = vm.createContext({ window, document, localStorage, sessionStorage, navigator, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, console });
  window.window = window;
  for (const n of names) {
    const src = fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8');
    vm.runInContext(src, ctx, { filename: 'js/' + n + '.js' });
  }
  window.__localStorage = localStorage;
  return window;
}

const plain = x => JSON.parse(JSON.stringify(x));

module.exports = { load, memStorage, plain, ROOT };
