// Audit de facture : chaque contrôle doit se déclencher sur le défaut qu'il vise, et rester muet sinon.
// C'est le contrôle qui protège l'argent de Yacine : une baisse de tarif ou une journée oubliée doit ressortir.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('../helpers/sandbox');
const inv = require('../helpers/invoice');

const w = load(['util', 'tariffs', 'db', 'pdf-import', 'features']);
const parse = lines => w.PYPDF.parseLines(lines);
const audit = (r, journal) => w.PYF.auditInvoice(r.inv, r.parcels, r.days, journal || [], r.meta);
const texts = a => a.issues.map(i => i.t).join(' | ');

describe('facture conforme', () => {
  const r = parse(inv.typicalWeek().lines);
  const a = audit(r);
  test('aucune anomalie, quatre contrôles verts', () => {
    assert.deepEqual(plain(a.issues), []);
    assert.deepEqual(plain(a.ok), ['Somme des colis = base facturée', 'Frais d’administration à 2 %', 'Total facture cohérent', 'Tarifs conformes à la grille de référence']);
    assert.equal(a.parcels, r.parcels.length); assert.equal(a.days, 4);
    assert.match(a.at, /^\d{4}-\d{2}-\d{2}T/);
  });
  test('signatures comptées quand il y en a', () => {
    const fx = inv.build({ week: '2026-42', from: '2026-10-12', to: '2026-10-18', days: [inv.day('2026-10-13', 25, 'ZONE_G', 7, { each: i => ({ sig: i < 4 }) })] });
    assert.ok(audit(parse(fx.lines)).ok.includes('4 colis avec signature'));
  });
});

describe('contrôles comptables', () => {
  test('frais d’administration différents de 2 % : point à vérifier', () => {
    const a = audit(parse(inv.typicalWeek('2026-41', '2026-10-05', { adminRate: 0.03 }).lines));
    assert.equal(a.issues.length, 1); assert.equal(a.issues[0].sev, 'warn'); assert.match(a.issues[0].t, /administration .* au lieu de 2 %/);
  });
  test('total facture incohérent : anomalie', () => {
    const r = parse(inv.typicalWeek().lines); r.inv.total = r.inv.total - 20;
    const a = audit(r);
    assert.ok(a.issues.some(i => i.sev === 'bad' && /Total facture/.test(i.t)), texts(a));
  });
  test('annulations déduites : signalées même si le total est juste', () => {
    const a = audit(parse(inv.typicalWeek('2026-41', '2026-10-05', { cancel: 15 }).lines));
    assert.ok(a.issues.some(i => i.sev === 'warn' && /Annulations déduites : 15\.00/.test(i.t)), texts(a));
    assert.ok(a.ok.includes('Total facture cohérent'));
  });
  test('somme des colis différente de la base : anomalie', () => {
    const r = parse(inv.typicalWeek().lines); r.parcels.pop();
    const a = audit(r);
    assert.ok(a.issues.some(i => i.sev === 'bad' && /Somme des colis/.test(i.t)), texts(a));
  });
});

describe('grille tarifaire', () => {
  const fx = (zone, wt, amt) => inv.build({ week: '2026-42', from: '2026-10-12', to: '2026-10-18', days: [{ date: '2026-10-13', parcels: Array.from({ length: 30 }, () => ({ zone, wt, amt })) }] });
  test('baisse de tarif sur un poids entier (2 lb) : anomalie', () => {
    const ref = inv.TARIFFS['ZONE_G|2.0'];
    const a = audit(parse(fx('ZONE_G', 2, ref - 0.10).lines));
    const t = a.issues.find(i => /Grille tarifaire/.test(i.t));
    assert.ok(t, 'la baisse doit être détectée : ' + texts(a));
    assert.equal(t.sev, 'bad'); assert.match(t.t, /30 colis \(0 hausses, 1 baisses/);
    assert.match(t.t, /ZONE_G 2\.0 lb : de 2\.00 à 1\.90/);
  });
  test('hausse de tarif sur une demi-livre : point à vérifier', () => {
    const ref = inv.TARIFFS['ZONE_M|0.5'];
    const a = audit(parse(fx('ZONE_M', 0.5, ref + 0.05).lines));
    const t = a.issues.find(i => /Grille tarifaire/.test(i.t));
    assert.ok(t); assert.equal(t.sev, 'warn'); assert.match(t.t, /1 hausses, 0 baisses/);
  });
  test('zone ou poids inconnus de la grille : pas de fausse alerte', () => {
    const a = audit(parse(fx('ZONE_Z', 2, 3.33).lines));
    assert.ok(!a.issues.some(i => /Grille tarifaire/.test(i.t)));
    assert.ok(a.ok.includes('Tarifs conformes à la grille de référence'));
  });
  test('écart inférieur à un demi-cent ignoré', () => {
    const ref = inv.TARIFFS['ZONE_G|1.0'];
    const a = audit(parse(fx('ZONE_G', 1, ref + 0.004).lines));
    assert.ok(!a.issues.some(i => /Grille tarifaire/.test(i.t)));
  });
});

describe('journées', () => {
  test('journée saisie à la main, dans la période, absente de la facture : anomalie', () => {
    const r = parse(inv.typicalWeek().lines);
    const journal = [{ date: '2026-10-08', parcels: 175, source: 'saisie' }, { date: '2026-10-06', parcels: 170, source: 'saisie' }, { date: '2026-10-01', parcels: 180, source: 'saisie' }];
    const a = audit(r, journal);
    const miss = a.issues.filter(i => /absente de la facture/.test(i.t));
    assert.equal(miss.length, 1); assert.match(miss[0].t, /2026-10-08 \(175 colis\)/);
  });
  test('journée saisie déjà confirmée par une facture précédente : ignorée', () => {
    const r = parse(inv.typicalWeek().lines);
    const a = audit(r, [{ date: '2026-10-08', parcels: 175, source: 'facture' }]);
    assert.ok(!a.issues.some(i => /absente/.test(i.t)));
  });
  test('résumé du jour différent du nombre de lignes de colis : point à vérifier', () => {
    const r = parse(inv.typicalWeek().lines); r.days[0].parcels += 1;
    const a = audit(r);
    assert.ok(a.issues.some(i => i.sev === 'warn' && /171 colis au résumé, 170 lignes/.test(i.t)), texts(a));
  });
});
