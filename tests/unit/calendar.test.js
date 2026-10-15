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
