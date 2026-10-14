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
  const seqColor = v => { const t = Math.max(0, Math.min(1, (v - 1.3) / 2)); return ['#cfe0f3', '#8fb3dc', '#4f85bf', '#1f5fa8', '#0e3a6e'][Math.min(4, Math.floor(t * 5))]; };

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
  function kd(e) { const k = KEYS[e.key]; if (k) { keys[k] = true; auto = null; e.preventDefault(); } }
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
    ctx.fillStyle = '#9ccf7a'; ctx.fillRect(0, 0, vw, vh);
    ctx.save(); ctx.translate(vw / 2, vh / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    const L = cam.x - vw / cam.z / 2 - 200, R = cam.x + vw / cam.z / 2 + 200, T = cam.y - vh / cam.z / 2 - 200, B = cam.y + vh / cam.z / 2 + 200;
    // champs
    fields.forEach(f => { if (f.x < L || f.x > R || f.y < T || f.y > B) return; ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.fillStyle = f.c < .3 ? '#b8d98a' : f.c < .6 ? '#8fc46a' : '#d9c97a'; ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h); ctx.strokeStyle = 'rgba(70,110,40,.18)'; ctx.lineWidth = 2; for (let i = -f.h / 2 + 14; i < f.h / 2; i += 14) { ctx.beginPath(); ctx.moveTo(-f.w / 2, i); ctx.lineTo(f.w / 2, i); ctx.stroke(); } ctx.restore(); });
    // routes
    ROADS.forEach(r => { ctx.beginPath(); r.p.forEach((q, i) => { const x = W.x(q[1]), y = W.y(q[0]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#3b4046'; ctx.lineWidth = r.w + 4; ctx.stroke(); ctx.strokeStyle = '#555b63'; ctx.lineWidth = r.w; ctx.stroke(); ctx.setLineDash([14, 14]); ctx.strokeStyle = r.w > 10 ? '#f2c94c' : '#e8e8e8'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); });
    ROADS.forEach(r => { const m = r.p[Math.floor(r.p.length / 2)]; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2a7a3b'; ctx.lineWidth = 2; const x = W.x(m[1]) + 10, y = W.y(m[0]) - 24; ctx.beginPath(); ctx.roundRect(x - 2, y - 11, 48, 16, 3); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#1b4d27'; ctx.font = '700 11px "IBM Plex Sans", sans-serif'; ctx.fillText(r.n, x + 4, y + 1); });
    // arbres
    trees.forEach(t => { if (t.x < L || t.x > R || t.y < T || t.y > B) return; ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.ellipse(t.x + 3, t.y + 4, t.s, t.s * .7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = t.k < .5 ? '#2f7a3e' : '#3f9450'; ctx.beginPath(); ctx.arc(t.x, t.y, t.s, 0, Math.PI * 2); ctx.fill(); });
    // localités
    const maxN = Math.max(1, ...locs.map(l => l.n));
    locs.forEach(l => {
      const x = W.x(l.lon), y = W.y(l.lat); if (x < L || x > R || y < T || y > B) return;
      const nb = 2 + Math.round(6 * Math.sqrt(l.n / maxN)); const rr = seed(l.code.charCodeAt(0) * 31 + l.code.charCodeAt(2));
      const col = seqColor(l.ppp); const isNear = near && near.code === l.code;
      if (isNear) { ctx.strokeStyle = '#d9561a'; ctx.lineWidth = 4; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -now / 40; ctx.beginPath(); ctx.arc(x, y, 95, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      for (let i = 0; i < nb; i++) { const hx = x + (rr() - .5) * 90, hy = y + (rr() - .5) * 70, hw = 16 + rr() * 10, hh = 12 + rr() * 8; ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(hx + 3, hy + 3, hw, hh); ctx.fillStyle = '#e9e4d8'; ctx.fillRect(hx, hy, hw, hh); ctx.fillStyle = col; ctx.fillRect(hx, hy, hw, hh * .45); }
      // drapeau de zone
      ctx.fillStyle = '#5a4a3a'; ctx.fillRect(x - 1.5, y - 60, 3, 60); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + 1, y - 60); ctx.lineTo(x + 36, y - 52); ctx.lineTo(x + 1, y - 44); ctx.closePath(); ctx.fill();
      ctx.font = '600 13px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = '#15202b'; ctx.strokeText(l.name, x, y + 56); ctx.fillText(l.name, x, y + 56);
      ctx.font = '500 11px "IBM Plex Sans", sans-serif'; const t = l.ppp.toFixed(2).replace('.', ',') + ' $/colis'; ctx.strokeText(t, x, y + 70); ctx.fillStyle = '#334'; ctx.fillText(t, x, y + 70); ctx.textAlign = 'start';
    });
    // station et domicile
    drawBuilding(W.x(station.lon), W.y(station.lat) - 190, 90, 54, '#d9561a', 'STATION DRUM', 'Point de départ des routes');
    drawBuilding(W.x(home.lon), W.y(home.lat), 50, 40, '#7a4bb3', 'SHERBROOKE', 'Domicile');
    // camionnette
    ctx.save(); ctx.translate(van.x, van.y); ctx.rotate(van.a);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.roundRect(-16, -9 + 4, 34, 18, 4); ctx.fill();
    ctx.fillStyle = '#1b1f24'; [-9, 7].forEach(wx => { ctx.fillRect(wx - 3, -11, 6, 3); ctx.fillRect(wx - 3, 8, 6, 3); });
    ctx.fillStyle = '#f0f0f0'; ctx.beginPath(); ctx.roundRect(-16, -9, 34, 18, 4); ctx.fill();
    ctx.fillStyle = '#d9561a'; ctx.fillRect(-16, -9, 22, 18);
    ctx.fillStyle = '#9fd3ff'; ctx.fillRect(8, -7, 6, 14);
    ctx.fillStyle = '#fff4b0'; ctx.fillRect(17, -8, 2, 4); ctx.fillRect(17, 4, 2, 4);
    if (Math.abs(van.v) > 30 && !reduced) { ctx.fillStyle = 'rgba(255,244,176,.25)'; ctx.beginPath(); ctx.moveTo(18, -8); ctx.lineTo(70, -26); ctx.lineTo(70, 26); ctx.lineTo(18, 8); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.restore();
    // mini-carte
    const mw = Math.min(170, vw * .3), mh = mw * WORLD_H / WORLD_W, mx = vw - mw - 12, my = vh - mh - 12;
    ctx.fillStyle = 'rgba(21,32,43,.78)'; ctx.beginPath(); ctx.roundRect(mx - 4, my - 4, mw + 8, mh + 8, 6); ctx.fill();
    const k = mw / WORLD_W; ROADS.forEach(r => { ctx.beginPath(); r.p.forEach((q, i) => { const x = mx + W.x(q[1]) * k, y = my + W.y(q[0]) * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.stroke(); });
    locs.forEach(l => { ctx.fillStyle = seqColor(l.ppp); ctx.beginPath(); ctx.arc(mx + W.x(l.lon) * k, my + W.y(l.lat) * k, 2.2, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#d9561a'; ctx.beginPath(); ctx.arc(mx + van.x * k, my + van.y * k, 3.5, 0, Math.PI * 2); ctx.fill();
    if (auto) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx + auto.x * k, my + auto.y * k, 5, 0, Math.PI * 2); ctx.stroke(); }
    // compteur
    ctx.fillStyle = 'rgba(21,32,43,.78)'; ctx.beginPath(); ctx.roundRect(12, vh - 44, 128, 32, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '600 18px "Barlow Condensed", sans-serif'; ctx.fillText(Math.round(Math.abs(van.v) / 5) + ' km/h', 22, vh - 21);
  }
  function drawBuilding(x, y, w, h, col, lab, sub) {
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x - w / 2 + 5, y - h / 2 + 6, w, h);
    ctx.fillStyle = '#d7d2c8'; ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.fillStyle = col; ctx.fillRect(x - w / 2, y - h / 2, w, 10);
    ctx.fillStyle = '#9aa3ad'; for (let i = 0; i < 3; i++) ctx.fillRect(x - w / 2 + 8 + i * (w / 3), y + h / 2 - 16, w / 3 - 12, 12);
    ctx.textAlign = 'center'; ctx.font = '700 13px "Barlow Condensed", sans-serif'; ctx.fillStyle = '#15202b'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(lab, x, y + h / 2 + 16); ctx.fillText(lab, x, y + h / 2 + 16);
    ctx.font = '500 11px "IBM Plex Sans", sans-serif'; ctx.strokeText(sub, x, y + h / 2 + 30); ctx.fillStyle = '#334'; ctx.fillText(sub, x, y + h / 2 + 30); ctx.textAlign = 'start';
  }
  function teleport(lat, lon) { van.x = Math.max(40, Math.min(WORLD_W - 40, W.x(lon))); van.y = Math.max(40, Math.min(WORLD_H - 40, W.y(lat))); van.v = 0; cam.x = van.x; cam.y = van.y; auto = null; }
  window.PY_WORLD = { start, stop, driveTo, setJoystick, teleport, isAuto: () => !!auto };
})();
