// Jeux de données déterministes pour les tests : semaines régulières, budget connu.
'use strict';

/** nWeeks semaines se terminant le dimanche avant `until` (AAAA-MM-JJ), `perWeek` jours du lundi, chacun à `invoiced` $, `fuel` $, `parcels` colis. */
function regularWeeks({ until = '2026-10-11', nWeeks = 8, perWeek = 4, invoiced = 400, fuel = 50, parcels = 180, km = 300, loc = 'J0C1S0' } = {}) {
  const days = [];
  const end = new Date(until + 'T12:00:00'); const dow = (end.getDay() + 6) % 7; // 0 = lundi
  const monday = new Date(end); monday.setDate(end.getDate() - dow - 7 * (nWeeks - 1));
  for (let w = 0; w < nWeeks; w++) for (let i = 0; i < perWeek; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + 7 * w + i);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    days.push({ date: iso, driver: 'yacine', parcels, invoiced, km, fuel, loc, source: 'facture' });
  }
  return days;
}

const DEFAULT_SAVINGS = () => [
  { id: 'voiture', name: 'Ma voiture', kind: 'voiture', target: 8000, saved: 0, priority: 1, active: true },
  { id: 'impot', name: 'Réserve impôt et RRQ', kind: 'impot', target: 0, saved: 0, priority: 1, active: true },
  { id: 'urgence', name: 'Coussin de sécurité', kind: 'urgence', target: 2000, saved: 0, priority: 2, active: true },
  { id: 'van', name: 'Van pour devenir indépendant', kind: 'van', target: 13800, saved: 0, priority: 3, active: true }];

/** État local complet : journées régulières, objectifs broker 25 %, épargne et budget par défaut. */
function localState(o = {}) {
  return Object.assign({
    days: regularWeeks(o.weeks || {}), parcels: [], invoices: [], shifts: [], localities: [],
    goals: Object.assign({ driver: 'yacine', days: 4.5, net: 4300, van: 8000, saved: 0, status: 'broker', fuel: 60, cut: 0.25 }, o.goals || {}),
    savings: o.savings || DEFAULT_SAVINGS(), savingsLog: o.savingsLog || [],
    budget: Object.assign({ driver: 'yacine', rent: 300, fixed: 250, living: 500, tax_rate: 0.2, weeks_per_month: 4.33 }, o.budget || {})
  }, o.extra || {});
}

module.exports = { regularWeeks, localState, DEFAULT_SAVINGS };
