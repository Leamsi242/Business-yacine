// Connexion et journal des connexions : consignation à chaque ouverture, avis de transparence, refus des accents,
// Touch ID / Face ID par WebAuthn PRF (simulé), back-office admin.html en mode local.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');
const { boot, ROOT } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const NOW = '2026-10-15T09:00:00-04:00';
const saved = c => JSON.parse(c.w.localStorage.getItem('pilote-yacine-v2'));

describe('journal des connexions (mode local)', () => {
  test('chaque ouverture de l’application est consignée avec l’appareil et la position autorisée', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      // l'ouverture au démarrage attend la position jusqu'à 8 s, puis se consigne sans elle
      await c.until(() => (saved(c).accessLog || []).length >= 1, 12000);
      const e = saved(c).accessLog[0];
      assert.equal(e.kind, 'ouverture'); assert.equal(e.method, 'session'); assert.equal(e.ok, true);
      assert.equal(typeof e.device, 'string'); assert.match(e.device, / · /);
      // position autorisée : elle accompagne la connexion
      c.geo.push({ lat: 45.88512, lon: -72.49011, acc: 14, t: Date.now() });
      await c.w.PYAUTH.record('connexion', 'pin');
      const f = saved(c).accessLog[0];
      assert.equal(f.kind, 'connexion'); assert.equal(f.method, 'pin'); assert.equal(f.lat, 45.88512); assert.equal(f.lon, -72.49011); assert.equal(f.accuracy, 14);
    } finally { c.close(); }
  });
  test('sans position autorisée, la connexion est consignée quand même, sans coordonnées', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState(), geo: false });
    try {
      await c.until(() => (saved(c).accessLog || []).length >= 1, 12000);
      assert.equal(saved(c).accessLog[0].lat, null);
    } finally { c.close(); }
  });
  test('appareil lisible', async () => {
    const c = await boot({ now: NOW, noHistory: true });
    try {
      const L = c.w.PYAUTH.deviceLabel;
      assert.equal(L('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
      assert.equal(L('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Mac · Chrome');
      assert.equal(L('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), 'Android · Chrome');
    } finally { c.close(); }
  });
});

// Faux authentificateur WebAuthn : une clé PRF fixe par identifiant, rendue seulement après « l'empreinte ».
function fakeWebAuthn(w, { prf = true, cancel = false } = {}) {
  const secrets = new Map(); let n = 0;
  const salted = (id, salt) => { const s = secrets.get(Buffer.from(id).toString('hex')); const out = new Uint8Array(32); for (let i = 0; i < 32; i++) out[i] = s[i] ^ new Uint8Array(salt)[i]; return out.buffer; };
  w.PublicKeyCredential = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true };
  Object.defineProperty(w.navigator, 'credentials', { configurable: true, value: {
    async create({ publicKey }) {
      const id = new Uint8Array([++n, 7, 7, 7]); secrets.set(Buffer.from(id).toString('hex'), webcrypto.getRandomValues(new Uint8Array(32)));
      return { rawId: id.buffer, getClientExtensionResults: () => (prf ? { prf: { enabled: true } } : {}) };
    },
    async get({ publicKey }) {
      if (cancel) { const e = new Error('annulé'); e.name = 'NotAllowedError'; throw e; }
      const id = publicKey.allowCredentials[0].id;
      return { getClientExtensionResults: () => (prf ? { prf: { results: { first: salted(id, publicKey.extensions.prf.eval.first) } } } : {}) };
    } } });
  return secrets;
}

describe('Touch ID / Face ID', () => {
  test('activer puis déverrouiller rend le PIN ; le PIN n’est jamais gardé en clair', async () => {
    const c = await boot({ now: NOW, noHistory: true });
    try {
      if (!c.w.crypto || !c.w.crypto.subtle) Object.defineProperty(c.w, 'crypto', { value: webcrypto, configurable: true });
      c.w.TextEncoder = TextEncoder; c.w.TextDecoder = TextDecoder;
      fakeWebAuthn(c.w); const A = c.w.PYAUTH;
      assert.equal(await A.available(), true); assert.equal(A.enrolled(), false);
      await A.enroll('pin-de-yacine-01');
      assert.equal(A.enrolled(), true);
      assert.doesNotMatch(c.w.localStorage.getItem('py-bio'), /pin-de-yacine/);
      assert.equal(await A.unlock(), 'pin-de-yacine-01');
      A.forget(); assert.equal(A.enrolled(), false);
    } finally { c.close(); }
  });
  test('sans extension PRF, l’activation est refusée plutôt que de garder le PIN en clair', async () => {
    const c = await boot({ now: NOW, noHistory: true });
    try {
      if (!c.w.crypto || !c.w.crypto.subtle) Object.defineProperty(c.w, 'crypto', { value: webcrypto, configurable: true });
      c.w.TextEncoder = TextEncoder; c.w.TextDecoder = TextDecoder;
      fakeWebAuthn(c.w, { prf: false });
      await assert.rejects(c.w.PYAUTH.enroll('pin-de-yacine-01'), /ne sait pas protéger le PIN/);
      assert.equal(c.w.PYAUTH.enrolled(), false);
    } finally { c.close(); }
  });
});

describe('écran de connexion', () => {
  test('un PIN avec accent est arrêté avant d’être envoyé, avec une explication', async () => {
    const c = await boot({ now: NOW, noHistory: true });
    try {
      c.$('#login').hidden = false; c.$('#pin').value = 'éléphant rouge 22';
      c.$('#loginForm').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
      assert.equal(c.$('#loginErr').hidden, false); assert.match(c.$('#loginErr').textContent, /ni accent/);
    } finally { c.close(); }
  });
});

describe('back-office admin.html (mode local)', () => {
  async function bootAdmin(state) {
    let html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8').replace(/<script src="[^"]*"[^>]*><\/script>\s*/g, '');
    const dom = new JSDOM(html, { url: 'http://localhost/admin.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; if (state) w.localStorage.setItem('pilote-yacine-v2', JSON.stringify(state));
    w.eval('window.PY_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", STATION: { name: "Station DRUM", lat: 45.885, lon: -72.49 }, HOME: { name: "Sherbrooke", lat: 45.40, lon: -71.89 } };');
    for (const n of ['util', 'admin']) w.eval(fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'));
    await new Promise(r => setTimeout(r, 20));
    return { w, $: s => w.document.querySelector(s), close: () => w.close() };
  }
  const iso = (d, h) => new Date('2026-10-' + d + 'T' + h + ':00-04:00').toISOString();
  const log = [
    { at: iso(15, '07:10'), ok: true, kind: 'connexion', method: 'biometrie', device: 'Android · Chrome', lat: 47.0, lon: -71.2, accuracy: 30 },
    { at: iso(14, '22:00'), ok: false, kind: 'echec', method: 'pin', device: null },
    { at: iso(14, '21:59'), ok: false, kind: 'echec', method: 'pin', device: null },
    { at: iso(14, '21:58'), ok: false, kind: 'echec', method: 'pin', device: null },
    { at: iso(14, '06:45'), ok: true, kind: 'ouverture', method: 'session', device: 'iPhone · Safari', lat: 45.885, lon: -72.49, accuracy: 12 },
    { at: iso(13, '06:40'), ok: true, kind: 'connexion', method: 'pin', device: 'iPhone · Safari', lat: 45.401, lon: -71.891, accuracy: 20 }];
  test('liste des connexions avec méthode, appareil, position et alertes', async () => {
    const a = await bootAdmin({ days: [], accessLog: log });
    try {
      assert.equal(a.$('#adApp').hidden, false);
      a.$('#adPeriod').value = '0'; a.$('#adPeriod').dispatchEvent(new a.w.Event('change'));
      const rows = [...a.$('#adTable').querySelectorAll('tr')].slice(1).map(r => r.textContent.replace(/[  ]/g, ' '));
      assert.equal(rows.length, 6);
      assert.match(rows[5], /Connexion/); assert.match(rows[5], /PIN/); assert.match(rows[5], /à la maison/);
      assert.match(rows[4], /Ouverture/); assert.match(rows[4], /à la station/);
      assert.match(rows[1], /PIN refusé/); assert.match(rows[1], /3 PIN refusés d’affilée/);
      assert.match(rows[0], /Touch ID \/ Face ID/); assert.match(rows[0], /nouvel appareil/); assert.match(rows[0], /km de la station/);
      a.$('#adKind').value = 'alerte'; a.$('#adKind').dispatchEvent(new a.w.Event('change'));
      assert.equal(a.$('#adTable').querySelectorAll('tr.ad-flag').length, 2);
      assert.match(a.$('#adTiles').textContent, /Appareils sur 30 jours/);
    } finally { a.close(); }
  });
  test('la page n’est pas indexée et le site ne la lie nulle part', () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8'), /<meta name="robots" content="noindex, nofollow">/);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /admin\.html/);
  });
});
