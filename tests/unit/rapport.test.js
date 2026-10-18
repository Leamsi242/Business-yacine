// Rapport hebdomadaire : le calcul doit compter la bonne semaine, traiter l'essence et les km manquants,
// et l'envoi doit partir avec le bon PIN et le bon objet. Aucun réseau réel : fetch est simulé.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const lib = () => import('../../scripts/rapport.mjs');

describe('semaines', () => {
  test('la semaine commence le lundi, dimanche inclus', async () => {
    const { weekStart, addDays } = await lib();
    assert.equal(weekStart('2026-10-18'), '2026-10-12');
    assert.equal(weekStart('2026-10-12'), '2026-10-12');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  });
});

describe('calcul de la semaine', () => {
  const days = [
    { date: '2026-10-11', parcels: 999, invoiced: 999, fuel: 1, km: 1 },            // semaine précédente : exclu
    { date: '2026-10-12', parcels: 180, invoiced: 360, fuel: 55, km: 300 },
    { date: '2026-10-13', parcels: 170, invoiced: 340, fuel: null, km: null },       // essence et km à estimer
    { date: '2026-10-18', parcels: 0, invoiced: 0, fuel: null, km: null }             // pas encore facturé
  ];
  const shifts = [{ date: '2026-10-13', km_gps: 280 }, { date: '2026-10-11', km_gps: 9 }];
  const goals = { days: 4.5, cut: 0.25, fuel: 60, status: 'broker' };

  test('compte la semaine, applique la part du broker et estime l’essence manquante', async () => {
    const { buildReport } = await lib();
    const r = buildReport({ week: '2026-10-12', days, shifts, goals });
    assert.equal(r.n, 3);
    assert.equal(r.target, 4);
    assert.equal(r.success, false);
    assert.equal(r.parcels, 350);
    assert.equal(r.invoiced, 700);
    assert.ok(Math.abs(r.net - 525) < 1e-9);
    assert.equal(r.fuel, 175);          // 55 réel, puis 60 estimé deux fois
    assert.ok(Math.abs(r.netAfter - 350) < 1e-9);
    assert.equal(r.km, 580);            // 300 saisis, 280 du GPS, 0 pour la journée sans chiffre
    assert.equal(r.pending, 1);
    assert.equal(r.shifts, 1);
  });

  test('statut indépendant : 95 % du facturé', async () => {
    const { buildReport } = await lib();
    const r = buildReport({ week: '2026-10-12', days, shifts, goals: { ...goals, status: 'indep' } });
    assert.ok(Math.abs(r.net - 665) < 1e-9);
  });

  test('semaine réussie quand le nombre de jours atteint l’objectif', async () => {
    const { buildReport, renderHtml } = await lib();
    const r = buildReport({ week: '2026-10-12', days, shifts, goals: { ...goals, days: 3 } });
    assert.equal(r.success, true);
    assert.match(renderHtml(r), /Semaine réussie : 3 jours sur 3/);
  });
});

describe('envoi', () => {
  const env = { YACINE_PIN: 'pin-test-0123456', BREVO_API_KEY: 'cle-test', RAPPORT_FROM: 'moi@example.com', RAPPORT_TO: 'toi@example.com' };
  const fakeFetch = calls => async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('brevo')) return { ok: true, status: 201, json: async () => ({}) };
    if (String(url).includes('/days')) return { ok: true, json: async () => [{ date: '2026-10-13', parcels: 170, invoiced: 340 }] };
    if (String(url).includes('/goals')) return { ok: true, json: async () => [{ days: 4.5, cut: 0.25, fuel: 60 }] };
    return { ok: true, json: async () => [] };
  };

  test('lit la semaine avec le PIN puis envoie le courriel', async () => {
    const { main } = await lib();
    const calls = [];
    const now = new Date('2026-10-18T23:00:00Z');   // dimanche 19 h à Toronto
    const r = await main(env, fakeFetch(calls), now);
    const reads = calls.filter(c => c.url.includes('/rest/v1/'));
    assert.ok(reads.length >= 3);
    assert.ok(reads.every(c => c.opts.headers['x-pin'] === env.YACINE_PIN));
    assert.ok(reads.some(c => c.url.includes('date=gte.2026-10-12') && c.url.includes('date=lte.2026-10-18')));
    const mail = calls.find(c => c.url.includes('brevo'));
    const body = JSON.parse(mail.opts.body);
    assert.equal(body.subject, 'Pilote Yacine : semaine du 12 oct au 18 oct');
    assert.deepEqual(body.to, [{ email: env.RAPPORT_TO }]);
    assert.equal(r.n, 1);
  });

  test('refuse de partir sans configuration complète', async () => {
    const { main } = await lib();
    await assert.rejects(main({ ...env, BREVO_API_KEY: '' }, fakeFetch([])), /BREVO_API_KEY/);
  });

  test('un PIN refusé stoppe l’envoi', async () => {
    const { main } = await lib();
    const refuse = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(main(env, refuse, new Date('2026-10-18T23:00:00Z')), /PIN de Yacine/);
  });
});
