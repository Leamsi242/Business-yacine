// Dates « du jour » en heure locale du Québec. Yacine saisit sa journée le soir : à 21 h 30 à Drummondville
// il est déjà le lendemain en UTC, et la journée doit quand même tomber à la bonne date.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const EVENING = '2026-10-15T21:30:00-04:00'; // jeudi 15 octobre, 21 h 30 heure de l'Est (01:30 UTC le 16)

describe('PYU', () => {
  test('isoDate, isoMonth, today, weekStart, tariffKey', async () => {
    const c = await boot({ now: EVENING });
    try {
      const U = c.w.PYU;
      assert.equal(U.today(), '2026-10-15');
      assert.equal(U.isoMonth(new c.w.Date()), '2026-10');
      assert.equal(U.isoDate(new c.w.Date('2026-10-31T23:59:00-04:00')), '2026-10-31');
      assert.equal(U.isoDate(new c.w.Date('2026-01-01T00:30:00-05:00')), '2026-01-01');
      assert.equal(U.weekStart('2026-10-18'), '2026-10-12');
      assert.equal(U.tariffKey('ZONE_G', 2), 'ZONE_G|2.0'); assert.equal(U.tariffKey('ZONE_G', '0.5'), 'ZONE_G|0.5'); assert.equal(U.tariffKey('ZONE_G', 15), 'ZONE_G|15.0');
    } finally { c.close(); }
  });
});

describe('le soir à 21 h 30, tout reste au 15 octobre', () => {
  let c;
  test('date par défaut du formulaire du journal', async () => {
    c = await boot({ now: EVENING, noHistory: true, localState: localState() });
    assert.equal(c.$('#f_date').value, '2026-10-15');
  });
  test('saisie du soir : titre et date', async () => {
    await enter(c, 'dash');
    c.$('#btnEvening').click(); await c.tick(10);
    assert.equal(c.$('#evening').hidden, false);
    assert.equal(c.$('#ev_eyebrow').textContent, 'Saisie du soir · jeudi 15 octobre');
    assert.equal(c.$('#ev_date').value, '2026-10-15');
    c.w.PYF.closeEvening();
  });
  test('brief du matin : la clé « déjà vu » porte la date locale', () => {
    assert.equal(c.w.localStorage.getItem('py-brief-2026-10-15'), '1');
    assert.equal(c.w.localStorage.getItem('py-brief-2026-10-16'), null);
  });
  test('versement d’épargne daté du 15', async () => {
    await c.w.PYDB.addContribution('voiture', 50);
    assert.equal((await c.w.PYDB.getSavings()).log[0].date, '2026-10-15');
    c.close();
  });
});

describe('fins de période', () => {
  test('dimanche soir : « cette semaine » compte encore la semaine en cours', async () => {
    const c = await boot({ now: '2026-10-11T21:30:00-04:00', noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      const tile = [...c.$('#kpis').querySelectorAll('.tile')].find(t => /Cette semaine/.test(t.textContent));
      assert.match(tile.querySelector('.val').textContent, /^4 j$/);
    } finally { c.close(); }
  });
  test('31 octobre au soir : le mois affiché est encore octobre', async () => {
    const c = await boot({ now: '2026-10-31T22:00:00-04:00', noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      assert.match(c.$('#kpis .tile .lab').textContent, /ce mois-ci/);
      assert.match(c.$('#kpis .tile .sub').textContent, /^5 jours/);
      assert.match(c.$('#forecast').textContent, /Jours restants0/);
    } finally { c.close(); }
  });
});
