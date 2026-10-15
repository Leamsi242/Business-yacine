// Parcours complets dans jsdom : navigation, brief du matin, shift GPS, saisie du soir, import de facture,
// objectifs. Se termine par le contrat de schéma : tout objet enregistré ne contient que des colonnes Supabase.
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, enter, dropPdf, ROOT } = require('../helpers/dom');
const { localState } = require('../helpers/data');
const inv = require('../helpers/invoice');

const NOW = '2026-10-15T07:30:00-04:00';
const plain = x => JSON.parse(JSON.stringify(x));
const state = c => JSON.parse(c.w.localStorage.getItem('pilote-yacine-v2'));

describe('une journée de Yacine', () => {
  let c;
  before(async () => { c = await boot({ now: NOW, noHistory: true, localState: localState() }); });
  after(() => c.close());

  test('accueil puis application : onglets, section visible, bouton Plus', async () => {
    assert.equal(c.$('#landing').hidden, false); assert.equal(c.$('#app').hidden, true);
    assert.equal(c.$('#signDest').children.length, 0, 'sans historique le panneau de destinations est vide');
    c.w.localStorage.setItem('py-brief-2026-10-15', '1'); // pour ce test seulement
    c.$('#btnExplore').click(); await c.tick(5);
    assert.equal(c.$('#app').hidden, false); assert.equal(c.$('#v-dash').hidden, false);
    c.w.PYAPP.goTab('goals'); assert.equal(c.$('#v-dash').hidden, true); assert.equal(c.$('#v-goals').hidden, false);
    assert.equal(c.w.localStorage.getItem('py-tab'), 'goals');
    const more = c.$('nav.tabs .more'); more.click(); assert.equal(more.getAttribute('aria-expanded'), 'true');
    c.$('nav.tabs button[data-v="tips"]').click(); assert.equal(more.getAttribute('aria-expanded'), 'false'); assert.equal(c.$('#v-tips').hidden, false);
    assert.equal(c.$('#advice .a') != null, true, 'les conseils sont rendus');
    c.w.localStorage.removeItem('py-brief-2026-10-15');
  });

  test('brief du matin : 4 étapes, choix de route, objectif chiffré, puis le shift démarre', async () => {
    await c.w.PYF.openBrief(true); await c.tick(5);
    assert.equal(c.$('#brief').hidden, false);
    assert.equal(c.$('#briefDots').children.length, 4);
    assert.match(c.$('#briefBody').textContent, /Bonjour Yacine/);
    assert.match(c.$('#briefBody').textContent.replace(/\u00a0/g, ' '), /Ma voiture : 0 \$ sur 8 000 \$\. Aujourd'hui rapproche la voiture d'environ 129 \$, il reste 62 journées/, 'la voiture apparaît dès le premier écran');
    c.$('#briefNext').click(); await c.tick(5);
    c.$('#briefBody').querySelector('[data-route="loin"]').click(); await c.tick(5);
    assert.ok(c.$('#briefBody [data-route="loin"]').classList.contains('on'));
    c.$('#briefNext').click(); await c.tick(5);
    const r = c.$('#bf_parcels'); r.value = '200'; r.dispatchEvent(new c.w.Event('input')); await c.tick(5);
    const tiles = plain([...c.$('#bf_tiles').querySelectorAll('.tile .val')].map(e => e.textContent.replace(/ /g, ' ')));
    assert.deepEqual(tiles, ['580 $', '435 $', '72 $', '363 $']); // 200 × 2,90 ; × 0,75 ; 380 km × 10 L/100 × 1,90 ; différence
    c.$('#briefNext').click(); await c.tick(5);
    assert.equal(c.$('#briefNext').textContent, 'Commencer le shift');
    c.$('#briefNext').click(); await c.until(() => c.$('#brief').hidden);
    assert.equal(c.$('#brief').hidden, true);
    const sh = await c.w.PYDB.getShift('2026-10-15');
    assert.equal(sh.route_type, 'loin'); assert.equal(sh.goal_parcels, 200); assert.equal(sh.goal_invoiced, 580); assert.equal(sh.goal_net, 435);
    assert.deepEqual(plain(sh.checklist), { gps: true });
    assert.equal(c.$('#shiftBar').hidden, false); assert.equal(c.geo.watching, 1);
    assert.equal(c.w.localStorage.getItem('py-brief-2026-10-15'), '1');
  });

  test('GPS pendant le shift : les km s’accumulent, les positions imprécises et les sauts sont ignorés', async () => {
    const t0 = new c.w.Date().getTime(); const lat = 45.885, lon = -72.49;
    const kmEast = 1 / (111.32 * Math.cos(lat * Math.PI / 180)); // 1 km en degrés de longitude
    c.geo.push({ lat, lon, t: t0 });
    c.geo.push({ lat, lon: lon + kmEast, t: t0 + 60e3 });           // 1 km en 60 s : compté
    c.geo.push({ lat, lon: lon + 2 * kmEast, t: t0 + 120e3, acc: 300 }); // imprécis : ignoré
    c.geo.push({ lat: lat + 0.45, lon: lon + kmEast, t: t0 + 130e3 }); // saut de 50 km en 10 s : ignoré
    c.geo.push({ lat: lat + 0.45 + 0.00004, lon: lon + kmEast, t: t0 + 140e3 }); // 4 m de dérive : ignoré
    const sh = JSON.parse(c.w.localStorage.getItem('py-shift'));
    assert.ok(Math.abs(sh.km - 1) < 0.01, 'km = ' + sh.km);
    assert.match(c.$('#shiftBar').textContent, /1,0 km/);
  });

  test('fin du shift : saisie du soir pré-remplie, journée enregistrée, verdict et suggestion d’épargne', async () => {
    c.$('#btnEndShift').click(); await c.until(() => !c.$('#evening').hidden);
    assert.equal(c.geo.watching, 0); assert.equal(c.w.localStorage.getItem('py-shift'), null);
    assert.equal(c.$('#evening').hidden, false);
    assert.equal(c.$('#ev_km').value, '1'); assert.equal(c.$('#ev_parcels').value, '200', 'l’objectif du matin sert de valeur par défaut');
    assert.match(c.$('#ev_goal').textContent, /Objectif du matin : 200 colis, 435 \$ net/);
    c.$('#ev_parcels').value = '210'; c.$('#ev_inv').value = '600'; c.$('#ev_fuel').value = '70'; c.$('#ev_km').value = '312';
    c.$('#eveningForm').dispatchEvent(new c.w.Event('submit', { cancelable: true })); await c.until(() => c.$('#ev_result').textContent);
    const res = c.$('#ev_result').textContent.replace(/ /g, ' ');
    assert.match(res, /Objectif atteint : 210 colis \(105 %\)\. Bravo\. Net : 450 \$, après essence 380 \$\./);
    assert.match(res, /Mets 229 \$ de côté pour Ma voiture ce soir \(et 90 \$ dans la réserve d’impôt\)/);
    assert.ok(c.$('#ev_result .pill').classList.contains('good'));
    const d = c.w.PYAPP.S.days.find(x => x.date === '2026-10-15');
    assert.equal(d.parcels, 210); assert.equal(d.invoiced, 600); assert.equal(d.km, 312); assert.equal(d.fuel, 70); assert.equal(d.source, 'saisie');
    const sh = await c.w.PYDB.getShift('2026-10-15'); assert.equal(sh.km_gps, 1); assert.ok(sh.ended_at);
    c.$('#ev_contrib').click(); await c.tick(5);
    assert.equal(c.$('#evening').hidden, true); assert.equal(c.$('#modal').hidden, false); assert.equal(c.$('#c_amt').value, '229');
    c.$('#contribForm').dispatchEvent(new c.w.Event('submit', { cancelable: true })); await c.until(() => c.$('#modal').hidden);
    assert.equal((await c.w.PYDB.getSavings()).goals.find(g => g.id === 'voiture').saved, 229);
  });

  test('saisie du soir sans objectif du matin : message neutre', async () => {
    await c.w.PYF.openEvening('2026-10-14'); await c.tick(5);
    assert.equal(c.$('#ev_goal').textContent, 'Pas d’objectif fixé ce matin.');
    assert.equal(c.$('#ev_eyebrow').textContent, 'Saisie du soir · mercredi 14 octobre');
    c.w.PYF.closeEvening();
  });

  test('import de facture : statut, audit conforme, journal mis à jour', async () => {
    c.w.PYAPP.goTab('log');
    const fx = inv.typicalWeek();
    const status = (await dropPdf(c, 'facture-41.pdf', fx.lines)).replace(/\u00a0/g, ' ');
    assert.match(status, /Importé facture-41\.pdf : semaine 2026-41, 4 journées, 708 colis, total facture 1 320,66 \$/);
    assert.match(c.$('#audits').textContent, /Semaine 2026-41Conforme/);
    assert.equal(c.w.PYAPP.S.invoices.length, 1);
    assert.ok(c.w.PYAPP.S.days.find(d => d.date === '2026-10-06' && d.source === 'facture' && d.parcels === 170));
    const rows = [...c.$('#logTable').querySelectorAll('tr')].slice(1);
    assert.ok(rows.length >= 5);
  });

  test('import d’une facture qui omet une journée saisie : anomalie visible', async () => {
    const d = n => '2026-10-' + String(12 + n).padStart(2, '0');
    const fx = inv.build({ week: '2026-42', from: d(0), to: d(6), days: [inv.day(d(1), 170, 'ZONE_M', 21), inv.day(d(2), 175, 'ZONE_G', 22), inv.day(d(4), 180, 'ZONE_L', 23)] });
    await dropPdf(c, 'facture-42.pdf', fx.lines);
    const a = c.$('#audits').textContent;
    assert.match(a, /Semaine 2026-421 anomalie/);
    assert.match(a, /Journée saisie le 2026-10-15 \(210 colis\) absente de la facture/);
  });

  test('un PDF qui n’est pas une facture est refusé sans rien enregistrer', async () => {
    const before = c.w.PYAPP.S.invoices.length;
    const status = await dropPdf(c, 'credit.pdf', inv.creditMemoLines());
    assert.match(status, /ne ressemble pas à une facture/);
    assert.equal(c.w.PYAPP.S.invoices.length, before);
  });

  test('objectifs : le formulaire met à jour la part et les cibles', async () => {
    c.w.PYAPP.goTab('goals');
    c.$('#g_days').value = '5'; c.$('#g_net').value = '5000'; c.$('#g_status').value = 'indep'; c.$('#g_fuel').value = '65'; c.$('#g_cut').value = '25';
    c.$('#goalForm').dispatchEvent(new c.w.Event('submit', { cancelable: true })); await c.until(() => c.w.PYAPP.S.goals.days === 5);
    assert.equal(c.w.PYAPP.S.goals.days, 5); assert.equal(c.w.PYAPP.S.goals.net, 5000); assert.equal(c.w.PYAPP.share(), 0.95);
    assert.match(c.$('#mission').textContent, /Travailler 5 jours/);
    assert.ok(c.$('#vanCountdown .tile'), 'compte à rebours van rendu');
    assert.equal(c.errors.length, 0, 'aucune erreur JavaScript pendant le parcours : ' + c.errors.map(e => e.message || e).join(' ; '));
  });

  describe('contrat de schéma : chaque objet enregistré n’a que des colonnes connues de Supabase', () => {
    const columns = () => {
      const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
      const cols = {};
      for (const m of sql.matchAll(/create table if not exists (\w+)\s*\(([\s\S]*?)\);/g)) {
        cols[m[1]] = new Set(m[2].split('\n').map(l => l.trim().replace(/,$/, '')).filter(l => l && !/^(primary key|unique|constraint|check\s*\(|foreign)/i.test(l)).map(l => l.split(/\s+/)[0]));
      }
      for (const m of sql.matchAll(/alter table (\w+) add column if not exists (\w+)/g)) (cols[m[1]] = cols[m[1]] || new Set()).add(m[2]);
      return cols;
    };
    const check = (table, rows, ignore = []) => { const cols = columns()[table]; assert.ok(cols, 'table ' + table); rows.forEach(r => { const extra = Object.keys(r).filter(k => !cols.has(k) && !ignore.includes(k)); assert.deepEqual(extra, [], table + ' : colonnes inconnues ' + extra.join(', ')); }); };
    test('days, parcels, invoices', () => { const s = state(c); check('days', s.days); check('parcels', s.parcels); check('invoices', s.invoices); });
    test('shifts, goals', () => { const s = state(c); check('shifts', s.shifts); check('goals', [s.goals]); });
    test('savings_goals, savings_log, budget', () => { const s = state(c); check('savings_goals', s.savings); check('savings_log', s.savingsLog); check('budget', [s.budget]); });
  });
});
