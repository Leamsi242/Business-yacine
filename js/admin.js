// Back-office : journal des connexions de Yacine (table access_log) et changement de son PIN.
// La base ne rend les lignes qu'avec le PIN administrateur (en-tête x-admin-pin, fonction check_admin) ; ce fichier
// ne fait qu'afficher. En mode local (sans Supabase), il lit le journal gardé dans ce navigateur.
(function () {
  const CFG = window.PY_CONFIG || {}, U = window.PYU, $ = s => document.querySelector(s);
  const LS = 'pilote-yacine-v2', ADMIN = 'py-admin-pin';
  const online = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
  let client = null, ROWS = [];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._x); t._x = setTimeout(() => t.classList.remove('on'), 3000); };
  const nf = (n, d = 0) => (+n).toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hav = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  const FAR_KM = 150;

  async function connect(pin) {
    if (!online) return true;
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { global: { headers: { 'x-admin-pin': pin } }, auth: { persistSession: false } });
    const r = await client.rpc('check_admin');
    if (r.error) throw new Error(r.error.message);
    if (r.data !== true) throw new Error('PIN administrateur refusé');
    return true;
  }
  async function fetchRows() {
    if (!online) { try { return (JSON.parse(localStorage.getItem(LS) || 'null') || {}).accessLog || []; } catch (e) { return []; } }
    const out = []; for (let from = 0; ; from += 1000) {
      const r = await client.from('access_log').select('*').order('at', { ascending: false }).range(from, from + 999);
      if (r.error) throw new Error(r.error.message); out.push(...r.data); if (r.data.length < 1000) return out;
    }
  }

  // Alertes : appareil jamais vu avant, connexion loin de la station, série de PIN refusés.
  function annotate(rows) {
    const asc = rows.slice().sort((a, b) => a.at < b.at ? -1 : 1), seen = new Set(); let fails = 0;
    asc.forEach(r => {
      r.alerts = [];
      if (r.ok) { const dev = r.device || r.user_agent || ''; if (dev && seen.size && !seen.has(dev)) r.alerts.push('nouvel appareil'); if (dev) seen.add(dev); fails = 0; }
      else { fails++; if (fails >= 3) r.alerts.push(fails + ' PIN refusés d’affilée'); }
      if (r.lat != null && CFG.STATION) { r.km = hav(CFG.STATION, r); if (CFG.HOME) r.kmHome = hav(CFG.HOME, r); if (r.km > FAR_KM) r.alerts.push('à ' + nf(r.km) + ' km de la station'); }
    });
    return rows;
  }
  // Heures affichées à l'heure du Québec, où roule Yacine, quel que soit le fuseau de l'administrateur.
  const TZ = 'America/Toronto';
  const day = iso => new Date(iso).toLocaleDateString('fr-CA', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
  const hour = iso => new Date(iso).toLocaleTimeString('fr-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(/\s*h\s*|:/, ' h ');
  const when = iso => day(iso) + ' · ' + hour(iso);
  const KIND = { connexion: ['good', 'Connexion'], ouverture: ['', 'Ouverture'], echec: ['bad', 'PIN refusé'] };
  const METHOD = { pin: 'PIN', biometrie: 'Touch ID / Face ID', session: 'session ouverte' };
  function place(r) {
    if (r.lat == null) return '<span class="muted">non autorisée</span>';
    const near = r.kmHome != null && r.kmHome < 3 ? 'à la maison' : r.km != null && r.km < 3 ? 'à la station' : r.km != null ? 'à ' + nf(r.km) + ' km de la station' : '';
    return `<a href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=14/${r.lat}/${r.lon}" target="_blank" rel="noopener">${nf(r.lat, 4)}, ${nf(r.lon, 4)}</a> <span class="muted small">(± ${nf(r.accuracy || 0)} m${near ? ', ' + near : ''})</span>`;
  }

  function render() {
    const days = +$('#adPeriod').value, kind = $('#adKind').value, since = days ? new Date(Date.now() - days * 864e5).toISOString() : '';
    const rows = ROWS.filter(r => (!since || r.at >= since) && (!kind || (kind === 'alerte' ? r.alerts.length : r.kind === kind)));
    const week = ROWS.filter(r => r.at >= new Date(Date.now() - 7 * 864e5).toISOString()), lastOk = ROWS.find(r => r.ok);
    const devices = new Set(ROWS.filter(r => r.ok && r.at >= new Date(Date.now() - 30 * 864e5).toISOString()).map(r => r.device || r.user_agent));
    $('#adTiles').innerHTML = [['Dernière connexion', lastOk ? day(lastOk.at) : 'aucune', lastOk ? hour(lastOk.at) + (lastOk.device ? ' · ' + lastOk.device : '') : ''], ['Connexions sur 7 jours', nf(week.filter(r => r.ok).length), 'ouvertures comprises'], ['PIN refusés sur 7 jours', nf(week.filter(r => !r.ok).length), week.some(r => !r.ok) ? 'à surveiller' : 'aucun'], ['Appareils sur 30 jours', nf(devices.size), [...devices].slice(0, 2).join(', ')]]
      .map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${esc(t[1])}</div><div class="sub">${esc(t[2])}</div></div>`).join('');
    const alerts = rows.filter(r => r.alerts.length);
    $('#adAlerts').innerHTML = alerts.length ? `<p class="ad-alert"><span class="pill warn">${alerts.length} alerte${alerts.length > 1 ? 's' : ''}</span> sur la période : ${esc([...new Set(alerts.flatMap(r => r.alerts))].slice(0, 4).join(', '))}.</p>` : '';
    $('#adTable').innerHTML = '<tr><th>Date et heure</th><th>Événement</th><th class="hide-sm">Méthode</th><th>Appareil</th><th class="hide-sm">Adresse IP</th><th>Position</th></tr>' +
      (rows.map(r => { const k = KIND[r.kind] || ['', esc(r.kind)]; return `<tr class="${r.alerts.length ? 'ad-flag' : ''}"><td class="ad-when">${when(r.at)}</td><td><span class="pill ${k[0]}">${k[1]}</span>${r.alerts.map(a => ` <span class="pill warn">${esc(a)}</span>`).join('')}</td><td class="hide-sm">${esc(METHOD[r.method] || r.method || '')}</td><td class="ad-dev">${esc(r.device || '')}</td><td class="hide-sm">${esc(r.ip || '')}</td><td class="ad-pos">${r.ok ? place(r) : '<span class="muted">sans objet</span>'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Aucune connexion sur cette période.</td></tr>');
  }
  function csv() {
    const head = ['date', 'evenement', 'methode', 'appareil', 'ip', 'latitude', 'longitude', 'precision_m', 'alertes'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const text = [head.join(',')].concat(ROWS.map(r => [r.at, r.kind, r.method, r.device, r.ip, r.lat, r.lon, r.accuracy, r.alerts.join(' ; ')].map(q).join(','))).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'connexions-yacine-' + U.today() + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  async function open() {
    $('#adLogin').hidden = true; $('#adApp').hidden = false;
    $('#adMode').textContent = online ? 'Données de la base partagée, lisibles avec le PIN administrateur seulement.' : 'Mode local : journal gardé dans ce navigateur (aucune base configurée).';
    $('#adActions').hidden = !online;
    try { ROWS = annotate(await fetchRows()); render(); } catch (e) { toast('Lecture impossible : ' + e.message); }
  }
  $('#adLoginForm').addEventListener('submit', async e => {
    e.preventDefault(); const err = $('#adErr'); err.hidden = true; const p = $('#adPin').value.trim();
    try { await connect(p); try { sessionStorage.setItem(ADMIN, p); } catch (x) {} open(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $('#adPeriod').onchange = render; $('#adKind').onchange = render;
  $('#adCsv').onclick = csv;
  $('#adOut').onclick = () => { try { sessionStorage.removeItem(ADMIN); } catch (e) {} client = null; ROWS = []; $('#adApp').hidden = true; $('#adLogin').hidden = false; $('#adPin').value = ''; };
  $('#adPinForm').addEventListener('submit', async e => {
    e.preventDefault(); const p = $('#adNewPin').value.trim(), msg = $('#adPinMsg');
    if (p.length < 10 || /[^\x20-\x7e]/.test(p)) { msg.textContent = '10 caractères au moins, sans accent ni caractère spécial.'; return; }
    const r = await client.rpc('admin_set_pin', { p_new: p });
    msg.textContent = r.error ? 'Refusé : ' + r.error.message : 'PIN de Yacine changé. Les sessions ouvertes avec l’ancien PIN sont coupées.';
    if (!r.error) $('#adNewPin').value = '';
  });

  // Reprise : PIN administrateur gardé le temps de l'onglet seulement ; mode local ouvert d'office.
  (async () => {
    let saved = null; try { saved = sessionStorage.getItem(ADMIN); } catch (e) {}
    if (!online) return open();
    if (saved) { try { await connect(saved); return open(); } catch (e) { try { sessionStorage.removeItem(ADMIN); } catch (x) {} } }
  })();
  window.PYADMIN = { annotate, render, get rows() { return ROWS; } };
})();
