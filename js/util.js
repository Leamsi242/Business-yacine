// Utilitaires partagés. Les dates « du jour » se calculent en heure locale du téléphone (Québec),
// jamais en UTC : à 21 h à Drummondville, toISOString() donnerait déjà la date du lendemain.
(function () {
  const pad = n => String(n).padStart(2, '0');
  // Date locale au format AAAA-MM-JJ.
  function isoDate(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // Mois local au format AAAA-MM.
  function isoMonth(d) { return isoDate(d).slice(0, 7); }
  // Date AAAA-MM-JJ décalée de n jours (midi local, donc insensible au changement d'heure).
  function addDays(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
  // Lundi de la semaine d'une date AAAA-MM-JJ (les factures Intelcom vont du lundi au dimanche).
  function weekStart(ds) { const d = new Date(ds + 'T12:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return isoDate(d); }
  // Clé de la grille tarifaire : zone et poids à une décimale (« ZONE_G|2.0 »), quel que soit le format du poids.
  function tariffKey(zone, wt) { return zone + '|' + (+wt).toFixed(1); }
  // Nombre saisi, ou la valeur par défaut si le champ est vide ou invalide. Contrairement à `+v || d`, garde le zéro.
  function numOr(v, d) { return v === '' || v == null || isNaN(+v) ? d : +v; }

  // Journées dont le facturé est connu. Une saisie du soir sans facturé reste à 0 $ jusqu'à l'import de la
  // facture : la compter dans une moyenne ferait baisser le revenu par jour, la prévision et la date de la voiture.
  function billed(days) { return days.filter(d => +d.invoiced > 0); }
  function avgInvoiced(days, fallback) { const b = billed(days); return b.length ? b.reduce((a, d) => a + +d.invoiced, 0) / b.length : (fallback || 0); }

  function weekCounts(days) { const c = {}; days.forEach(d => { const k = weekStart(d.date); c[k] = (c[k] || 0) + 1; }); return c; }
  // Les n semaines calendaires complètes avant la semaine de `today`, de la plus ancienne à la plus récente.
  // Une semaine sans aucune journée compte pour 0 jour ; on ne remonte pas avant la première journée connue.
  function pastWeeks(days, today, n) {
    const c = weekCounts(days); const first = days.reduce((m, d) => !m || d.date < m ? d.date : m, '');
    const out = []; let wk = addDays(weekStart(today), -7);
    for (let i = 0; i < n && first && wk >= weekStart(first); i++, wk = addDays(wk, -7)) out.unshift({ wk, days: c[wk] || 0 });
    return out;
  }
  // Série de semaines consécutives à `minDays` jours ou plus. La semaine en cours compte seulement si elle est
  // déjà réussie (sinon le lundi remettrait la série à zéro) ; une semaine de congé casse la série.
  function streak(days, minDays, today) {
    const c = weekCounts(days), min = Math.max(1, Math.floor(minDays) || 1);
    let n = (c[weekStart(today)] || 0) >= min ? 1 : 0, wk = addDays(weekStart(today), -7);
    while ((c[wk] || 0) >= min) { n++; wk = addDays(wk, -7); }
    return n;
  }

  window.PYU = { isoDate, isoMonth, today: () => isoDate(new Date()), addDays, weekStart, tariffKey, numOr, billed, avgInvoiced, pastWeeks, streak };
})();
