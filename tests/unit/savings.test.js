// Moteur d'épargne : capacité hebdomadaire à partir des semaines réelles, répartition par priorité,
// date prévue, suggestion du soir, prévision de fin de mois. Données régulières pour des attendus exacts.
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, enter } = require('../helpers/dom');
const { localState } = require('../helpers/data');

const near = (a, b, eps = 0.01, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' attendu ' + b + ', obtenu ' + a);
const NOW = '2026-10-15T09:00:00-04:00';

describe('capacité hebdomadaire (8 semaines à 4 jours, 400 $ facturés et 50 $ d’essence par jour)', () => {
  let c, PYS;
  before(async () => { c = await boot({ now: NOW, noHistory: true, localState: localState() }); PYS = c.w.PYS; });
  after(() => c.close());

  test('net = jours × facturé × 75 %, puis essence, impôt 20 %, loyer et vie / 4,33', () => {
    const cap = PYS.capacity();
    assert.equal(cap.dpw, 4); assert.equal(cap.avgDay, 400);
    near(cap.netWeek, 1200); near(cap.fuelWeek, 200); near(cap.taxWeek, 240); near(cap.livingWeek, 1050 / 4.33);
    near(cap.free, 1200 - 200 - 240 - 1050 / 4.33); assert.equal(cap.free, cap.rawFree);
  });
  test('un jour de plus par semaine', () => {
    const cap = PYS.capacity(5);
    near(cap.netWeek, 1500); near(cap.fuelWeek, 250); near(cap.free, 1500 - 250 - 300 - 1050 / 4.33);
  });
  test('répartition : la voiture (priorité 1) prend tout tant qu’elle n’est pas financée, l’impôt n’est jamais servi', () => {
    const cap = PYS.capacity(); const alloc = PYS.allocate(cap.free);
    near(alloc.voiture, cap.free); assert.equal(alloc.impot, undefined); assert.equal(alloc.urgence, undefined); assert.equal(alloc.van, undefined);
  });
  test('répartition : le reste descend à la priorité suivante quand la cible est presque atteinte', async () => {
    await c.w.PYDB.upsertSavingsGoal({ id: 'voiture', name: 'Ma voiture', kind: 'voiture', target: 8000, saved: 7900, priority: 1, active: true });
    await PYS.load();
    const cap = PYS.capacity(); const alloc = PYS.allocate(cap.free);
    near(alloc.voiture, 100); near(alloc.urgence, cap.free - 100); assert.equal(alloc.van, undefined);
    await c.w.PYDB.upsertSavingsGoal({ id: 'voiture', name: 'Ma voiture', kind: 'voiture', target: 8000, saved: 0, priority: 1, active: true }); await PYS.load();
  });
  test('répartition : deux projets de même priorité se partagent à parts égales', async () => {
    await c.w.PYDB.upsertSavingsGoal({ id: 'moto', name: 'Moto', kind: 'autre', target: 5000, saved: 0, priority: 1, active: true });
    await PYS.load();
    const cap = PYS.capacity(); const alloc = PYS.allocate(cap.free);
    near(alloc.voiture, cap.free / 2); near(alloc.moto, cap.free / 2);
    await c.w.PYDB.deleteSavingsGoal('moto'); await PYS.load();
  });
  test('suggestion du soir : impôt 20 % du net, part de loyer du jour, le reste pour la voiture', () => {
    const sg = PYS.eveningSuggestion(300, 50);
    near(sg.tax, 60); near(sg.free, 300 - 50 - 60 - (1050 / 4.33) / 4); near(sg.car, sg.free); assert.equal(sg.carGoal.id, 'voiture');
  });
  test('rendu : tuile voiture avec semaines restantes et date, tuiles de capacité', async () => {
    await enter(c, 'goals');
    const cap = PYS.capacity(); const weeks = Math.ceil(8000 / cap.free);
    const tile = c.$('#carTile .tile.car'); assert.ok(tile);
    assert.match(tile.textContent, new RegExp(weeks + ' sem\\. restantes'));
    assert.match(tile.querySelector('.val').textContent, /^0 \$$/);
    const tiles = [...c.$('#savings .tiles').querySelectorAll('.tile .lab')].map(e => e.textContent);
    assert.deepEqual(JSON.parse(JSON.stringify(tiles)), ['Net par semaine', 'Essence', 'Réserve impôt et RRQ', 'Loyer et vie courante', 'Disponible pour les projets']);
    assert.equal(c.$('#savings .proj.voiture .pill').textContent, 'priorité 1');
  });
});

