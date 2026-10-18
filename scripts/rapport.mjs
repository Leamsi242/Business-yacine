// Rapport hebdomadaire de Pilote Yacine, envoyé par courriel chaque dimanche soir (Brevo, offre gratuite).
// Lancé par .github/workflows/rapport.yml. Il lit la semaine dans Supabase avec le PIN de Yacine, puis envoie le courriel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fr = (n, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n, d = 0) => fr(n, d) + ' $';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
// Lundi de la semaine qui contient la date (semaines du lundi au dimanche, comme les factures Intelcom).
export function weekStart(iso) {
  const wd = (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7; return addDays(iso, -wd);
}
export function torontoToday(now = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const shortDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');

// Calcul pur, sans réseau : les chiffres du courriel viennent d'ici et sont testés.
export function buildReport({ week, days, shifts = [], goals = {} }) {
  const end = addDays(week, 6);
  const inWeek = x => x.date >= week && x.date <= end;
  const ws = days.filter(inWeek), kmByDay = {};
  shifts.filter(inWeek).forEach(s => { if (s.km_gps != null) kmByDay[s.date] = +s.km_gps; });
  const share = goals.status === 'indep' ? 0.95 : 1 - (Number(goals.cut) || 0.25);
  const target = Math.floor(Number(goals.days) || 4);
  const fuelOf = d => d.fuel != null ? +d.fuel : (+goals.fuel || 0);
  const sum = f => ws.reduce((a, d) => a + f(d), 0);
  const parcels = sum(d => +d.parcels || 0), invoiced = sum(d => +d.invoiced || 0);
  const net = invoiced * share, fuel = sum(fuelOf), netAfter = net - fuel;
  const km = sum(d => d.km != null ? +d.km : (kmByDay[d.date] || 0));
  return {
    week, end, n: ws.length, target, success: ws.length >= target, share,
    parcels, invoiced, net, fuel, netAfter, km,
    pending: ws.filter(d => !(+d.invoiced > 0)).length,
    perDay: ws.length ? netAfter / ws.length : 0,
    shifts: shifts.filter(inWeek).length
  };
}

export function renderHtml(r) {
  const verdict = r.success
    ? `<b style="color:#1f7a3d">Semaine réussie : ${r.n} jour${r.n > 1 ? 's' : ''} sur ${r.target} visés.</b>`
    : `<b style="color:#b26a00">Semaine à ${r.n} jour${r.n > 1 ? 's' : ''} sur ${r.target} visés.</b>`;
  const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#555">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`;
  return `<div style="font-family:Arial,sans-serif;color:#222;max-width:560px">
<h2 style="margin:0 0 4px">Pilote Yacine : semaine du ${shortDate(r.week)} au ${shortDate(r.end)}</h2>
<p style="margin:0 0 16px">${verdict}</p>
<table style="border-collapse:collapse">
${row('Colis', fr(r.parcels))}
${row('Facturé', money(r.invoiced, 2))}
${row('Net (part de Yacine)', money(r.net, 2))}
${row('Essence', money(r.fuel, 2))}
${row('Net après essence', money(r.netAfter, 2))}
${row('Net moyen par jour travaillé', money(r.perDay, 2))}
${row('Kilomètres', fr(r.km, 1) + ' km')}
${row('Factures en attente', r.pending ? r.pending + ' journée' + (r.pending > 1 ? 's' : '') : 'aucune')}
</table>
<p style="font-size:12px;color:#777;margin-top:16px">Rapport automatique envoyé chaque dimanche soir. Données tirées de Pilote Yacine.</p>
</div>`;
}

function readConfig() {
  const src = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  const get = k => (src.match(new RegExp(k + ':\\s*"([^"]+)"')) || [])[1];
  return { url: get('SUPABASE_URL'), anon: get('SUPABASE_ANON_KEY') };
}

async function fetchWeek(cfg, pin, week, end, fetchImpl) {
  const get = async path => {
    const r = await fetchImpl(`${cfg.url}/rest/v1/${path}`, { headers: { apikey: cfg.anon, Authorization: 'Bearer ' + cfg.anon, 'x-pin': pin } });
    if (!r.ok) throw new Error(`Lecture refusée (${r.status}) : vérifier le PIN de Yacine`);
    return r.json();
  };
  const [days, shifts, goals] = await Promise.all([
    get(`days?select=*&date=gte.${week}&date=lte.${end}`),
    get(`shifts?select=*&date=gte.${week}&date=lte.${end}`),
    get(`goals?select=*&driver=eq.yacine`)
  ]);
  return { days, shifts, goals: goals[0] || {} };
}

async function send(env, subject, html, fetchImpl) {
  const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: env.RAPPORT_FROM, name: 'Pilote Yacine' }, to: [{ email: env.RAPPORT_TO }], subject, htmlContent: html })
  });
  if (!r.ok) throw new Error(`Envoi refusé par Brevo (${r.status})`);
}

export async function main(env = process.env, fetchImpl = fetch, now = new Date()) {
  for (const k of ['YACINE_PIN', 'BREVO_API_KEY', 'RAPPORT_FROM', 'RAPPORT_TO']) if (!env[k]) throw new Error(`Variable manquante : ${k}`);
  const cfg = readConfig();
  if (!cfg.url || !cfg.anon) throw new Error('Configuration Supabase introuvable dans js/config.js');
  const week = weekStart(torontoToday(now)), end = addDays(week, 6);
  const data = await fetchWeek(cfg, env.YACINE_PIN, week, end, fetchImpl);
  const r = buildReport({ week, ...data });
  const subject = `Pilote Yacine : semaine du ${shortDate(week)} au ${shortDate(end)}`;
  await send(env, subject, renderHtml(r), fetchImpl);
  return r;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(r => console.log(`Rapport envoyé : ${r.n} jours, ${r.parcels} colis`)).catch(e => { console.error(e.message); process.exit(1); });
}
