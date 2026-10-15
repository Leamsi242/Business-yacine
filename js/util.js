// Utilitaires partagés. Les dates « du jour » se calculent en heure locale du téléphone (Québec),
// jamais en UTC : à 21 h à Drummondville, toISOString() donnerait déjà la date du lendemain.
(function () {
  const pad = n => String(n).padStart(2, '0');
  // Date locale au format AAAA-MM-JJ.
  function isoDate(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // Mois local au format AAAA-MM.
  function isoMonth(d) { return isoDate(d).slice(0, 7); }
  // Lundi de la semaine d'une date AAAA-MM-JJ (les factures Intelcom vont du lundi au dimanche).
  function weekStart(ds) { const d = new Date(ds + 'T12:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return isoDate(d); }
  // Clé de la grille tarifaire : zone et poids à une décimale (« ZONE_G|2.0 »), quel que soit le format du poids.
  function tariffKey(zone, wt) { return zone + '|' + (+wt).toFixed(1); }
  window.PYU = { isoDate, isoMonth, today: () => isoDate(new Date()), weekStart, tariffKey };
})();
