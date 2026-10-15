// Sécurité et données : le schéma ne réinitialise jamais le PIN, les scripts externes sont vérifiés par empreinte,
// une base injoignable est signalée en grand, aucun chiffre personnel figé dans les conseils.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('schéma Supabase', () => {
  const sql = read('supabase/schema.sql').replace(/--[^\n]*/g, '');
  test('relancer le schéma ne remet pas le PIN à une valeur connue', () => {
    const ins = sql.match(/insert into config[\s\S]*?;/i)[0];
    assert.match(ins, /on conflict \(id\) do nothing/i);
    assert.doesNotMatch(sql, /'1234'/);
  });
  test('un nouveau PIN doit faire au moins 10 caractères', () => {
    assert.match(sql, /check \(length\(pin\) >= 10\)/i);
    const pin = read('supabase/schema.sql').match(/insert into config \(id, pin\) values \(1, '([^']*)'\)/)[1];
    assert.ok(pin.length >= 10, 'la valeur initiale respecte la contrainte');
  });
});

describe('scripts et styles externes', () => {
  test('chaque fichier chargé depuis un CDN porte une empreinte integrity et crossorigin', () => {
    const html = read('index.html');
    const ext = [...html.matchAll(/<(script|link)[^>]+(?:src|href)="https:\/\/(?!fonts\.googleapis)[^"]+"[^>]*>/g)].map(m => m[0]);
    assert.ok(ext.length >= 4, 'leaflet (css, js), supabase, pdf.js');
    ext.forEach(t => { assert.match(t, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, t); assert.match(t, /crossorigin="anonymous"/, t); });
  });
  test('le champ PIN accepte une phrase de passe (pas seulement des chiffres)', () => {
    assert.doesNotMatch(read('index.html'), /id="pin"[^>]*inputmode="numeric"/);
  });
});

describe('base configurée mais injoignable', () => {
  test('un bandeau le dit, et le mode local n’est pas présenté comme normal', async () => {
    const config = 'window.PY_CONFIG = { SUPABASE_URL: "https://exemple.supabase.co", SUPABASE_ANON_KEY: "cle", DEFAULT_DRIVER: "yacine", STATION: { name: "Station DRUM", lat: 45.885, lon: -72.49 }, HOME: { name: "Sherbrooke", lat: 45.40, lon: -71.89 }, FUEL_PRICE: 1.90 };';
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true, config });
    try {
      assert.equal(c.w.PYDB.unavailable, true);
      const b = c.$('#netBanner'); assert.equal(b.hidden, false); assert.match(b.textContent, /reste sur ce téléphone/);
    } finally { c.close(); }
  });
  test('en mode local voulu (sans configuration), pas de bandeau', async () => {
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true });
    try { assert.equal(c.w.PYDB.unavailable, false); assert.equal(c.$('#netBanner').hidden, true); } finally { c.close(); }
  });
});

describe('conseils', () => {
  test('aucun montant personnel figé ; la navette est calculée depuis la configuration', async () => {
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true, localState: localState() });
    try {
      await enter(c, 'tips');
      const t = c.$('#advice').textContent.replace(/[  ]/g, ' ');
      assert.doesNotMatch(t, /422,97|71 %|1 500 \$|5 300 \$|88 colis/);
      assert.match(t, /La navette Sherbrooke à Station DRUM coûte environ 31 \$ par jour/);
      assert.doesNotMatch(c.$('#brief').textContent + read('js/features.js'), /422,97/);
    } finally { c.close(); }
  });
});
