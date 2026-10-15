// Couche de données : Supabase si configuré, sinon stockage local du navigateur.
// Toutes les fonctions renvoient des promesses pour que l'application ne change pas selon le mode.
(function () {
  const CFG = window.PY_CONFIG || {};
  const LS = 'pilote-yacine-v2';
  const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  // Base configurée mais bibliothèque Supabase absente (CDN injoignable, réseau coupé) : le site retombe en
  // stockage local, et l'application doit le dire en grand, sinon les saisies restent sur le téléphone sans que personne le sache.
  const online = configured && !!window.supabase;
  let client = null;
  let pin = '';
  try { pin = sessionStorage.getItem(LS + '-pin') || ''; } catch (e) {}

  function local() {
    try { return JSON.parse(localStorage.getItem(LS) || 'null') || { days: [], parcels: [], invoices: [], goals: {}, localities: [] }; }
    catch (e) { return { days: [], parcels: [], invoices: [], goals: {}, localities: [] }; }
  }
  function saveLocal(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }

  function connect(p) {
    pin = p || pin;
    try { sessionStorage.setItem(LS + '-pin', pin); } catch (e) {}
    client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { global: { headers: { 'x-pin': pin } } });
    return client;
  }
  if (online && pin) connect(pin);

  const DRIVER = () => CFG.DEFAULT_DRIVER || 'yacine';
  const DEFAULT_BUDGET = () => ({ rent: 300, fixed: 250, living: 500, tax_rate: 0.20, weeks_per_month: 4.33 });
  const DEFAULT_GOALS = () => [
    { id: 'voiture', name: 'Ma voiture', kind: 'voiture', target: 8000, saved: 0, priority: 1, note: 'Voiture personnelle, achat comptant', active: true },
    { id: 'impot', name: 'Réserve impôt et RRQ', kind: 'impot', target: 0, saved: 0, priority: 1, note: 'Alimentée à 20 % du net', active: true },
    { id: 'urgence', name: 'Coussin de sécurité', kind: 'urgence', target: 2000, saved: 0, priority: 2, note: 'Trois semaines de dépenses', active: true },
    { id: 'van', name: 'Van pour devenir indépendant', kind: 'van', target: 13800, saved: 0, priority: 3, note: 'Phase 1 du plan', active: true }];
  const fail = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  // Supabase renvoie au plus 1 000 lignes par requête : on lit par pages jusqu'à la dernière.
  // `query` fabrique une requête neuve à chaque page (un constructeur Supabase ne sert qu'une fois).
  const PAGE = 1000;
  async function readAll(query) { const out = []; for (let from = 0; ; from += PAGE) { const rows = fail(await query().range(from, from + PAGE - 1)); out.push(...rows); if (rows.length < PAGE) return out; } }

  const api = {
    online, unavailable: configured && !online, isConnected: () => !online || !!client, hasPin: () => !!pin,
    mode: () => online ? 'supabase' : 'local',

    // Vérifie le PIN : une lecture qui renvoie une ligne prouve que le PIN est bon.
    async login(p) {
      if (!online) return true;
      connect(p);
      const r = await client.from('goals').select('driver').limit(1);
      if (r.error) { client = null; throw new Error(r.error.message); }
      if (!r.data || !r.data.length) { client = null; throw new Error('PIN refusé'); }
      return true;
    },
    logout() { pin = ''; client = null; try { sessionStorage.removeItem(LS + '-pin'); } catch (e) {} },

    async getDays() {
      if (!online) return local().days;
      return readAll(() => client.from('days').select('*').order('date'));
    },
    async upsertDay(d) {
      d = Object.assign({ driver: DRIVER(), source: 'saisie' }, d);
      if (!online) { const s = local(); s.days = s.days.filter(x => !(x.date === d.date && x.driver === d.driver)); s.days.push(d); saveLocal(s); return d; }
      return fail(await client.from('days').upsert(d, { onConflict: 'date,driver' }).select());
    },
    async deleteDay(date, driver) {
      driver = driver || DRIVER();
      if (!online) { const s = local(); s.days = s.days.filter(x => !(x.date === date && x.driver === driver)); saveLocal(s); return; }
      fail(await client.from('days').delete().eq('date', date).eq('driver', driver));
    },

    async getGoals() {
      if (!online) return local().goals || {};
      const rows = fail(await client.from('goals').select('*').eq('driver', DRIVER()));
      return rows[0] || {};
    },
    async saveGoals(g) {
      g = Object.assign({ driver: DRIVER() }, g);
      if (!online) { const s = local(); s.goals = g; saveLocal(s); return g; }
      return fail(await client.from('goals').upsert(g, { onConflict: 'driver' }).select());
    },

    async getLocalities() {
      if (!online) return window.PY_LOCALITIES || [];
      const rows = fail(await client.from('localities').select('*'));
      return rows.length ? rows : (window.PY_LOCALITIES || []);
    },
    async upsertLocality(l) {
      if (!online) return l;
      return fail(await client.from('localities').upsert(l, { onConflict: 'code' }).select());
    },

    async getParcelsSince(date) {
      if (!online) return local().parcels.filter(p => !date || p.date >= date);
      return readAll(() => { let q = client.from('parcels').select('*'); if (date) q = q.gte('date', date); return q.order('date').order('tracking'); });
    },
    async getInvoices() {
      if (!online) return local().invoices;
      return fail(await client.from('invoices').select('*').order('week'));
    },
    // Import d'une facture : enregistre la facture, ses colis et les journées (source 'facture', sans écraser une saisie km/essence).
    async importInvoice(inv, parcels, days) {
      const drv = DRIVER();
      if (!online) {
        const s = local();
        s.invoices = s.invoices.filter(i => i.week !== inv.week); s.invoices.push(Object.assign({ driver: drv }, inv));
        const seen = new Set(parcels.map(p => p.tracking)); s.parcels = s.parcels.filter(p => !seen.has(p.tracking)).concat(parcels.map(p => Object.assign({ driver: drv }, p)));
        days.forEach(d => { const ex = s.days.find(x => x.date === d.date && x.driver === drv); if (ex) { ex.parcels = d.parcels; ex.invoiced = d.invoiced; ex.source = 'facture'; if (!ex.loc) ex.loc = d.loc; } else s.days.push(Object.assign({ driver: drv, source: 'facture' }, d)); });
        saveLocal(s); return;
      }
      fail(await client.from('invoices').upsert(Object.assign({ driver: drv }, inv), { onConflict: 'week,driver' }));
      for (let i = 0; i < parcels.length; i += 500) fail(await client.from('parcels').upsert(parcels.slice(i, i + 500).map(p => Object.assign({ driver: drv }, p)), { onConflict: 'tracking' }));
      const existing = fail(await client.from('days').select('date,km,fuel,loc,note,source').eq('driver', drv).in('date', days.map(d => d.date)));
      const rows = days.map(d => { const ex = existing.find(x => x.date === d.date) || {}; return Object.assign({ driver: drv, source: 'facture' }, d, { km: ex.km ?? null, fuel: ex.fuel ?? null, loc: ex.loc || d.loc || null, note: ex.note || null }); });
      fail(await client.from('days').upsert(rows, { onConflict: 'date,driver' }));
    },
    async getShift(date) {
      if (!online) { return (local().shifts || []).find(x => x.date === date) || null; }
      const rows = fail(await client.from('shifts').select('*').eq('driver', DRIVER()).eq('date', date)); return rows[0] || null;
    },
    async getShifts(since) {
      if (!online) { return (local().shifts || []).filter(x => !since || x.date >= since); }
      let q = client.from('shifts').select('*').eq('driver', DRIVER()); if (since) q = q.gte('date', since); return fail(await q.order('date'));
    },
    async upsertShift(sh) {
      sh = Object.assign({ driver: DRIVER() }, sh);
      if (!online) { const s = local(); s.shifts = (s.shifts || []).filter(x => x.date !== sh.date); s.shifts.push(sh); saveLocal(s); return sh; }
      return fail(await client.from('shifts').upsert(sh, { onConflict: 'date,driver' }).select());
    },
    async saveAudit(week, audit) {
      if (!online) { const s = local(); const i = s.invoices.find(x => x.week === week); if (i) i.audit = audit; saveLocal(s); return; }
      fail(await client.from('invoices').update({ audit }).eq('week', week).eq('driver', DRIVER()));
    },
    /* ---- Épargne et budget ---- */
    async getSavings() {
      if (!online) { const s = local(); if (!s.savings) { s.savings = DEFAULT_GOALS(); saveLocal(s); } return { goals: s.savings, log: s.savingsLog || [], budget: s.budget || DEFAULT_BUDGET() }; }
      const [g, l, b] = await Promise.all([client.from('savings_goals').select('*').eq('driver', DRIVER()).order('priority'), client.from('savings_log').select('*').eq('driver', DRIVER()).order('date', { ascending: false }).limit(200), client.from('budget').select('*').eq('driver', DRIVER())]);
      return { goals: fail(g), log: fail(l), budget: (fail(b)[0]) || DEFAULT_BUDGET() };
    },
    async upsertSavingsGoal(g) {
      g = Object.assign({ driver: DRIVER() }, g);
      if (!online) { const s = local(); s.savings = (s.savings || DEFAULT_GOALS()).filter(x => x.id !== g.id); s.savings.push(g); saveLocal(s); return g; }
      return fail(await client.from('savings_goals').upsert(g, { onConflict: 'id' }).select());
    },
    async deleteSavingsGoal(id) {
      if (!online) { const s = local(); s.savings = (s.savings || []).filter(x => x.id !== id); saveLocal(s); return; }
      fail(await client.from('savings_goals').delete().eq('id', id));
    },
    async addContribution(goalId, amount, note) {
      const row = { driver: DRIVER(), goal_id: goalId, date: window.PYU.today(), amount: +amount, note: note || null };
      if (!online) { const s = local(); s.savingsLog = s.savingsLog || []; s.savingsLog.unshift(Object.assign({ id: Date.now() }, row)); const g = (s.savings || []).find(x => x.id === goalId); if (g) g.saved = +(+g.saved + +amount).toFixed(2); saveLocal(s); return; }
      fail(await client.from('savings_log').insert(row));
      const cur = fail(await client.from('savings_goals').select('saved').eq('id', goalId));
      fail(await client.from('savings_goals').update({ saved: +((cur[0] ? +cur[0].saved : 0) + +amount).toFixed(2) }).eq('id', goalId));
    },
    async saveBudget(b) {
      b = Object.assign({ driver: DRIVER() }, b);
      if (!online) { const s = local(); s.budget = b; saveLocal(s); return b; }
      return fail(await client.from('budget').upsert(b, { onConflict: 'driver' }).select());
    },
    _readAll: readAll,
    exportLocal() { return JSON.stringify(local()); },
    importLocal(txt) { const s = JSON.parse(txt); if (!s || !Array.isArray(s.days)) throw new Error('format'); saveLocal(s); }
  };
  window.PYDB = api;
})();
