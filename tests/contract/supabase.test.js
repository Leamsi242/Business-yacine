// Contrat avec Supabase : la sécurité par PIN (RLS) et la présence des tables attendues par le site.
// Parle directement à PostgREST avec la clé anonyme publique de js/config.js.
//  - sans réseau vers supabase.co : les tests sont sautés (le bac à sable n'y a pas accès)
//  - sans PY_TEST_PIN : seuls les contrôles « sans PIN » tournent (refus de lecture et d'écriture)
//  - avec PY_TEST_PIN (secret CI ou variable locale) : vérifie aussi que le bon PIN ouvre l'accès
'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cfg = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'config.js'), 'utf8'))(w); return w.PY_CONFIG; })();
const PIN = process.env.PY_TEST_PIN || '';
const WRONG = '000000';
const TABLES = ['days', 'parcels', 'invoices', 'goals', 'localities', 'shifts', 'savings_goals', 'savings_log', 'budget'];

async function rest(method, pathq, { pin, body } = {}) {
  const headers = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (pin != null) headers['x-pin'] = pin;
  const r = await fetch(cfg.SUPABASE_URL + '/rest/v1/' + pathq, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

let online = false, why = '';
before(async () => {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) { why = 'config.js sans Supabase'; return; }
  try { await rest('GET', 'goals?select=driver&limit=1', { pin: WRONG }); online = true; } catch (e) { why = 'supabase.co injoignable (' + (e.cause && e.cause.code || e.message) + ')'; }
});
const online_ = (t, fn) => test(t, async (ctx) => { if (!online) return ctx.skip(why); await fn(); });

describe('sans PIN ou avec un mauvais PIN', () => {
  online_('lecture : aucune ligne ne sort (RLS), sur toutes les tables', async () => {
    for (const t of TABLES) {
      const r = await rest('GET', t + '?select=*&limit=1', { pin: WRONG });
      assert.equal(r.status, 200, t + ' : ' + JSON.stringify(r.data)); assert.deepEqual(r.data, [], t + ' lisible sans PIN');
    }
    const r = await rest('GET', 'goals?select=*&limit=1'); assert.deepEqual(r.data, [], 'sans en-tête x-pin');
  });
  online_('la table config (le PIN) n’est jamais lisible', async () => {
    const r1 = await rest('GET', 'config?select=*', { pin: WRONG }); assert.ok(r1.status === 200 && Array.isArray(r1.data) && r1.data.length === 0 || r1.status === 401 || r1.status === 403 || r1.status === 404, JSON.stringify(r1));
    if (PIN) { const r2 = await rest('GET', 'config?select=*', { pin: PIN }); assert.ok(!Array.isArray(r2.data) || r2.data.length === 0, 'config lisible avec le bon PIN : ' + JSON.stringify(r2)); }
  });
  online_('écriture refusée : insertion d’une journée et d’un versement', async () => {
    const r = await rest('POST', 'days', { pin: WRONG, body: { date: '1999-01-01', driver: 'test-contrat', parcels: 1, invoiced: 1 } });
    assert.ok([401, 403].includes(r.status), 'insert days : ' + r.status + ' ' + JSON.stringify(r.data));
    const r2 = await rest('POST', 'savings_log', { pin: WRONG, body: { goal_id: 'voiture', amount: 1, date: '1999-01-01' } });
    assert.ok([401, 403, 409].includes(r2.status), 'insert savings_log : ' + r2.status);
  });
  online_('les tables des migrations 2 et 3 existent (shifts, savings_goals, savings_log, budget, invoices.audit)', async () => {
    for (const t of ['shifts', 'savings_goals', 'savings_log', 'budget']) {
      const r = await rest('GET', t + '?select=*&limit=1', { pin: WRONG });
      assert.notEqual(r.status, 404, 'table ' + t + ' absente : exécuter supabase/migration_' + (t === 'shifts' ? '2_shifts_audit' : '3_savings') + '.sql');
    }
    const r = await rest('GET', 'invoices?select=audit&limit=1', { pin: WRONG });
    assert.equal(r.status, 200, 'colonne invoices.audit absente (migration 2) : ' + JSON.stringify(r.data));
  });
});

describe('avec le bon PIN (PY_TEST_PIN)', () => {
  const withPin = (t, fn) => test(t, async (ctx) => { if (!online) return ctx.skip(why); if (!PIN) return ctx.skip('PY_TEST_PIN non défini'); await fn(); });
  withPin('la lecture des objectifs renvoie une ligne : c’est le test de connexion du site', async () => {
    const r = await rest('GET', 'goals?select=driver&limit=1', { pin: PIN });
    assert.equal(r.status, 200); assert.ok(r.data.length >= 1, 'aucune ligne goals : PIN faux ou table vide');
  });
  withPin('les localités de référence sont chargées', async () => {
    const r = await rest('GET', 'localities?select=code,name,lat,lon', { pin: PIN });
    assert.ok(r.data.length >= 20, r.data.length + ' localités'); assert.ok(r.data.every(l => l.code && typeof l.lat === 'number'));
  });
  withPin('les projets d’épargne par défaut existent, la voiture en priorité 1', async () => {
    const r = await rest('GET', 'savings_goals?select=id,kind,priority&order=priority', { pin: PIN });
    assert.equal(r.status, 200); assert.ok(r.data.find(g => g.kind === 'voiture' && g.priority === 1), JSON.stringify(r.data));
  });
});
