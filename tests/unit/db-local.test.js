// Couche de données en mode local (stockage du navigateur). Les mêmes règles valent pour Supabase :
// une journée par date, un colis par numéro de suivi, l'import d'une facture ne détruit jamais une saisie km/essence.
'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { load, memStorage, plain } = require('../helpers/sandbox');
const inv = require('../helpers/invoice');

let w, DB, ls;
beforeEach(() => { ls = memStorage(); w = load(['util', 'data', 'db'], { localStorage: ls }); DB = w.PYDB; });
const state = () => JSON.parse(ls.getItem('pilote-yacine-v2'));

describe('mode', () => {
  test('sans configuration Supabase le site est en mode local, connecté d’office', () => {
    assert.equal(DB.online, false); assert.equal(DB.mode(), 'local'); assert.equal(DB.isConnected(), true);
  });
  test('login accepte n’importe quel PIN en local', async () => { assert.equal(await DB.login('0000'), true); });
  test('localités : repli sur la liste embarquée', async () => {
    const l = await DB.getLocalities(); assert.ok(l.length > 10); assert.ok(l.every(x => x.code && x.name));
  });
});

describe('journées', () => {
  test('upsertDay crée puis remplace la journée de la même date', async () => {
    await DB.upsertDay({ date: '2026-10-13', parcels: 170, invoiced: 360, km: 310, fuel: 55 });
    await DB.upsertDay({ date: '2026-10-13', parcels: 175, invoiced: 370 });
    const days = await DB.getDays();
    assert.equal(days.length, 1); assert.equal(days[0].parcels, 175); assert.equal(days[0].source, 'saisie'); assert.equal(days[0].driver, 'yacine');
  });
  test('deleteDay', async () => {
    await DB.upsertDay({ date: '2026-10-13', parcels: 1, invoiced: 1 }); await DB.deleteDay('2026-10-13');
    assert.equal((await DB.getDays()).length, 0);
  });
});

describe('import de facture', () => {
  const fx = inv.typicalWeek();
  const parsed = () => { const g = load(['util', 'tariffs', 'pdf-import']); return g.PYPDF.parseLines(fx.lines); };
  test('enregistre la facture, ses colis et ses journées (source facture)', async () => {
    const r = parsed(); await DB.importInvoice(r.inv, r.parcels, r.days);
    const s = state();
    assert.equal(s.invoices.length, 1); assert.equal(s.invoices[0].week, '2026-41'); assert.equal(s.invoices[0].driver, 'yacine');
    assert.equal(s.parcels.length, r.parcels.length);
    assert.equal(s.days.length, 4); assert.ok(s.days.every(d => d.source === 'facture'));
  });
  test('idempotent : réimporter la même facture ne duplique rien', async () => {
    const r = parsed(); await DB.importInvoice(r.inv, r.parcels, r.days); await DB.importInvoice(r.inv, r.parcels, r.days);
    const s = state(); assert.equal(s.invoices.length, 1); assert.equal(s.parcels.length, r.parcels.length); assert.equal(s.days.length, 4);
  });
  test('une journée saisie le soir garde km, essence, note et localité ; colis et facturé viennent de la facture', async () => {
    await DB.upsertDay({ date: '2026-10-06', parcels: 168, invoiced: 350, km: 312, fuel: 58.2, loc: 'J0H1A0', note: 'pluie' });
    const r = parsed(); await DB.importInvoice(r.inv, r.parcels, r.days);
    const d = (await DB.getDays()).find(x => x.date === '2026-10-06');
    assert.equal(d.parcels, 170); assert.equal(d.invoiced, r.days[0].invoiced);
    assert.equal(d.km, 312); assert.equal(d.fuel, 58.2); assert.equal(d.note, 'pluie'); assert.equal(d.loc, 'J0H1A0', 'la localité saisie prime sur celle déduite');
    assert.equal(d.source, 'facture', 'la journée est désormais confirmée par la facture');
  });
  test('saveAudit attache l’audit à la facture', async () => {
    const r = parsed(); await DB.importInvoice(r.inv, r.parcels, r.days);
    await DB.saveAudit('2026-41', { issues: [], ok: ['x'] });
    assert.deepEqual(plain((await DB.getInvoices())[0].audit), { issues: [], ok: ['x'] });
  });
  test('getParcelsSince filtre par date', async () => {
    const r = parsed(); await DB.importInvoice(r.inv, r.parcels, r.days);
    const since = await DB.getParcelsSince('2026-10-09');
    assert.ok(since.length > 0); assert.ok(since.every(p => p.date >= '2026-10-09'));
  });
});

describe('shifts', () => {
  test('un shift par date, lecture par date et depuis une date', async () => {
    await DB.upsertShift({ date: '2026-10-13', route_type: 'loin', goal_parcels: 180 });
    await DB.upsertShift({ date: '2026-10-13', route_type: 'rural', goal_parcels: 170 });
    await DB.upsertShift({ date: '2026-10-14', route_type: 'urbain', goal_parcels: 200 });
    assert.equal((await DB.getShift('2026-10-13')).goal_parcels, 170);
    assert.equal((await DB.getShifts('2026-10-14')).length, 1);
    assert.equal(await DB.getShift('2026-01-01'), null);
  });
});

describe('épargne et budget', () => {
  test('getSavings crée les quatre projets par défaut, la voiture en priorité 1', async () => {
    const s = await DB.getSavings();
    assert.deepEqual(plain(s.goals.map(g => g.kind)), ['voiture', 'impot', 'urgence', 'van']);
    assert.equal(s.goals[0].priority, 1); assert.equal(s.budget.rent, 300); assert.equal(s.budget.tax_rate, 0.2);
  });
  test('addContribution augmente l’épargne et journalise à la date locale du jour', async () => {
    await DB.getSavings();
    await DB.addContribution('voiture', 120.5, 'paie 41'); await DB.addContribution('voiture', 79.5);
    const s = await DB.getSavings();
    assert.equal(s.goals.find(g => g.id === 'voiture').saved, 200);
    assert.equal(s.log.length, 2); assert.equal(s.log[0].amount, 79.5); assert.equal(s.log[1].note, 'paie 41');
    assert.equal(s.log[0].date, w.PYU.today());
  });
  test('upsertSavingsGoal remplace par id, deleteSavingsGoal retire', async () => {
    await DB.getSavings();
    await DB.upsertSavingsGoal({ id: 'voiture', name: 'Civic', kind: 'voiture', target: 9000, saved: 100, priority: 1, active: true });
    assert.equal((await DB.getSavings()).goals.find(g => g.id === 'voiture').target, 9000);
    await DB.deleteSavingsGoal('van');
    assert.ok(!(await DB.getSavings()).goals.find(g => g.id === 'van'));
  });
  test('saveBudget', async () => {
    await DB.saveBudget({ rent: 350, fixed: 200, living: 450, tax_rate: 0.22, weeks_per_month: 4.33 });
    assert.equal((await DB.getSavings()).budget.rent, 350);
  });
});

describe('sauvegarde et restauration', () => {
  test('exportLocal puis importLocal restituent les données ; un format inconnu est refusé', async () => {
    await DB.upsertDay({ date: '2026-10-13', parcels: 170, invoiced: 360 });
    const txt = DB.exportLocal(); ls.clear();
    DB.importLocal(txt);
    assert.equal((await DB.getDays())[0].parcels, 170);
    assert.throws(() => DB.importLocal('{"x":1}'), /format/);
  });
});
