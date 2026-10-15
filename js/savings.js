// Projets d'épargne : budget réel, capacité hebdomadaire, répartition par priorité, date d'achat de la voiture,
// mur des semaines et prévision de fin de mois. S'appuie sur window.PYAPP et window.PYDB.
(function () {
  const A = () => window.PYAPP, DB = window.PYDB, $ = s => document.querySelector(s);
  const KIND = { voiture: { icon: 'VT', label: 'Voiture' }, van: { icon: 'VN', label: 'Van' }, impot: { icon: 'IM', label: 'Impôt' }, urgence: { icon: 'SC', label: 'Sécurité' }, autre: { icon: 'PR', label: 'Projet' } };
  let SV = { goals: [], log: [], budget: {} };
  const num = v => +v || 0;
  const U = window.PYU, taxRate = () => U.numOr(SV.budget.tax_rate, 0.2);

  async function load() { try { SV = await DB.getSavings(); } catch (e) { SV = { goals: [], log: [], budget: {} }; } SV.goals = (SV.goals || []).filter(g => g.active !== false).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)); }

  // Capacité d'épargne hebdomadaire à partir des 8 dernières semaines réelles.
  function capacity(daysPerWeekOverride) {
    const { S, share } = A(); const b = SV.budget; const wpm = num(b.weeks_per_month) || 4.33;
    const weeks = A().recentWeeks(8);
    const avgDay = U.avgInvoiced(S.days, 367);
    const avgDays = weeks.length ? weeks.reduce((a, w) => a + w.days, 0) / weeks.length : 4;
    const dpw = daysPerWeekOverride != null ? daysPerWeekOverride : avgDays;
    const fuelDay = (() => { const f = S.days.filter(d => d.fuel != null); return f.length ? f.reduce((a, d) => a + d.fuel, 0) / f.length : (num(S.goals.fuel) || 60); })();
    const netWeek = dpw * avgDay * share();
    const fuelWeek = dpw * fuelDay;
    const taxWeek = netWeek * taxRate();
    const livingWeek = (num(b.rent) + num(b.fixed) + num(b.living)) / wpm;
    const free = netWeek - fuelWeek - taxWeek - livingWeek;
    return { dpw, avgDay, netWeek, fuelWeek, taxWeek, livingWeek, free: Math.max(0, free), rawFree: free };
  }
  // Répartition : priorité 1 servie à 100 % jusqu'à cible, puis 2, puis 3 (hors impôt qui est déjà la taxWeek).
  // `saved` (facultatif) remplace les montants épargnés, pour la projection semaine par semaine.
  function allocate(free, saved) {
    const alloc = {}; let rest = free; const sv = g => saved ? saved[g.id] : num(g.saved);
    [1, 2, 3].forEach(p => {
      const gs = SV.goals.filter(g => g.priority === p && g.kind !== 'impot' && num(g.target) > sv(g)); if (!gs.length || rest <= 0) return;
      const each = rest / gs.length; gs.forEach(g => { const need = num(g.target) - sv(g); const a = Math.min(each, need); alloc[g.id] = a; rest -= a; });
    });
    return alloc;
  }
  // Projection : chaque semaine, le disponible est réparti par priorité ; quand un projet atteint sa cible, sa part
  // passe au suivant. Le van (priorité 3) n'est donc pas « jamais » : il commence quand la voiture est payée.
  const MAX_WEEKS = 520;
  function project(free) {
    const saved = {}, track = {}; SV.goals.forEach(g => { saved[g.id] = num(g.saved); track[g.id] = []; });
    if (free > 0) for (let w = 1; w <= MAX_WEEKS; w++) {
      const alloc = allocate(free, saved); let any = false;
      Object.entries(alloc).forEach(([id, a]) => { saved[id] += a; if (a > 0) any = true; });
      SV.goals.forEach(g => track[g.id].push(saved[g.id]));
      if (!any) break;
    }
    // Semaines pour qu'un projet atteigne `amount` (sa cible par défaut) ; Infinity si jamais en dix ans.
    const weeksTo = (g, amount) => { amount = amount == null ? num(g.target) : amount; if (num(g.saved) >= amount - 0.005) return 0; const i = (track[g.id] || []).findIndex(v => v >= amount - 0.005); return i < 0 ? Infinity : i + 1; };
    return { weeksTo };
  }
  const inWeeks = w => { const d = new Date(); d.setDate(d.getDate() + w * 7); return d; };
  function eta(g, proj, amount) { const w = proj.weeksTo(g, amount); return { weeks: w, date: isFinite(w) && w > 0 ? inWeeks(w) : null }; }
  // Plan du van, source unique pour les objectifs, le compte à rebours et le projet : épargne du projet « van »,
  // seuil `down` (mise de fonds exigée par le plan), apport de cette semaine et date prévue par la projection.
  function vanPlan(down) {
    const van = SV.goals.find(g => g.kind === 'van'); if (!van) return null;
    const cap = capacity(), alloc = allocate(cap.free), e = eta(van, project(cap.free), down);
    return { goal: van, saved: num(van.saved), target: num(van.target), down, left: Math.max(0, down - num(van.saved)), weekly: alloc[van.id] || 0, weeks: e.weeks, date: e.date, first: SV.goals.find(g => g.priority < van.priority && g.kind !== 'impot' && num(g.target) > num(g.saved)) || null };
  }
  const fmtDate = d => d ? d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  function renderSavings() {
    const el = $('#savings'); if (!el) return; const { fmt, money } = A();
    const cap = capacity(); const alloc = allocate(cap.free), proj = project(cap.free);
    const capPlus = capacity(cap.dpw + 1); const projPlus = project(capPlus.free);
    const car = SV.goals.find(g => g.kind === 'voiture');
    el.innerHTML = `
      <div class="tiles">${[['Net par semaine', money(cap.netWeek), fmt(cap.dpw, 1) + ' j/sem, ' + money(cap.avgDay) + ' facturés/j'], ['Essence', '− ' + money(cap.fuelWeek), 'réel saisi ou estimation'], ['Réserve impôt et RRQ', '− ' + money(cap.taxWeek), Math.round(taxRate() * 100) + ' % du net'], ['Loyer et vie courante', '− ' + money(cap.livingWeek), money(num(SV.budget.rent) + num(SV.budget.fixed) + num(SV.budget.living)) + ' par mois'], ['Disponible pour les projets', money(cap.free), cap.rawFree < 0 ? 'budget en déficit de ' + money(-cap.rawFree) + ' par semaine' : 'par semaine, au rythme actuel']].map(t => `<div class="tile"><div class="lab">${t[0]}</div><div class="val">${t[1]}</div><div class="sub">${t[2]}</div></div>`).join('')}</div>
      <div class="projects">${SV.goals.map(g => { const k = KIND[g.kind] || KIND.autre; const isTax = g.kind === 'impot'; const weekly = isTax ? cap.taxWeek : (alloc[g.id] || 0); const e = eta(g, proj); const pct = num(g.target) ? Math.min(100, 100 * num(g.saved) / num(g.target)) : 0; const ePlus = eta(g, projPlus); const later = !weekly && isFinite(e.weeks) && e.weeks > 0; return `
        <div class="proj ${g.kind}">
          <div class="row" style="justify-content:space-between"><div><span class="ic">${k.icon}</span> <b>${A().esc(g.name)}</b> <span class="pill">priorité ${g.priority}</span></div><div class="row"><button class="btn sec" data-contrib="${g.id}" style="padding:4px 10px">+ Verser</button><button class="btn sec" data-edit="${g.id}" style="padding:4px 10px">Modifier</button></div></div>
          <div class="kv" style="margin-top:6px"><span>Épargné</span><b>${money(num(g.saved))}${num(g.target) ? ' / ' + money(num(g.target)) : ''}</b><span>Apport par semaine au rythme actuel</span><b>${later ? 'commence quand les projets prioritaires sont payés' : money(weekly)}</b>${num(g.target) && !isTax ? `<span>Date prévue</span><b>${e.weeks === 0 ? 'cible atteinte' : isFinite(e.weeks) ? fmtDate(e.date) + ' (' + e.weeks + ' sem.)' : 'jamais à ce rythme'}</b>` : ''}</div>
          ${num(g.target) ? `<div class="bar"><i class="${pct >= 100 ? 'good' : ''}" style="width:${pct}%"></i></div>` : ''}
          ${num(g.target) && !isTax && isFinite(e.weeks) && isFinite(ePlus.weeks) && ePlus.weeks < e.weeks ? `<p class="small muted" style="margin:6px 0 0">Avec un jour de plus par semaine : ${fmtDate(ePlus.date)}, soit ${e.weeks - ePlus.weeks} semaine${e.weeks - ePlus.weeks > 1 ? 's' : ''} plus tôt.</p>` : ''}
          ${g.note ? `<p class="small muted" style="margin:4px 0 0">${A().esc(g.note)}</p>` : ''}
        </div>`; }).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn sec" id="btnNewGoal">Nouveau projet</button><button class="btn sec" id="btnBudget">Mon budget</button></div>
      ${car && num(car.target) ? `<p class="small muted" style="margin-top:8px">Chaque journée travaillée rapproche la voiture d’environ ${money((alloc[car.id] || 0) / Math.max(1, cap.dpw))}. Une journée urbaine à 1,46 $/colis en vaut ${money(((alloc[car.id] || 0) / Math.max(1, cap.dpw)) * 0.7)}, une rurale éloignée ${money(((alloc[car.id] || 0) / Math.max(1, cap.dpw)) * 1.4)}.</p>` : ''}
      <div class="tscroll" style="margin-top:10px"><table><tr><th>Date</th><th>Projet</th><th class="num">Montant</th><th>Note</th></tr>${(SV.log || []).slice(0, 10).map(l => { const g = SV.goals.find(x => x.id === l.goal_id); return `<tr><td>${l.date}</td><td>${g ? A().esc(g.name) : l.goal_id}</td><td class="num">${money(num(l.amount))}</td><td class="small">${A().esc(l.note || '')}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted small">Aucun versement enregistré. Clique sur « + Verser » après chaque paie.</td></tr>'}</table></div>`;
    el.querySelectorAll('[data-contrib]').forEach(b => b.onclick = () => openContrib(b.dataset.contrib));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openGoalForm(SV.goals.find(g => g.id === b.dataset.edit)));
    $('#btnNewGoal').onclick = () => openGoalForm(null);
    $('#btnBudget').onclick = openBudget;
    renderCarTile(proj);
  }
  function renderCarTile(proj) {
    const el = $('#carTile'); if (!el) return; const { money } = A();
    const car = SV.goals.find(g => g.kind === 'voiture'); if (!car || !num(car.target)) { el.innerHTML = ''; return; }
    const e = eta(car, proj); const pct = Math.min(100, 100 * num(car.saved) / num(car.target));
    el.innerHTML = `<div class="tile car"><div class="lab">${A().esc(car.name)} · projet prioritaire</div><div class="val">${money(num(car.saved))}</div><div class="sub">sur ${money(num(car.target))} · ${e.weeks === 0 ? 'cible atteinte' : isFinite(e.weeks) ? e.weeks + ' sem. restantes (' + fmtDate(e.date) + ')' : 'augmenter les jours travaillés'}</div><div class="bar"><i class="${pct >= 100 ? 'good' : ''}" style="width:${pct}%"></i></div></div>`;
  }

  /* ---- Formulaires ---- */
  function modal(html) { const m = $('#modal'); m.hidden = false; m.querySelector('.panel').innerHTML = html; document.body.classList.add('noscroll'); return m; }
  function closeModal() { $('#modal').hidden = true; document.body.classList.remove('noscroll'); }
  function openContrib(id, suggested) {
    const g = SV.goals.find(x => x.id === id); if (!g) return; const { money } = A();
    const m = modal(`<p class="eyebrow">Verser dans</p><h2>${A().esc(g.name)}</h2><p class="small muted">Épargné : ${money(num(g.saved))}${num(g.target) ? ' sur ' + money(num(g.target)) : ''}.</p>
      <form id="contribForm" class="f"><label class="fl">Montant ($)<input type="number" id="c_amt" step="1" min="1" inputmode="decimal" value="${suggested ? Math.round(suggested) : ''}" required style="font-size:22px"></label><label class="fl">Note<input type="text" id="c_note" placeholder="paie de la semaine 42"></label><div class="row" style="grid-column:1/-1;justify-content:space-between"><button class="btn sec" type="button" id="c_cancel">Annuler</button><button class="btn big" type="submit">Enregistrer</button></div></form>`);
    $('#c_cancel').onclick = closeModal;
    // Le bouton est bloqué pendant l'envoi : deux appuis rapides ne versent pas deux fois.
    $('#contribForm').onsubmit = async e => { e.preventDefault(); const sb = e.target.querySelector('[type=submit]'); if (sb.disabled) return; sb.disabled = true; try { await DB.addContribution(id, +$('#c_amt').value, $('#c_note').value.trim()); A().toast(money(+$('#c_amt').value) + ' versés dans ' + g.name); closeModal(); await A().refresh(); } catch (err) { sb.disabled = false; A().toast('Refusé : ' + err.message); } };
  }
  function openGoalForm(g) {
    const isNew = !g; g = g || { id: 'p' + Date.now().toString(36), name: '', kind: 'autre', target: 0, saved: 0, priority: 2, note: '' };
    modal(`<p class="eyebrow">${isNew ? 'Nouveau projet' : 'Modifier'}</p><h2>${isNew ? 'Un objectif à atteindre' : A().esc(g.name)}</h2>
      <form id="goalForm2" class="f"><label class="fl">Nom<input id="g2_name" value="${A().esc(g.name)}" required></label><label class="fl">Type<select id="g2_kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${g.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label><label class="fl">Cible ($)<input type="number" id="g2_target" value="${num(g.target)}" min="0" step="50"></label><label class="fl">Déjà épargné ($)<input type="number" id="g2_saved" value="${num(g.saved)}" min="0" step="10"></label><label class="fl">Priorité<select id="g2_prio"><option value="1" ${g.priority == 1 ? 'selected' : ''}>1 : en premier</option><option value="2" ${g.priority == 2 ? 'selected' : ''}>2 : normal</option><option value="3" ${g.priority == 3 ? 'selected' : ''}>3 : ensuite</option></select></label><label class="fl" style="grid-column:1/-1">Note<input id="g2_note" value="${A().esc(g.note || '')}"></label>
      <div class="row" style="grid-column:1/-1;justify-content:space-between">${isNew ? '<span></span>' : '<button class="btn danger" type="button" id="g2_del">Supprimer</button>'}<div class="row"><button class="btn sec" type="button" id="g2_cancel">Annuler</button><button class="btn big" type="submit">Enregistrer</button></div></div></form>`);
    $('#g2_cancel').onclick = closeModal;
    // Supprimer un projet efface aussi ses versements : un premier appui demande confirmation.
    const del = $('#g2_del'); if (del) del.onclick = async () => { if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Confirmer : supprimer le projet et ses versements'; return; } try { await DB.deleteSavingsGoal(g.id); closeModal(); await A().refresh(); } catch (err) { A().toast(err.message); } };
    $('#goalForm2').onsubmit = async e => { e.preventDefault(); try { await DB.upsertSavingsGoal({ id: g.id, name: $('#g2_name').value.trim(), kind: $('#g2_kind').value, target: +$('#g2_target').value || 0, saved: +$('#g2_saved').value || 0, priority: +$('#g2_prio').value, note: $('#g2_note').value.trim() || null, active: true }); closeModal(); await A().refresh(); A().toast('Projet enregistré'); } catch (err) { A().toast('Refusé : ' + err.message); } };
  }
  function openBudget() {
    const b = SV.budget;
    modal(`<p class="eyebrow">Mon budget</p><h2>Ce qui sort chaque mois</h2><p class="small muted">Sert à calculer ce qui reste pour les projets, à partir du net réel.</p>
      <form id="budgetForm" class="f"><label class="fl">Loyer ($/mois)<input type="number" id="b_rent" value="${num(b.rent)}" step="10"></label><label class="fl">Fixes : téléphone, assurance, abonnements<input type="number" id="b_fixed" value="${num(b.fixed)}" step="10"></label><label class="fl">Vie courante : nourriture, divers<input type="number" id="b_living" value="${num(b.living)}" step="10"></label><label class="fl">Réserve impôt et RRQ (%)<input type="number" id="b_tax" value="${Math.round(taxRate() * 100)}" min="0" max="50"></label>
      <div class="row" style="grid-column:1/-1;justify-content:space-between"><button class="btn sec" type="button" id="b_cancel">Annuler</button><button class="btn big" type="submit">Enregistrer</button></div></form>`);
    $('#b_cancel').onclick = closeModal;
    $('#budgetForm').onsubmit = async e => { e.preventDefault(); try { await DB.saveBudget({ rent: +$('#b_rent').value, fixed: +$('#b_fixed').value, living: +$('#b_living').value, tax_rate: U.numOr($('#b_tax').value, 20) / 100, weeks_per_month: 4.33 }); closeModal(); await A().refresh(); A().toast('Budget enregistré'); } catch (err) { A().toast('Refusé : ' + err.message); } };
  }

  /* ---- Suggestion du soir : combien mettre de côté après la journée ---- */
  function eveningSuggestion(dayNet, fuel) {
    const cap = capacity();
    const tax = dayNet * taxRate(); const living = cap.livingWeek / Math.max(1, cap.dpw);
    const free = Math.max(0, dayNet - (fuel || 0) - tax - living); const alloc = allocate(free);
    const car = SV.goals.find(g => g.kind === 'voiture');
    return { tax, free, car: car ? (alloc[car.id] || 0) : 0, carGoal: car };
  }

  /* ---- Calendrier du mois : chaque journée lisible, cliquable, avec le total de chaque semaine ---- */
  const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  let calMonth = null, calSel = null;
  const longDate = iso => { const d = new Date(iso + 'T12:00:00'); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
  function renderHeatmap() {
    const el = $('#heatmap'); if (!el) return; const { S, money, fmt, share, esc } = A();
    const today = U.today(); calMonth = calMonth || today.slice(0, 7); calSel = calSel || today;
    const by = {}; S.days.forEach(d => by[d.date] = d);
    const [y, m] = calMonth.split('-').map(Number), first = calMonth + '-01';
    const last = U.isoDate(new Date(y, m, 0)), start = U.weekStart(first), sh = share(), goalDays = Math.floor(+S.goals.days || 4);
    const md = S.days.filter(d => d.date.startsWith(calMonth)), mb = U.billed(md), inv = mb.reduce((a, d) => a + d.invoiced, 0);
    const maxNet = Math.max(1, ...S.days.map(d => d.invoiced * sh));
    let rows = '';
    for (let wk = start; wk <= last; wk = U.addDays(wk, 7)) {
      let cells = '', wDays = 0, wNet = 0;
      for (let i = 0; i < 7; i++) {
        const iso = U.addDays(wk, i), d = by[iso], out = !iso.startsWith(calMonth), net = d ? d.invoiced * sh : 0;
        if (d) { wDays++; wNet += net; }
        const pending = d && !(d.invoiced > 0);
        const label = longDate(iso) + (d ? ' : ' + d.parcels + ' colis, ' + (pending ? 'facturé en attente' : money(d.invoiced, 2) + ' facturés') : ', pas de journée');
        cells += `<button type="button" role="gridcell" class="cal-d${out ? ' out' : ''}${d ? ' work' : ''}${pending ? ' pending' : ''}${iso === today ? ' today' : ''}${iso === calSel ? ' sel' : ''}${iso > today ? ' future' : ''}" data-date="${iso}" tabindex="${iso === calSel ? 0 : -1}" aria-label="${label}"${iso === calSel ? ' aria-selected="true"' : ''}>
          <span class="n">${+iso.slice(8)}</span>${d ? `<span class="amt">${pending ? 'en attente' : money(net)}</span><span class="p">${d.parcels} colis</span><i class="m" style="width:${Math.round(100 * net / maxNet)}%"></i>` : ''}</button>`;
      }
      rows += `<div class="cal-row" role="row">${cells}<div class="cal-wk${wDays >= goalDays ? ' ok' : ''}" role="gridcell"><b>${wDays} j</b><span>${money(wNet)}</span></div></div>`;
    }
    el.innerHTML = `<div class="cal-head"><div class="cal-navs"><button type="button" class="cal-nav" data-cal="-1" aria-label="Mois précédent">‹</button><h3 class="cal-title" aria-live="polite">${MONTHS[m - 1]} ${y}</h3><button type="button" class="cal-nav" data-cal="1" aria-label="Mois suivant">›</button></div><button type="button" class="btn sec cal-today" data-cal="0">Aujourd’hui</button></div>
      <p class="cal-sum">${md.length} journée${md.length > 1 ? 's' : ''} travaillée${md.length > 1 ? 's' : ''} · <b>${money(inv * sh)} net</b> · ${money(inv)} facturés · ${fmt(md.reduce((a, d) => a + d.parcels, 0))} colis${md.length > mb.length ? ` · ${md.length - mb.length} en attente de facture` : ''}</p>
      <div class="cal" role="grid" aria-label="Calendrier de ${MONTHS[m - 1]} ${y}, net de Yacine par journée"><div class="cal-row cal-wd" role="row">${WD.map(w => `<span role="columnheader">${w}</span>`).join('')}<span role="columnheader" class="cal-wk">Semaine</span></div>${rows}</div>
      <p class="small muted">Montant net de Yacine par journée (après commission, avant essence). Le total de la semaine est souligné quand elle atteint ${goalDays} jours. Flèches du clavier pour se déplacer.</p>
      <div class="cal-detail" id="calDetail" aria-live="polite"></div>`;
    renderDayDetail();
    // Changer de mois sélectionne le 1er (ou aujourd’hui pour le mois en cours) ; « Aujourd’hui » revient au jour même.
    el.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { const k = +b.dataset.cal; calMonth = k ? U.isoMonth(new Date(y, m - 1 + k, 1)) : today.slice(0, 7); calSel = calMonth === today.slice(0, 7) ? today : calMonth + '-01'; renderHeatmap(); });
    el.querySelectorAll('.cal-d').forEach(b => b.onclick = () => selectDay(b.dataset.date));
    el.querySelector('.cal').onkeydown = e => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!step) return;
      e.preventDefault(); selectDay(U.addDays(calSel, step), true);
    };
  }
  function selectDay(iso, focus) {
    calSel = iso; if (iso.slice(0, 7) !== calMonth) calMonth = iso.slice(0, 7);
    renderHeatmap(); if (focus) { const b = $(`#heatmap .cal-d[data-date="${iso}"]`); if (b) b.focus(); }
  }
  function renderDayDetail() {
    const el = $('#calDetail'); if (!el) return; const { S, money, fmt, share, esc } = A();
    const d = S.days.find(x => x.date === calSel), today = U.today(), sh = share();
    const loc = d && (d.loc ? (S.localities.find(l => l.code === d.loc) || {}).name || d.loc : d.top && d.top[0] ? d.top[0].name : '');
    if (!d) {
      el.innerHTML = `<h3>${longDate(calSel)}</h3><p class="muted">${calSel > today ? 'Journée à venir.' : 'Aucune journée enregistrée.'}</p>${calSel <= today ? '<button type="button" class="btn" id="calAdd">Saisir cette journée</button>' : ''}`;
      const b = $('#calAdd'); if (b) b.onclick = () => window.PYF.openEvening(calSel);
      return;
    }
    const net = d.invoiced * sh, fuel = d.fuel;
    el.innerHTML = `<h3>${longDate(calSel)}${d.source === 'saisie' ? ' <span class="pill good">saisie</span>' : ''}</h3>
      <div class="kv"><span>Colis</span><b>${fmt(d.parcels)}</b><span>Facturé</span><b>${d.invoiced > 0 ? money(d.invoiced, 2) : 'en attente de facture'}</b><span>Net (part de Yacine)</span><b>${d.invoiced > 0 ? money(net, 2) : 'en attente'}</b>${d.invoiced > 0 && d.parcels ? `<span>Revenu par colis</span><b>${fmt(d.invoiced / d.parcels, 2)} $</b>` : ''}<span>Km</span><b>${d.km != null ? fmt(d.km) + ' km' : 'non saisis'}</b><span>Essence</span><b>${fuel != null ? money(fuel, 2) : 'non saisie'}</b>${d.invoiced > 0 && fuel != null ? `<span>Net après essence</span><b>${money(net - fuel, 2)}</b>` : ''}${loc ? `<span>Zone principale</span><b>${esc(loc)}</b>` : ''}${d.note ? `<span>Note</span><b>${esc(d.note)}</b>` : ''}</div>
      ${d.driver ? '<button type="button" class="btn sec" id="calEdit">Modifier dans le journal</button>' : ''}`;
    const b = $('#calEdit'); if (b) b.onclick = () => { A().goTab('log'); const f = $('#f_date'); f.value = calSel; f.dispatchEvent(new Event('change')); const form = $('#dayForm'); if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }

  /* ---- Prévision de fin de mois ---- */
  function renderForecast() {
    const el = $('#forecast'); if (!el) return; const { S, share, money, fmt } = A();
    const now = new Date(); const ym = window.PYU.isoMonth(now); const md = S.days.filter(d => d.date.startsWith(ym));
    const done = md.reduce((a, d) => a + d.invoiced, 0) * share();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); const left = daysInMonth - now.getDate();
    const weeks = A().recentWeeks(8); const dpw = weeks.length ? weeks.reduce((a, w) => a + w.days, 0) / weeks.length : 4;
    const avgDay = U.avgInvoiced(S.days, 367) * share();
    const expDays = left / 7 * dpw; const low = done + expDays * avgDay * 0.8, mid = done + expDays * avgDay, high = done + (left / 7 * Math.min(6, dpw + 1)) * avgDay * 1.1;
    const target = num(S.goals.net); const needDays = target > mid && avgDay ? Math.ceil((target - done) / avgDay) : 0;
    el.innerHTML = `<div class="kv"><span>Déjà net ce mois</span><b>${money(done)} (${md.length} j)</b><span>Jours restants</span><b>${left}</b><span>Prévision basse / centrale / haute</span><b>${money(low)} / <span class="forecast-mid">${money(mid)}</span> / ${money(high)}</b><span>Objectif</span><b>${money(target)} <span class="pill ${mid >= target ? 'good' : 'warn'}">${mid >= target ? 'en bonne voie' : 'encore ' + needDays + ' j de travail nécessaires'}</span></b></div>
      <p class="small muted" style="margin-top:6px">Centrale = rythme des 8 dernières semaines (${fmt(dpw, 1)} j/sem à ${money(avgDay)} net/j). Haute = un jour de plus par semaine et des routes mieux payées.</p>`;
  }

  function render() { renderSavings(); renderHeatmap(); renderForecast(); }
  async function refresh() { await load(); render(); }
  window.PYS = { refresh, load, render, capacity, allocate, project, vanPlan, eveningSuggestion, openContrib, get goals() { return SV.goals; } };
})();
