// Cœur de l'application (app.js) : part de Yacine, semaines, formats français, fusion de l'historique
// embarqué avec la base, statistiques par localité. Tourne dans jsdom car app.js s'attache à la page.
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, enter } = require('../helpers/dom');

const NBSP = /[\u00a0\u202f ]/;
const plain = x => JSON.parse(JSON.stringify(x)); // valeurs venant du realm jsdom

describe('helpers de app.js', () => {
  let c, A;
  before(async () => { c = await boot({ now: '2026-10-15T09:00:00-04:00' }); A = c.w.PYAPP; });
  after(() => c.close());

  test('share : 75 % chez le broker (25 % retenus), 95 % en indépendant (5 % CNESST)', () => {
    A.S.goals.status = 'broker'; A.S.goals.cut = 0.25; assert.equal(A.share(), 0.75);
    A.S.goals.cut = 0.3; assert.equal(A.share(), 0.7);
    A.S.goals.status = 'indep'; assert.equal(A.share(), 0.95);
    A.S.goals.status = 'broker'; A.S.goals.cut = 0.25;
  });
  test('weekStart : lundi de la semaine, du lundi au dimanche (comme les factures)', () => {
    assert.equal(A.weekStart('2026-10-12'), '2026-10-12'); // lundi
    assert.equal(A.weekStart('2026-10-15'), '2026-10-12'); // jeudi
    assert.equal(A.weekStart('2026-10-18'), '2026-10-12'); // dimanche
    assert.equal(A.weekStart('2026-10-19'), '2026-10-19'); // lundi suivant
    assert.equal(A.weekStart('2026-01-01'), '2025-12-29'); // changement d'année
  });
  test('byWeek : regroupe, somme colis / facturé / km / essence, compte les jours, trié', () => {
    const w = A.byWeek([
      { date: '2026-10-13', parcels: 170, invoiced: 360, km: 300, fuel: 55 },
      { date: '2026-10-15', parcels: 180, invoiced: 400, km: null, fuel: null },
      { date: '2026-10-06', parcels: 100, invoiced: 200, km: 100, fuel: 20 }]);
    assert.deepEqual(plain(w.map(x => x.wk)), ['2026-10-05', '2026-10-12']);
    assert.deepEqual(plain(w[1]), { wk: '2026-10-12', parcels: 350, inv: 760, days: 2, fuel: 55, km: 300 });
  });
  test('fmt / money : format fr-CA, espace de milliers, virgule décimale, $ détaché', () => {
    assert.match(A.fmt(1234.5, 1), new RegExp('^1' + NBSP.source + '234,5$'));
    assert.equal(A.fmt(2.345, 2), '2,35'); assert.equal(A.fmt(0), '0');
    assert.match(A.money(4300), new RegExp('^4' + NBSP.source + '300' + NBSP.source + '\\$$'));
    assert.equal(A.money(1.464, 2), '1,46 $');
  });
  test('esc protège le HTML', () => { assert.equal(A.esc('<b>&"'), '&lt;b&gt;&amp;&quot;'); assert.equal(A.esc(null), ''); });
  test('isoDate : date locale, même tard le soir', () => { assert.equal(A.isoDate(new c.w.Date('2026-10-15T23:30:00-04:00')), '2026-10-15'); });
});

describe('chargement et fusion des données', () => {
  test('historique embarqué : 31 journées d’avril à septembre, triées, source facture', async () => {
    const c = await boot();
    try {
      const d = c.w.PYAPP.S.days;
      assert.equal(d.length, c.w.PY_HISTORY.days.length);
      assert.ok(d.every((x, i) => !i || x.date > d[i - 1].date));
      assert.ok(d.every(x => x.source === 'facture' && x.parcels > 0 && x.invoiced > 0));
      assert.equal(c.w.PYAPP.S.goals.days, 4.5); assert.equal(c.w.PYAPP.S.goals.net, 4300);
    } finally { c.close(); }
  });
  test('une journée de la base l’emporte sur l’historique à date égale, sans perdre les champs manquants', async () => {
    const c = await boot({ localState: { days: [{ date: '2026-09-27', driver: 'yacine', parcels: 181, invoiced: '590.10', km: '377', fuel: '61.5', source: 'facture' }], parcels: [], invoices: [], goals: { days: 5, net: 5000 }, localities: [] } });
    try {
      const d = c.w.PYAPP.S.days.find(x => x.date === '2026-09-27');
      assert.equal(d.parcels, 181); assert.equal(d.invoiced, 590.1); assert.equal(d.km, 377); assert.equal(d.fuel, 61.5);
      assert.ok(Array.isArray(d.top), 'le détail des localités de l’historique est conservé');
      assert.equal(c.w.PYAPP.S.goals.days, 5); assert.equal(c.w.PYAPP.S.goals.cut, 0.25, 'valeur par défaut complétée');
    } finally { c.close(); }
  });
  test('colis importés après le 27 septembre enrichissent les statistiques par localité', async () => {
    const parcels = [];
    for (let i = 0; i < 50; i++) parcels.push({ tracking: 'T' + i, date: '2026-10-06', week: '2026-41', driver: 'yacine', svc: 'FLEX', pc: 'J0A1M0', zone: 'ZONE_M', wt: 2, amt: 1.97 });
    for (let i = 0; i < 10; i++) parcels.push({ tracking: 'U' + i, date: '2026-10-06', week: '2026-41', driver: 'yacine', svc: 'FLEX', pc: 'G6P2A1', zone: 'ZONE_D', wt: 1, amt: 1.20 });
    const c = await boot({ localState: { days: [], parcels, invoices: [], goals: {}, localities: [] } });
    try {
      const ls = c.w.PYAPP.S.locstats;
      const before = c.w.PY_LOCSTATS.find(l => l.code === 'J0A1M0');
      const after = ls.find(l => l.code === 'J0A1M0');
      assert.equal(after.n, (before ? before.n : 0) + 50);
      assert.ok(Math.abs(after.ppp - after.rev / after.n) < 1e-9);
      const g6 = ls.find(l => l.code === 'G6'); assert.ok(g6 && g6.n >= 10, 'G6P se range sous la ville G6');
    } finally { c.close(); }
  });
  test('colis antérieurs au 27 septembre ignorés (déjà dans l’historique)', async () => {
    const parcels = [{ tracking: 'X1', date: '2026-09-20', driver: 'yacine', pc: 'J0A1M0', zone: 'ZONE_M', wt: 2, amt: 1.97 }];
    const c = await boot({ localState: { days: [], parcels, invoices: [], goals: {}, localities: [] } });
    try {
      const before = c.w.PY_LOCSTATS.find(l => l.code === 'J0A1M0'); const after = c.w.PYAPP.S.locstats.find(l => l.code === 'J0A1M0');
      assert.equal(after.n, before.n);
    } finally { c.close(); }
  });
});

