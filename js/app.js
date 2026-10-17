// Pilote Yacine : application. Données via window.PYDB ; l'historique des factures, les statistiques par localité
// et la grille tarifaire viennent de la table `reference` (derrière le PIN), jamais du dépôt public.
(function () {
  const CFG = window.PY_CONFIG, DB = window.PYDB;
  const $ = s => document.querySelector(s);
  const fmt = (n, d = 0) => (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (n, d = 0) => fmt(n, d) + ' $';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fdate = iso => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', ''); };
  // Message bref ; avec `action` ({ label, run }), un bouton (ex. « Annuler ») reste six secondes.
  const toast = (m, action) => {
    const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._x);
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = () => { t.classList.remove('on'); action.run(); }; t.appendChild(b); }
    t._x = setTimeout(() => t.classList.remove('on'), action ? 6000 : 2600);
  };

  // État chargé depuis la base
  let S = { days: [], goals: {}, localities: [], parcels: [], locstats: [], invoices: [] };
  let REF = { history: { days: [] }, locstats: [], tariffs: {} };
  let LOCBY = {}; let map = null, layer = null, selLoc = null, rankBy = 'ppp';
  const U = window.PYU;
  const share = () => S.goals.status === 'indep' ? 0.95 : 1 - U.numOr(S.goals.cut, 0.25);

  async function load() {
    const [days, goals, localities, parcels, invoices, ref] = await Promise.all([DB.getDays(), DB.getGoals(), DB.getLocalities(), DB.getParcelsSince(null), DB.getInvoices().catch(() => []), DB.getReference().catch(() => ({}))]);
    REF = { history: ref.history || { days: [] }, locstats: ref.locstats || [], tariffs: ref.tariffs || {} };
    window.PY_TARIFFS = REF.tariffs; const H = REF.history;
    const histEnd = H.days.reduce((m, d) => d.date > m ? d.date : m, '');
    S.invoices = invoices || [];
    S.goals = Object.assign({ days: 4.5, net: 4300, van: 8000, saved: 0, status: 'broker', fuel: 60, cut: 0.25 }, goals || {});
    S.localities = localities; LOCBY = {}; localities.forEach(l => LOCBY[l.code] = l);
    // journées : historique embarqué + base (la base l'emporte à date égale)
    const m = {};
    H.days.forEach(d => m[d.date] = { date: d.date, parcels: d.parcels, invoiced: d.invoiced, source: 'facture', loc: d.top[0] ? d.top[0].code : '', top: d.top });
    days.forEach(d => m[d.date] = Object.assign({}, m[d.date] || {}, d, { invoiced: +d.invoiced, parcels: +d.parcels, km: d.km == null ? null : +d.km, fuel: d.fuel == null ? null : +d.fuel }));
    S.days = Object.values(m).sort((a, b) => a.date < b.date ? -1 : 1);
    S.parcels = parcels;
    // stats par localité : historique + colis importés après la dernière journée de l'historique
    const ls = {}; REF.locstats.forEach(l => ls[l.code] = Object.assign({}, l, { zones: Object.assign({}, l.zones), dayset: null }));
    const extra = {};
    parcels.filter(p => p.date > histEnd).forEach(p => {
      const k = p.pc && p.pc[1] === '0' ? p.pc : (p.pc || '').slice(0, 3);
      const key = { G6P: 'G6', G6R: 'G6', G6S: 'G6', G6T: 'G6', J2B: 'J2', J2C: 'J2' }[k] || k;
      const e = extra[key] = extra[key] || { n: 0, rev: 0, days: new Set(), zones: {}, wt: 0 };
      e.n++; e.rev += +p.amt; e.days.add(p.date); e.zones[p.zone] = (e.zones[p.zone] || 0) + 1; e.wt += +p.wt || 0;
    });
    Object.entries(extra).forEach(([k, e]) => {
      const l = ls[k] || (ls[k] = { code: k, name: LOCBY[k] ? LOCBY[k].name : k, lat: LOCBY[k] ? LOCBY[k].lat : null, lon: LOCBY[k] ? LOCBY[k].lon : null, n: 0, rev: 0, days: 0, zones: {}, wt: 0 });
      l.wt = l.n + e.n ? ((l.wt || 0) * l.n + e.wt) / (l.n + e.n) : 0; l.n += e.n; l.rev += e.rev; l.days += e.days.size;
      Object.entries(e.zones).forEach(([z, c]) => l.zones[z] = (l.zones[z] || 0) + c);
    });
    Object.values(ls).forEach(l => { l.ppp = l.n ? l.rev / l.n : 0; if (LOCBY[l.code]) { l.lat = LOCBY[l.code].lat; l.lon = LOCBY[l.code].lon; l.name = LOCBY[l.code].name; } });
    S.locstats = Object.values(ls).filter(l => l.n > 0);
  }

  const weekStart = ds => window.PYU.weekStart(ds);
  // Semaines du lundi, de la première à la dernière journée connue. Une semaine sans travail apparaît à 0 jour :
  // la cacher ferait croire à des semaines consécutives et gonflerait les moyennes.
  function byWeek(days) {
    const m = {}; const blank = k => ({ wk: k, parcels: 0, inv: 0, days: 0, fuel: 0, km: 0 });
    days.forEach(d => { const k = weekStart(d.date); const w = (m[k] = m[k] || blank(k)); w.parcels += d.parcels; w.inv += d.invoiced; w.days++; w.fuel += d.fuel || 0; w.km += d.km || 0; });
    const ks = Object.keys(m).sort(); if (!ks.length) return [];
    const out = []; for (let k = ks[0]; k <= ks[ks.length - 1]; k = U.addDays(k, 7)) out.push(m[k] || blank(k));
    return out;
  }
  // Les n dernières semaines complètes (la semaine en cours, partielle, fausserait les moyennes).
  const recentWeeks = n => { const ws = weekStart(U.today()); return byWeek(S.days).filter(w => w.wk < ws).slice(-n); };
  const avgInvoiced = fallback => U.avgInvoiced(S.days, fallback);
  const goalDays = () => Math.floor(+S.goals.days || 4);
  const streak = () => U.streak(S.days, goalDays(), U.today());
  const fuelOf = d => d.fuel != null ? d.fuel : (+S.goals.fuel || 0);
  const locName = c => c && LOCBY[c] ? LOCBY[c].name : (c || '—');

  /* ---------- Tableau de bord ---------- */
  function renderDash() {
    const days = S.days, weeks = byWeek(days), sh = share();
    const ym = window.PYU.isoMonth(new Date());
    let monthDays = days.filter(d => d.date.startsWith(ym)), label = 'ce mois-ci';
    if (!monthDays.length && days.length) { const lm = days[days.length - 1].date.slice(0, 7); monthDays = days.filter(d => d.date.startsWith(lm)); label = 'dernier mois avec données (' + lm + ')'; }
    const inv = monthDays.reduce((a, d) => a + d.invoiced, 0), net = inv * sh;
    const monthBilled = U.billed(monthDays), parcels = monthBilled.reduce((a, d) => a + d.parcels, 0), pending = monthDays.length - monthBilled.length;
    const fuel = monthDays.reduce((a, d) => a + fuelOf(d), 0);
    const avgDay = avgInvoiced(0), nBilled = U.billed(days).length;
    $('#kpis').innerHTML = [
      ['Net ' + label, money(net), fmt(monthDays.length) + ' jours, ' + money(inv) + ' facturés' + (pending ? ' (' + pending + ' en attente de facture)' : '')],
      ['Après essence', money(net - fuel), money(fuel) + ' d’essence' + (monthDays.some(d => d.fuel == null) ? ' (en partie estimée)' : '')],
      ['Par jour travaillé', money(avgDay * sh), 'moyenne sur ' + nBilled + ' jours facturés, ' + money(avgDay) + ' facturés'],
      ['Revenu par colis', money(parcels ? monthBilled.reduce((a, d) => a + d.invoiced, 0) / parcels : 0, 2), fmt(parcels) + ' colis facturés ' + label],
      ['Objectif net mensuel', fmt(Math.min(999, Math.round(100 * net / (+S.goals.net || 1)))) + ' %', 'cible ' + money(+S.goals.net)],
      (() => { const ws = weekStart(window.PYU.today()); const wd = days.filter(d => d.date >= ws); return ['Cette semaine', wd.length + ' j', 'sur ' + fmt(S.goals.days, 1) + ' visés · ' + money(wd.reduce((a, d) => a + d.invoiced, 0) * sh) + ' net']; })()
    ].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div><div class="sub">${t[2]}</div></div>`).join('');
    $('#hdrinfo').textContent = days.length + ' journées, ' + fmt(days.reduce((a, d) => a + d.parcels, 0)) + ' colis';
    $('#chWeeks').innerHTML = barChart(weeks.slice(-14).map(w => ({ x: w.wk.slice(5), y: w.inv * sh, sub: w.days + ' j' })), { goal: (+S.goals.net || 0) / 4.33 });
    $('#chPpp').innerHTML = lineChart(U.billed(days).slice(-20).map(d => ({ x: d.date.slice(5), y: d.parcels ? d.invoiced / d.parcels : 0, lab: d.date })));
    const g = S.goals, target = +g.net || 0, pct = target ? Math.min(100, 100 * net / target) : 0, dayNet = avgDay * sh, remaining = Math.max(0, target - net), daysLeft = dayNet ? Math.ceil(remaining / dayNet) : 0;
    $('#goalMini').innerHTML = `<div class="kv"><span>Net ${label}</span><b>${money(net)} / ${money(target)}</b></div><div class="bar"><i class="${pct >= 100 ? 'good' : ''}" style="width:${pct}%"></i></div>
      <p class="small muted" style="margin-top:8px">${remaining > 0 ? `Il manque ${money(remaining)}${daysLeft ? ` : environ ${daysLeft} journée${daysLeft > 1 ? 's' : ''} au rythme moyen` : ''}.` : 'Objectif atteint.'}</p>
`;
    $('#lastDays').innerHTML = '<tr><th>Date</th><th>Zone</th><th class="num">Colis</th><th class="num">Facturé</th><th class="num hide-sm">$/colis</th></tr>' + days.slice(-8).reverse().map(d => `<tr><td title="${d.date}">${fdate(d.date)}</td><td>${esc(locName(d.loc))}</td><td class="num">${d.parcels}</td><td class="num">${d.invoiced > 0 ? money(d.invoiced, 2) : '<span class="muted small">en attente</span>'}</td><td class="num hide-sm">${d.parcels && d.invoiced > 0 ? fmt(d.invoiced / d.parcels, 2) : ''}</td></tr>`).join('');
  }
  function barChart(pts, o) {
    const W = 560, Hh = 220, pl = 44, pr = 10, pt = 14, pb = 34; if (!pts.length) return '<p class="muted small">Pas encore de données.</p>';
    const max = Math.max(o.goal || 0, ...pts.map(p => p.y)) * 1.08 || 1, bw = (W - pl - pr) / pts.length, y = v => pt + (Hh - pt - pb) * (1 - v / max);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${Hh}">`;
    for (let i = 0; i <= 4; i++) { const v = max * i / 4; s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
    pts.forEach((p, i) => { const x = pl + i * bw + bw * 0.15, w = bw * 0.7; s += `<rect class="b ${i === pts.length - 1 ? 'cur' : ''}" x="${x}" y="${y(p.y)}" width="${w}" height="${Math.max(0, y(0) - y(p.y))}" rx="3"><title>Semaine du ${p.x} : ${money(p.y)} (${p.sub})</title></rect>${pts.length <= 8 || (pts.length - 1 - i) % 2 === 0 ? `<text x="${x + w / 2}" y="${Hh - pb + 14}" text-anchor="middle">${p.x}</text>` : ''}`; if (i === pts.length - 1) s += `<text class="direct" x="${x + w / 2}" y="${y(p.y) - 5}" text-anchor="middle">${money(p.y)}</text>`; });
    if (o.goal) s += `<line class="goal" x1="${pl}" x2="${W - pr}" y1="${y(o.goal)}" y2="${y(o.goal)}"/><text class="goal-lab" x="${pl + 4}" y="${y(o.goal) - 6}" text-anchor="start">objectif ${money(o.goal)} / sem.</text>`;
    return s + '</svg>';
  }
  function lineChart(pts) {
    const W = 560, Hh = 220, pl = 44, pr = 14, pt = 16, pb = 34; if (pts.length < 2) return '<p class="muted small">Pas encore assez de données.</p>';
    const ys = pts.map(p => p.y), min = Math.floor(Math.min(...ys) * 0.9 * 4) / 4, max = Math.ceil(Math.max(...ys) * 1.05 * 4) / 4;
    const x = i => pl + (W - pl - pr) * i / (pts.length - 1), y = v => pt + (Hh - pt - pb) * (1 - (v - min) / (max - min || 1));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${Hh}">`;
    for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4; s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, 2)}</text>`; }
    s += `<path class="l" d="${pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' ')}"/>`;
    const st = Math.ceil(pts.length / 7);
    pts.forEach((p, i) => { s += `<circle class="pt" cx="${x(i)}" cy="${y(p.y)}" r="4"><title>${p.lab} : ${fmt(p.y, 2)} $/colis</title></circle>`; if ((i % st === 0 && pts.length - 1 - i >= st / 2) || i === pts.length - 1) s += `<text x="${x(i)}" y="${Hh - pb + 14}" text-anchor="${i === pts.length - 1 ? 'end' : 'middle'}">${p.x}</text>`; });
    const l = pts[pts.length - 1]; s += `<text class="direct" x="${x(pts.length - 1) - 6}" y="${y(l.y) - 8}" text-anchor="end">${fmt(l.y, 2)} $</text>`;
    return s + '</svg>';
  }

  /* ---------- Carte (Leaflet + OpenStreetMap) ---------- */
  // Rampe et contour partagés avec le monde à conduire (PYU.seqColor) ; le rouge de marque marque la sélection.
  // Leaflet écrit ses couleurs en attributs SVG, qui n'acceptent pas var() : on passe des valeurs résolues.
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (map && !$('#v-map').hidden) renderMap(); }); } catch (e) { /* vieux navigateurs */ } }
  function renderMap() {
    renderRank();
    if (!window.L) return;
    if (!map) {
      map = L.map('map', { scrollWheelZoom: true }).setView([45.88, -72.25], 9);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      L.marker([CFG.STATION.lat, CFG.STATION.lon], { icon: L.divIcon({ className: '', html: '<div class="map-pin station"></div>', iconSize: [16, 16] }) }).addTo(map).bindPopup('<b>' + esc(CFG.STATION.name) + '</b><br>Point de départ des routes');
      L.marker([CFG.HOME.lat, CFG.HOME.lon], { icon: L.divIcon({ className: '', html: '<div class="map-pin home"></div>', iconSize: [14, 14] }) }).addTo(map).bindPopup('<b>' + esc(CFG.HOME.name) + '</b><br>Environ 80 km de la station, 30 $ d’essence par jour aller-retour');
      $('#legend').innerHTML = `<div><span class="sw" style="background:var(--seq1)"></span>≈1,30 $/colis</div><div><span class="sw" style="background:var(--seq3)"></span>≈2,20 $/colis</div><div><span class="sw" style="background:var(--seq5)"></span>≈3,00 $/colis et plus</div><div><span class="sw station"></span>station de départ</div><div><span class="sw sel"></span>localité choisie</div>`;
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const maxN = Math.max(1, ...S.locstats.map(l => l.n));
    const dark = U.isDark(), edge = U.SEQ_EDGE[dark ? 'dark' : 'light'], brand = U.cssVar('--brand', dark ? '#FF3B3B' : '#C7000B');
    S.locstats.filter(l => l.lat && l.lon).sort((a, b) => b.n - a.n).forEach(l => {
      const c = L.circleMarker([l.lat, l.lon], { radius: 6 + 20 * Math.sqrt(l.n / maxN), color: selLoc === l.code ? brand : edge, weight: selLoc === l.code ? 3 : 1.5, fillColor: U.seqColor(l.ppp, dark), fillOpacity: .9 });
      c.bindTooltip(`<b>${esc(l.name)}</b><br>${fmt(l.n)} colis sur ${l.days} jour${l.days > 1 ? 's' : ''}<br>${fmt(l.ppp, 2)} $/colis`);
      c.on('click', () => selectLoc(l.code));
      c.addTo(layer);
    });
    setTimeout(() => map.invalidateSize(), 50);
    renderRank();
  }
  function selectLoc(code) {
    selLoc = code; renderMap();
    const l = S.locstats.find(x => x.code === code); if (!l) return;
    if (l.lat && l.lon) map.panTo([l.lat, l.lon]);
    const sh = share(), routeVal = l.ppp * 180;
    const zones = Object.entries(l.zones || {}).sort((a, b) => b[1] - a[1]).map(z => z[0].replace('ZONE_', 'zone ') + ' (' + z[1] + ')').join(', ');
    let verdict, cls; if (l.ppp >= 2.6) { verdict = 'À demander en priorité : une des zones les mieux payées.'; cls = 'good'; } else if (l.ppp >= 2.0) { verdict = 'Bonne zone, revenu dans la moyenne haute.'; cls = 'good'; } else if (l.ppp >= 1.7) { verdict = 'Correct, sans plus.'; cls = 'warn'; } else { verdict = 'Zone urbaine dense : beaucoup de colis, peu de revenu. À éviter si le choix existe.'; cls = 'bad'; }
    $('#locDetail').innerHTML = `<h2>${esc(l.name)} <span class="pill">${esc(l.code)}</span></h2>
      <div class="kv"><span>Colis observés</span><b>${fmt(l.n)} sur ${l.days} journée${l.days > 1 ? 's' : ''}</b><span>Revenu par colis</span><b>${fmt(l.ppp, 2)} $</b><span>Facturé par journée où elle apparaît</span><b>${money(l.rev / (l.days || 1))}</b><span>Poids moyen</span><b>${l.wt ? fmt(l.wt, 1) + ' lb' : '—'}</b><span>Zones tarifaires Intelcom</span><b>${zones || '—'}</b></div>
      <hr><p><span class="pill ${cls}">${cls === 'good' ? 'Privilégier' : cls === 'warn' ? 'Neutre' : 'Éviter'}</span> ${verdict}</p>
      <p class="small muted">Une route complète de 180 colis dans cette zone vaudrait environ ${money(routeVal)} facturés, soit ${money(routeVal * sh)} net pour Yacine.</p>`;
    document.querySelectorAll('.rank .it').forEach(it => it.classList.toggle('sel', it.dataset.code === code));
  }
  function renderRank() {
    const locs = S.locstats.filter(l => l.n >= 10);
    const key = { ppp: l => l.ppp, rev: l => l.rev, n: l => l.n, day: l => l.rev / (l.days || 1) }[rankBy];
    const fv = { ppp: l => fmt(l.ppp, 2) + ' $', rev: l => money(l.rev), n: l => fmt(l.n), day: l => money(l.rev / (l.days || 1)) }[rankBy];
    locs.sort((a, b) => key(b) - key(a));
    $('#rank').innerHTML = locs.slice(0, 12).map((l, i) => `<div class="it ${selLoc === l.code ? 'sel' : ''}" data-code="${esc(l.code)}" role="button" tabindex="0"><div class="n">${i + 1}</div><div><div class="t">${esc(l.name)}</div><div class="s">${fmt(l.n)} colis · ${l.days} j</div></div><div class="v">${fv(l)}</div></div>`).join('');
    $('#rank').querySelectorAll('.it').forEach(it => { it.onclick = () => selectLoc(it.dataset.code); it.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLoc(it.dataset.code); } }; });
  }
  $('#rankBy').onchange = e => { rankBy = e.target.value; renderRank(); };

  /* ---------- Journal ---------- */
  function fillLocSelect() { $('#f_loc').innerHTML = '<option value="">—</option>' + S.localities.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(l => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join(''); }
  $('#dayForm').addEventListener('submit', async e => {
    e.preventDefault();
    const date = $('#f_date').value; if (!date) return;
    const ex = S.days.find(d => d.date === date) || {};
    const v = id => $(id).value;
    const row = { date, parcels: v('#f_parcels') !== '' ? +v('#f_parcels') : (ex.parcels || 0), invoiced: v('#f_inv') !== '' ? +v('#f_inv') : (ex.invoiced || 0), km: v('#f_km') !== '' ? +v('#f_km') : (ex.km ?? null), fuel: v('#f_fuel') !== '' ? +v('#f_fuel') : (ex.fuel ?? null), loc: v('#f_loc') || ex.loc || null, note: v('#f_note').trim() || ex.note || null, source: ex.source === 'facture' ? 'facture' : 'saisie' };
    try { await DB.upsertDay(row); toast('Journée du ' + date + ' enregistrée'); e.target.reset(); $('#f_date').value = window.PYU.today(); $('#f_del').hidden = true; await refresh(); }
    catch (err) { toast('Enregistrement refusé : ' + err.message); }
  });
  $('#f_date').addEventListener('change', () => { const ex = S.days.find(d => d.date === $('#f_date').value); $('#f_del').hidden = !(ex && ex.driver); if (!ex) return; $('#f_parcels').value = ex.parcels || ''; $('#f_inv').value = ex.invoiced || ''; $('#f_km').value = ex.km ?? ''; $('#f_fuel').value = ex.fuel ?? ''; $('#f_loc').value = ex.loc || ''; $('#f_note').value = ex.note || ''; });
  // Suppression immédiate mais réversible : la journée effacée peut être remise pendant six secondes.
  async function deleteDay(date) {
    const d = S.days.find(x => x.date === date); if (!d || !d.driver) return; const keep = DAY_COLS.reduce((o, k) => { if (d[k] !== undefined) o[k] = d[k]; return o; }, {});
    try { await DB.deleteDay(d.date); await refresh(); toast('Journée du ' + fdate(d.date) + ' supprimée', { label: 'Annuler', run: async () => { try { await DB.upsertDay(keep); toast('Journée remise'); await refresh(); } catch (err) { toast(err.message); } } }); } catch (err) { toast(err.message); }
  }
  $('#f_del').onclick = async () => { const date = $('#f_date').value; $('#dayForm').reset(); $('#f_date').value = U.today(); $('#f_del').hidden = true; await deleteDay(date); };
  let logAll = false;
  const DAY_COLS = ['date', 'driver', 'parcels', 'invoiced', 'km', 'fuel', 'loc', 'note', 'source'];
  function renderLog() {
    $('#storageMode').textContent = DB.mode() === 'supabase' ? 'Données partagées (Supabase)' : 'Mode local : données gardées dans ce navigateur seulement';
    const all = S.days.slice().reverse(); const rows = logAll ? all : all.slice(0, 12);
    $('#logTable').innerHTML = '<tr><th>Date</th><th class="hide-sm">Zone</th><th class="num">Colis</th><th class="num">Facturé</th><th class="num hide-sm">Km</th><th class="num">Essence</th><th class="hide-sm">Note</th><th class="hide-sm"></th></tr>' + rows.map(d => `<tr${d.driver ? ` data-day="${d.date}"` : ''}><td title="${d.date}">${fdate(d.date)}${d.source === 'saisie' ? ' <span class="pill good">saisie</span>' : ''}</td><td class="hide-sm">${esc(d.top && !d.loc ? d.top.slice(0, 2).map(t => t.name).join(', ') : locName(d.loc))}</td><td class="num">${d.parcels}</td><td class="num">${d.invoiced > 0 ? money(d.invoiced, 2) : '<span class="muted small">en attente</span>'}</td><td class="num hide-sm">${d.km != null ? d.km : '—'}</td><td class="num">${d.fuel != null ? money(d.fuel) : '—'}</td><td class="small hide-sm">${esc(d.note || '')}</td><td class="hide-sm">${d.driver ? `<button class="btn danger del" data-del="${d.date}" aria-label="Supprimer la journée du ${fdate(d.date)}"><span aria-hidden="true">×</span><span class="lbl"> Supprimer</span></button>` : ''}</td></tr>`).join('');
    // Toucher une journée la charge dans le formulaire (sur téléphone, c'est là que se trouve « Supprimer »).
    $('#logTable').querySelectorAll('tr[data-day]').forEach(tr => tr.onclick = e => { if (e.target.closest('button')) return; $('#f_date').value = tr.dataset.day; $('#f_date').dispatchEvent(new Event('change')); $('#dayForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#logTable').querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteDay(b.dataset.del));
    renderBackup();
    const more = $('#logMore'); more.hidden = logAll || all.length <= 12; more.textContent = `Afficher les ${all.length} journées`;
    more.onclick = () => { logAll = true; renderLog(); };
  }
  /* ---------- Sauvegarde ---------- */
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0); }
  $('#btnExport').onclick = () => {
    // Mode local : tout le stockage du navigateur, restaurable. Mode Supabase : copie de ce qui est affiché.
    const text = DB.mode() === 'local' ? DB.exportLocal() : JSON.stringify({ exported_at: new Date().toISOString(), days: S.days.filter(d => d.driver).map(d => DAY_COLS.reduce((o, k) => (o[k] = d[k] ?? null, o), {})), invoices: S.invoices, goals: S.goals, savings: window.PYS ? window.PYS.goals : [] }, null, 1);
    download('pilote-yacine-' + U.today() + '.json', text); toast('Sauvegarde téléchargée');
  };
  $('#restoreWrap').onclick = () => $('#restoreFile').click();
  $('#restoreFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const readText = file => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsText(file); });
    try { DB.importLocal(await readText(f)); toast('Sauvegarde restaurée'); await refresh(); } catch (err) { toast('Fichier refusé : ce n’est pas une sauvegarde de Pilote Yacine'); }
    e.target.value = '';
  };
  function renderBackup() {
    const local = DB.mode() === 'local'; $('#restoreWrap').hidden = !local;
    $('#backupHint').textContent = local ? 'En mode local, tout vit dans ce navigateur : vider le cache efface tout. Une sauvegarde par semaine suffit.' : 'Copie de tes journées, factures et projets, à garder en lieu sûr.';
  }

  (function dropZone() {
    const z = $('#pdfDrop'), inp = $('#pdfFile'); if (!z) return;
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { inp.files = e.dataTransfer.files; inp.dispatchEvent(new Event('change')); } });
  })();
  $('#pdfFile').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    const st = $('#pdfStatus'); st.textContent = 'Lecture…';
    for (const f of files) {
      try {
        const r = await window.PYPDF.parseInvoice(f);
        await DB.importInvoice(r.inv, r.parcels, r.days);
        try { const audit = window.PYF.auditInvoice(r.inv, r.parcels, r.days, S.days, r.meta); await DB.saveAudit(r.inv.week, audit); } catch (ae) { console.warn(ae); }
        st.innerHTML += `<div><span class="pill good">Importé</span> ${esc(f.name)} : semaine ${esc(r.inv.week)}, ${r.days.length} journées, ${r.parcels.length} colis, total facture ${money(r.inv.total, 2)}</div>`;
      } catch (err) { st.innerHTML += `<div><span class="pill bad">Échec</span> ${esc(f.name)} : ${esc(err.message)}</div>`; }
    }
    e.target.value = ''; await refresh();
  });

  /* ---------- Objectifs ---------- */
  function fillGoals() { const g = S.goals; $('#g_days').value = g.days; $('#g_net').value = g.net; $('#g_status').value = g.status; $('#g_fuel').value = g.fuel; $('#g_cut').value = Math.round(U.numOr(g.cut, 0.25) * 100); }
  $('#goalForm').addEventListener('submit', async e => { e.preventDefault(); const g = { days: +$('#g_days').value || 4.5, net: +$('#g_net').value || 0, van: U.numOr(S.goals.van, 8000), saved: +S.goals.saved || 0, status: $('#g_status').value, fuel: U.numOr($('#g_fuel').value, 0), cut: U.numOr($('#g_cut').value, 25) / 100 }; try { await DB.saveGoals(g); toast('Objectifs enregistrés'); await refresh(); } catch (err) { toast(err.message); } });
  // Mise de fonds exigée par le plan avant d'acheter le van (règle de la phase 0). L'épargne vient du projet « van ».
  const vanDown = () => U.numOr(S.goals.van, 8000);
  const fdate2 = d => d ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  function renderGoals() {
    const g = S.goals, sh = share(), min = goalDays();
    const recent = U.pastWeeks(S.days, U.today(), 12), ok = recent.filter(w => w.days >= min).length;
    const st = streak();
    const avgDay = avgInvoiced(0) * sh;
    const needDaysMonth = g.net && avgDay ? Math.ceil(g.net / avgDay) : 0;
    const vp = window.PYS && window.PYS.vanPlan ? window.PYS.vanPlan(vanDown()) : null;
    const vanTxt = !vp ? 'aucun projet « van » dans l’épargne' : vp.left <= 0 ? money(vp.saved) + ' de côté : mise de fonds atteinte' : money(vp.left) + (isFinite(vp.weeks) ? ` · ${vp.weeks} sem. (${fdate2(vp.date)})` : ' · jamais au rythme actuel');
    $('#goalDetail').innerHTML = `<div class="kv">
      <span>Semaines consécutives à ${min} jours ou plus</span><b>${st} <span class="pill ${st >= 12 ? 'good' : st >= 6 ? 'warn' : 'bad'}">cible 12</span></b>
      <span>Semaines réussies sur les ${recent.length} dernières</span><b>${ok} / ${recent.length}</b>
      <span>Net moyen par jour (statut ${g.status === 'indep' ? 'indépendant' : 'broker ' + Math.round(U.numOr(g.cut, .25) * 100) + ' %'})</span><b>${money(avgDay)}</b>
      <span>Jours nécessaires pour ${money(g.net)} net</span><b>${needDaysMonth} par mois (${fmt(needDaysMonth / 4.33, 1)} par semaine)</b>
      <span>Reste avant la mise de fonds du van (${money(vanDown())})</span><b>${vanTxt}</b></div>
      <p class="small muted" style="margin-top:10px">Règle du plan : acheter le van seulement après 12 semaines consécutives à ${min} jours ou plus et ${money(vanDown())} de côté dans le projet « van ».</p>`;
    const pill = (ok, txt) => `<span class="pill ${ok ? 'good' : 'warn'}">${ok ? 'Atteint' : txt}</span>`;
    const saved = vp ? vp.saved : 0;
    $('#st0').innerHTML = pill(st >= 12 && saved >= vanDown(), 'En cours : ' + st + '/12 sem., ' + money(saved) + '/' + money(vanDown()));
    $('#st1').innerHTML = g.status === 'indep' ? pill(false, 'En cours') : '<span class="pill">À venir</span>';
    $('#st2').innerHTML = '<span class="pill">À venir</span>'; $('#st3').innerHTML = '<span class="pill">À venir</span>';
  }

  /* ---------- Simulateur ---------- */
  function renderSim() {
    const v = id => +$(id).value; const days = v('#s_days'), rev = v('#s_rev'), km = v('#s_km'), l = v('#s_l'), fuel = v('#s_fuel'), cut = v('#s_cut') / 100, van = v('#s_van'), fix = v('#s_fix'), rate = v('#s_rate') / 100;
    $('#o_days').value = fmt(days, 1); $('#o_rev').value = money(rev); $('#o_km').value = km + ' km'; $('#o_l').value = l + ' L'; $('#o_fuel').value = fmt(fuel, 2) + ' $'; $('#o_cut').value = fmt(cut * 100) + ' %'; $('#o_van').value = money(van); $('#o_fix').value = money(fix); $('#o_rate').value = rate ? fmt(rate * 100, 1) + ' %' : 'comptant';
    const dpm = days * 4.33, gross = dpm * rev, fuelM = dpm * km * l / 100 * fuel, brokerNet = gross * (1 - cut) - fuelM;
    const pay = rate ? van * (rate / 12) / (1 - Math.pow(1 + rate / 12, -36)) : 0, indepNet = gross * 0.95 - fuelM - fix - pay;
    const gainCash = gross * (cut - 0.05) - fix, payback = gainCash > 0 ? van / gainCash : Infinity, diff = indepNet - brokerNet;
    // Facturé mensuel à partir duquel l'indépendance (van payé) rattrape le broker : les 5 % de CNESST contre la commission.
    const seuil = cut > 0.05 ? fix / (cut - 0.05) : Infinity;
    const line = (k, v) => `<span>${k}</span><b>${v}</b>`;
    $('#simOut').innerHTML = `<div class="kv">${line('Jours par mois', fmt(dpm, 1))}${line('Facturé par mois', money(gross))}${line('Essence par mois', money(fuelM) + ' (' + money(km * l / 100 * fuel) + ' par jour)')}</div><hr>
      <div class="kv">${line('Net chez le broker (' + fmt(cut * 100) + ' %), après essence', '<span style="font-family:var(--mono);font-size:22px">' + money(brokerNet) + '</span>')}
      ${line('Net indépendant (CNESST 5 %), après essence, fixes' + (pay ? ' et paiement du van (' + money(pay) + '/mois sur 3 ans)' : ''), '<span style="font-family:var(--mono);font-size:22px">' + money(indepNet) + '</span>')}
      </div><div class="hero-diff ${diff > 0 ? 'up' : 'down'}"><span class="lab">Écart par mois, indépendant moins broker</span><span class="val">${diff > 0 ? '+' : ''}${money(diff)}</span></div>
      <div class="kv">${line('Gain indépendant vs broker, van payé comptant', money(gainCash) + ' par mois')}${line('Délai de remboursement du van', isFinite(payback) ? fmt(payback, 1) + ' mois' : 'jamais à ce rythme')}${line('Facturé mensuel où l’indépendance rattrape le broker (van payé)', isFinite(seuil) ? money(seuil) + ' (' + fmt(seuil / rev, 1) + ' jours)' : 'jamais : commission trop basse')}</div>
      <p class="small muted" style="margin-top:10px">${diff > 0 ? `À ce rythme, l’indépendance rapporte ${money(diff * 12)} de plus par an.` : `À ce rythme, rester chez le broker rapporte plus.${isFinite(seuil) ? ` Il faut ${fmt(seuil / rev / 4.33, 1)} jours par semaine (van payé) pour que l’indépendance rattrape le broker.` : ''}`}</p>`;
  }
  document.querySelectorAll('#v-sim input[type=range]').forEach(r => r.addEventListener('input', renderSim));

  /* ---------- Optimisation ---------- */
  function renderTips() {
    const sh = share(), locs = S.locstats, out = [];
    const add = (cls, t, b, kpi) => out.push(`<div class="a ${cls} ${kpi ? 'has-kpi' : ''}"><i></i><div class="txt"><b>${t}</b><span class="small">${b}</span></div>${kpi ? `<div class="kpi">${kpi}</div>` : ''}</div>`);
    const good = locs.filter(l => l.n >= 40 && l.ppp >= 2.5).sort((a, b) => b.ppp - a.ppp), bad = locs.filter(l => l.n >= 40 && l.ppp < 1.6);
    const badP = bad.length ? bad[0].ppp : 1.46;
    if (good.length) add('', 'Demander les routes ' + good.slice(0, 3).map(l => l.name).join(', '), `Revenu observé de ${fmt(good[0].ppp, 2)} $ par colis contre ${fmt(badP, 2)} $ en zone urbaine. Même nombre de colis, ${fmt(100 * (good[0].ppp / badP - 1))} % de revenu en plus par journée.`, '+' + money((good[0].ppp - badP) * 180 * sh) + ' / j');
    if (bad.length) add('warn', 'Éviter les routes ' + bad.map(l => l.name).join(' et ') + ' quand le choix existe', `Secteur dense mais payé ${fmt(bad[0].ppp, 2)} $ par colis : les journées les moins payées de l’historique.`, fmt(bad[0].ppp, 2) + ' $ / colis');
    const withFuel = S.days.filter(d => d.fuel && d.km);
    if (withFuel.length >= 3) { const km = withFuel.reduce((a, e) => a + e.km, 0), f = withFuel.reduce((a, e) => a + e.fuel, 0), perKm = f / km, per100 = perKm / CFG.FUEL_PRICE * 100; add(per100 > 12 ? 'warn' : '', `Coût réel d’essence : ${fmt(perKm, 3)} $ par km (${money(f / withFuel.length)} par jour)`, `Sur ${withFuel.length} journées saisies. À ${fmt(CFG.FUEL_PRICE, 2)} $/L, environ ${fmt(per100, 1)} L/100 km${per100 > 12 ? ' : élevé pour un Transit Connect, vérifier pression des pneus, climatisation et moteur tournant à l’arrêt.' : ', dans la norme pour ce véhicule.'}`, fmt(perKm, 2) + ' $ / km'); }
    else add('warn', 'Saisir km et essence pendant 10 journées', 'Sans ces deux chiffres, l’essence est estimée à ' + money(+S.goals.fuel || 0) + ' par jour. Le vrai chiffre décide si l’indépendance est rentable et de combien.', money(+S.goals.fuel || 0) + ' / j estimés');
    // Navette : distance à vol d'oiseau entre la maison et la station, majorée de 15 % pour la route, à 10 L/100 km.
    const R = 6371, rad = x => x * Math.PI / 180, h = CFG.HOME, st = CFG.STATION;
    const crow = 2 * R * Math.asin(Math.sqrt(Math.sin(rad(st.lat - h.lat) / 2) ** 2 + Math.cos(rad(h.lat)) * Math.cos(rad(st.lat)) * Math.sin(rad(st.lon - h.lon) / 2) ** 2));
    const commKm = Math.round(crow * 1.15) * 2, commDay = commKm * 10 / 100 * CFG.FUEL_PRICE, perYear = Math.round((+S.goals.days || 4.5) * 52);
    add('', `La navette ${esc(h.name)} à ${esc(st.name)} coûte environ ${money(commDay)} par jour`, `Environ ${commKm} km aller-retour, ${fmt(commKm / 10)} L d’essence à ${fmt(CFG.FUEL_PRICE, 2)} $/L. Sur ${perYear} jours par an (${fmt(+S.goals.days || 4.5, 1)} jours par semaine), ${money(commDay * perYear)}. À garder en tête pour le choix d’un logement ou d’une station.`, money(commDay * perYear) + ' / an');
    const recent = U.pastWeeks(S.days, U.today(), 12), min = goalDays(), full = recent.filter(w => w.days >= min).length, dayNet = avgInvoiced(367) * sh;
    add(full >= 8 ? '' : 'warn', `${full} semaine${full > 1 ? 's' : ''} sur les ${recent.length} dernières à ${min} jours ou plus`, 'Chaque journée vaut environ ' + money(dayNet) + ' net. Un jour de plus par semaine ajoute environ ' + money(dayNet * 4.33) + ' net par mois sans rien changer d’autre.', full + ' / ' + recent.length + ' sem.');
    add('bad', 'Photographier chaque dépôt de colis', 'Un colis déclaré perdu peut être déduit pour sa pleine valeur, parfois plus d’une journée de net. La photo horodatée est la seule défense ; contester chaque déduction par écrit au broker.');
    add('warn', 'Carte de crédit : rester sous 30 % d’utilisation', 'Au-dessus, la cote de crédit baisse, ce qui renchérit le financement du van. Demander une hausse de limite ou payer en milieu de cycle.');
    // Colis lourds : calculé sur les colis importés (factures), seulement s'il y en a assez pour conclure.
    const heavy = S.parcels.filter(p => +p.wt > 30), allAmt = S.parcels.reduce((a, p) => a + +p.amt, 0);
    if (heavy.length >= 10) { const hAmt = heavy.reduce((a, p) => a + +p.amt, 0); add('', 'Les colis lourds paient plus', `${fmt(heavy.length)} colis de plus de 30 lb ont rapporté ${money(hAmt)} sur les factures importées, soit ${fmt(hAmt / heavy.length, 2)} $ chacun contre ${fmt(allAmt / S.parcels.length, 2)} $ en moyenne.`, fmt(hAmt / heavy.length, 2) + ' $ / colis'); }
    $('#advice').innerHTML = out.join('');
  }


  /* ---------- Monde à conduire ---------- */
  let worldOn = false;
  function startWorld() {
    if (!window.PY_WORLD || worldOn) return; worldOn = true;
    window.PY_WORLD.start({ canvas: $('#world'), locs: S.locstats, station: CFG.STATION, home: CFG.HOME,
      onArrive: l => {
        const sh = share(), cls = l.ppp >= 2.6 ? 'good' : l.ppp >= 2.0 ? 'good' : l.ppp >= 1.7 ? 'warn' : 'bad';
        const p = $('#worldLoc'); p.hidden = false;
        p.innerHTML = `<h2 style="margin:0 0 4px">${esc(l.name)} <span class="pill ${cls}">${cls === 'good' ? 'Privilégier' : cls === 'warn' ? 'Neutre' : 'Éviter'}</span></h2>
          <div class="kv"><span>Revenu par colis</span><b>${fmt(l.ppp, 2)} $</b><span>Colis livrés ici</span><b>${fmt(l.n)} sur ${l.days} j</b><span>Une route de 180 colis</span><b>${money(l.ppp * 180)} facturés · ${money(l.ppp * 180 * sh)} net</b></div>
          <div class="row" style="margin-top:8px"><button class="btn" data-detail="${esc(l.code)}" style="padding:6px 12px">Voir le détail</button></div>`;
        p.querySelector('[data-detail]').onclick = () => { goTab('map'); selectLoc(l.code); };
      },
      onLeave: () => { $('#worldLoc').hidden = true; } });
    $('#destSel').innerHTML = '<option value="">Choisir une destination</option>' + S.locstats.filter(l => l.lat).sort((a, b) => b.ppp - a.ppp).map(l => `<option value="${esc(l.code)}">${esc(l.name)} · ${fmt(l.ppp, 2)} $/colis</option>`).join('');
  }
  function stopWorld() { if (worldOn && window.PY_WORLD) { window.PY_WORLD.stop(); worldOn = false; } }
  $('#destSel').onchange = e => { if (e.target.value) { window.PY_WORLD.driveTo(e.target.value); $('#worldHint').textContent = 'Conduite automatique vers ' + e.target.selectedOptions[0].textContent.split(' · ')[0] + ' (toucher une flèche reprend la main)'; } };
  $('#btnRealMap').onclick = () => goTab('map');
  (function joystick() {
    const j = $('#joy'), k = j.querySelector('.knob'); let id = null;
    const set = (ev) => { const r = j.getBoundingClientRect(); const t = ev.touches ? ev.touches[0] : ev; let x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2); const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } k.style.transform = `translate(${x * 36}px,${y * 36}px)`; window.PY_WORLD.setJoystick(x, y, true); };
    const end = () => { k.style.transform = ''; window.PY_WORLD.setJoystick(0, 0, false); };
    j.addEventListener('pointerdown', e => { j.setPointerCapture(e.pointerId); set(e); }); j.addEventListener('pointermove', e => { if (e.pressure > 0 || e.buttons) set(e); }); j.addEventListener('pointerup', end); j.addEventListener('pointercancel', end);
  })();

  /* ---------- Compteurs animés ---------- */
  function animateCounters(root) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('.tile .val').forEach(el => {
      const txt = el.dataset.final || el.textContent; el.dataset.final = txt; const m = txt.match(/^(-?[\d\s\u00a0]+?)(,\d+)?\s*([^\d\s\u00a0].*)?$/); if (!m) return;
      const target = parseFloat(m[1].replace(/[\s\u00a0]/g, '') + (m[2] ? m[2].replace(',', '.') : '')); const dec = m[2] ? m[2].length - 1 : 0; const suffix = m[3] ? ' ' + m[3].trim() : '';
      const t0 = performance.now(), dur = 900;
      const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(target * e, dec) + suffix; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  /* ---------- Fenêtres (brief, soir, épargne) : focus, Tab, Échap ---------- */
  // À l'ouverture, le focus entre dans la fenêtre et y reste (Tab boucle) ; Échap ferme comme « Plus tard »,
  // « Fermer » ou « Annuler » ; à la fermeture, le focus revient au bouton qui l'avait ouverte.
  const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const CLOSE = { brief: '#briefSkip', evening: '#evClose', modal: '[id$="_cancel"]' };
  Object.keys(CLOSE).forEach(id => {
    const el = document.getElementById(id); if (!el) return; let back = null;
    new MutationObserver(() => {
      if (!el.hidden && !el._open) { el._open = true; back = document.activeElement; setTimeout(() => { const f = [...el.querySelectorAll(FOCUSABLE)].find(x => x.offsetParent !== null || !x.closest('[hidden]')); if (f && !el.contains(document.activeElement)) f.focus(); }, 0); }
      else if (el.hidden && el._open) { el._open = false; if (back && document.contains(back)) back.focus(); }
    }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { const c = el.querySelector(CLOSE[id]); if (c) { e.preventDefault(); c.click(); } return; }
      if (e.key !== 'Tab') return;
      const fs = [...el.querySelectorAll(FOCUSABLE)].filter(x => !x.closest('[hidden]')); if (!fs.length) return;
      const first = fs[0], last = fs[fs.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  /* ---------- Navigation, connexion, init ---------- */
  function goTab(v) {
    const b = document.querySelector(`nav.tabs button[data-v="${v}"]`); if (!b) return;
    document.querySelectorAll('nav.tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    document.querySelectorAll('section.view').forEach(s => { s.hidden = s.id !== 'v-' + v; });
    try { localStorage.setItem('py-tab', v); } catch (e) {}
    if (v === 'map') renderMap();
    if (v === 'world') startWorld(); else stopWorld();
    if (v === 'dash') animateCounters($('#v-dash'));
    if (window._moreNav) window._moreNav.more.classList.toggle('on', window._moreNav.hidden.includes(v));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => goTab(b.dataset.v));
  (function moreNav() {
    const nav = document.querySelector('nav.tabs'); const hidden = ['sim', 'tips'];
    const sheet = document.createElement('div'); sheet.className = 'more-sheet';
    hidden.forEach(v => { const b = nav.querySelector(`button[data-v="${v}"]`); if (b) sheet.appendChild(b); });
    const more = document.createElement('button'); more.type = 'button'; more.className = 'more'; more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-label', 'Plus de sections');
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg><span>Plus</span>';
    more.onclick = () => { const open = !sheet.classList.contains('open'); sheet.classList.toggle('open', open); more.setAttribute('aria-expanded', String(open)); };
    sheet.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { sheet.classList.remove('open'); more.setAttribute('aria-expanded', 'false'); }));
    nav.appendChild(more); nav.appendChild(sheet);
    document.addEventListener('click', e => { if (!nav.contains(e.target)) { sheet.classList.remove('open'); more.setAttribute('aria-expanded', 'false'); } });
    window._moreNav = { more, hidden };
  })();
  // L'épargne se charge avant le rendu : objectifs, compte à rebours et projets lisent le même projet « van ».
  async function refresh() {
    await load(); if (window.PYS) { try { await window.PYS.load(); } catch (e) { console.warn(e); } }
    fillLocSelect(); fillGoals(); fillSign(); renderDash(); renderLog(); renderGoals(); renderSim(); renderTips(); if (!$('#v-map').hidden) renderMap();
    if (window.PYF) { window.PYF.renderMission(); window.PYF.renderVanCountdown(); window.PYF.renderAudits(S.invoices); }
    if (window.PYS) { try { window.PYS.render(); } catch (e) { console.warn(e); } }
  }
  window.PYAPP = { get S() { return S; }, get ref() { return REF; }, share, fmt, money, esc, toast, goTab, selectLoc, refresh: () => refresh(), byWeek, recentWeeks, avgInvoiced, streak, vanDown, weekStart, isoDate: d => window.PYU.isoDate(d), getMap: () => map };
  $('#btnBrief').onclick = () => window.PYF.openBrief(true);
  $('#btnEvening').onclick = () => window.PYF.openEvening();
  $('#evClose').onclick = () => window.PYF.closeEvening();
  $('#btnLocate').onclick = () => window.PYF.locateOnMap(map);
  $('#btnWorldGps').onclick = () => window.PYF.locateInWorld();
  $('#routeScore').addEventListener('submit', e => { e.preventDefault(); window.PYF.scoreRoute(); });
  function banner(msg) { const b = $('#netBanner'); b.textContent = msg; b.hidden = !msg; }
  // method : 'pin' ou 'biometrie' juste après une connexion ; absent quand la session était déjà ouverte.
  async function start(method) {
    $('#login').hidden = true;
    if (DB.unavailable) banner('Base partagée injoignable : ce que tu saisis reste sur ce téléphone seulement et n’ira pas dans la base. Recharge la page quand le réseau revient.');
    $('#f_date').value = window.PYU.today();
    let seen = false; try { seen = sessionStorage.getItem('py-landing') === '1'; } catch (e) {}
    if (seen) { $('#app').hidden = false; } else { $('#landing').hidden = false; }
    if (window.PYAUTH) window.PYAUTH.record(method ? 'connexion' : 'ouverture', method || 'session');
    try { await refresh(); } catch (err) { banner('Chargement impossible (' + err.message + ') : les chiffres affichés sont incomplets. Recharge la page quand le réseau revient.'); }
    if (seen) { let t = 'dash'; try { t = localStorage.getItem('py-tab') || 'dash'; } catch (e) {} goTab(t); }
    window.PYF.resumeShift();
    if (seen) window.PYF.openBrief(false);
  }
  function enterApp(tab) { try { sessionStorage.setItem('py-landing', '1'); } catch (e) {} $('#landing').hidden = true; $('#app').hidden = false; goTab(tab); window.PYF.openBrief(false); }
  function fillSign() { const el = $('#signDest'); if (!el) return; const top = S.locstats.filter(l => l.n >= 40).sort((a, b) => b.ppp - a.ppp).slice(0, 5); el.innerHTML = top.map(l => `<li><span>${esc(l.name)}</span><b>${fmt(l.ppp, 2)} $</b></li>`).join(''); }
  $('#btnDrive').onclick = () => enterApp('world');
  $('#btnExplore').onclick = () => enterApp('dash');
  window.addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#landing').hidden) enterApp('world'); });
  /* ---------- Connexion : PIN, puis proposition de Touch ID / Face ID ; ensuite Touch ID directement ---------- */
  const AU = window.PYAUTH;
  async function showLogin() {
    $('#login').hidden = false; $('#loginFields').hidden = false; $('#bioOffer').hidden = true;
    $('#btnBio').hidden = !(AU && AU.enrolled() && await AU.available());
  }
  function loginError(msg) { const err = $('#loginErr'); err.textContent = msg; err.hidden = false; }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').hidden = true; const p = $('#pin').value.trim();
    if (/[^\x20-\x7e]/.test(p)) { loginError('Le PIN ne doit contenir ni accent ni caractère spécial (lettres sans accent, chiffres, espaces, tirets).'); return; }
    try { await DB.login(p, 'pin'); } catch (ex) { loginError('PIN refusé ou base injoignable (' + ex.message + ').'); return; }
    // Première connexion par PIN sur un appareil compatible : proposer Touch ID / Face ID une fois.
    if (AU && !AU.enrolled() && !AU.declined() && await AU.available()) {
      $('#loginFields').hidden = true; $('#bioOffer').hidden = false;
      $('#bioYes').onclick = async () => { try { await AU.enroll(p); toast('Touch ID / Face ID activé sur cet appareil'); } catch (er) { toast(er.name === 'NotAllowedError' ? 'Activation annulée' : er.message); } start('pin'); };
      $('#bioNo').onclick = () => { AU.decline(); start('pin'); };
      return;
    }
    start('pin');
  });
  $('#btnBio').onclick = async () => {
    $('#loginErr').hidden = true; let p;
    try { p = await AU.unlock(); } catch (er) { loginError(er.name === 'NotAllowedError' ? 'Empreinte ou visage non reconnu, ou demande annulée. Entre le PIN.' : er.message); return; }
    try { await DB.login(p, 'biometrie'); start('biometrie'); }
    catch (ex) { if (/PIN refusé/.test(ex.message)) { AU.forget(); $('#btnBio').hidden = true; loginError('Le PIN a changé : entre le nouveau PIN (Touch ID sera proposé de nouveau).'); } else loginError('Base injoignable (' + ex.message + ').'); }
  };
  if (DB.online && !DB.isConnected()) showLogin(); else start();
})();
