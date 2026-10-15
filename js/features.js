// Fonctions de pilotage : brief du matin, shift GPS, saisie du soir, audit de facture, score de route,
// mission de la semaine, compte à rebours van, géolocalisation. S'appuie sur window.PYAPP exposé par app.js.
(function () {
  const A = () => window.PYAPP, DB = window.PYDB, CFG = window.PY_CONFIG, T = window.PY_TARIFFS || {};
  const $ = s => document.querySelector(s);
  const todayISO = () => window.PYU.today();
  const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const ROUTE_TYPES = { urbain: { label: 'Urbaine (Drummondville)', ppp: 1.46, km: 220, desc: 'Dense, 200 à 226 colis, peu payée' }, rural: { label: 'Rurale proche (Acton Vale, Wickham, L’Avenir)', ppp: 2.12, km: 300, desc: 'La route standard, 170 à 190 colis' }, loin: { label: 'Rurale éloignée (Ham-Nord, Chesterville, Norbertville)', ppp: 2.90, km: 380, desc: 'La mieux payée, plus de route' } };
  const hav = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180, s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

  /* ===== Brief du matin ===== */
  let briefStep = 0, brief = { route: 'rural', parcels: 180, checklist: {} };
  async function openBrief(force) {
    const { S, share, fmt, money, byWeek } = A(); const date = todayISO();
    const seenKey = 'py-brief-' + date; let seen = false; try { seen = localStorage.getItem(seenKey) === '1'; } catch (e) {}
    if (seen && !force) return;
    const existing = await DB.getShift(date).catch(() => null);
    if (existing) { brief.route = existing.route_type || 'rural'; brief.parcels = existing.goal_parcels || 180; brief.checklist = existing.checklist || {}; }
    const d = new Date(); const dateTxt = DAYS_FR[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS_FR[d.getMonth()];
    const weeks = byWeek(S.days); const wk = weeks.find(w => w.wk === weekStart(date)) || { days: 0, inv: 0 };
    const streak = A().streak();
    const sh = share(); const avg = A().avgInvoiced(367);
    const best = S.locstats.filter(l => l.n >= 40).sort((a, b) => b.ppp - a.ppp).slice(0, 3);
    const suggested = wk.days >= Math.floor(S.goals.days) ? 'rural' : 'loin';
    let carLine = '';
    try { if (window.PYS) { await window.PYS.load(); const car = window.PYS.goals.find(g => g.kind === 'voiture'); if (car && +car.target > +car.saved) { const cap = window.PYS.capacity(); const alloc = window.PYS.allocate(cap.free); const perDay = (alloc[car.id] || 0) / Math.max(1, cap.dpw); const left = +car.target - +car.saved; carLine = `<p class="carline"><b>${A().esc(car.name)}</b> : ${money(+car.saved)} sur ${money(+car.target)}. Aujourd'hui rapproche la voiture d'environ <b>${money(perDay)}</b>${perDay > 0 ? ', il reste ' + Math.ceil(left / perDay) + ' journées de travail' : ''}.</p>`; } } } catch (e) {}
    brief.route = brief.route || suggested;
    // Chaque écran est une fonction : le rendu reflète le choix courant (route sélectionnée, objectif).
    const slides = [
      () => `<p class="eyebrow">${dateTxt}</p><h2>Bonjour Yacine.</h2>
       <p class="lead">Cette semaine : <b>${wk.days} jour${wk.days > 1 ? 's' : ''}</b> sur ${fmt(S.goals.days, 1)} visés, <b>${money(wk.inv * sh)}</b> net déjà facturés. Série en cours : <b>${streak} semaine${streak > 1 ? 's' : ''}</b> réussie${streak > 1 ? 's' : ''} (cible 12 pour la phase 1).</p>
       <div class="bar"><i style="width:${Math.min(100, 100 * wk.days / S.goals.days)}%"></i></div>
       <p class="small muted">Ta moyenne : ${money(avg)} facturés par jour, soit ${money(avg * sh)} net avant essence.</p>${carLine}`,
      () => `<p class="eyebrow">Choix n° 1</p><h2>Quelle route aujourd'hui ?</h2>
       <div class="choices">${Object.entries(ROUTE_TYPES).map(([k, r]) => `<button class="choice ${brief.route === k ? 'on' : ''}" data-route="${k}"><b>${r.label}</b><span>${r.desc}</span><em>${fmt(r.ppp, 2)} $/colis · 180 colis ≈ ${money(r.ppp * 180)} facturés, ${money(r.ppp * 180 * sh)} net</em>${k === suggested ? '<i class="pill good">Conseillée</i>' : ''}</button>`).join('')}</div>
       <p class="small muted">Si on te propose ${best.map(l => l.name).join(', ')}, dis oui : ce sont tes zones les mieux payées.</p>`,
      () => `<p class="eyebrow">Choix n° 2</p><h2>Ton objectif du jour</h2>
       <label class="sl">Colis visés <output id="bf_out">${brief.parcels}</output><input type="range" id="bf_parcels" min="90" max="240" step="5" value="${brief.parcels}"></label>
       <div class="tiles" id="bf_tiles"></div>
       <p class="small muted">Un objectif chiffré avant de partir augmente le rendement : tu sauras à midi si tu es en avance ou en retard.</p>`,
      () => `<p class="eyebrow">Avant de partir</p><h2>Les trois réflexes</h2>
       <div class="checks">
        <label><input type="checkbox" data-ck="photo" ${brief.checklist.photo ? 'checked' : ''}> Photo de chaque dépôt (un colis perdu = 422,97 $)</label>
        <label><input type="checkbox" data-ck="fuel" ${brief.checklist.fuel ? 'checked' : ''}> Garder le reçu d'essence pour la saisie du soir</label>
        <label><input type="checkbox" data-ck="gps" ${brief.checklist.gps !== false ? 'checked' : ''}> Compter mes kilomètres avec le GPS pendant le shift</label>
       </div>
       <p class="small muted">Le GPS reste sur ton téléphone : seuls les kilomètres cumulés sont enregistrés, jamais le trajet.</p>`
    ];
    briefStep = 0;
    const el = $('#brief'); el.hidden = false; document.body.classList.add('noscroll');
    const render = () => {
      $('#briefBody').innerHTML = slides[briefStep]();
      $('#briefDots').innerHTML = slides.map((_, i) => `<i class="${i === briefStep ? 'on' : ''}"></i>`).join('');
      $('#briefPrev').hidden = briefStep === 0; $('#briefNext').textContent = briefStep === slides.length - 1 ? 'Commencer le shift' : 'Suivant';
      $('#briefBody').querySelectorAll('[data-route]').forEach(b => b.onclick = () => { brief.route = b.dataset.route; render(); });
      const r = $('#bf_parcels'); if (r) { const upd = () => { brief.parcels = +r.value; $('#bf_out').textContent = r.value; const rt = ROUTE_TYPES[brief.route]; const inv = rt.ppp * brief.parcels, fuel = rt.km * 10 / 100 * CFG.FUEL_PRICE; $('#bf_tiles').innerHTML = [['Facturé visé', money(inv)], ['Net (part Yacine)', money(inv * sh)], ['Essence estimée', money(fuel)], ['Net après essence', money(inv * sh - fuel)]].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div></div>`).join(''); }; r.oninput = upd; upd(); }
      $('#briefBody').querySelectorAll('[data-ck]').forEach(c => c.onchange = () => brief.checklist[c.dataset.ck] = c.checked);
    };
    render();
    $('#briefPrev').onclick = () => { briefStep--; render(); };
    $('#briefNext').onclick = async () => {
      if (briefStep < slides.length - 1) { briefStep++; render(); return; }
      const rt = ROUTE_TYPES[brief.route]; const inv = rt.ppp * brief.parcels;
      const ck = Object.assign({ gps: true }, brief.checklist);
      try { await DB.upsertShift({ date, route_type: brief.route, goal_parcels: brief.parcels, goal_invoiced: +inv.toFixed(2), goal_net: +(inv * sh).toFixed(2), started_at: new Date().toISOString(), checklist: ck }); } catch (e) { A().toast('Objectif non enregistré : ' + e.message); }
      try { localStorage.setItem(seenKey, '1'); } catch (e) {}
      closeBrief(); A().toast('Objectif du jour : ' + brief.parcels + ' colis, ' + money(inv * sh) + ' net');
      if (ck.gps !== false) startShift(date);
      renderShiftBar();
    };
    $('#briefSkip').onclick = () => { try { localStorage.setItem(seenKey, '1'); } catch (e) {} closeBrief(); };
  }
  function closeBrief() { $('#brief').hidden = true; document.body.classList.remove('noscroll'); }
  const weekStart = ds => window.PYU.weekStart(ds);

  /* ===== Shift et GPS ===== */
  let geoWatch = null, shift = null;
  function loadShift() { try { shift = JSON.parse(localStorage.getItem('py-shift') || 'null'); } catch (e) { shift = null; } if (shift && shift.date !== todayISO()) shift = null; }
  function saveShift() { try { localStorage.setItem('py-shift', JSON.stringify(shift)); } catch (e) {} }
  function startShift(date) {
    if (!navigator.geolocation) { A().toast('Pas de GPS sur cet appareil'); return; }
    shift = { date, km: 0, last: null, start: Date.now() }; saveShift();
    geoWatch = navigator.geolocation.watchPosition(p => {
      const c = { lat: p.coords.latitude, lon: p.coords.longitude, t: p.timestamp, acc: p.coords.accuracy };
      if (c.acc > 120) return;
      if (shift.last) { const d = hav(shift.last, c); const dt = (c.t - shift.last.t) / 1000; if (d > 0.015 && d / Math.max(dt, 1) * 3600 < 140) shift.km += d; }
      shift.last = c; saveShift(); renderShiftBar();
    }, err => { A().toast('GPS refusé ou indisponible (' + err.message + ')'); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    renderShiftBar();
  }
  function resumeShift() { loadShift(); if (shift && navigator.geolocation && geoWatch == null) { const s = shift; startShift(s.date); shift.km = s.km; shift.start = s.start; saveShift(); } renderShiftBar(); }
  async function endShift() {
    if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
    const km = shift ? Math.round(shift.km) : 0, date = shift ? shift.date : todayISO();
    try { const ex = await DB.getShift(date); if (ex) await DB.upsertShift(Object.assign(ex, { ended_at: new Date().toISOString(), km_gps: km })); } catch (e) {}
    shift = null; try { localStorage.removeItem('py-shift'); } catch (e) {}
    renderShiftBar(); openEvening(date, km);
  }
  function renderShiftBar() {
    const b = $('#shiftBar'); if (!shift) { b.hidden = true; return; }
    b.hidden = false; const h = (Date.now() - shift.start) / 36e5;
    b.innerHTML = `<span class="live"></span> Shift en cours · <b>${A().fmt(shift.km, 1)} km</b> · ${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} <button class="btn" id="btnEndShift">Terminer et saisir</button>`;
    $('#btnEndShift').onclick = endShift;
  }
  setInterval(() => { if (shift) renderShiftBar(); }, 60000);

  /* ===== Saisie du soir ===== */
  async function openEvening(date, km) {
    date = date || todayISO(); const { S, money, fmt, share } = A();
    const ex = S.days.find(d => d.date === date) || {}; const sh = await DB.getShift(date).catch(() => null);
    const el = $('#evening'); el.hidden = false; document.body.classList.add('noscroll');
    $('#ev_date').value = date; $('#ev_km').value = km || ex.km || ''; $('#ev_fuel').value = ex.fuel ?? ''; $('#ev_parcels').value = ex.parcels || (sh ? sh.goal_parcels : '') || ''; $('#ev_inv').value = ex.invoiced || '';
    $('#ev_loc').innerHTML = '<option value="">—</option>' + S.localities.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(l => `<option value="${l.code}" ${ex.loc === l.code ? 'selected' : ''}>${l.name}</option>`).join('');
    const dd = new Date(date + 'T12:00:00'); $('#ev_eyebrow').textContent = 'Saisie du soir · ' + DAYS_FR[dd.getDay()] + ' ' + dd.getDate() + ' ' + MONTHS_FR[dd.getMonth()];
    $('#ev_goal').innerHTML = sh ? `Objectif du matin : <b>${sh.goal_parcels} colis</b>, ${money(sh.goal_net)} net (${ROUTE_TYPES[sh.route_type] ? ROUTE_TYPES[sh.route_type].label : ''}).` : 'Pas d’objectif fixé ce matin.';
    $('#ev_result').innerHTML = '';
    $('#eveningForm').onsubmit = async e => {
      e.preventDefault();
      const row = { date, parcels: +$('#ev_parcels').value || ex.parcels || 0, invoiced: +$('#ev_inv').value || ex.invoiced || 0, km: $('#ev_km').value !== '' ? +$('#ev_km').value : null, fuel: $('#ev_fuel').value !== '' ? +$('#ev_fuel').value : null, loc: $('#ev_loc').value || null, note: ex.note || null, source: ex.source === 'facture' ? 'facture' : 'saisie' };
      try { await DB.upsertDay(row); } catch (err) { A().toast('Refusé : ' + err.message); return; }
      let msg = 'Journée enregistrée.';
      if (sh && row.parcels) { const pct = Math.round(100 * row.parcels / sh.goal_parcels); msg = pct >= 100 ? `Objectif atteint : ${row.parcels} colis (${pct} %). Bravo.` : `${row.parcels} colis sur ${sh.goal_parcels} visés (${pct} %).`; if (row.invoiced) msg += ` Net : ${money(row.invoiced * share())}${row.fuel ? ', après essence ' + money(row.invoiced * share() - row.fuel) : ''}.`; }
      let sugg = '', sg = null;
      if (window.PYS && row.invoiced) { sg = window.PYS.eveningSuggestion(row.invoiced * share(), row.fuel || 0); if (sg.carGoal && sg.car > 5) sugg = `<p style="margin-top:8px">Mets <b>${money(sg.car)}</b> de côté pour ${A().esc(sg.carGoal.name)} ce soir (et ${money(sg.tax)} dans la réserve d’impôt). <button class="btn" type="button" id="ev_contrib" style="padding:5px 10px">Verser ${money(sg.car)}</button></p>`; }
      $('#ev_result').innerHTML = `<p class="pill ${sh && row.parcels >= (sh.goal_parcels || 0) ? 'good' : 'warn'}" style="font-size:14px;padding:8px 12px">${msg}</p>${sugg}`;
      await A().refresh();
      const cb = $('#ev_contrib'); if (cb) { cb.onclick = () => { closeEvening(); window.PYS.openContrib(sg.carGoal.id, sg.car); }; } else setTimeout(closeEvening, 1800);
    };
  }
  function closeEvening() { $('#evening').hidden = true; document.body.classList.remove('noscroll'); }

  /* ===== Audit de facture ===== */
  function auditInvoice(inv, parcels, days, journalDays, meta) {
    const issues = []; const ok = [];
    const sumAmt = parcels.reduce((a, p) => a + p.amt, 0);
    if (Math.abs(sumAmt - inv.base) > 0.5) issues.push({ sev: 'bad', t: `Somme des colis (${sumAmt.toFixed(2)} $) différente de la base facturée (${inv.base.toFixed(2)} $)` }); else ok.push('Somme des colis = base facturée');
    const expAdmin = Math.round((inv.base + inv.fsc) * 0.02 * 100) / 100;
    if (Math.abs(expAdmin - inv.admin) > 0.05) issues.push({ sev: 'warn', t: `Frais d'administration ${inv.admin.toFixed(2)} $ au lieu de 2 % attendus (${expAdmin.toFixed(2)} $)` }); else ok.push('Frais d’administration à 2 %');
    const expTotal = inv.base + inv.fsc - inv.admin - inv.cancel;
    if (Math.abs(expTotal - inv.total) > 0.05) issues.push({ sev: 'bad', t: `Total facture ${inv.total.toFixed(2)} $ au lieu de ${expTotal.toFixed(2)} $ (base + carburant − admin − annulations)` }); else ok.push('Total facture cohérent');
    if (inv.cancel > 0) issues.push({ sev: 'warn', t: `Annulations déduites : ${inv.cancel.toFixed(2)} $ (vérifier la dernière page de la facture)` });
    // tarifs vs référence
    const changed = {}; let nChanged = 0;
    parcels.forEach(p => { const k = window.PYU.tariffKey(p.zone, p.wt); const ref = T[k]; if (ref != null && Math.abs(ref - p.amt) > 0.005) { nChanged++; changed[k] = changed[k] || { ref, now: p.amt, n: 0 }; changed[k].n++; } });
    if (nChanged) { const ex = Object.entries(changed).sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([k, v]) => `${k.replace('|', ' ')} lb : ${v.ref.toFixed(2)} → ${v.now.toFixed(2)} $ (${v.n})`).join(' ; '); const up = Object.values(changed).filter(v => v.now > v.ref).length, down = Object.values(changed).filter(v => v.now < v.ref).length; issues.push({ sev: down > up ? 'bad' : 'warn', t: `Grille tarifaire différente de la référence sur ${nChanged} colis (${up} hausses, ${down} baisses de tarif). Exemples : ${ex}` }); } else ok.push('Tarifs conformes à la grille de référence');
    // journées
    const invDates = new Set(days.map(d => d.date));
    (journalDays || []).filter(d => d.date >= inv.from_date && d.date <= inv.to_date && d.source === 'saisie' && d.parcels >= 20).forEach(d => { if (!invDates.has(d.date)) issues.push({ sev: 'bad', t: `Journée saisie le ${d.date} (${d.parcels} colis) absente de la facture` }); });
    days.forEach(d => { const n = parcels.filter(p => p.date === d.date).length; if (n !== d.parcels) issues.push({ sev: 'warn', t: `${d.date} : ${d.parcels} colis au résumé, ${n} lignes de colis détaillées` }); });
    const sig = meta && meta.sig ? meta.sig : 0; if (sig) ok.push(sig + ' colis avec signature');
    return { at: new Date().toISOString(), issues, ok, parcels: parcels.length, days: days.length };
  }
  function renderAudits(invoices) {
    const el = $('#audits'); if (!el) return;
    const list = (invoices || []).filter(i => i.audit).sort((a, b) => a.week < b.week ? 1 : -1).slice(0, 8);
    if (!list.length) { el.innerHTML = '<p class="muted small">Aucune facture importée pour l’instant. Chaque PDF déposé est vérifié ligne par ligne.</p>'; return; }
    el.innerHTML = list.map(i => { const a = i.audit; const bad = a.issues.filter(x => x.sev === 'bad').length; return `<div class="audit"><div class="row" style="justify-content:space-between"><b>Semaine ${i.week}</b><span class="pill ${bad ? 'bad' : a.issues.length ? 'warn' : 'good'}">${bad ? bad + ' anomalie' + (bad > 1 ? 's' : '') : a.issues.length ? a.issues.length + ' point' + (a.issues.length > 1 ? 's' : '') + ' à vérifier' : 'Conforme'}</span></div><div class="small muted">${a.parcels} colis, ${a.days} journées, total ${A().money(+i.total, 2)}</div>${a.issues.map(x => `<div class="small"><span class="pill ${x.sev}">${x.sev === 'bad' ? 'Anomalie' : 'À vérifier'}</span> ${x.t}</div>`).join('')}<div class="small muted">${a.ok.join(' · ')}</div></div>`; }).join('');
  }

  /* ===== Score de route ===== */
  function scoreRoute() {
    const { S, fmt, money, share } = A(); const txt = $('#rs_codes').value.toUpperCase().replace(/\s+/g, ' ');
    const codes = (txt.match(/[A-Z]\d[A-Z] ?\d[A-Z]\d|[A-Z]\d[A-Z]/g) || []).map(c => c.replace(' ', ''));
    const n = +$('#rs_parcels').value || 180; if (!codes.length) { $('#rs_out').innerHTML = '<p class="muted small">Colle des codes postaux (ex. J0H1A0, G0P1B0, J2C) séparés par des espaces ou des virgules.</p>'; return; }
    const stats = {}; S.locstats.forEach(l => stats[l.code] = l);
    const hit = codes.map(c => { const k = c[1] === '0' ? c : c.slice(0, 3); const key = { G6P: 'G6', G6R: 'G6', G6S: 'G6', G6T: 'G6', J2B: 'J2', J2C: 'J2' }[k] || k; return { code: c, loc: stats[key] || null }; });
    const known = hit.filter(h => h.loc); const unknown = hit.filter(h => !h.loc).map(h => h.code);
    const ppp = known.length ? known.reduce((a, h) => a + h.loc.ppp, 0) / known.length : 2.09;
    const pts = known.filter(h => h.loc.lat).map(h => h.loc); const cen = pts.length ? { lat: pts.reduce((a, l) => a + l.lat, 0) / pts.length, lon: pts.reduce((a, l) => a + l.lon, 0) / pts.length } : null;
    const urban = ppp < 1.6; const km = cen ? 2 * hav(CFG.STATION, cen) + n * (urban ? 0.25 : 0.6) + 160 : 300;
    const inv = ppp * n, sh = share(), fuel = km * 10 / 100 * CFG.FUEL_PRICE, net = inv * sh - fuel;
    const avgNet = A().avgInvoiced(367) * sh - window.PYU.numOr(S.goals.fuel, 60);
    const verdict = net >= avgNet * 1.15 ? ['good', 'Accepter sans hésiter'] : net >= avgNet * 0.9 ? ['warn', 'Correcte, dans ta moyenne'] : ['bad', 'Demander un échange si possible'];
    $('#rs_out').innerHTML = `<div class="tiles">${[['Facturé estimé', money(inv)], ['Net (part Yacine)', money(inv * sh)], ['Km estimés (navette incluse)', fmt(km) + ' km'], ['Net après essence', money(net)]].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div></div>`).join('')}</div>
      <p style="margin-top:10px"><span class="pill ${verdict[0]}">${verdict[1]}</span> ${fmt(ppp, 2)} $/colis en moyenne sur ${known.length} zone${known.length > 1 ? 's' : ''} connue${known.length > 1 ? 's' : ''} (${[...new Set(known.map(h => h.loc.name))].slice(0, 5).join(', ')}). Ta journée moyenne vaut ${money(avgNet)} net après essence.</p>
      ${unknown.length ? `<p class="small muted">Codes inconnus (jamais livrés) : ${unknown.join(', ')}. Ils comptent à la moyenne générale.</p>` : ''}`;
  }

  /* ===== Mission de la semaine ===== */
  function renderMission() {
    const { S, fmt } = A(); const el = $('#mission'); if (!el) return;
    const ws = weekStart(todayISO()); const days = S.days.filter(d => d.date >= ws);
    const g = S.goals; const target = Math.floor(g.days);
    const farDays = days.filter(d => { const l = S.locstats.find(x => x.code === d.loc); return l && l.ppp >= 2.5; }).length;
    const fuelDays = days.filter(d => d.fuel != null && d.km != null).length;
    const streak = A().streak();
    const items = [
      { t: `Travailler ${target} jours`, v: days.length, max: target },
      { t: 'Au moins 1 route rurale éloignée (≥ 2,50 $/colis)', v: farDays, max: 1 },
      { t: 'Km et essence saisis chaque soir', v: fuelDays, max: Math.max(1, days.length) },
      { t: 'Moyenne de 170 colis par jour', v: days.length ? Math.round(days.reduce((a, d) => a + d.parcels, 0) / days.length) : 0, max: 170 }
    ];
    const done = items.filter(i => i.v >= i.max).length;
    el.innerHTML = `<div class="row" style="justify-content:space-between"><span class="pill ${done === items.length ? 'good' : 'warn'}">${done} / ${items.length} réussis</span><span class="small muted">série : ${streak} semaine${streak > 1 ? 's' : ''} (12 pour la phase 1)</span></div>
      ${items.map(i => `<div class="mi"><div class="row" style="justify-content:space-between"><span>${i.t}</span><b>${fmt(Math.min(i.v, i.max))} / ${i.max}</b></div><div class="bar"><i class="${i.v >= i.max ? 'good' : ''}" style="width:${Math.min(100, 100 * i.v / i.max)}%"></i></div></div>`).join('')}
      <div class="gate"><span>Série vers la phase 1</span><div class="dots">${Array.from({ length: 12 }, (_, i) => `<i class="${i < streak ? 'on' : ''}"></i>`).join('')}</div></div>`;
  }

  /* ===== Compte à rebours van ===== */
  function renderVanCountdown() {
    const { S, fmt, money, esc } = A(); const el = $('#vanCountdown'); if (!el) return;
    const down = A().vanDown(), vp = window.PYS && window.PYS.vanPlan ? window.PYS.vanPlan(down) : null;
    if (!vp) { el.innerHTML = '<p class="small muted">Ajoute un projet de type « Van » dans « Mes projets d’épargne » pour suivre la mise de fonds.</p>'; return; }
    const streak = A().streak(), min = Math.floor(+S.goals.days || 4);
    const dateTxt = vp.left <= 0 ? 'atteinte' : isFinite(vp.weeks) ? vp.date.toLocaleDateString('fr-CA', { month: 'short', year: 'numeric' }) : 'jamais';
    const conds = [[streak >= 12, `12 semaines consécutives à ${min} jours ou plus`, `${streak} / 12`], [vp.left <= 0, `${money(down)} de côté`, money(vp.saved)], [false, 'Réponse de la station sur les 280 pi³', 'à confirmer']];
    el.innerHTML = `<div class="tiles">${[['Reste avant la mise de fonds', money(vp.left)], ['Apport cette semaine', money(vp.weekly)], ['Semaines restantes', vp.left <= 0 ? '0' : isFinite(vp.weeks) ? fmt(vp.weeks) : '—'], ['Mise de fonds prévue', dateTxt]].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div></div>`).join('')}</div>
      <div class="bar" style="margin-top:10px"><i class="${vp.left <= 0 ? 'good' : ''}" style="width:${Math.min(100, 100 * vp.saved / (down || 1))}%"></i></div>
      <div style="margin-top:10px">${conds.map(c => `<div class="small"><span class="pill ${c[0] ? 'good' : 'warn'}">${c[0] ? 'OK' : 'En cours'}</span> ${c[1]} · ${c[2]}</div>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">Mêmes chiffres que le projet « ${esc(vp.goal.name)} » (prix visé ${money(vp.target)}).${!vp.weekly && vp.first ? ` L’épargne du van commence quand « ${esc(vp.first.name)} » est payé : la date en tient compte.` : ''}</p>`;
  }

  /* ===== Géolocalisation sur la carte et dans le monde ===== */
  function locateOnMap(map) {
    if (!navigator.geolocation) { A().toast('Pas de GPS sur cet appareil'); return; }
    navigator.geolocation.getCurrentPosition(p => {
      const { S, fmt } = A(); const me = { lat: p.coords.latitude, lon: p.coords.longitude };
      let best = null, bd = 1e9; S.locstats.filter(l => l.lat).forEach(l => { const d = hav(me, l); if (d < bd) { bd = d; best = l; } });
      if (map && window.L) { if (!window._meMarker) window._meMarker = L.circleMarker([me.lat, me.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#1f8a4c', fillOpacity: 1 }).addTo(map); else window._meMarker.setLatLng([me.lat, me.lon]); window._meMarker.bindPopup(`<b>Tu es ici</b><br>${best ? 'Zone la plus proche : ' + best.name + ' (' + fmt(bd, 1) + ' km), ' + fmt(best.ppp, 2) + ' $/colis' : ''}<br>Station DRUM : ${fmt(hav(me, CFG.STATION), 1)} km`).openPopup(); map.setView([me.lat, me.lon], 11); }
      A().toast(best ? `Zone la plus proche : ${best.name}, ${fmt(best.ppp, 2)} $/colis` : 'Position trouvée');
    }, err => A().toast('GPS refusé ou indisponible (' + err.message + ')'), { enableHighAccuracy: true, timeout: 15000 });
  }
  function locateInWorld() {
    if (!navigator.geolocation) { A().toast('Pas de GPS sur cet appareil'); return; }
    navigator.geolocation.getCurrentPosition(p => { if (window.PY_WORLD && window.PY_WORLD.teleport) window.PY_WORLD.teleport(p.coords.latitude, p.coords.longitude); A().toast('Camionnette placée à ta position'); }, err => A().toast('GPS refusé (' + err.message + ')'), { enableHighAccuracy: true, timeout: 15000 });
  }

  window.PYF = { openBrief, closeBrief, resumeShift, startShift, endShift, openEvening, closeEvening, auditInvoice, renderAudits, scoreRoute, renderMission, renderVanCountdown, locateOnMap, locateInWorld, renderShiftBar };
})();
