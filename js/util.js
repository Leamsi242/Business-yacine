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

  // Rampe séquentielle partagée par la carte, le monde à conduire et le mur des semaines : graphite du gris clair
  // au quasi-noir en clair, inversée en sombre pour que la marque la plus contrastée reste la plus payante.
  // Les mêmes valeurs sont reprises par --seq1 à --seq5 dans css/app.css. Le rouge de marque n'en fait pas partie :
  // il est réservé à la sélection et à la semaine en cours. Les deux premiers paliers ont moins de 3:1 contre le
  // fond, d'où le contour SEQ_EDGE (au moins 3:1 en clair comme en sombre) posé autour de chaque marque.
  const SEQ = { light: ['#E5E5E5', '#BDBDBD', '#8C8C8C', '#4D4D4D', '#1A1A1A'], dark: ['#3A3A3E', '#5C5C62', '#8E8E93', '#C7C7CC', '#F5F5F7'] };
  const SEQ_EDGE = { light: '#8C8C8C', dark: '#8E8E93' };
  // Palier de 0 à 4 d'un revenu par colis : 1,30 $ et moins au palier 0, 3,30 $ et plus au palier 4.
  function seqLevel(ppp) { const t = Math.max(0, Math.min(1, ((+ppp || 0) - 1.3) / 2)); return Math.min(4, Math.floor(t * 5)); }
  function seqColor(ppp, dark) { return SEQ[dark ? 'dark' : 'light'][seqLevel(ppp)]; }
  // Mode sombre effectif : l'attribut data-theme l'emporte, sinon la préférence du système.
  function isDark() {
    const t = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
    if (t === 'dark') return true; if (t === 'light') return false;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }
  // Valeur d'une variable CSS de :root, pour Leaflet et le canvas qui ne comprennent pas var().
  function cssVar(name, fallback) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch (e) { return fallback; }
  }

  window.PYU = { isoDate, isoMonth, today: () => isoDate(new Date()), addDays, weekStart, tariffKey, numOr, billed, avgInvoiced, pastWeeks, streak,
    SEQ, SEQ_EDGE, seqLevel, seqColor, isDark, cssVar };
})();
