// Couche de données : Supabase si configuré, sinon stockage local du navigateur.
// Toutes les fonctions renvoient des promesses pour que l'application ne change pas selon le mode.
(function () {
  const CFG = window.PY_CONFIG || {};
  const LS = 'pilote-yacine-v2';
  const online = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
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
  const fail = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

  const api = {
    online, isConnected: () => !online || !!client, hasPin: () => !!pin,
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
      return fail(await client.from('days').select('*').order('date'));
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
      let q = client.from('parcels').select('*'); if (date) q = q.gte('date', date);
      return fail(await q.order('date'));
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
        days.forEach(d => { const ex = s.days.find(x => x.date === d.date && x.driver === drv); if (ex) { ex.parcels = d.parcels; ex.invoiced = d.invoiced; if (!ex.loc) ex.loc = d.loc; } else s.days.push(Object.assign({ driver: drv, source: 'facture' }, d)); });
        saveLocal(s); return;
      }
      fail(await client.from('invoices').upsert(Object.assign({ driver: drv }, inv), { onConflict: 'week,driver' }));
      for (let i = 0; i < parcels.length; i += 500) fail(await client.from('parcels').upsert(parcels.slice(i, i + 500).map(p => Object.assign({ driver: drv }, p)), { onConflict: 'tracking' }));
      const existing = fail(await client.from('days').select('date,km,fuel,loc,note,source').eq('driver', drv).in('date', days.map(d => d.date)));
      const rows = days.map(d => { const ex = existing.find(x => x.date === d.date) || {}; return Object.assign({ driver: drv, source: 'facture' }, d, { km: ex.km ?? null, fuel: ex.fuel ?? null, loc: ex.loc || d.loc || null, note: ex.note || null }); });
      fail(await client.from('days').upsert(rows, { onConflict: 'date,driver' }));
    },
    exportLocal() { return JSON.stringify(local()); },
    importLocal(txt) { const s = JSON.parse(txt); if (!s || !Array.isArray(s.days)) throw new Error('format'); saveLocal(s); }
  };
  window.PYDB = api;
})();
