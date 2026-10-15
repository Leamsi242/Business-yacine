// Chiffres justes : série de semaines commune à tous les écrans, journées sans facturé hors des moyennes,
// une seule source pour l'épargne du van, zéros respectés, pagination Supabase. Chaque test échouait avant.
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, enter } = require('../helpers/dom');
const { localState, regularWeeks } = require('../helpers/data');

const plain = x => JSON.parse(JSON.stringify(x));
const NB = s => s.replace(/[  ]/g, ' ');
const tileVal = (c, root, lab) => { const t = [...c.$(root).querySelectorAll('.tile')].find(x => x.querySelector('.lab').textContent.includes(lab)); return t ? NB(t.querySelector('.val').textContent) : null; };

describe('série de semaines', () => {
  test('lundi soir avec une journée faite : la série ne retombe pas à zéro, et tous les écrans disent pareil', async () => {
    const st = localState(); st.days.push({ date: '2026-10-12', driver: 'yacine', parcels: 180, invoiced: 400, km: 300, fuel: 50, source: 'saisie' });
    const c = await boot({ now: '2026-10-12T20:00:00-04:00', noHistory: true, localState: st });
    try {
      await enter(c, 'goals');
      assert.match(NB(c.$('#goalDetail').textContent), /Semaines consécutives à 4 jours ou plus8 /);
      assert.match(c.$('#mission').textContent, /série : 8 semaines/);
      assert.match(c.$('#vanCountdown').textContent, /8 \/ 12/);
      assert.equal(c.w.PYAPP.streak(), 8);
    } finally { c.close(); }
  });
  test('une semaine de congé casse la série', async () => {
    const st = localState(); st.days = st.days.filter(d => d.date < '2026-09-14' || d.date > '2026-09-20');
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true, localState: st });
    try {
      assert.equal(c.w.PYAPP.streak(), 3, 'semaines du 21 sept., du 28 sept. et du 5 oct.');
      await enter(c, 'goals');
      assert.match(NB(c.$('#goalDetail').textContent), /Semaines réussies sur les 8 dernières7 \/ 8/);
    } finally { c.close(); }
  });
  test('la semaine en cours compte dès qu’elle est réussie', () => {
    const days = regularWeeks({ until: '2026-10-18', nWeeks: 3 });
    return boot({ now: '2026-10-15T21:00:00-04:00', noHistory: true }).then(c => {
      try { assert.equal(c.w.PYU.streak(days, 4, '2026-10-15'), 3); assert.equal(c.w.PYU.streak(days, 5, '2026-10-15'), 0); } finally { c.close(); }
    });
  });
});

describe('semaines sans travail', () => {
  test('byWeek montre la semaine vide au lieu de la sauter', async () => {
    const c = await boot({ now: '2026-10-25T09:00:00-04:00', noHistory: true });
    try {
      const w = c.w.PYAPP.byWeek([{ date: '2026-10-06', parcels: 100, invoiced: 200 }, { date: '2026-10-20', parcels: 100, invoiced: 250 }]);
      assert.deepEqual(plain(w.map(x => [x.wk, x.days])), [['2026-10-05', 1], ['2026-10-12', 0], ['2026-10-19', 1]]);
    } finally { c.close(); }
  });
});

describe('journée saisie le soir, facture pas encore importée', () => {
  test('le revenu par jour ne baisse pas et la journée est marquée « en attente »', async () => {
    const st = localState(); st.days.push({ date: '2026-10-13', driver: 'yacine', parcels: 180, invoiced: 0, km: 310, fuel: 55, source: 'saisie' });
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true, localState: st });
    try {
      await enter(c, 'dash');
      assert.equal(tileVal(c, '#kpis', 'Par jour travaillé'), '300 $');
      assert.equal(c.w.PYAPP.avgInvoiced(), 400);
      assert.match(c.$('#lastDays').textContent, /en attente/);
      assert.match(NB(c.$('#kpis').textContent), /1 en attente de facture/);
      assert.equal(c.w.PYS.capacity().avgDay, 400);
    } finally { c.close(); }
  });
});

describe('épargne du van : une seule source', () => {
  test('objectifs, compte à rebours et projet affichent la même épargne et une vraie date', async () => {
    const st = localState(); st.savings.find(g => g.id === 'van').saved = 1000;
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true, localState: st });
    try {
      await enter(c, 'goals');
      assert.match(NB(c.$('#goalDetail').textContent), /Reste avant la mise de fonds du van \(8 000 \$\)7 000 \$/);
      assert.equal(tileVal(c, '#vanCountdown', 'Reste avant la mise de fonds'), '7 000 $');
      assert.notEqual(tileVal(c, '#vanCountdown', 'Mise de fonds prévue'), 'jamais');
      const van = [...c.$('#savings').querySelectorAll('.proj')].find(p => /Van/.test(p.textContent));
      assert.doesNotMatch(van.textContent, /jamais/, 'le van démarre quand la voiture et le coussin sont payés');
      const plan = c.w.PYS.vanPlan(8000); assert.equal(plan.saved, 1000); assert.ok(isFinite(plan.weeks) && plan.weeks > 0);
      assert.match(NB(c.$('#st0').textContent), /1 000 \$\/8 000 \$/);
    } finally { c.close(); }
  });
});

describe('zéros et arrondis', () => {
  test('simulateur : 28 % s’affiche « 28 % »', async () => {
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true });
    try {
      const r = c.$('#s_cut'); r.value = '28'; r.dispatchEvent(new c.w.Event('input'));
      assert.equal(NB(c.$('#o_cut').value), '28 %');
      assert.match(NB(c.$('#simOut').textContent), /Net chez le broker \(28 %\)/);
    } finally { c.close(); }
  });
  test('commission à 0 % et réserve d’impôt à 0 % sont gardées', async () => {
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true, localState: localState() });
    try {
      await enter(c, 'goals');
      c.$('#g_cut').value = '0';
      c.$('#goalForm').dispatchEvent(new c.w.Event('submit', { cancelable: true })); await c.until(() => c.w.PYAPP.S.goals.cut === 0);
      assert.equal(c.w.PYAPP.share(), 1);
      c.$('#btnBudget').click(); c.$('#b_tax').value = '0';
      c.$('#budgetForm').dispatchEvent(new c.w.Event('submit', { cancelable: true })); await c.until(() => c.$('#modal').hidden);
      assert.equal(c.w.PYS.capacity().taxWeek, 0);
    } finally { c.close(); }
  });
});

describe('Supabase : lecture par pages de 1 000 lignes', () => {
  test('readAll enchaîne les pages jusqu’à la dernière', async () => {
    const c = await boot({ now: '2026-10-15T09:00:00-04:00', noHistory: true });
    try {
      const total = 2005, asked = [];
      const query = () => ({ range: async (a, b) => { asked.push([a, b]); return { data: Array.from({ length: Math.max(0, Math.min(b, total - 1) - a + 1) }, (_, i) => a + i), error: null }; } });
      const rows = await c.w.PYDB._readAll(query);
      assert.equal(rows.length, total); assert.deepEqual(plain(asked), [[0, 999], [1000, 1999], [2000, 2999]]);
    } finally { c.close(); }
  });
});
