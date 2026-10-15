// Projets d'épargne : budget réel, capacité hebdomadaire, répartition par priorité, date d'achat de la voiture,
// mur des semaines et prévision de fin de mois. S'appuie sur window.PYAPP et window.PYDB.
(function () {
  const A = () => window.PYAPP, DB = window.PYDB, $ = s => document.querySelector(s);
  const KIND = { voiture: { icon: 'VT', label: 'Voiture' }, van: { icon: 'VN', label: 'Van' }, impot: { icon: 'IM', label: 'Impôt' }, urgence: { icon: 'SC', label: 'Sécurité' }, autre: { icon: 'PR', label: 'Projet' } };
  let SV = { goals: [], log: [], budget: {} };
  const num = v => +v || 0;

  async function load() { try { SV = await DB.getSavings(); } catch (e) { SV = { goals: [], log: [], budget: {} }; } SV.goals = (SV.goals || []).filter(g => g.active !== false).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)); }

  // Capacité d'épargne hebdomadaire à partir des 8 dernières semaines réelles.
  function capacity(daysPerWeekOverride) {
    const { S, share, byWeek } = A(); const b = SV.budget; const wpm = num(b.weeks_per_month) || 4.33;
    const weeks = byWeek(S.days).slice(-8);
    const avgDay = S.days.length ? S.days.reduce((a, d) => a + d.invoiced, 0) / S.days.length : 367;
    const avgDays = weeks.length ? weeks.reduce((a, w) => a + w.days, 0) / weeks.length : 4;
    const dpw = daysPerWeekOverride != null ? daysPerWeekOverride : avgDays;
    const fuelDay = (() => { const f = S.days.filter(d => d.fuel != null); return f.length ? f.reduce((a, d) => a + d.fuel, 0) / f.length : (num(S.goals.fuel) || 60); })();
    const netWeek = dpw * avgDay * share();
    const fuelWeek = dpw * fuelDay;
    const taxWeek = netWeek * (num(b.tax_rate) || 0.2);
    const livingWeek = (num(b.rent) + num(b.fixed) + num(b.living)) / wpm;
    const free = netWeek - fuelWeek - taxWeek - livingWeek;
    return { dpw, avgDay, netWeek, fuelWeek, taxWeek, livingWeek, free: Math.max(0, free), rawFree: free };
  }
  // Répartition : priorité 1 servie à 100 % jusqu'à cible, puis 2, puis 3 (hors impôt qui est déjà la taxWeek).
  function allocate(free) {
    const alloc = {}; let rest = free;
    [1, 2, 3].forEach(p => {
      const gs = SV.goals.filter(g => g.priority === p && g.kind !== 'impot' && num(g.target) > num(g.saved)); if (!gs.length || rest <= 0) return;
      const each = rest / gs.length; gs.forEach(g => { const need = num(g.target) - num(g.saved); const a = Math.min(each, need); alloc[g.id] = a; rest -= a; });
    });
    return alloc;
  }
  function eta(g, weekly) { const left = Math.max(0, num(g.target) - num(g.saved)); if (!left) return { weeks: 0, date: null }; if (!weekly) return { weeks: Infinity, date: null }; const w = Math.ceil(left / weekly); const d = new Date(); d.setDate(d.getDate() + w * 7); return { weeks: w, date: d }; }
  const fmtDate = d => d ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  function renderSavings() {
    const el = $('#savings'); if (!el) return; const { fmt, money } = A();
    const cap = capacity(); const alloc = allocate(cap.free);
    const capPlus = capacity(cap.dpw + 1); const allocPlus = allocate(capPlus.free);
    const car = SV.goals.find(g => g.kind === 'voiture');
    el.innerHTML = `
      <div class="tiles">${[['Net par semaine', money(cap.netWeek), fmt(cap.dpw, 1) + ' j/sem, ' + money(cap.avgDay) + ' facturés/j'], ['Essence', '− ' + money(cap.fuelWeek), 'réel saisi ou estimation'], ['Réserve impôt et RRQ', '− ' + money(cap.taxWeek), Math.round((num(SV.budget.tax_rate) || .2) * 100) + ' % du net'], ['Loyer et vie courante', '− ' + money(cap.livingWeek), money(num(SV.budget.rent) + num(SV.budget.fixed) + num(SV.budget.living)) + ' par mois'], ['Disponible pour les projets', money(cap.free), cap.rawFree < 0 ? 'budget en déficit de ' + money(-cap.rawFree) + ' par semaine' : 'par semaine, au rythme actuel']].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div><div class="sub">${t[2]}</div></div>`).join('')}</div>
      <div class="projects">${SV.goals.map(g => { const k = KIND[g.kind] || KIND.autre; const isTax = g.kind === 'impot'; const weekly = isTax ? cap.taxWeek : (alloc[g.id] || 0); const e = eta(g, weekly); const pct = num(g.target) ? Math.min(100, 100 * num(g.saved) / num(g.target)) : 0; const ePlus = eta(g, isTax ? capPlus.taxWeek : (allocPlus[g.id] || 0)); return `
        <div class="proj ${g.kind}">
          <div class="row" style="justify-content:space-between"><div><span class="ic">${k.icon}</span> <b>${A().esc(g.name)}</b> <span class="pill">priorité ${g.priority}</span></div><div class="row"><button class="btn sec" data-contrib="${g.id}" style="padding:4px 10px">+ Verser</button><button class="btn sec" data-edit="${g.id}" style="padding:4px 10px">Modifier</button></div></div>
          <div class="kv" style="margin-top:6px"><span>Épargné</span><b>${money(num(g.saved))}${num(g.target) ? ' / ' + money(num(g.target)) : ''}</b><span>Apport par semaine au rythme actuel</span><b>${money(weekly)}</b>${num(g.target) ? `<span>Date prévue</span><b>${isFinite(e.weeks) ? fmtDate(e.date) + ' (' + e.weeks + ' sem.)' : 'jamais à ce rythme'}</b>` : ''}</div>
          ${num(g.target) ? `<div class="bar"><i class="${pct >= 100 ? 'good' : ''}" style="width:${pct}%"></i></div>` : ''}
          ${num(g.target) && isFinite(e.weeks) && isFinite(ePlus.weeks) && ePlus.weeks < e.weeks ? `<p class="small muted" style="margin:6px 0 0">Avec un jour de plus par semaine : ${fmtDate(ePlus.date)}, soit ${e.weeks - ePlus.weeks} semaine${e.weeks - ePlus.weeks > 1 ? 's' : ''} plus tôt.</p>` : ''}
          ${g.note ? `<p class="small muted" style="margin:4px 0 0">${A().esc(g.note)}</p>` : ''}
        </div>`; }).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn sec" id="btnNewGoal">Nouveau projet</button><button class="btn sec" id="btnBudget">Mon budget</button></div>
      ${car && num(car.target) ? `<p class="small muted" style="margin-top:8px">Chaque journée travaillée rapproche la voiture d'environ ${money((alloc[car.id] || 0) / Math.max(1, cap.dpw))}. Une journée urbaine à 1,46 $/colis en vaut ${money(((alloc[car.id] || 0) / Math.max(1, cap.dpw)) * 0.7)}, une rurale éloignée ${money(((alloc[car.id] || 0) / Math.max(1, cap.dpw)) * 1.4)}.</p>` : ''}
      <div class="tscroll" style="margin-top:10px"><table><tr><th>Date</th><th>Projet</th><th class="num">Montant</th><th>Note</th></tr>${(SV.log || []).slice(0, 10).map(l => { const g = SV.goals.find(x => x.id === l.goal_id); return `<tr><td>${l.date}</td><td>${g ? A().esc(g.name) : l.goal_id}</td><td class="num">${money(num(l.amount))}</td><td class="small">${A().esc(l.note || '')}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted small">Aucun versement enregistré. Clique sur « + Verser » après chaque paie.</td></tr>'}</table></div>`;
    el.querySelectorAll('[data-contrib]').forEach(b => b.onclick = () => openContrib(b.dataset.contrib));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openGoalForm(SV.goals.find(g => g.id === b.dataset.edit)));
    $('#btnNewGoal').onclick = () => openGoalForm(null);
    $('#btnBudget').onclick = openBudget;
    renderCarTile(cap, alloc);
  }
  function renderCarTile(cap, alloc) {
    const el = $('#carTile'); if (!el) return; const { money } = A();
    const car = SV.goals.find(g => g.kind === 'voiture'); if (!car || !num(car.target)) { el.innerHTML = ''; return; }
    const e = eta(car, alloc[car.id] || 0); const pct = Math.min(100, 100 * num(car.saved) / num(car.target));
    el.innerHTML = `<div class="tile car"><div class="lab">${A().esc(car.name)} · projet prioritaire</div><div class="val">${money(num(car.saved))}</div><div class="sub">sur ${money(num(car.target))} · ${isFinite(e.weeks) ? e.weeks + ' sem. restantes (' + fmtDate(e.date) + ')' : 'augmenter les jours travaillés'}</div><div class="bar"><i class="${pct >= 100 ? 'good' : ''}" style="width:${pct}%"></i></div></div>`;
  }

  /* ---- Formulaires ---- */
  function modal(html) { const m = $('#modal'); m.hidden = false; m.querySelector('.panel').innerHTML = html; document.body.classList.add('noscroll'); return m; }
  function closeModal() { $('#modal').hidden = true; document.body.classList.remove('noscroll'); }
  function openContrib(id, suggested) {
    const g = SV.goals.find(x => x.id === id); if (!g) return; const { money } = A();
    const m = modal(`<p class="eyebrow">Verser dans</p><h2>${A().esc(g.name)}</h2><p class="small muted">Épargné : ${money(num(g.saved))}${num(g.target) ? ' sur ' + money(num(g.target)) : ''}.</p>
      <form id="contribForm" class="f"><label class="fl">Montant ($)<input type="number" id="c_amt" step="1" min="1" inputmode="decimal" value="${suggested ? Math.round(suggested) : ''}" required style="font-size:22px"></label><label class="fl">Note<input type="text" id="c_note" placeholder="paie de la semaine 42"></label><div class="row" style="grid-column:1/-1;justify-content:space-between"><button class="btn sec" type="button" id="c_cancel">Annuler</button><button class="btn big" type="submit">Enregistrer</button></div></form>`);
    $('#c_cancel').onclick = closeModal;
    $('#contribForm').onsubmit = async e => { e.preventDefault(); try { await DB.addContribution(id, +$('#c_amt').value, $('#c_note').value.trim()); A().toast(money(+$('#c_amt').value) + ' versés dans ' + g.name); closeModal(); await refresh(); } catch (err) { A().toast('Refusé : ' + err.message); } };
  }
  function openGoalForm(g) {
    const isNew = !g; g = g || { id: 'p' + Date.now().toString(36), name: '', kind: 'autre', target: 0, saved: 0, priority: 2, note: '' };
    modal(`<p class="eyebrow">${isNew ? 'Nouveau projet' : 'Modifier'}</p><h2>${isNew ? 'Un objectif à atteindre' : A().esc(g.name)}</h2>
      <form id="goalForm2" class="f"><label class="fl">Nom<input id="g2_name" value="${A().esc(g.name)}" required></label><label class="fl">Type<select id="g2_kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${g.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label><label class="fl">Cible ($)<input type="number" id="g2_target" value="${num(g.target)}" min="0" step="50"></label><label class="fl">Déjà épargné ($)<input type="number" id="g2_saved" value="${num(g.saved)}" min="0" step="10"></label><label class="fl">Priorité<select id="g2_prio"><option value="1" ${g.priority == 1 ? 'selected' : ''}>1 : en premier</option><option value="2" ${g.priority == 2 ? 'selected' : ''}>2 : normal</option><option value="3" ${g.priority == 3 ? 'selected' : ''}>3 : ensuite</option></select></label><label class="fl" style="grid-column:1/-1">Note<input id="g2_note" value="${A().esc(g.note || '')}"></label>
      <div class="row" style="grid-column:1/-1;justify-content:space-between">${isNew ? '<span></span>' : '<button class="btn danger" type="button" id="g2_del">Supprimer</button>'}<div class="row"><button class="btn sec" type="button" id="g2_cancel">Annuler</button><button class="btn big" type="submit">Enregistrer</button></div></div></form>`);
    $('#g2_cancel').onclick = closeModal;
    const del = $('#g2_del'); if (del) del.onclick = async () => { try { await DB.deleteSavingsGoal(g.id); closeModal(); await refresh(); } catch (err) { A().toast(err.message); } };
    $('#goalForm2').onsubmit = async e => { e.preventDefault(); try { await DB.upsertSavingsGoal({ id: g.id, name: $('#g2_name').value.trim(), kind: $('#g2_kind').value, target: +$('#g2_target').value || 0, saved: +$('#g2_saved').value || 0, priority: +$('#g2_prio').value, note: $('#g2_note').value.trim() || null, active: true }); closeModal(); await refresh(); A().toast('Projet enregistré'); } catch (err) { A().toast('Refusé : ' + err.message); } };
  }
  function openBudget() {
    const b = SV.budget;
    modal(`<p class="eyebrow">Mon budget</p><h2>Ce qui sort chaque mois</h2><p class="small muted">Sert à calculer ce qui reste pour les projets, à partir du net réel.</p>
      <form id="budgetForm" class="f"><label class="fl">Loyer ($/mois)<input type="number" id="b_rent" value="${num(b.rent)}" step="10"></label><label class="fl">Fixes : téléphone, assurance, abonnements<input type="number" id="b_fixed" value="${num(b.fixed)}" step="10"></label><label class="fl">Vie courante : nourriture, divers<input type="number" id="b_living" value="${num(b.living)}" step="10"></label><label class="fl">Réserve impôt et RRQ (%)<input type="number" id="b_tax" value="${Math.round((num(b.tax_rate) || .2) * 100)}" min="0" max="50"></label>
      <div class="row" style="grid-column:1/-1;justify-content:space-between"><button class="btn sec" type="button" id="b_cancel">Annuler</button><button class="btn big" type="submit">Enregistrer</button></div></form>`);
    $('#b_cancel').onclick = closeModal;
    $('#budgetForm').onsubmit = async e => { e.preventDefault(); try { await DB.saveBudget({ rent: +$('#b_rent').value, fixed: +$('#b_fixed').value, living: +$('#b_living').value, tax_rate: (+$('#b_tax').value || 20) / 100, weeks_per_month: 4.33 }); closeModal(); await refresh(); A().toast('Budget enregistré'); } catch (err) { A().toast('Refusé : ' + err.message); } };
  }

  /* ---- Suggestion du soir : combien mettre de côté après la journée ---- */
  function eveningSuggestion(dayNet, fuel) {
    const cap = capacity(); const b = SV.budget;
    const tax = dayNet * (num(b.tax_rate) || .2); const living = cap.livingWeek / Math.max(1, cap.dpw);
    const free = Math.max(0, dayNet - (fuel || 0) - tax - living); const alloc = allocate(free);
    const car = SV.goals.find(g => g.kind === 'voiture');
    return { tax, free, car: car ? (alloc[car.id] || 0) : 0, carGoal: car };
  }

  /* ---- Mur des semaines (calendrier) ---- */
  function renderHeatmap() {
    const el = $('#heatmap'); if (!el) return; const { S, money } = A();
    const by = {}; S.days.forEach(d => by[d.date] = d);
    const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 7 * 26 + 1); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const max = Math.max(1, ...S.days.map(d => d.invoiced));
    let cols = ''; const cur = new Date(start); const months = [];
    while (cur <= end) {
      let col = ''; for (let i = 0; i < 7; i++) { const iso = cur.toISOString().slice(0, 10); const d = by[iso]; const lvl = d ? Math.min(4, Math.ceil(4 * d.invoiced / max)) : 0; col += `<i class="l${lvl}" title="${iso}${d ? ' : ' + d.parcels + ' colis, ' + money(d.invoiced, 2) : ''}"></i>`; if (cur.getDate() <= 7 && i === 0) months.push({ i: months.length, m: cur.toLocaleDateString('fr-CA', { month: 'short' }) }); cur.setDate(cur.getDate() + 1); }
      cols += `<div class="hcol">${col}</div>`;
    }
    const worked = S.days.filter(d => d.date >= start.toISOString().slice(0, 10)).length;
    el.innerHTML = `<div class="hgrid">${cols}</div><p class="small muted">26 dernières semaines : ${worked} journées travaillées, les cases vides sont les jours sans revenu. Plus la case est foncée, plus la journée a rapporté.</p>`;
  }

  /* ---- Prévision de fin de mois ---- */
  function renderForecast() {
    const el = $('#forecast'); if (!el) return; const { S, share, money, fmt, byWeek } = A();
    const now = new Date(); const ym = now.toISOString().slice(0, 7); const md = S.days.filter(d => d.date.startsWith(ym));
    const done = md.reduce((a, d) => a + d.invoiced, 0) * share();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); const left = daysInMonth - now.getDate();
    const weeks = byWeek(S.days).slice(-8); const dpw = weeks.length ? weeks.reduce((a, w) => a + w.days, 0) / weeks.length : 4;
    const avgDay = S.days.length ? S.days.reduce((a, d) => a + d.invoiced, 0) / S.days.length * share() : 275;
    const expDays = left / 7 * dpw; const low = done + expDays * avgDay * 0.8, mid = done + expDays * avgDay, high = done + (left / 7 * Math.min(6, dpw + 1)) * avgDay * 1.1;
    const target = num(S.goals.net); const needDays = target > mid && avgDay ? Math.ceil((target - done) / avgDay) : 0;
    el.innerHTML = `<div class="kv"><span>Déjà net ce mois</span><b>${money(done)} (${md.length} j)</b><span>Jours restants</span><b>${left}</b><span>Prévision basse / centrale / haute</span><b>${money(low)} / <span style="color:var(--sign-text)">${money(mid)}</span> / ${money(high)}</b><span>Objectif</span><b>${money(target)} <span class="pill ${mid >= target ? 'good' : 'warn'}">${mid >= target ? 'en bonne voie' : 'il faut ' + needDays + ' j au total'}</span></b></div>
      <p class="small muted" style="margin-top:6px">Centrale = rythme des 8 dernières semaines (${fmt(dpw, 1)} j/sem à ${money(avgDay)} net/j). Haute = un jour de plus par semaine et des routes mieux payées.</p>`;
  }

  async function refresh() { await load(); renderSavings(); renderHeatmap(); renderForecast(); }
  window.PYS = { refresh, load, capacity, allocate, eveningSuggestion, openContrib, get goals() { return SV.goals; } };
})();
