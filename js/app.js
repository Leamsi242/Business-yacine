// Pilote Yacine : application. Données via window.PYDB, historique via window.PY_HISTORY.
(function () {
  const CFG = window.PY_CONFIG, DB = window.PYDB, H = window.PY_HISTORY;
  const $ = s => document.querySelector(s);
  const fmt = (n, d = 0) => (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (n, d = 0) => fmt(n, d) + ' $';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._x); t._x = setTimeout(() => t.classList.remove('on'), 2600); };

  // État chargé depuis la base
  let S = { days: [], goals: {}, localities: [], parcels: [], locstats: [], invoices: [] };
  let LOCBY = {}; let map = null, layer = null, selLoc = null, rankBy = 'ppp';
  const share = () => S.goals.status === 'indep' ? 0.95 : 1 - (+S.goals.cut || 0.25);

  async function load() {
    const [days, goals, localities, parcels, invoices] = await Promise.all([DB.getDays(), DB.getGoals(), DB.getLocalities(), DB.getParcelsSince(null), DB.getInvoices().catch(() => [])]);
    S.invoices = invoices || [];
    S.goals = Object.assign({ days: 4.5, net: 4300, van: 8000, saved: 0, status: 'broker', fuel: 60, cut: 0.25 }, goals || {});
    S.localities = localities; LOCBY = {}; localities.forEach(l => LOCBY[l.code] = l);
    // journées : historique embarqué + base (la base l'emporte à date égale)
    const m = {};
    H.days.forEach(d => m[d.date] = { date: d.date, parcels: d.parcels, invoiced: d.invoiced, source: 'facture', loc: d.top[0] ? d.top[0].code : '', top: d.top });
    days.forEach(d => m[d.date] = Object.assign({}, m[d.date] || {}, d, { invoiced: +d.invoiced, parcels: +d.parcels, km: d.km == null ? null : +d.km, fuel: d.fuel == null ? null : +d.fuel }));
    S.days = Object.values(m).sort((a, b) => a.date < b.date ? -1 : 1);
    S.parcels = parcels;
    // stats par localité : historique + colis importés postérieurs au 27 sept. 2026 (fin des factures embarquées)
    const ls = {}; (window.PY_LOCSTATS || []).forEach(l => ls[l.code] = Object.assign({}, l, { zones: Object.assign({}, l.zones), dayset: null }));
    const extra = {};
    parcels.filter(p => p.date > '2026-09-27').forEach(p => {
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

  function weekStart(ds) { const d = new Date(ds + 'T12:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); }
  function byWeek(days) { const m = {}; days.forEach(d => { const k = weekStart(d.date); const w = (m[k] = m[k] || { wk: k, parcels: 0, inv: 0, days: 0, fuel: 0, km: 0 }); w.parcels += d.parcels; w.inv += d.invoiced; w.days++; w.fuel += d.fuel || 0; w.km += d.km || 0; }); return Object.values(m).sort((a, b) => a.wk < b.wk ? -1 : 1); }
  const fuelOf = d => d.fuel != null ? d.fuel : (+S.goals.fuel || 0);
  const locName = c => c && LOCBY[c] ? LOCBY[c].name : (c || '—');

  /* ---------- Tableau de bord ---------- */
  function renderDash() {
    const days = S.days, weeks = byWeek(days), sh = share();
    const ym = new Date().toISOString().slice(0, 7);
    let monthDays = days.filter(d => d.date.startsWith(ym)), label = 'ce mois-ci';
    if (!monthDays.length && days.length) { const lm = days[days.length - 1].date.slice(0, 7); monthDays = days.filter(d => d.date.startsWith(lm)); label = 'dernier mois avec données (' + lm + ')'; }
    const inv = monthDays.reduce((a, d) => a + d.invoiced, 0), net = inv * sh, parcels = monthDays.reduce((a, d) => a + d.parcels, 0);
    const fuel = monthDays.reduce((a, d) => a + fuelOf(d), 0);
    const avgDay = days.length ? days.reduce((a, d) => a + d.invoiced, 0) / days.length : 0;
    $('#kpis').innerHTML = [
      ['Net ' + label, money(net), fmt(monthDays.length) + ' jours, ' + money(inv) + ' facturés'],
      ['Après essence', money(net - fuel), money(fuel) + ' d’essence' + (monthDays.some(d => d.fuel == null) ? ' (en partie estimée)' : '')],
      ['Par jour travaillé', money(avgDay * sh), 'moyenne sur ' + days.length + ' jours, ' + money(avgDay) + ' facturés'],
      ['Revenu par colis', money(parcels ? inv / parcels : 0, 2), fmt(parcels) + ' colis ' + label],
      ['Objectif net mensuel', fmt(Math.min(999, Math.round(100 * net / (+S.goals.net || 1)))) + ' %', 'cible ' + money(+S.goals.net)],
      ['Épargne van', money(+S.goals.saved), 'cible ' + money(+S.goals.van)]
    ].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div><div class="sub">${t[2]}</div></div>`).join('');
    $('#hdrinfo').textContent = days.length + ' journées, ' + fmt(days.reduce((a, d) => a + d.parcels, 0)) + ' colis';
    $('#chWeeks').innerHTML = barChart(weeks.slice(-14).map(w => ({ x: w.wk.slice(5), y: w.inv * sh, sub: w.days + ' j' })), { goal: (+S.goals.net || 0) / 4.33 });
    $('#chPpp').innerHTML = lineChart(days.slice(-20).map(d => ({ x: d.date.slice(5), y: d.parcels ? d.invoiced / d.parcels : 0, lab: d.date })));
    const g = S.goals, target = +g.net || 0, pct = target ? Math.min(100, 100 * net / target) : 0, dayNet = avgDay * sh || 1, remaining = Math.max(0, target - net), daysLeft = Math.ceil(remaining / dayNet);
    $('#goalMini').innerHTML = `<div class="kv"><span>Net ${label}</span><b>${money(net)} / ${money(target)}</b></div><div class="bar"><i class="${pct >= 100 ? 'good' : ''}" style="width:${pct}%"></i></div>
      <p class="small muted" style="margin-top:8px">${remaining > 0 ? `Il manque ${money(remaining)} : environ ${daysLeft} journée${daysLeft > 1 ? 's' : ''} au rythme moyen.` : 'Objectif atteint.'}</p>
      <div class="kv" style="margin-top:8px"><span>Épargne van</span><b>${money(+g.saved)} / ${money(+g.van)}</b></div><div class="bar"><i class="${g.saved >= g.van ? 'good' : ''}" style="width:${Math.min(100, 100 * g.saved / (+g.van || 1))}%"></i></div>`;
    $('#lastDays').innerHTML = '<tr><th>Date</th><th>Zone</th><th class="num">Colis</th><th class="num">Facturé</th><th class="num">$/colis</th></tr>' + days.slice(-8).reverse().map(d => `<tr><td>${d.date}</td><td>${esc(locName(d.loc))}</td><td class="num">${d.parcels}</td><td class="num">${money(d.invoiced, 2)}</td><td class="num">${d.parcels ? fmt(d.invoiced / d.parcels, 2) : '—'}</td></tr>`).join('');
  }
  function barChart(pts, o) {
    const W = 560, Hh = 220, pl = 44, pr = 10, pt = 14, pb = 34; if (!pts.length) return '<p class="muted small">Pas encore de données.</p>';
    const max = Math.max(o.goal || 0, ...pts.map(p => p.y)) * 1.08 || 1, bw = (W - pl - pr) / pts.length, y = v => pt + (Hh - pt - pb) * (1 - v / max);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${Hh}">`;
    for (let i = 0; i <= 4; i++) { const v = max * i / 4; s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
    pts.forEach((p, i) => { const x = pl + i * bw + bw * 0.15, w = bw * 0.7; s += `<rect class="b ${i === pts.length - 1 ? 'cur' : ''}" x="${x}" y="${y(p.y)}" width="${w}" height="${Math.max(0, y(0) - y(p.y))}" rx="3"><title>Semaine du ${p.x} : ${money(p.y)} (${p.sub})</title></rect><text x="${x + w / 2}" y="${Hh - pb + 14}" text-anchor="middle">${p.x}</text>`; if (i === pts.length - 1) s += `<text class="direct" x="${x + w / 2}" y="${y(p.y) - 5}" text-anchor="middle">${money(p.y)}</text>`; });
    if (o.goal) s += `<line class="goal" x1="${pl}" x2="${W - pr}" y1="${y(o.goal)}" y2="${y(o.goal)}"/><text x="${W - pr}" y="${y(o.goal) - 4}" text-anchor="end">objectif ${money(o.goal)}/sem</text>`;
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
    pts.forEach((p, i) => { s += `<circle class="pt" cx="${x(i)}" cy="${y(p.y)}" r="4"><title>${p.lab} : ${fmt(p.y, 2)} $/colis</title></circle>`; if ((i % st === 0 && pts.length - 1 - i >= st / 2) || i === pts.length - 1) s += `<text x="${x(i)}" y="${Hh - pb + 14}" text-anchor="middle">${p.x}</text>`; });
    const l = pts[pts.length - 1]; s += `<text class="direct" x="${x(pts.length - 1) - 6}" y="${y(l.y) - 8}" text-anchor="end">${fmt(l.y, 2)} $</text>`;
    return s + '</svg>';
  }

  /* ---------- Carte (Leaflet + OpenStreetMap) ---------- */
  const seqColor = v => { const t = Math.max(0, Math.min(1, (v - 1.3) / 2)); return ['#dce8f5', '#9dbde0', '#4f85bf', '#1f5fa8', '#0e3a6e'][Math.min(4, Math.floor(t * 5))]; };
  function renderMap() {
    if (!window.L) return;
    if (!map) {
      map = L.map('map', { scrollWheelZoom: true }).setView([45.88, -72.25], 9);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      L.marker([CFG.STATION.lat, CFG.STATION.lon], { icon: L.divIcon({ className: '', html: '<div style="width:16px;height:16px;background:#d9561a;border:2px solid #fff;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [16, 16] }) }).addTo(map).bindPopup('<b>' + esc(CFG.STATION.name) + '</b><br>Point de départ des routes');
      L.marker([CFG.HOME.lat, CFG.HOME.lon], { icon: L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#7a4bb3;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [14, 14] }) }).addTo(map).bindPopup('<b>' + esc(CFG.HOME.name) + '</b><br>Environ 80 km de la station, 30 $ d’essence par jour aller-retour');
      $('#legend').innerHTML = `<div><span class="sw" style="background:#dce8f5"></span>≈1,30 $/colis</div><div><span class="sw" style="background:#4f85bf"></span>≈2,20 $/colis</div><div><span class="sw" style="background:#0e3a6e"></span>≈3,00 $/colis et plus</div><div><span class="sw" style="background:#d9561a;border-radius:2px"></span>station de départ</div>`;
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const maxN = Math.max(1, ...S.locstats.map(l => l.n));
    S.locstats.filter(l => l.lat && l.lon).sort((a, b) => b.n - a.n).forEach(l => {
      const c = L.circleMarker([l.lat, l.lon], { radius: 6 + 20 * Math.sqrt(l.n / maxN), color: selLoc === l.code ? '#d9561a' : '#fff', weight: selLoc === l.code ? 3 : 1.5, fillColor: seqColor(l.ppp), fillOpacity: .85 });
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
    $('#rank').innerHTML = locs.slice(0, 12).map((l, i) => `<div class="it ${selLoc === l.code ? 'sel' : ''}" data-code="${esc(l.code)}" role="button" tabindex="0"><div class="n">${i + 1}</div><div><div class="t">${esc(l.name)}</div><div class="s">${fmt(l.n)} colis · ${l.days} j · ${fmt(l.ppp, 2)} $/colis</div></div><div class="v">${fv(l)}</div></div>`).join('');
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
    try { await DB.upsertDay(row); toast('Journée du ' + date + ' enregistrée'); e.target.reset(); $('#f_date').value = new Date().toISOString().slice(0, 10); await refresh(); }
    catch (err) { toast('Enregistrement refusé : ' + err.message); }
  });
  $('#f_date').addEventListener('change', () => { const ex = S.days.find(d => d.date === $('#f_date').value); if (!ex) return; $('#f_parcels').value = ex.parcels || ''; $('#f_inv').value = ex.invoiced || ''; $('#f_km').value = ex.km ?? ''; $('#f_fuel').value = ex.fuel ?? ''; $('#f_loc').value = ex.loc || ''; $('#f_note').value = ex.note || ''; });
  function renderLog() {
    $('#storageMode').textContent = DB.mode() === 'supabase' ? 'Données partagées (Supabase)' : 'Mode local : données gardées dans ce navigateur seulement';
    $('#logTable').innerHTML = '<tr><th>Date</th><th>Source</th><th>Zone</th><th class="num">Colis</th><th class="num">Facturé</th><th class="num">Km</th><th class="num">Essence</th><th>Note</th><th></th></tr>' + S.days.slice().reverse().map(d => `<tr><td>${d.date}</td><td><span class="pill">${esc(d.source || 'facture')}</span></td><td>${esc(d.top && !d.loc ? d.top.slice(0, 2).map(t => t.name).join(', ') : locName(d.loc))}</td><td class="num">${d.parcels}</td><td class="num">${money(d.invoiced, 2)}</td><td class="num">${d.km != null ? d.km : '—'}</td><td class="num">${d.fuel != null ? money(d.fuel, 2) : '—'}</td><td class="small">${esc(d.note || '')}</td><td>${d.driver ? `<button class="btn danger" data-del="${d.date}" style="padding:3px 8px;font-size:12px">Supprimer</button>` : ''}</td></tr>`).join('');
    $('#logTable').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { try { await DB.deleteDay(b.dataset.del); toast('Journée supprimée'); await refresh(); } catch (err) { toast(err.message); } });
  }
  $('#pdfFile').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    const st = $('#pdfStatus'); st.textContent = 'Lecture…';
    for (const f of files) {
      try {
        const r = await window.PYPDF.parseInvoice(f);
        await DB.importInvoice(r.inv, r.parcels, r.days);
        try { const audit = window.PYF.auditInvoice(r.inv, r.parcels, r.days, S.days); await DB.saveAudit(r.inv.week, audit); } catch (ae) { console.warn(ae); }
        st.innerHTML += `<div><span class="pill good">Importé</span> ${esc(f.name)} : semaine ${esc(r.inv.week)}, ${r.days.length} journées, ${r.parcels.length} colis, total facture ${money(r.inv.total, 2)}</div>`;
      } catch (err) { st.innerHTML += `<div><span class="pill bad">Échec</span> ${esc(f.name)} : ${esc(err.message)}</div>`; }
    }
    e.target.value = ''; await refresh();
  });

  /* ---------- Objectifs ---------- */
  function fillGoals() { const g = S.goals; $('#g_days').value = g.days; $('#g_net').value = g.net; $('#g_status').value = g.status; $('#g_fuel').value = g.fuel; $('#g_cut').value = Math.round((+g.cut || 0.25) * 100); }
  $('#goalForm').addEventListener('submit', async e => { e.preventDefault(); const g = { days: +$('#g_days').value || 4.5, net: +$('#g_net').value || 0, van: +S.goals.van || 8000, saved: +S.goals.saved || 0, status: $('#g_status').value, fuel: +$('#g_fuel').value || 0, cut: (+$('#g_cut').value || 25) / 100 }; try { await DB.saveGoals(g); toast('Objectifs enregistrés'); await refresh(); } catch (err) { toast(err.message); } });
  function renderGoals() {
    const weeks = byWeek(S.days), g = S.goals, sh = share();
    const recent = weeks.slice(-12), ok = recent.filter(w => w.days >= Math.floor(g.days)).length;
    let streak = 0; for (let i = weeks.length - 1; i >= 0; i--) { if (weeks[i].days >= Math.floor(g.days)) streak++; else break; }
    const avgDay = S.days.length ? S.days.reduce((a, d) => a + d.invoiced, 0) / S.days.length * sh : 0;
    const needDaysMonth = g.net && avgDay ? Math.ceil(g.net / avgDay) : 0;
    const vanLeft = Math.max(0, g.van - g.saved); const weekly = Math.max(0, avgDay * g.days - (+g.fuel || 0) * g.days) * 0.35; const weeksToVan = vanLeft > 0 && weekly ? Math.ceil(vanLeft / weekly) : 0;
    $('#goalDetail').innerHTML = `<div class="kv">
      <span>Semaines consécutives à ${Math.floor(g.days)} jours ou plus</span><b>${streak} <span class="pill ${streak >= 12 ? 'good' : streak >= 6 ? 'warn' : 'bad'}">cible 12</span></b>
      <span>Semaines réussies sur les 12 dernières</span><b>${ok} / ${recent.length}</b>
      <span>Net moyen par jour (statut ${g.status === 'indep' ? 'indépendant' : 'broker ' + Math.round((+g.cut || .25) * 100) + ' %'})</span><b>${money(avgDay)}</b>
      <span>Jours nécessaires pour ${money(g.net)} net</span><b>${needDaysMonth} par mois (${fmt(needDaysMonth / 4.33, 1)} par semaine)</b>
      <span>Épargne van restante</span><b>${money(vanLeft)}${weeksToVan ? ` · ${weeksToVan} sem. en mettant 35 % du net après essence` : ''}</b></div>
      <p class="small muted" style="margin-top:10px">Règle du plan : acheter le van seulement après 12 semaines consécutives à 4 jours ou plus et 8 000 $ de côté.</p>`;
    const st = (ok, txt) => `<span class="pill ${ok ? 'good' : 'warn'}">${ok ? 'Atteint' : txt}</span>`;
    $('#st0').innerHTML = st(streak >= 12 && g.saved >= g.van, 'En cours : ' + streak + '/12 sem., ' + money(g.saved) + '/' + money(g.van));
    $('#st1').innerHTML = g.status === 'indep' ? st(false, 'En cours') : '<span class="pill">À venir</span>';
    $('#st2').innerHTML = '<span class="pill">À venir</span>'; $('#st3').innerHTML = '<span class="pill">À venir</span>';
  }

  /* ---------- Simulateur ---------- */
  function renderSim() {
    const v = id => +$(id).value; const days = v('#s_days'), rev = v('#s_rev'), km = v('#s_km'), l = v('#s_l'), fuel = v('#s_fuel'), cut = v('#s_cut') / 100, van = v('#s_van'), fix = v('#s_fix'), rate = v('#s_rate') / 100;
    $('#o_days').value = days; $('#o_rev').value = money(rev); $('#o_km').value = km + ' km'; $('#o_l').value = l + ' L'; $('#o_fuel').value = fmt(fuel, 2) + ' $'; $('#o_cut').value = cut * 100 + ' %'; $('#o_van').value = money(van); $('#o_fix').value = money(fix); $('#o_rate').value = rate ? fmt(rate * 100, 1) + ' %' : 'comptant';
    const dpm = days * 4.33, gross = dpm * rev, fuelM = dpm * km * l / 100 * fuel, brokerNet = gross * (1 - cut) - fuelM;
    const pay = rate ? van * (rate / 12) / (1 - Math.pow(1 + rate / 12, -36)) : 0, indepNet = gross * 0.95 - fuelM - fix - pay;
    const gainCash = gross * (cut - 0.05) - fix, payback = gainCash > 0 ? van / gainCash : Infinity, diff = indepNet - brokerNet, seuil = fix / (cut - 0.05 || 0.01);
    const line = (k, v) => `<span>${k}</span><b>${v}</b>`;
    $('#simOut').innerHTML = `<div class="kv">${line('Jours par mois', fmt(dpm, 1))}${line('Facturé par mois', money(gross))}${line('Essence par mois', money(fuelM) + ' (' + money(km * l / 100 * fuel) + ' par jour)')}</div><hr>
      <div class="kv">${line('Net chez le broker (' + (cut * 100) + ' %), après essence', '<span style="font-family:var(--display);font-size:22px">' + money(brokerNet) + '</span>')}
      ${line('Net indépendant (CNESST 5 %), après essence, fixes' + (pay ? ' et paiement du van (' + money(pay) + '/mois sur 3 ans)' : ''), '<span style="font-family:var(--display);font-size:22px">' + money(indepNet) + '</span>')}
      ${line('Écart par mois', '<span class="pill ' + (diff > 0 ? 'good' : 'bad') + '">' + (diff > 0 ? '+' : '') + money(diff) + '</span>')}</div><hr>
      <div class="kv">${line('Gain indépendant vs broker, van payé comptant', money(gainCash) + ' par mois')}${line('Délai de remboursement du van', isFinite(payback) ? fmt(payback, 1) + ' mois' : 'jamais à ce rythme')}${line('Facturé mensuel minimum pour couvrir les fixes', money(seuil) + ' (' + fmt(seuil / rev, 1) + ' jours)')}</div>
      <p class="small muted" style="margin-top:10px">${diff > 0 ? `À ce rythme, l’indépendance rapporte ${money(diff * 12)} de plus par an.` : `À ce rythme, rester chez le broker rapporte plus. Il faut ${fmt(seuil / rev / 4.33, 1)} jours par semaine pour couvrir les fixes.`}</p>`;
  }
  document.querySelectorAll('#v-sim input[type=range]').forEach(r => r.addEventListener('input', renderSim));

  /* ---------- Optimisation ---------- */
  function renderTips() {
    const sh = share(), locs = S.locstats, out = [];
    const add = (cls, t, b) => out.push(`<div class="a ${cls}"><i></i><div><b>${t}</b><span class="small">${b}</span></div></div>`);
    const good = locs.filter(l => l.n >= 40 && l.ppp >= 2.5).sort((a, b) => b.ppp - a.ppp), bad = locs.filter(l => l.n >= 40 && l.ppp < 1.6);
    const badP = bad.length ? bad[0].ppp : 1.46;
    if (good.length) add('', 'Demander les routes ' + good.slice(0, 3).map(l => l.name).join(', '), `Revenu observé de ${fmt(good[0].ppp, 2)} $ par colis contre ${fmt(badP, 2)} $ en zone urbaine. Même nombre de colis, ${fmt(100 * (good[0].ppp / badP - 1))} % de revenu en plus par journée (environ ${money((good[0].ppp - badP) * 180 * sh)} net).`);
    if (bad.length) add('warn', 'Éviter les routes ' + bad.map(l => l.name).join(' et ') + ' quand le choix existe', `Secteur dense (jusqu’à 226 colis par jour) mais payé ${fmt(bad[0].ppp, 2)} $ par colis : les journées les moins payées de l’historique.`);
    const withFuel = S.days.filter(d => d.fuel && d.km);
    if (withFuel.length >= 3) { const km = withFuel.reduce((a, e) => a + e.km, 0), f = withFuel.reduce((a, e) => a + e.fuel, 0), perKm = f / km, per100 = perKm / CFG.FUEL_PRICE * 100; add(per100 > 12 ? 'warn' : '', `Coût réel d’essence : ${fmt(perKm, 3)} $ par km (${money(f / withFuel.length)} par jour)`, `Sur ${withFuel.length} journées saisies. À ${fmt(CFG.FUEL_PRICE, 2)} $/L, environ ${fmt(per100, 1)} L/100 km${per100 > 12 ? ' : élevé pour un Transit Connect, vérifier pression des pneus, climatisation et moteur tournant à l’arrêt.' : ', dans la norme pour ce véhicule.'}`); }
    else add('warn', 'Saisir km et essence pendant 10 journées', 'Sans ces deux chiffres, l’essence est estimée à ' + money(+S.goals.fuel || 0) + ' par jour. Le vrai chiffre décide si l’indépendance est rentable et de combien.');
    add('', 'La navette Sherbrooke à Drummondville coûte environ 30 $ par jour', 'Soit 160 km aller-retour, 16 L d’essence et 1 h 40 de route non payée. Sur 216 jours, 5 300 $ par an : plus que le gain d’indépendance à 3 jours par semaine.');
    const weeks = byWeek(S.days), recent = weeks.slice(-12), full = recent.filter(w => w.days >= 4).length;
    add(full >= 8 ? '' : 'warn', `${full} semaine${full > 1 ? 's' : ''} sur les ${recent.length} dernières à 4 jours ou plus`, 'Chaque journée vaut environ ' + money(275) + ' net. Passer de 3,5 à 4,5 jours par semaine ajoute environ 1 200 $ net par mois sans rien changer d’autre.');
    add('bad', 'Photographier chaque dépôt de colis', 'Un seul colis perdu a été facturé 422,97 $ en mai, soit 1,5 journée de net. La photo horodatée est la seule défense ; contester chaque déduction par écrit au broker.');
    add('warn', 'Carte Visa : rester sous 30 % d’utilisation', 'Limite de 1 500 $ pour 2 500 $ d’achats par mois : demander une hausse de limite ou payer en milieu de cycle. Mettre 20 % de chaque paiement de côté pour l’impôt.');
    add('', 'Les colis lourds paient : 40 lb rapporte 5,67 $, 60 lb près de 9 $', '88 colis de plus de 30 lb ont rapporté 497 $ sur 9 semaines, soit 5,6 $ chacun contre 2,09 $ en moyenne.');
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
    $('#destSel').innerHTML = '<option value="">— choisir une destination —</option>' + S.locstats.filter(l => l.lat).sort((a, b) => b.ppp - a.ppp).map(l => `<option value="${esc(l.code)}">${esc(l.name)} · ${fmt(l.ppp, 2)} $/colis</option>`).join('');
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
      const txt = el.textContent; const m = txt.match(/^(-?[\d\s\u00a0]+?)(,\d+)?\s*([^\d\s\u00a0].*)?$/); if (!m) return;
      const target = parseFloat(m[1].replace(/[\s\u00a0]/g, '') + (m[2] ? m[2].replace(',', '.') : '')); const dec = m[2] ? m[2].length - 1 : 0; const suffix = m[3] ? ' ' + m[3].trim() : '';
      const t0 = performance.now(), dur = 900;
      const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(target * e, dec) + suffix; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  /* ---------- Navigation, connexion, init ---------- */
  function goTab(v) {
    const b = document.querySelector(`nav.tabs button[data-v="${v}"]`); if (!b) return;
    document.querySelectorAll('nav.tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    document.querySelectorAll('section.view').forEach(s => { s.hidden = s.id !== 'v-' + v; });
    try { localStorage.setItem('py-tab', v); } catch (e) {}
    if (v === 'map') renderMap();
    if (v === 'world') startWorld(); else stopWorld();
    if (v === 'dash') animateCounters($('#v-dash'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => goTab(b.dataset.v));
  async function refresh() { await load(); fillLocSelect(); fillGoals(); renderDash(); renderLog(); renderGoals(); renderSim(); renderTips(); if (!$('#v-map').hidden) renderMap(); if (window.PYF) { window.PYF.renderMission(); window.PYF.renderVanCountdown(); window.PYF.renderAudits(S.invoices); } if (window.PYS) { try { await window.PYS.refresh(); } catch (e) { console.warn(e); } } }
  window.PYAPP = { get S() { return S; }, share, fmt, money, esc, toast, goTab, selectLoc, refresh: () => refresh(), byWeek, getMap: () => map };
  $('#btnBrief').onclick = () => window.PYF.openBrief(true);
  $('#btnEvening').onclick = () => window.PYF.openEvening();
  $('#evClose').onclick = () => window.PYF.closeEvening();
  $('#btnLocate').onclick = () => window.PYF.locateOnMap(map);
  $('#btnWorldGps').onclick = () => window.PYF.locateInWorld();
  $('#routeScore').addEventListener('submit', e => { e.preventDefault(); window.PYF.scoreRoute(); });
  async function start() {
    $('#login').hidden = true;
    $('#f_date').value = new Date().toISOString().slice(0, 10);
    let seen = false; try { seen = sessionStorage.getItem('py-landing') === '1'; } catch (e) {}
    if (seen) { $('#app').hidden = false; } else { $('#landing').hidden = false; }
    try { await refresh(); } catch (err) { toast('Chargement impossible : ' + err.message); }
    if (seen) { let t = 'dash'; try { t = localStorage.getItem('py-tab') || 'dash'; } catch (e) {} goTab(t); }
    window.PYF.resumeShift();
    if (seen) window.PYF.openBrief(false);
  }
  function enterApp(tab) { try { sessionStorage.setItem('py-landing', '1'); } catch (e) {} $('#landing').hidden = true; $('#app').hidden = false; goTab(tab); window.PYF.openBrief(false); }
  $('#btnDrive').onclick = () => enterApp('world');
  $('#btnExplore').onclick = () => enterApp('dash');
  window.addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#landing').hidden) enterApp('world'); });
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const err = $('#loginErr'); err.hidden = true; try { await DB.login($('#pin').value.trim()); start(); } catch (ex) { err.textContent = 'PIN refusé ou base injoignable (' + ex.message + ').'; err.hidden = false; } });
  if (DB.online && !DB.isConnected()) { $('#login').hidden = false; } else start();
})();
