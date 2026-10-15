// Monde conduisible : carte stylisée du Centre-du-Québec, camionnette pilotable, localités comme destinations.
// Entrées : window.PY_WORLD.start({canvas, locs, station, home, onArrive, onLeave}) ; .driveTo(code) ; .stop()
(function () {
  const ROADS = [
    { n: 'A-20', w: 14, p: [[45.63, -72.95], [45.75, -72.75], [45.88, -72.52], [45.96, -72.38], [46.10, -72.20], [46.18, -72.00]] },
    { n: 'A-55', w: 14, p: [[45.40, -71.90], [45.50, -72.05], [45.66, -72.15], [45.78, -72.35], [45.88, -72.48], [46.05, -72.50]] },
    { n: 'R-116', w: 9, p: [[45.88, -72.48], [45.97, -72.20], [46.05, -71.96], [46.22, -71.78]] },
    { n: 'R-139', w: 9, p: [[45.88, -72.48], [45.78, -72.52], [45.65, -72.57], [45.55, -72.65]] },
    { n: 'R-161', w: 9, p: [[46.05, -71.96], [45.95, -71.90], [45.90, -71.65], [45.85, -71.56]] },
    { n: 'R-122', w: 9, p: [[45.88, -72.48], [45.95, -72.30], [46.00, -72.10], [46.05, -71.96]] },
    { n: 'R-143', w: 7, p: [[45.88, -72.48], [45.77, -72.31], [45.63, -72.10]] },
    { n: 'R-224', w: 7, p: [[45.65, -72.57], [45.72, -72.57], [45.77, -72.45], [45.75, -72.31]] },
    { n: 'R-263', w: 7, p: [[46.17, -71.87], [46.03, -71.78], [45.93, -71.70], [45.90, -71.65]] }
  ];
  const LON0 = -73.0, LON1 = -71.4, LAT0 = 46.32, LAT1 = 45.30, SCALE = 2600; // unités monde par degré de latitude
  const cosL = Math.cos(45.9 * Math.PI / 180);
  const W = { x: lon => (lon - LON0) * cosL * SCALE, y: lat => (LAT0 - lat) * SCALE };
  const WORLD_W = W.x(LON1), WORLD_H = W.y(LAT1);
  // Palette sobre : sol et champs gris très clairs, routes blanches bordées de gris, graphite pour le texte et
  // les bâtiments, rampe partagée PYU.seqColor pour les localités, une seule touche de rouge (camionnette,
  // destination, localité proche). Deux jeux, clair et sombre, choisis à chaque image selon PYU.isDark().
  const PALETTES = {
    light: { ground: '#F5F5F7', fields: ['#EDEDF0', '#E8E8EB', '#F0F0F2'], furrow: 'rgba(26,26,26,.025)', casing: '#C9C9CE', road: '#FFFFFF', dash: '#D6D6D9',
      plate: '#1A1A1A', plateText: '#FFFFFF', tree: ['#E3E3E7', '#DCDCE0'], shadow: 'rgba(26,26,26,.06)', house: '#FFFFFF', pole: '#666666',
      text: '#1A1A1A', sub: '#666666', halo: 'rgba(255,255,255,.9)', station: '#1A1A1A', home: '#8C8C8C', building: '#FFFFFF', window: '#E5E5E5',
      vanBody: '#FFFFFF', vanEdge: '#1A1A1A', wheel: '#1A1A1A', glass: '#4D4D4D', lamp: '#FFFFFF', beam: 'rgba(26,26,26,.06)',
      panel: 'rgba(255,255,255,.94)', panelEdge: '#E5E5E5', panelRoad: '#BDBDBD', panelText: '#1A1A1A' },
    dark: { ground: '#0F0F10', fields: ['#141416', '#17171A', '#121214'], furrow: 'rgba(255,255,255,.025)', casing: '#3A3A3E', road: '#26262A', dash: '#4A4A50',
      plate: '#F5F5F7', plateText: '#0F0F10', tree: ['#1A1A1D', '#1E1E22'], shadow: 'rgba(0,0,0,.3)', house: '#2C2C30', pole: '#A1A1A6',
      text: '#F5F5F7', sub: '#A1A1A6', halo: 'rgba(15,15,16,.9)', station: '#F5F5F7', home: '#8E8E93', building: '#2C2C30', window: '#3A3A3E',
      vanBody: '#F5F5F7', vanEdge: '#0F0F10', wheel: '#000000', glass: '#5C5C62', lamp: '#FFFFFF', beam: 'rgba(255,255,255,.08)',
      panel: 'rgba(28,28,30,.94)', panelEdge: '#333338', panelRoad: '#5C5C62', panelText: '#F5F5F7' }
  };
  let P = PALETTES.light, dark = false;
  const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';
  const seqColor = v => window.PYU.seqColor(v, dark);

  let ctx, cv, raf = null, locs = [], station, home, onArrive, onLeave, keys = {}, joy = { x: 0, y: 0, on: false };
  let arrived = null, van = { x: 0, y: 0, a: -Math.PI / 2, v: 0 }, cam = { x: 0, y: 0, z: 1 }, auto = null, near = null, t0 = 0, dpr = 1, reduced = false;
  let trees = [], fields = [];

  function seed(n) { let s = n; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
  function prepareScenery() {
    const r = seed(42); trees = []; fields = [];
    for (let i = 0; i < 900; i++) trees.push({ x: r() * WORLD_W, y: r() * WORLD_H, s: 6 + r() * 8, k: r() });
    for (let i = 0; i < 160; i++) fields.push({ x: r() * WORLD_W, y: r() * WORLD_H, w: 120 + r() * 260, h: 80 + r() * 180, a: (r() - .5) * .6, c: r() });
  }

  function start(o) {
    cv = o.canvas; ctx = cv.getContext('2d'); locs = o.locs.filter(l => l.lat && l.lon); station = o.station; home = o.home; onArrive = o.onArrive; onLeave = o.onLeave;
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    prepareScenery();
    van = { x: W.x(station.lon), y: W.y(station.lat) - 120, a: Math.PI / 2, v: 0 };
    cam = { x: van.x, y: van.y, z: 1 };
    resize(); window.addEventListener('resize', resize);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    t0 = performance.now(); if (!raf) raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = null; window.removeEventListener('resize', resize); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); }
  function resize() { dpr = Math.min(2, window.devicePixelRatio || 1); const r = cv.getBoundingClientRect(); cv.width = r.width * dpr; cv.height = r.height * dpr; }
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right', z: 'up', q: 'left', Z: 'up', Q: 'left' };
  // Les touches de conduite ne doivent pas voler les lettres tapées dans un champ (note, montant).
  const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  function kd(e) { if (typing(e)) return; const k = KEYS[e.key]; if (k) { keys[k] = true; auto = null; e.preventDefault(); } }
  function ku(e) { const k = KEYS[e.key]; if (k) keys[k] = false; }
  function setJoystick(x, y, on) { joy = { x, y, on }; if (on) auto = null; }
  function driveTo(code) { const l = locs.find(x => x.code === code); if (l) auto = { x: W.x(l.lon), y: W.y(l.lat), code }; }

  function frame(now) {
    const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
    // commandes
    let th = 0, st = 0;
    if (keys.up) th += 1; if (keys.down) th -= 0.7; if (keys.left) st -= 1; if (keys.right) st += 1;
    if (joy.on) { th += -joy.y; st += joy.x; }
    if (auto) {
      const dx = auto.x - van.x, dy = auto.y - van.y, d = Math.hypot(dx, dy);
      if (d < 60) { arrived = auto.code; auto = null; van.v *= 0.5; }
      else { const ta = Math.atan2(dy, dx); let da = ta - van.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; st = Math.max(-1, Math.min(1, da * 2.5)); th = Math.abs(da) > 1.2 ? 0.35 : (d < 250 ? 0.55 : 1); }
    }
    const MAXV = 520, ACC = 620, FR = 0.985;
    van.v += th * ACC * dt; van.v = Math.max(-MAXV * 0.4, Math.min(MAXV, van.v)); van.v *= Math.pow(FR, dt * 60);
    if (Math.abs(van.v) < 2 && !th) van.v = 0;
    van.a += st * 2.6 * dt * Math.min(1, Math.abs(van.v) / 120) * (van.v < 0 ? -1 : 1);
    van.x += Math.cos(van.a) * van.v * dt; van.y += Math.sin(van.a) * van.v * dt;
    van.x = Math.max(40, Math.min(WORLD_W - 40, van.x)); van.y = Math.max(40, Math.min(WORLD_H - 40, van.y));
    // caméra
    const vw = cv.width / dpr, vh = cv.height / dpr;
    const tz = Math.max(0.55, Math.min(1, 1 - Math.abs(van.v) / MAXV * 0.35)) * (vw < 600 ? 0.8 : 1);
    cam.z += (tz - cam.z) * (1 - Math.pow(0.02, dt)); cam.x += (van.x + Math.cos(van.a) * 60 - cam.x) * (1 - Math.pow(0.001, dt)); cam.y += (van.y + Math.sin(van.a) * 60 - cam.y) * (1 - Math.pow(0.001, dt));
    // proximité
    let best = null, bd = 1e9;
    locs.forEach(l => { const d = Math.hypot(W.x(l.lon) - van.x, W.y(l.lat) - van.y); if (d < bd) { bd = d; best = l; } });
    let nearNow = bd < 110 ? best : null; if (arrived) { const a = locs.find(l => l.code === arrived); if (a && Math.hypot(W.x(a.lon) - van.x, W.y(a.lat) - van.y) < 140) nearNow = a; else arrived = null; }
    if (nearNow !== near) { near = nearNow; if (near) onArrive && onArrive(near); else onLeave && onLeave(); }
    draw(vw, vh, now);
    raf = requestAnimationFrame(frame);
  }

  function draw(vw, vh, now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = window.PYU.isDark(); if (d !== dark || !P.brand) { dark = d; P = PALETTES[d ? 'dark' : 'light']; P.brand = window.PYU.cssVar('--brand', d ? '#FF3B3B' : '#C7000B'); P.edge = window.PYU.SEQ_EDGE[d ? 'dark' : 'light']; }
    ctx.fillStyle = P.ground; ctx.fillRect(0, 0, vw, vh);
    ctx.save(); ctx.translate(vw / 2, vh / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    const L = cam.x - vw / cam.z / 2 - 200, R = cam.x + vw / cam.z / 2 + 200, T = cam.y - vh / cam.z / 2 - 200, B = cam.y + vh / cam.z / 2 + 200;
    // champs
    fields.forEach(f => { if (f.x < L || f.x > R || f.y < T || f.y > B) return; ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.fillStyle = P.fields[f.c < .3 ? 0 : f.c < .6 ? 1 : 2]; ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h); ctx.strokeStyle = P.furrow; ctx.lineWidth = 2; for (let i = -f.h / 2 + 14; i < f.h / 2; i += 14) { ctx.beginPath(); ctx.moveTo(-f.w / 2, i); ctx.lineTo(f.w / 2, i); ctx.stroke(); } ctx.restore(); });
    // routes
    ROADS.forEach(r => { ctx.beginPath(); r.p.forEach((q, i) => { const x = W.x(q[1]), y = W.y(q[0]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = P.casing; ctx.lineWidth = r.w + 4; ctx.stroke(); ctx.strokeStyle = P.road; ctx.lineWidth = r.w; ctx.stroke(); if (r.w > 10) { ctx.setLineDash([14, 14]); ctx.strokeStyle = P.dash; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); } });
    ROADS.forEach(r => { const m = r.p[Math.floor(r.p.length / 2)]; ctx.fillStyle = P.plate; const x = W.x(m[1]) + 10, y = W.y(m[0]) - 24; ctx.beginPath(); ctx.roundRect(x - 2, y - 11, 48, 16, 8); ctx.fill(); ctx.fillStyle = P.plateText; ctx.font = '600 11px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(r.n, x + 22, y + 1); ctx.textAlign = 'start'; });
    // arbres
    trees.forEach(t => { if (t.x < L || t.x > R || t.y < T || t.y > B) return; ctx.fillStyle = P.shadow; ctx.beginPath(); ctx.ellipse(t.x + 3, t.y + 4, t.s, t.s * .7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = P.tree[t.k < .5 ? 0 : 1]; ctx.beginPath(); ctx.arc(t.x, t.y, t.s, 0, Math.PI * 2); ctx.fill(); });
    // localités
    const maxN = Math.max(1, ...locs.map(l => l.n));
    locs.forEach(l => {
      const x = W.x(l.lon), y = W.y(l.lat); if (x < L || x > R || y < T || y > B) return;
      const nb = 2 + Math.round(6 * Math.sqrt(l.n / maxN)); const rr = seed(l.code.charCodeAt(0) * 31 + l.code.charCodeAt(2));
      const col = seqColor(l.ppp); const isNear = near && near.code === l.code;
      if (isNear) { ctx.strokeStyle = P.brand; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.lineDashOffset = reduced ? 0 : -now / 40; ctx.beginPath(); ctx.arc(x, y, 95, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      for (let i = 0; i < nb; i++) { const hx = x + (rr() - .5) * 90, hy = y + (rr() - .5) * 70, hw = 16 + rr() * 10, hh = 12 + rr() * 8; ctx.fillStyle = P.shadow; ctx.fillRect(hx + 3, hy + 3, hw, hh); ctx.fillStyle = P.house; ctx.fillRect(hx, hy, hw, hh); ctx.fillStyle = col; ctx.fillRect(hx, hy, hw, hh * .45); ctx.strokeStyle = P.edge; ctx.lineWidth = 1; ctx.strokeRect(hx + .5, hy + .5, hw - 1, hh - 1); }
      // drapeau de zone, bordé du contour partagé pour rester lisible aux paliers clairs
      ctx.fillStyle = P.pole; ctx.fillRect(x - 1, y - 60, 2, 60); ctx.fillStyle = col; ctx.strokeStyle = P.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 1, y - 60); ctx.lineTo(x + 36, y - 52); ctx.lineTo(x + 1, y - 44); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.font = '600 13px ' + FONT; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = P.halo; ctx.fillStyle = isNear ? P.brand : P.text; ctx.strokeText(l.name, x, y + 56); ctx.fillText(l.name, x, y + 56);
      ctx.font = '500 11px ' + FONT; const t = l.ppp.toFixed(2).replace('.', ',') + ' $/colis'; ctx.strokeText(t, x, y + 70); ctx.fillStyle = P.sub; ctx.fillText(t, x, y + 70); ctx.textAlign = 'start';
    });
    // station et domicile
    drawBuilding(W.x(station.lon), W.y(station.lat) - 190, 90, 54, P.station, 'STATION DRUM', 'Point de départ des routes');
    drawBuilding(W.x(home.lon), W.y(home.lat), 50, 40, P.home, 'SHERBROOKE', 'Domicile');
    // camionnette : carrosserie neutre, bande rouge de marque, la seule couleur vive du monde
    ctx.save(); ctx.translate(van.x, van.y); ctx.rotate(van.a);
    ctx.fillStyle = P.shadow; ctx.beginPath(); ctx.roundRect(-16, -9 + 4, 34, 18, 4); ctx.fill();
    ctx.fillStyle = P.wheel; [-9, 7].forEach(wx => { ctx.fillRect(wx - 3, -11, 6, 3); ctx.fillRect(wx - 3, 8, 6, 3); });
    ctx.fillStyle = P.vanBody; ctx.strokeStyle = P.vanEdge; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.roundRect(-16, -9, 34, 18, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.brand; ctx.fillRect(-15, -2, 21, 4);
    ctx.fillStyle = P.glass; ctx.fillRect(8, -7, 6, 14);
    ctx.fillStyle = P.lamp; ctx.fillRect(17, -8, 2, 4); ctx.fillRect(17, 4, 2, 4);
    if (Math.abs(van.v) > 30 && !reduced) { ctx.fillStyle = P.beam; ctx.beginPath(); ctx.moveTo(18, -8); ctx.lineTo(70, -26); ctx.lineTo(70, 26); ctx.lineTo(18, 8); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.restore();
    // mini-carte
    const mw = Math.min(170, vw * .3), mh = mw * WORLD_H / WORLD_W, mx = vw - mw - 12, my = vh - mh - 12;
    ctx.fillStyle = P.panel; ctx.strokeStyle = P.panelEdge; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(mx - 4, my - 4, mw + 8, mh + 8, 8); ctx.fill(); ctx.stroke();
    const k = mw / WORLD_W; ROADS.forEach(r => { ctx.beginPath(); r.p.forEach((q, i) => { const x = mx + W.x(q[1]) * k, y = my + W.y(q[0]) * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = P.panelRoad; ctx.lineWidth = 1; ctx.stroke(); });
    locs.forEach(l => { ctx.fillStyle = seqColor(l.ppp); ctx.strokeStyle = P.edge; ctx.lineWidth = .75; ctx.beginPath(); ctx.arc(mx + W.x(l.lon) * k, my + W.y(l.lat) * k, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = P.brand; ctx.beginPath(); ctx.arc(mx + van.x * k, my + van.y * k, 3.5, 0, Math.PI * 2); ctx.fill();
    if (auto) { ctx.strokeStyle = P.brand; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx + auto.x * k, my + auto.y * k, 5, 0, Math.PI * 2); ctx.stroke(); }
    // compteur
    ctx.fillStyle = P.panel; ctx.strokeStyle = P.panelEdge; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(12, vh - 44, 128, 32, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.panelText; ctx.font = '600 17px ' + FONT; ctx.fillText(Math.round(Math.abs(van.v) / 5) + ' km/h', 24, vh - 22);
  }
  function drawBuilding(x, y, w, h, col, lab, sub) {
    ctx.fillStyle = P.shadow; ctx.fillRect(x - w / 2 + 4, y - h / 2 + 5, w, h);
    ctx.fillStyle = P.building; ctx.strokeStyle = P.edge; ctx.lineWidth = 1; ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.strokeRect(x - w / 2 + .5, y - h / 2 + .5, w - 1, h - 1); ctx.fillStyle = col; ctx.fillRect(x - w / 2, y - h / 2, w, 8);
    ctx.fillStyle = P.window; for (let i = 0; i < 3; i++) ctx.fillRect(x - w / 2 + 8 + i * (w / 3), y + h / 2 - 16, w / 3 - 12, 12);
    ctx.textAlign = 'center'; ctx.font = '700 12px ' + FONT; ctx.fillStyle = P.text; ctx.lineWidth = 4; ctx.strokeStyle = P.halo; ctx.strokeText(lab, x, y + h / 2 + 16); ctx.fillText(lab, x, y + h / 2 + 16);
    ctx.font = '500 11px ' + FONT; ctx.strokeText(sub, x, y + h / 2 + 30); ctx.fillStyle = P.sub; ctx.fillText(sub, x, y + h / 2 + 30); ctx.textAlign = 'start';
  }
  function teleport(lat, lon) { van.x = Math.max(40, Math.min(WORLD_W - 40, W.x(lon))); van.y = Math.max(40, Math.min(WORLD_H - 40, W.y(lat))); van.v = 0; cam.x = van.x; cam.y = van.y; auto = null; }
  window.PY_WORLD = { start, stop, driveTo, setJoystick, teleport, isAuto: () => !!auto };
})();