describe('cas limites', () => {
  test('budget en déficit : disponible 0, projets non servis, message explicite', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState({ budget: { living: 5000 } }) });
    try {
      const cap = c.w.PYS.capacity(); assert.equal(cap.free, 0); assert.ok(cap.rawFree < 0);
      assert.deepEqual(JSON.parse(JSON.stringify(c.w.PYS.allocate(cap.free))), {});
      await enter(c, 'goals');
      assert.match(c.$('#savings').textContent, /budget en déficit de/);
      assert.match(c.$('#carTile').textContent, /augmenter les jours travaillés/);
    } finally { c.close(); }
  });
  test('sans aucune journée : valeurs de repli (367 $ facturés, 4 jours, essence 60 $)', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState({ weeks: { nWeeks: 0 } }) });
    try {
      const cap = c.w.PYS.capacity(); assert.equal(cap.avgDay, 367); assert.equal(cap.dpw, 4); near(cap.fuelWeek, 240);
    } finally { c.close(); }
  });
  test('indépendant : part de 95 %', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState({ goals: { status: 'indep' } }) });
    try { near(c.w.PYS.capacity().netWeek, 4 * 400 * 0.95); } finally { c.close(); }
  });
});

describe('prévision de fin de mois et mur des semaines', () => {
  test('déjà net ce mois, jours restants, journées nécessaires', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      const t = c.$('#forecast').textContent.replace(/ /g, ' ');
      assert.match(t, /Déjà net ce mois1 500 \$ \(5 j\)/); // 1er, 5, 6, 7 et 8 octobre à 300 $ net
      assert.match(t, /Jours restants16/);
      assert.match(t, /il faut 10 j au total/); // (4300 − 1500) / 300
    } finally { c.close(); }
  });
  test('mur des 26 dernières semaines : une case par jour, les journées travaillées sont colorées et datées', async () => {
    const c = await boot({ now: NOW, noHistory: true, localState: localState() });
    try {
      await enter(c, 'dash');
      const cells = [...c.$('#heatmap').querySelectorAll('.hcol i')];
      assert.ok(cells.length >= 26 * 7);
      const worked = cells.filter(i => !i.classList.contains('l0'));
      assert.equal(worked.length, 32);
      assert.ok(worked.every(i => /^\d{4}-\d{2}-\d{2} : 180 colis, 400,00 \$$/.test(i.title.replace(/ /g, ' '))));
      assert.ok(worked.find(i => i.title.startsWith('2026-10-08')), 'la dernière journée est à la bonne date locale');
    } finally { c.close(); }
  });
});

describe('formulaires d’épargne', () => {
  let c;
  before(async () => { c = await boot({ now: NOW, noHistory: true, localState: localState() }); await enter(c, 'goals'); });
  after(() => c.close());
  const submit = (sel) => { c.$(sel).dispatchEvent(new c.w.Event('submit', { cancelable: true })); return c.until(() => c.$('#modal').hidden); };

  test('nouveau projet puis modification puis suppression', async () => {
    c.$('#btnNewGoal').click(); assert.equal(c.$('#modal').hidden, false);
    c.$('#g2_name').value = 'Permis de classe 3'; c.$('#g2_kind').value = 'autre'; c.$('#g2_target').value = '900'; c.$('#g2_saved').value = '100'; c.$('#g2_prio').value = '2'; c.$('#g2_note').value = 'pour le van';
    await submit('#goalForm2');
    assert.equal(c.$('#modal').hidden, true);
    let g = c.w.PYS.goals.find(x => x.name === 'Permis de classe 3');
    assert.ok(g); assert.equal(g.target, 900); assert.equal(g.saved, 100); assert.equal(g.priority, 2); assert.equal(g.note, 'pour le van');
    assert.match(c.$('#savings').textContent, /Permis de classe 3/);
    c.$(`[data-edit="${g.id}"]`).click(); c.$('#g2_target').value = '1200'; await submit('#goalForm2');
    g = c.w.PYS.goals.find(x => x.name === 'Permis de classe 3'); assert.equal(g.target, 1200);
    c.$(`[data-edit="${g.id}"]`).click(); c.$('#g2_del').click(); await c.until(() => !c.w.PYS.goals.find(x => x.name === 'Permis de classe 3'));
    assert.ok(!c.w.PYS.goals.find(x => x.name === 'Permis de classe 3'));
  });
  test('budget : loyer, fixes, vie courante, taux d’impôt', async () => {
    c.$('#btnBudget').click(); assert.equal(c.$('#b_rent').value, '300');
    c.$('#b_rent').value = '350'; c.$('#b_fixed').value = '200'; c.$('#b_living').value = '450'; c.$('#b_tax').value = '25';
    await submit('#budgetForm');
    const b = (await c.w.PYDB.getSavings()).budget;
    assert.equal(b.rent, 350); assert.equal(b.tax_rate, 0.25); assert.equal(b.weeks_per_month, 4.33);
    near(c.w.PYS.capacity().taxWeek, 1200 * 0.25); near(c.w.PYS.capacity().livingWeek, 1000 / 4.33);
  });
  test('versement manuel depuis la liste des projets', async () => {
    c.$('[data-contrib="urgence"]').click(); c.$('#c_amt').value = '75'; c.$('#c_note').value = 'bonus';
    await submit('#contribForm');
    const s = await c.w.PYDB.getSavings();
    assert.equal(s.goals.find(g => g.id === 'urgence').saved, 75); assert.equal(s.log[0].note, 'bonus');
    assert.match(c.$('#savings table').textContent, /bonus/);
  });
});