describe('score de route et saisie manuelle (avec l’historique)', () => {
  let c;
  before(async () => { c = await boot({ now: '2026-10-15T09:00:00-04:00' }); await enter(c, 'map'); });
  after(() => c.close());

  test('codes ruraux éloignés : net élevé, verdict « Accepter », zones nommées', () => {
    c.$('#rs_codes').value = 'G0P1A0, G0P1J0 g0p1b0\nG0P1C0'; c.$('#rs_parcels').value = '180';
    c.$('#routeScore').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
    const t = c.$('#rs_out').textContent.replace(/\u00a0/g, ' ');
    assert.equal(c.$('#rs_out').querySelectorAll('.tile').length, 4);
    assert.match(t, /Accepter sans hésiter/);
    assert.match(t, /sur 4 zones connues \(Ham-Nord, Chesterville, Norbertville, Notre-Dame-de-Ham\)/);
    assert.ok(!/Codes inconnus/.test(t));
    const ppp = (2.94 + 2.91 + 2.64 + 3.64) / 4;
    assert.match(t, new RegExp(ppp.toFixed(2).replace('.', ',') + ' \\$/colis en moyenne'));
  });
  test('route urbaine (J2C) : verdict défavorable, km urbains', () => {
    c.$('#rs_codes').value = 'J2C4B7 J2B1A1 J2C'; c.$('#rs_parcels').value = '220';
    c.$('#routeScore').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
    const t = c.$('#rs_out').textContent.replace(/\u00a0/g, ' ');
    assert.match(t, /Demander un échange si possible|Correcte, dans ta moyenne/);
    assert.match(t, /\(Drummondville\)/);
  });
  test('codes jamais livrés : listés, moyenne générale', () => {
    c.$('#rs_codes').value = 'H0H0H0 J0H1A0'; c.$('#rs_parcels').value = '';
    c.$('#routeScore').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
    const t = c.$('#rs_out').textContent;
    assert.match(t, /Codes inconnus \(jamais livrés\) : H0H0H0/); assert.match(t, /1 zone connue \(Acton Vale\)/);
    c.$('#rs_codes').value = ''; c.$('#routeScore').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
    assert.match(c.$('#rs_out').textContent, /Colle des codes postaux/);
  });
  test('formulaire du journal : la journée saisie apparaît avec la pastille « saisie »', async () => {
    c.w.PYAPP.goTab('log');
    c.$('#f_date').value = '2026-10-14'; c.$('#f_parcels').value = '176'; c.$('#f_inv').value = '398.4'; c.$('#f_km').value = '305'; c.$('#f_fuel').value = '57'; c.$('#f_loc').value = 'J0H1A0'; c.$('#f_note').value = 'pluie';
    c.$('#dayForm').dispatchEvent(new c.w.Event('submit', { cancelable: true })); await c.tick(40);
    const d = c.w.PYAPP.S.days.find(x => x.date === '2026-10-14');
    assert.equal(d.parcels, 176); assert.equal(d.invoiced, 398.4); assert.equal(d.km, 305); assert.equal(d.fuel, 57); assert.equal(d.loc, 'J0H1A0'); assert.equal(d.note, 'pluie'); assert.equal(d.source, 'saisie');
    const row = [...c.$('#logTable').querySelectorAll('tr')].find(r => /mer 14 oct/.test(r.textContent));
    assert.ok(row, 'la ligne du 14 octobre est dans le journal'); assert.match(row.textContent, /saisie/); assert.match(row.textContent, /Acton Vale/);
    assert.equal(c.$('#f_date').value, '2026-10-15', 'le formulaire revient à aujourd’hui');
  });
});
