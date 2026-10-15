// Démarre le site dans jsdom, en mode local (sans Supabase, sans Leaflet, sans pdf.js réel),
// avec les scripts chargés dans le même ordre que index.html. Permet de tester la logique métier
// et le rendu HTML sans navigateur. Les tests de bout en bout (Playwright) couvrent le reste.
'use strict';
process.env.TZ = process.env.TZ || 'America/Toronto';
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const REFERENCE = require('./reference');
const SCRIPTS = ['config', 'util', 'data', 'db', 'pdf-import', 'tariffs', 'world', 'features', 'savings', 'app'];

const LOCAL_CONFIG = `window.PY_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", DEFAULT_DRIVER: "yacine",
  STATION: { name: "Station DRUM", lat: 45.885, lon: -72.49 }, HOME: { name: "Sherbrooke", lat: 45.40, lon: -71.89 }, FUEL_PRICE: 1.90 };`;

// Date figée : new Date() et Date.now() renvoient l'instant demandé, les autres usages restent intacts.
function freezeDate(w, iso) {
  const Real = w.Date; const fixed = new Real(iso).getTime();
  function Frozen(...a) { if (!new.target) return new Real(fixed).toString(); return a.length ? new Real(...a) : new Real(fixed); }
  Frozen.prototype = Real.prototype; Frozen.now = () => fixed; Frozen.parse = Real.parse; Frozen.UTC = Real.UTC;
  w.Date = Frozen;
}

// Objet « tout-terrain » pour le contexte canvas : chaque propriété est une fonction qui renvoie le même objet.
function anyStub() { const s = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : s), apply: () => s, set: () => true }); return s; }

// Faux pdf.js : le « PDF » déposé est un texte dont chaque ligne devient une rangée d'items positionnés,
// comme le ferait pdf.js sur une vraie facture (même regroupement par y, même tri par x).
function fakePdfjs() {
  return {
    GlobalWorkerOptions: {},
    getDocument({ data }) {
      const lines = Buffer.from(data).toString('utf8').split('\n');
      const pages = []; for (let i = 0; i < lines.length; i += 40) pages.push(lines.slice(i, i + 40));
      return { promise: Promise.resolve({ numPages: pages.length, async getPage(p) { const ls = pages[p - 1]; return { async getTextContent() { return { items: ls.flatMap((l, i) => l.split(' ').map((s, j) => ({ str: s, transform: [1, 0, 0, 1, j * 40, 1000 - i * 12] }))) }; } }; } }) };
    }
  };
}

// Fausse géolocalisation pilotable : geo.push({ lat, lon, acc, t }) alimente watchPosition et getCurrentPosition.
function fakeGeo(w) {
  const watchers = new Map(); let id = 0; let last = null;
  const geo = {
    watchPosition(ok) { watchers.set(++id, ok); return id; },
    clearWatch(i) { watchers.delete(i); },
    getCurrentPosition(ok) { if (last) ok(last); },
    push(p) { last = { coords: { latitude: p.lat, longitude: p.lon, accuracy: p.acc == null ? 10 : p.acc, speed: null }, timestamp: p.t }; watchers.forEach(cb => cb(last)); },
    get watching() { return watchers.size; }
  };
  Object.defineProperty(w.navigator, 'geolocation', { value: geo, configurable: true });
  return geo;
}

/**
 * boot({ now, localState, session, storage }) → { w, d, $, errors, geo, tick }
 *  now          : ISO de l'instant figé (ex. '2026-10-15T21:30:00-04:00')
 *  localState   : état initial du stockage local (clé pilote-yacine-v2)
 *  session      : entrées de sessionStorage (ex. { 'py-landing': '1' })
 *  storage      : autres entrées de localStorage (ex. { 'py-shift': '...' })
 *  noHistory    : sans historique ni stats par localité (la grille tarifaire reste) pour des calculs déterministes
 *  config       : texte de js/config.js à utiliser à la place du mode local
 */
