// En tournée : suppression réversible, versement unique malgré deux appuis, saisie du soir à une autre date,
// shift oublié la veille, sauvegarde des données, tableaux lisibles sur téléphone. Chaque test échouait avant.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const NOW = '2026-10-15T21:00:00-04:00';
const saved = c => JSON.parse(c.w.localStorage.getItem('pilote-yacine-v2'));

describe('journal', () => {
  test('supprimer une journée puis « Annuler » la remet telle quelle', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'log');
      const before = saved(c).days.find(d => d.date === '2026-10-08');
      c.$('[data-del="2026-10-08"]').click(); await c.until(() => !saved(c).days.find(d => d.date === '2026-10-08'));
      await c.until(() => c.$('#toast button')); const undo = c.$('#toast button'); assert.equal(undo.textContent, 'Annuler');
      undo.click(); await c.until(() => saved(c).days.find(d => d.date === '2026-10-08'));
      assert.deepEqual(saved(c).days.find(d => d.date === '2026-10-08'), before);
      await c.until(() => c.w.PYAPP.S.days.find(d => d.date === '2026-10-08')); await c.tick(50);
    } finally { c.close(); }
  });
  test('toucher une journée la charge dans le formulaire, qui propose de la supprimer', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'log'); assert.equal(c.$('#f_del').hidden, true);
      c.$('#logTable tr[data-day="2026-10-07"] td').click();
      assert.equal(c.$('#f_date').value, '2026-10-07'); assert.equal(c.$('#f_km').value, '300'); assert.equal(c.$('#f_del').hidden, false);
      c.$('#f_del').click(); await c.until(() => !saved(c).days.find(d => d.date === '2026-10-07'));
      await c.until(() => c.$('#toast button')); assert.equal(c.$('#f_del').hidden, true);
      await c.tick(50);
    } finally { c.close(); }
  });
  test('sur téléphone, les colonnes secondaires sont marquées pour céder la place', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'log');
      assert.ok(c.$('#logTable').classList.contains('fit')); assert.ok(c.$('#lastDays').classList.contains('fit'));
      assert.deepEqual([...c.$('#logTable tr').querySelectorAll('th.hide-sm')].map(t => t.textContent), ['Zone', 'Km', 'Note', '']);
      assert.match(c.$('#logTable [data-del]').getAttribute('aria-label'), /Supprimer la journée du/);
    } finally { c.close(); }
  });
  test('sauvegarde téléchargée puis restaurée (mode local)', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      let blob = null; c.w.URL.createObjectURL = b => { blob = b; return 'blob:x'; }; c.w.URL.revokeObjectURL = () => {};
      c.w.HTMLAnchorElement.prototype.click = function () {};
      await enter(c, 'log'); c.$('#btnExport').click();
      assert.ok(blob, 'un fichier est proposé');
      const text = await new Promise(r => { const fr = new c.w.FileReader(); fr.onload = () => r(fr.result); fr.readAsText(blob); });
      assert.equal(JSON.parse(text).days.length, 32);
      assert.equal(c.$('#restoreWrap').hidden, false);
      c.w.localStorage.setItem('pilote-yacine-v2', JSON.stringify({ days: [], parcels: [], invoices: [], goals: {}, localities: [] }));
      const inp = c.$('#restoreFile'); Object.defineProperty(inp, 'files', { value: [new c.w.File([text], 'sauvegarde.json')], configurable: true });
      inp.dispatchEvent(new c.w.Event('change')); await c.until(() => saved(c).days.length === 32);
      await c.until(() => c.w.PYAPP.S.days.length === 32);
    } finally { c.close(); }
  });
});

describe('épargne', () => {
  test('deux appuis rapides sur « Enregistrer » ne versent qu’une fois', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'goals'); c.w.PYS.openContrib('voiture', 100);
      const f = c.$('#contribForm'); f.dispatchEvent(new c.w.Event('submit', { cancelable: true })); f.dispatchEvent(new c.w.Event('submit', { cancelable: true }));
      await c.until(() => c.$('#modal').hidden); await c.tick(20);
      assert.equal(saved(c).savingsLog.length, 1); assert.equal(saved(c).savings.find(g => g.id === 'voiture').saved, 100);
    } finally { c.close(); }
  });
});

describe('saisie du soir', () => {
  test('après minuit, on choisit la journée d’hier et la saisie y tombe', async () => {
    const c = await boot({ now: '2026-10-16T00:40:00-04:00', noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash'); await c.w.PYF.openEvening();
      const dt = c.$('#ev_date'); assert.equal(dt.type, 'date'); assert.equal(dt.value, '2026-10-16');
      dt.value = '2026-10-15'; dt.dispatchEvent(new c.w.Event('change')); await c.until(() => /jeudi 15 octobre/.test(c.$('#ev_eyebrow').textContent));
      c.$('#ev_parcels').value = '175'; c.$('#ev_km').value = '320'; c.$('#ev_fuel').value = '58';
      c.$('#eveningForm').dispatchEvent(new c.w.Event('submit', { cancelable: true }));
      await c.until(() => saved(c).days.find(d => d.date === '2026-10-15'));
      const d = saved(c).days.find(x => x.date === '2026-10-15'); assert.equal(d.parcels, 175); assert.equal(d.km, 320);
      await c.until(() => c.$('#ev_result').textContent); await c.tick(50);
      assert.equal(saved(c).days.find(x => x.date === '2026-10-16'), undefined);
    } finally { c.close(); }
  });
  test('un shift oublié la veille est proposé à la saisie au lieu d’être perdu', async () => {
    const shift = JSON.stringify({ date: '2026-10-14', km: 287.4, last: null, start: Date.parse('2026-10-14T08:00:00-04:00') });
    const c = await boot({ now: '2026-10-15T07:30:00-04:00', noHistory: true, localState: localState(), storage: { 'py-shift': shift } });
    try {
      await enter(c, 'dash'); c.w.PYF.resumeShift();
      const bar = c.$('#shiftBar'); assert.equal(bar.hidden, false); assert.match(bar.textContent, /Shift du mercredi 14 octobre pas terminé/);
      assert.equal(c.geo.watching, 0, 'pas de GPS relancé pour un shift d’hier');
      c.$('#btnEndShift').click(); await c.until(() => !c.$('#evening').hidden);
      assert.equal(c.$('#ev_date').value, '2026-10-14'); assert.equal(c.$('#ev_km').value, '287');
    } finally { c.close(); }
  });
});
