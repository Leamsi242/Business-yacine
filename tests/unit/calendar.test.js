// Calendrier du tableau de bord : mois navigable, total par semaine, détail d'une journée, clavier, accès au journal.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const NOW = '2026-10-15T09:00:00-04:00';
const NB = s => s.replace(/[\u00a0\u202f]/g, ' ');

describe('calendrier', () => {
  test('en-tête du mois, résumé et total de chaque semaine', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      assert.equal(c.$('#heatmap .cal-title').textContent, 'octobre 2026');
      assert.match(NB(c.$('#heatmap .cal-sum').textContent), /5 journées travaillées · 1 500 \$ net · 2 000 \$ facturés · 900 colis/);
      const row = c.$('#heatmap .cal-d[data-date="2026-10-05"]').parentElement;
      assert.match(NB(row.querySelector('.cal-wk').textContent), /4 j\s*1 200 \$/);
      assert.ok(row.querySelector('.cal-wk').classList.contains('ok'), 'semaine à 4 jours soulignée');
      assert.equal(c.$('#heatmap .cal-d.sel').dataset.date, '2026-10-15', 'aujourd’hui sélectionné par défaut');
    } finally { c.close(); }
  });
  test('mois précédent, suivant et retour à aujourd’hui', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      c.$('#heatmap [data-cal="-1"]').click(); assert.equal(c.$('#heatmap .cal-title').textContent, 'septembre 2026');
      assert.equal(c.$('#heatmap .cal-d.sel').dataset.date, '2026-09-01');
      assert.ok(c.$('#heatmap .cal-d[data-date="2026-09-28"]').classList.contains('work'));
      c.$('#heatmap [data-cal="1"]').click(); c.$('#heatmap [data-cal="1"]').click(); assert.equal(c.$('#heatmap .cal-title').textContent, 'novembre 2026');
      assert.ok(c.$('#heatmap .cal-d[data-date="2026-11-03"]').classList.contains('future'));
      c.$('#heatmap [data-cal="0"]').click(); assert.equal(c.$('#heatmap .cal-title').textContent, 'octobre 2026');
    } finally { c.close(); }
  });
  test('cliquer une journée affiche son détail ; « Modifier dans le journal » la charge dans le formulaire', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      c.$('#heatmap .cal-d[data-date="2026-10-07"]').click();
      const t = NB(c.$('#calDetail').textContent);
      assert.match(t, /Mercredi 7 octobre 2026|mercredi 7 octobre 2026/); assert.match(t, /Facturé400,00 \$/); assert.match(t, /Net \(part de Yacine\)300,00 \$/); assert.match(t, /Net après essence250,00 \$/);
      c.$('#calEdit').click();
      assert.equal(c.$('#v-log').hidden, false); assert.equal(c.$('#f_date').value, '2026-10-07'); assert.equal(c.$('#f_km').value, '300');
    } finally { c.close(); }
  });
  test('journée vide passée : « Saisir cette journée » ouvre la saisie du soir à cette date', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      c.$('#heatmap .cal-d[data-date="2026-10-12"]').click();
      assert.match(c.$('#calDetail').textContent, /Aucune journée enregistrée/);
      c.$('#calAdd').click(); await c.until(() => !c.$('#evening').hidden);
      assert.equal(c.$('#ev_date').value, '2026-10-12');
    } finally { c.close(); }
  });
  test('flèches du clavier : un jour à gauche ou à droite, une semaine en haut ou en bas, même d’un mois à l’autre', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      const key = k => c.$('#heatmap .cal').dispatchEvent(new c.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      key('ArrowRight'); assert.equal(c.$('#heatmap .cal-d.sel').dataset.date, '2026-10-16');
      assert.equal(c.d.activeElement.dataset.date, '2026-10-16', 'le focus suit la sélection');
      key('ArrowUp'); key('ArrowUp'); key('ArrowUp'); assert.equal(c.$('#heatmap .cal-d.sel').dataset.date, '2026-09-25');
      assert.equal(c.$('#heatmap .cal-title').textContent, 'septembre 2026');
    } finally { c.close(); }
  });
  test('journée saisie sans facture : marquée « en attente »', async () => {
    const st = localState(); st.days.push({ date: '2026-10-13', driver: 'yacine', parcels: 175, invoiced: 0, km: 300, fuel: 50, source: 'saisie' });
    const c = await boot({ now: NOW, noHistory: true, localState: st });
    try {
      await enter(c, 'dash');
      const b = c.$('#heatmap .cal-d[data-date="2026-10-13"]');
      assert.ok(b.classList.contains('pending')); assert.match(b.getAttribute('aria-label'), /facturé en attente/);
      assert.match(NB(c.$('#heatmap .cal-sum').textContent), /1 en attente de facture/);
    } finally { c.close(); }
  });
});