async function boot(opts = {}) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script src="[^"]*"><\/script>\s*/g, '');
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e)); vc.on('error', e => errors.push(e));
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window; const d = w.document;
  if (opts.now) freezeDate(w, opts.now);
  // Données de référence synthétiques (tests/helpers/reference.js) : en mode local, l'application les lit dans le
  // stockage comme une sauvegarde restaurée.
  let state = opts.localState ? JSON.parse(JSON.stringify(opts.localState)) : null;
  // noHistory garde la grille tarifaire (pour l'audit) mais retire l'historique et les stats par localité.
  state = state || { days: [], parcels: [], invoices: [], goals: {}, localities: [] };
  if (!state.reference) state.reference = opts.noHistory ? { tariffs: REFERENCE.tariffs } : REFERENCE;
  w.localStorage.setItem('pilote-yacine-v2', JSON.stringify(state));
  if (opts.session) Object.entries(opts.session).forEach(([k, v]) => w.sessionStorage.setItem(k, v));
  if (opts.storage) Object.entries(opts.storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.HTMLCanvasElement.prototype.getContext = () => anyStub();
  // « Réduire les animations » activé : les compteurs du tableau affichent tout de suite leur valeur finale
  // (sinon une image d'animation peut tomber entre le rendu et l'assertion et lire « 0 j »).
  w.matchMedia = q => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q), media: q, addEventListener() {}, addListener() {} });
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.pdfjsLib = fakePdfjs();
  if (!w.Blob.prototype.arrayBuffer) w.Blob.prototype.arrayBuffer = function () { return new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(this); }); };
  const geo = opts.geo === false ? null : fakeGeo(w);
  w.onerror = e => errors.push(e);
  for (const n of SCRIPTS) {
    const file = path.join(ROOT, 'js', n + '.js'); if (!fs.existsSync(file)) continue;
    const src = n === 'config' ? (opts.config || LOCAL_CONFIG) : fs.readFileSync(file, 'utf8');
    try { w.eval(src + '\n//# sourceURL=js/' + n + '.js'); } catch (e) { e.message = n + '.js : ' + e.message; throw e; }
  }
  await w.PYAPP.refresh();
  const $ = s => d.querySelector(s);
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  // attend qu'une condition soit vraie (rendu après une promesse, stockage mis à jour), au plus `ms` millisecondes
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('condition non remplie après ' + ms + ' ms'); await tick(10); } };
  const close = () => { try { if (w.PY_WORLD) w.PY_WORLD.stop(); } catch (e) {} w.close(); };
  return { dom, w, d, $, errors, geo, tick, until, close };
}

/** Entre dans l'application (après l'accueil) sans ouvrir le brief du matin. */
async function enter(ctx, tab = 'dash') {
  const { w, $ } = ctx; const today = w.PYU ? w.PYU.today() : new w.Date().toISOString().slice(0, 10);
  w.localStorage.setItem('py-brief-' + today, '1');
  $('#btnExplore').click(); w.PYAPP.goTab(tab); await ctx.tick(5);
}

/** Dépose un faux PDF dans la zone d'import et attend la fin du traitement. */
async function dropPdf(ctx, name, lines) {
  const { w, $ } = ctx;
  const file = new w.File([lines.join('\n')], name, { type: 'application/pdf' });
  const inp = $('#pdfFile'); Object.defineProperty(inp, 'files', { value: [file], configurable: true });
  inp.dispatchEvent(new w.Event('change', { bubbles: true }));
  // le statut garde « Lecture… » en préfixe puis reçoit « Importé » ou « Échec » ; refresh() suit dans la même file de micro-tâches
  const t0 = Date.now();
  while (!/Importé|Échec/.test($('#pdfStatus').textContent)) { if (Date.now() - t0 > 15000) throw new Error('import PDF sans réponse après 15 s : ' + $('#pdfStatus').textContent); await ctx.tick(10); }
  await ctx.tick(10);
  return $('#pdfStatus').textContent;
}

module.exports = { boot, enter, dropPdf, freezeDate, ROOT };
