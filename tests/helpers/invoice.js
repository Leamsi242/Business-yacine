// Générateur de factures Intelcom synthétiques, au format des lignes reconstruites par js/pdf-import.js.
// Aucune donnée réelle : chauffeur, suivis et montants sont inventés, mais la structure est celle
// observée sur les factures hebdomadaires (en-tête, résumé par jour, frais, total, détail par colis).
'use strict';
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');

function loadTariffs() {
  const g = { window: {} };
  const src = require('node:fs').readFileSync(path.join(ROOT, 'js', 'tariffs.js'), 'utf8');
  new Function('window', src)(g.window);
  return g.window.PY_TARIFFS;
}
const TARIFFS = loadTariffs();

const round2 = n => Math.round(n * 100) / 100;
const usd = (n, comma) => { const s = n.toFixed(2); return '$' + (comma ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s); };
const lb = w => (Number.isInteger(w) ? String(w) : String(w)) + ' LB';

// Petit générateur pseudo-aléatoire déterministe (LCG) pour des mélanges reproductibles.
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/**
 * build({ week, from, to, driver, days: [{ date, parcels: [{ zone, wt, amt?, svc?, pc?, sig? }] }], adminRate, cancel, fscRate, comma })
 * Renvoie { lines, expected } où expected contient base, fsc, admin, total, days (résumé par jour) et parcels.
 */
function build(o) {
  const adminRate = o.adminRate == null ? 0.02 : o.adminRate;
  const fscRate = o.fscRate == null ? 0.032 : o.fscRate;
  const cancel = o.cancel || 0;
  const driver = o.driver || 'C0X0000';
  const head = [
    'Delivery Invoice',
    `Driver: ${driver} Test Chauffeur Invoice To:`,
    `Week reference: ${o.week} Intelcom Courrier`,
    `From: ${o.from} 1380, rue William`,
    `To: ${o.to} Suite 200`,
    'Station: DRUM MONTREAL, QC H3C 1R5'
  ];
  const summary = ['Transaction summary', 'Transaction Date Stop Invoiced Qty Parcels Invoiced Amount FSC Additional Total', 'Qty Amount'];
  const detail = ['Transaction details - Invoiced per parcel', 'Service Type Station Postal Zone Tracking No. Weight Amount', 'Transaction Date', 'Code * Signature required'];
  let base = 0, fsc = 0, n = 0, trk = 0;
  const expDays = [], expParcels = [];
  // toutes les dates de la semaine apparaissent, même sans colis
  const dates = []; for (let d = new Date(o.from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= o.to; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const byDate = {}; (o.days || []).forEach(d => byDate[d.date] = d);
  dates.forEach(date => {
    const day = byDate[date]; const ps = day ? day.parcels : [];
    let amt = 0;
    ps.forEach(p => {
      const a = p.amt != null ? p.amt : TARIFFS[p.zone + '|' + Number(p.wt).toFixed(1)];
      if (a == null) throw new Error('pas de tarif de référence pour ' + p.zone + ' ' + p.wt + ' lb');
      amt += a; trk++;
      const row = { date, svc: p.svc || 'FLEX', pc: p.pc || 'J0A1M0', zone: p.zone, tracking: p.tracking || ('TEST' + String(trk).padStart(10, '0') + 'CA'), wt: Number(p.wt), amt: round2(a), sig: !!p.sig };
      expParcels.push(row);
      detail.push(`${date} ${row.svc} DRUM ${row.pc} ${row.zone} ${row.tracking}${row.sig ? ' *' : ''} ${lb(row.wt)} ${usd(row.amt, o.comma)}`);
    });
    amt = round2(amt); const f = round2(amt * fscRate); const tot = round2(amt + f);
    base = round2(base + amt); fsc = round2(fsc + f); n += ps.length;
    summary.push(`${date} 0 ${ps.length} ${usd(amt, o.comma)} ${usd(f, o.comma)} $0.00 ${usd(tot, o.comma)}`);
    if (ps.length >= 20) expDays.push({ date, parcels: ps.length, invoiced: tot });
  });
  const admin = round2((base + fsc) * adminRate);
  const total = round2(base + fsc - admin - cancel);
  // le total du résumé est parfois coupé en deux lignes par pdf.js, on reproduit ce défaut
  const totStr = usd(round2(base + fsc), o.comma);
  summary.push(`Total 0 ${n} ${usd(base, o.comma)} ${usd(fsc, o.comma)} $0.00 ${totStr.slice(0, -1)}`, totStr.slice(-1));
  const fees = [
    `Fuel Surcharge applicable during current month : ${(fscRate * 100).toFixed(2)}%`,
    'Manual Fees Detail', 'Date Qty Item Unit Cost Amount Amount With Tax', 'before', 'Tax',
    `${o.week} 1 Cost of Sales - Administration Fees (${usd(admin, o.comma)}) (${usd(admin, o.comma)}) (${usd(admin, o.comma)})`,
    'Recovery [ Pre', `Total (${usd(admin, o.comma)})`,
    `Total Cancellation (see last page) ${usd(cancel, o.comma)}`,
    `Total invoice ${usd(total, o.comma)}`
  ];
  const lines = [...head, ...summary, ...fees, ...detail];
  return { lines, expected: { week: o.week, from_date: o.from, to_date: o.to, driver_code: driver, base, fsc, admin, cancel, total, days: expDays, parcels: expParcels } };
}

/** Journée réaliste : n colis répartis sur une zone, poids mêlés (entiers et demi-livres), tarifs de référence. */
function day(date, n, zone, seed, opts = {}) {
  const r = rng(seed || 1); const weights = [0.5, 1, 1, 1.5, 2, 2, 3, 4, 5, 6, 8, 10];
  const parcels = [];
  for (let i = 0; i < n; i++) {
    let wt = weights[Math.floor(r() * weights.length)];
    if (TARIFFS[zone + '|' + wt.toFixed(1)] == null) wt = 1;
    parcels.push(Object.assign({ zone, wt, pc: opts.pc || 'J0A1M0', svc: r() < 0.8 ? 'FLEX' : 'DELIVERY' }, opts.each ? opts.each(i, wt) : {}));
  }
  return { date, parcels };
}

/** Une semaine type : 4 journées de 170 à 190 colis, une journée de 2 colis (retour), deux jours vides. */
function typicalWeek(week = '2026-41', from = '2026-10-05', extra = {}) {
  const d = n => { const x = new Date(from + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  return build(Object.assign({
    week, from, to: d(6),
    days: [day(d(1), 170, 'ZONE_M', 11), day(d(2), 184, 'ZONE_G', 12), day(d(3), 2, 'ZONE_G', 13), day(d(4), 172, 'ZONE_L', 14), day(d(6), 180, 'ZONE_H', 15)]
  }, extra));
}

/** Lignes d'un document qui n'est pas une facture hebdomadaire (note de crédit pour colis perdu). */
function creditMemoLines() {
  return ['Purchase Credit Memo', 'Document No. CMI0000000', 'Vendor: Test Chauffeur', 'Description Quantity Amount', 'Lost parcel claim 1 422.97', 'Total $422.97'];
}

module.exports = { build, day, typicalWeek, creditMemoLines, TARIFFS, round2 };
