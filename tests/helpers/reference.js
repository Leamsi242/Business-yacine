// Données de référence SYNTHÉTIQUES pour les tests et le mode local : historique de journées, statistiques par
// localité et grille tarifaire. Les vraies valeurs (factures de Yacine, grille Intelcom) vivent dans Supabase,
// table `reference`, derrière le PIN ; elles ne doivent jamais revenir dans le dépôt public.
// Seules les localités (noms et coordonnées de villages, publics) viennent de js/data.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');

function localities() { const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8'))(w); return w.PY_LOCALITIES; }
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const r2 = n => Math.round(n * 100) / 100;

// Revenu par colis inventé, mais du bon ordre : rural éloigné (G0P) mieux payé, Drummondville (J2) le moins.
const PPP = { G0P1C0: 3.50, G0P1A1: 3.10, G0P1A0: 3.00, G0P1J0: 2.90, G0P1B0: 2.70, J2: 1.50, G6: 2.05, J0A1M0: 2.10, J0H1A0: 2.15, J0C1S0: 2.20 };
const ZONES = ['ZONE_D', 'ZONE_F', 'ZONE_G', 'ZONE_H', 'ZONE_I', 'ZONE_K', 'ZONE_L', 'ZONE_M', 'ZONE_N', 'ZONE_O', 'ZONE_Q', 'ZONE_S'];

function build() {
  const rnd = rng(42), locs = localities();
  const locstats = locs.map((l, i) => {
    const ppp = PPP[l.code] || r2(1.9 + rnd() * 0.5), n = 40 + Math.floor(rnd() * 600), days = 2 + Math.floor(rnd() * 12), z = ZONES[i % ZONES.length];
    return { code: l.code, name: l.name, lat: l.lat, lon: l.lon, n, rev: r2(n * ppp), ppp, days, zone: z, zones: { [z]: n }, wt: r2(2 + rnd() * 4) };
  });
  // 31 journées inventées, du lundi 13 avril au dimanche 27 septembre 2026 (fin de l'historique).
  const dates = []; const d = new Date('2026-04-13T12:00:00');
  // Lundis et mercredis à partir du 13 avril : 30 journées, jusqu'à fin juillet.
  while (dates.length < 30) { const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); if (d.getDay() === 1 || d.getDay() === 3) dates.push(iso); d.setDate(d.getDate() + 1); }
  dates.push('2026-09-27');
  const top = ['J0C1S0', 'J0H1A0', 'J0A1M0', 'G0P1A0'].map(c => locstats.find(l => l.code === c));
  const days = dates.sort().map((date, i) => { const parcels = 150 + Math.floor(rnd() * 60), t = top[i % top.length]; return { date, parcels, invoiced: r2(parcels * (2 + rnd() * 0.4)), top: [{ code: t.code, name: t.name, n: parcels }], zones: { [t.zone]: parcels } }; });
  // Grille inventée : prix de base par zone + 0,06 $ par livre, pour chaque demi-livre de 0,5 à 60 lb.
  const tariffs = {}; ZONES.forEach((z, i) => { for (let w = 0.5; w <= 60; w += 0.5) tariffs[z + '|' + w.toFixed(1)] = r2(1.5 + i * 0.05 + 0.06 * w); });
  tariffs['ZONE_G|2.0'] = 2.00;
  return { history: { days }, locstats, tariffs };
}

module.exports = build();