describe('numéros de semaine et vue « Semaines »', () => {
  test('isoWeek : numéros ISO, comme les factures Intelcom', async () => {
    const c = await boot({ now: NOW, noHistory: true });
    try {
      const W = ds => JSON.parse(JSON.stringify(c.w.PYU.isoWeek(ds)));
      assert.deepEqual(W('2026-10-05'), { year: 2026, week: 41 }); // facture « 2026-41 »
      assert.deepEqual(W('2026-10-11'), { year: 2026, week: 41 }); // dimanche, même semaine
      assert.deepEqual(W('2026-01-01'), { year: 2026, week: 1 });
      assert.deepEqual(W('2025-12-29'), { year: 2026, week: 1 }); // lundi de la semaine 1 de 2026
      assert.deepEqual(W('2027-01-01'), { year: 2026, week: 53 });
    } finally { c.close(); }
  });
  test('vue « Mois » : chaque ligne porte son numéro de semaine', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      const nums = [...c.$('#heatmap').querySelectorAll('.cal-row:not(.cal-wd) .cal-wn')].map(x => x.textContent);
      assert.deepEqual(nums, ['S40', 'S41', 'S42', 'S43', 'S44']);
    } finally { c.close(); }
  });
  test('bascule vers « Semaines » : 12 lignes, la plus récente en haut, net lisible par jour et total, choix mémorisé', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      c.$('#heatmap [data-view="wall"]').click();
      assert.equal(c.$('#heatmap [data-view="wall"]').getAttribute('aria-pressed'), 'true');
      assert.equal(c.w.localStorage.getItem('py-cal-view'), 'wall');
      const rows = [...c.$('#heatmap').querySelectorAll('.wall-row:not(.wall-head)')];
      assert.equal(rows.length, 12);
      assert.match(rows[0].querySelector('.wall-wk').textContent, /^S4212 au 18 oct\.$/);
      assert.match(NB(rows[1].querySelector('.wall-wk').textContent), /^S415 au 11 oct\.$/);
      const mon = rows[1].querySelector('.cal-d[data-date="2026-10-05"]');
      assert.equal(mon.querySelector('.amt').textContent, '300'); assert.ok(/lv\d/.test(mon.className));
      assert.match(NB(rows[1].querySelector('.wall-tot').textContent), /1 200 \$4 j · 720 colis/);
      assert.ok(rows[1].querySelector('.wall-tot').classList.contains('ok'));
      assert.match(NB(c.$('#heatmap .cal-sum').textContent), /8 semaines sur 11 à 4 jours ou plus/);
      c.$('#wallMore').click(); assert.equal(c.$('#heatmap').querySelectorAll('.wall-row:not(.wall-head)').length, 24);
    } finally { c.close(); }
  });
  test('mur : toucher une semaine l’ouvre dans le mois ; toucher un jour affiche son détail ; flèche du bas recule d’une semaine', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState(), storage: { 'py-cal-view': 'wall' } });
    try {
      await enter(c, 'dash');
      assert.ok(c.$('#heatmap .wall'), 'vue mémorisée au rechargement');
      c.$('#heatmap .cal-d[data-date="2026-09-29"]').click();
      assert.match(c.$('#calDetail').textContent, /mardi 29 septembre 2026/i);
      c.$('#heatmap .cal').dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      assert.equal(c.$('#heatmap .cal-d.sel').dataset.date, '2026-09-22');
      c.$('#heatmap [data-week="2026-09-28"]').click();
      assert.ok(!c.$('#heatmap .wall')); assert.equal(c.$('#heatmap .cal-title').textContent, 'septembre 2026');
      assert.equal(c.$('#heatmap .cal-d.sel').dataset.date, '2026-09-28');
    } finally { c.close(); }
  });
});
