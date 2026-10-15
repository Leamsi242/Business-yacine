// Parseur de factures : à partir des lignes de texte, on doit retrouver exactement l'en-tête,
// les journées (≥ 20 colis), chaque colis, et rejeter les documents qui ne sont pas des factures.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('../helpers/sandbox');
const inv = require('../helpers/invoice');

const w = load(['util', 'tariffs', 'pdf-import']);
const P = w.PYPDF;

describe('PYPDF.parseLines sur une semaine type', () => {
  const fx = inv.typicalWeek();
  const r = P.parseLines(fx.lines);
  test('en-tête : semaine, dates, chauffeur, montants', () => {
    assert.equal(r.inv.week, '2026-41');
    assert.equal(r.inv.from_date, '2026-10-05');
    assert.equal(r.inv.to_date, '2026-10-11');
    assert.equal(r.meta.driver_code, 'C0X0000');
    assert.equal(r.inv.base, fx.expected.base);
    assert.equal(r.inv.fsc, fx.expected.fsc);
    assert.equal(r.inv.admin, fx.expected.admin);
    assert.equal(r.inv.cancel, 0);
    assert.equal(r.inv.total, fx.expected.total);
    assert.equal(r.inv.vendor, null);
  });
  test('cohérence comptable : base + carburant − admin − annulations = total', () => {
    assert.equal(Math.round((r.inv.base + r.inv.fsc - r.inv.admin - r.inv.cancel) * 100) / 100, r.inv.total);
  });
  test('journées : seules celles d’au moins 20 colis, avec le total facturé du jour', () => {
    assert.deepEqual(plain(r.days.map(d => [d.date, d.parcels, d.invoiced])), fx.expected.days.map(d => [d.date, d.parcels, d.invoiced]));
    assert.ok(!r.days.find(d => d.date === '2026-10-08'), 'la journée de 2 colis (retour) ne compte pas comme journée travaillée');
  });
  test('colis : un par ligne de détail, poids et montant numériques, semaine renseignée', () => {
    assert.equal(r.parcels.length, fx.expected.parcels.length);
    const p = r.parcels[0];
    assert.deepEqual(plain(Object.keys(p).sort()), ['amt', 'date', 'pc', 'svc', 'tracking', 'week', 'wt', 'zone']);
    assert.equal(typeof p.wt, 'number'); assert.equal(typeof p.amt, 'number'); assert.equal(p.week, '2026-41');
    assert.equal(r.parcels.reduce((a, p) => a + p.amt, 0).toFixed(2), fx.expected.base.toFixed(2), 'la somme des colis égale la base facturée');
  });
  test('localité dominante : code rural complet (J0…) ou 3 premiers caractères en ville', () => {
    assert.equal(r.days[0].loc, 'J0A1M0');
    const urban = inv.build({ week: '2026-42', from: '2026-10-12', to: '2026-10-18', days: [inv.day('2026-10-13', 30, 'ZONE_G', 5, { pc: 'J2C4B7' })] });
    assert.equal(P.parseLines(urban.lines).days[0].loc, 'J2C');
  });
  test('meta : aucune signature sur cette semaine, code chauffeur hors des colonnes enregistrées', () => { assert.equal(r.meta.sig, 0); assert.equal('driver_code' in r.inv, false); });
});

describe('variantes de mise en page', () => {
  test('montants avec séparateur de milliers ($1,305.83)', () => {
    const fx = inv.typicalWeek('2026-41', '2026-10-05', { comma: true });
    const r = P.parseLines(fx.lines);
    assert.equal(r.inv.total, fx.expected.total); assert.equal(r.inv.base, fx.expected.base);
    assert.equal(r.parcels.length, fx.expected.parcels.length);
  });
  test('en-tête répété sur chaque page : une seule valeur retenue', () => {
    const fx = inv.typicalWeek();
    const header = fx.lines.slice(1, 5);
    const lines = fx.lines.concat(header, header, header);
    const r = P.parseLines(lines);
    assert.equal(r.inv.week, '2026-41'); assert.equal(r.days.length, fx.expected.days.length);
  });
  test('colis avec signature (*) : poids et montant lus, signature comptée dans meta', () => {
    const fx = inv.build({ week: '2026-42', from: '2026-10-12', to: '2026-10-18', days: [inv.day('2026-10-13', 25, 'ZONE_G', 7, { each: i => ({ sig: i < 3 }) })] });
    const r = P.parseLines(fx.lines);
    assert.equal(r.parcels.length, 25); assert.equal(r.meta.sig, 3);
    assert.ok(r.parcels.every(p => p.wt > 0 && p.amt > 0));
  });
  test('annulations déduites : montant lu', () => {
    const fx = inv.typicalWeek('2026-41', '2026-10-05', { cancel: 12.34 });
    const r = P.parseLines(fx.lines);
    assert.equal(r.inv.cancel, 12.34); assert.equal(r.inv.total, fx.expected.total);
  });
  test('poids entiers et demi-livres', () => {
    const fx = inv.build({ week: '2026-42', from: '2026-10-12', to: '2026-10-18', days: [{ date: '2026-10-13', parcels: Array.from({ length: 20 }, (_, i) => ({ zone: 'ZONE_G', wt: i % 2 ? 0.5 : 2 })) }] });
    const r = P.parseLines(fx.lines);
    assert.deepEqual(plain([...new Set(r.parcels.map(p => p.wt))].sort()), [0.5, 2]);
  });
});

describe('documents étrangers', () => {
  test('une note de crédit n’a ni semaine ni journées', () => {
    const r = P.parseLines(inv.creditMemoLines());
    assert.equal(r.inv.week, null); assert.equal(r.days.length, 0); assert.equal(r.parcels.length, 0);
  });
  test('PDF vide', () => {
    const r = P.parseLines([]);
    assert.equal(r.inv.week, null); assert.equal(r.inv.total, 0); assert.equal(r.inv.base, 0);
  });
});
