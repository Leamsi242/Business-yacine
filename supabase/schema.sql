-- Pilote Yacine : schéma Supabase
-- À coller tel quel dans Supabase > SQL Editor > New query > Run.
-- Remplace 1234 par le code PIN que Yacine et toi utiliserez dans le site.

create table if not exists config (
  id int primary key default 1,
  pin text not null
);

create table if not exists days (
  date date not null,
  driver text not null default 'yacine',
  parcels int not null default 0,
  invoiced numeric(10,2) not null default 0,
  km numeric(8,1),
  fuel numeric(8,2),
  loc text,
  note text,
  source text not null default 'saisie',   -- 'saisie' ou 'facture'
  updated_at timestamptz not null default now(),
  primary key (date, driver)
);

create table if not exists parcels (
  tracking text primary key,
  date date not null,
  week text,
  driver text not null default 'yacine',
  svc text,
  pc text,
  zone text,
  wt numeric(6,1),
  amt numeric(8,2)
);
create index if not exists parcels_date_idx on parcels (date);
create index if not exists parcels_pc_idx on parcels (pc);

create table if not exists invoices (
  week text not null,
  driver text not null default 'yacine',
  from_date date,
  to_date date,
  total numeric(10,2),
  base numeric(10,2),
  fsc numeric(10,2),
  admin numeric(10,2),
  cancel numeric(10,2),
  vendor text,
  imported_at timestamptz not null default now(),
  primary key (week, driver)
);

create table if not exists goals (
  driver text primary key,
  days numeric(3,1) default 4.5,
  net numeric(10,2) default 4300,
  van numeric(10,2) default 8000,
  saved numeric(10,2) default 0,
  status text default 'broker',          -- 'broker' ou 'indep'
  fuel numeric(8,2) default 60,
  cut numeric(4,3) default 0.25          -- commission du broker
);

create table if not exists localities (
  code text primary key,
  name text not null,
  lat double precision not null,
  lon double precision not null
);

create table if not exists drivers (
  id text primary key,                   -- 'yacine', puis les chauffeurs recrutés
  name text not null,
  cut numeric(4,3) default 0.25,         -- part retenue par le broker
  active boolean default true
);

-- Sécurité : un code PIN envoyé dans l'en-tête HTTP x-pin par le site.
create or replace function check_pin() returns boolean
language sql security definer stable as $$
  select coalesce(current_setting('request.headers', true)::json->>'x-pin', '')
       = (select pin from config where id = 1);
$$;

alter table config     enable row level security;
alter table days       enable row level security;
alter table parcels    enable row level security;
alter table invoices   enable row level security;
alter table goals      enable row level security;
alter table localities enable row level security;
alter table drivers    enable row level security;

drop policy if exists pin_days on days;
drop policy if exists pin_parcels on parcels;
drop policy if exists pin_invoices on invoices;
drop policy if exists pin_goals on goals;
drop policy if exists pin_localities on localities;
drop policy if exists pin_drivers on drivers;
create policy pin_days       on days       for all using (check_pin()) with check (check_pin());
create policy pin_parcels    on parcels    for all using (check_pin()) with check (check_pin());
create policy pin_invoices   on invoices   for all using (check_pin()) with check (check_pin());
create policy pin_goals      on goals      for all using (check_pin()) with check (check_pin());
create policy pin_localities on localities for all using (check_pin()) with check (check_pin());
create policy pin_drivers    on drivers    for all using (check_pin()) with check (check_pin());
-- config n'a aucune policy : personne ne peut lire le PIN depuis le site.

-- PIN initial à remplacer avant d'exécuter (10 caractères au moins, une phrase de passe est l'idéal).
-- « do nothing » : relancer ce fichier ne remet jamais le PIN à sa valeur d'origine.
insert into config (id, pin) values (1, 'remplace-moi-par-un-long-pin')
  on conflict (id) do nothing;
insert into drivers (id, name, cut) values ('yacine', 'Yacine', 0.25)
  on conflict (id) do nothing;
insert into goals (driver) values ('yacine') on conflict (driver) do nothing;
-- Migration 2 : shifts (brief du matin, GPS) et audit des factures.
-- À coller dans Supabase > SQL Editor > Run (une seule fois).
create table if not exists shifts (
  date date not null,
  driver text not null default 'yacine',
  route_type text,                 -- 'urbain' | 'rural' | 'loin'
  goal_parcels int,
  goal_invoiced numeric(10,2),
  goal_net numeric(10,2),
  started_at timestamptz,
  ended_at timestamptz,
  km_gps numeric(8,1),
  checklist jsonb,
  primary key (date, driver)
);
alter table shifts enable row level security;
drop policy if exists pin_shifts on shifts;
create policy pin_shifts on shifts for all using (check_pin()) with check (check_pin());
alter table invoices add column if not exists audit jsonb;
-- Migration 3 : projets d'épargne (voiture, van, impôt, urgence) et budget personnel.
create table if not exists savings_goals (
  id text primary key,                 -- 'voiture', 'van', 'impot', 'urgence', ou libre
  driver text not null default 'yacine',
  name text not null,
  kind text not null default 'autre',  -- voiture | van | impot | urgence | autre
  target numeric(10,2) not null default 0,
  saved numeric(10,2) not null default 0,
  priority int not null default 2,     -- 1 = en premier, 2 = normal, 3 = quand le reste est servi
  deadline date,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists savings_log (
  id bigserial primary key,
  driver text not null default 'yacine',
  goal_id text not null references savings_goals(id) on delete cascade,
  date date not null default current_date,
  amount numeric(10,2) not null,
  note text
);
create table if not exists budget (
  driver text primary key,
  rent numeric(10,2) default 300,
  fixed numeric(10,2) default 250,     -- téléphone, assurance perso, abonnements
  living numeric(10,2) default 500,    -- nourriture, divers, par mois
  tax_rate numeric(4,3) default 0.20,  -- réserve impôt et RRQ sur le net
  weeks_per_month numeric(4,2) default 4.33
);
alter table savings_goals enable row level security;
alter table savings_log enable row level security;
alter table budget enable row level security;
drop policy if exists pin_savings_goals on savings_goals;
drop policy if exists pin_savings_log on savings_log;
drop policy if exists pin_budget on budget;
create policy pin_savings_goals on savings_goals for all using (check_pin()) with check (check_pin());
create policy pin_savings_log on savings_log for all using (check_pin()) with check (check_pin());
create policy pin_budget on budget for all using (check_pin()) with check (check_pin());
insert into budget (driver) values ('yacine') on conflict (driver) do nothing;
insert into savings_goals (id, name, kind, target, priority, note) values
  ('voiture', 'Ma voiture', 'voiture', 8000, 1, 'Voiture personnelle, achat comptant'),
  ('impot', 'Réserve impôt et RRQ', 'impot', 0, 1, 'Alimentée automatiquement à 20 % du net'),
  ('urgence', 'Coussin de sécurité', 'urgence', 2000, 2, 'Trois semaines de dépenses'),
  ('van', 'Van pour devenir indépendant', 'van', 13800, 3, 'Phase 1 du plan')
on conflict (id) do nothing;

-- Migration 4 : PIN long. À coller dans Supabase > SQL Editor > Run (une seule fois).
-- Un PIN de 4 chiffres se devine en 10 000 essais : la base refuse désormais tout nouveau PIN de moins de
-- 10 caractères. « not valid » laisse fonctionner le PIN actuel jusqu'au prochain changement, à faire ainsi :
--   update config set pin = 'ta phrase de passe' where id = 1;
alter table config drop constraint if exists config_pin_long;
alter table config add constraint config_pin_long check (length(pin) >= 10) not valid;

-- Migration 5 : données de référence derrière le PIN. À coller dans Supabase > SQL Editor > Run (une seule fois).
-- Historique des factures (key 'history'), statistiques par localité ('locstats') et grille tarifaire ('tariffs')
-- ne sont plus dans le dépôt public. Leur contenu se charge avec le fichier reference_data.sql, fourni à part
-- et jamais versionné.
create table if not exists reference (
  key text primary key,                  -- 'history', 'locstats' ou 'tariffs'
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table reference enable row level security;
drop policy if exists pin_reference on reference;
create policy pin_reference on reference for all using (check_pin()) with check (check_pin());

-- Migration 6 : journal des connexions, lisible par l'administrateur seul. À coller dans Supabase > SQL Editor > Run.
-- Chaque ouverture de l'application (PIN, Touch ID ou session déjà ouverte) et chaque PIN refusé est consigné par
-- la fonction log_access : date et heure fixées par la base, adresse IP et navigateur lus dans la requête,
-- appareil et position GPS seulement si le téléphone l'autorise. Personne ne peut écrire, modifier ou effacer une
-- ligne directement ; seule une requête portant le PIN administrateur (en-tête x-admin-pin) peut les lire.
-- Après l'avoir collée, choisir le PIN administrateur (12 caractères au moins, différent de celui de Yacine) :
--   update config set admin_pin = 'phrase administrateur' where id = 1;
alter table config add column if not exists admin_pin text;
alter table config drop constraint if exists config_admin_pin_long;
alter table config add constraint config_admin_pin_long check (admin_pin is null or length(admin_pin) >= 12);

create or replace function check_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select admin_pin from config where id = 1), '') <> ''
     and coalesce(current_setting('request.headers', true)::json->>'x-admin-pin', '') = (select admin_pin from config where id = 1);
$$;

create table if not exists access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  driver text not null default 'yacine',
  ok boolean not null,                   -- PIN accepté par la base (jamais fourni par le site)
  kind text not null,                    -- 'connexion', 'ouverture' (session déjà ouverte) ou 'echec'
  method text,                           -- 'pin', 'biometrie' ou 'session'
  ip text,
  user_agent text,
  device text,                           -- résumé lisible : « iPhone · Safari »
  lat double precision,                  -- position seulement si autorisée sur le téléphone, jamais pour un échec
  lon double precision,
  accuracy double precision
);
create index if not exists access_log_at on access_log (at desc);
alter table access_log enable row level security;
drop policy if exists admin_read_log on access_log;
create policy admin_read_log on access_log for select using (check_admin());
-- Aucune policy d'écriture : insertion par log_access seulement, ni modification ni effacement possibles.

create or replace function log_access(p_kind text, p_method text, p_device text,
  p_lat double precision default null, p_lon double precision default null, p_acc double precision default null)
returns boolean language plpgsql security definer volatile set search_path = public as $$
declare
  h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ok boolean := check_pin();
begin
  -- Garde-fou : au plus 60 lignes par tranche de 10 minutes (un PIN deviné à la chaîne ne remplit pas la table).
  if (select count(*) from access_log where at > now() - interval '10 minutes') >= 60 then return ok; end if;
  insert into access_log (ok, kind, method, ip, user_agent, device, lat, lon, accuracy) values (
    ok,
    case when ok and p_kind in ('connexion', 'ouverture') then p_kind when ok then 'connexion' else 'echec' end,
    case when p_method in ('pin', 'biometrie', 'session') then p_method end,
    left(trim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', h->>'x-real-ip', ''), ',', 1)), 64),
    left(h->>'user-agent', 300), left(p_device, 120),
    case when ok then p_lat end, case when ok then p_lon end, case when ok then p_acc end);
  return ok;
end $$;

-- Changer le PIN de Yacine depuis le back-office (coupe l'accès de toute session ouverte avec l'ancien PIN).
create or replace function admin_set_pin(p_new text) returns boolean
language plpgsql security definer volatile set search_path = public as $$
begin
  if not check_admin() then raise exception 'accès administrateur refusé'; end if;
  if p_new = (select admin_pin from config where id = 1) then raise exception 'le PIN de Yacine doit différer du PIN administrateur'; end if;
  update config set pin = p_new where id = 1;
  return true;
end $$;
revoke all on function admin_set_pin(text) from public;
grant execute on function log_access(text, text, text, double precision, double precision, double precision) to anon;
grant execute on function admin_set_pin(text) to anon;
grant execute on function check_admin() to anon;   -- le back-office vérifie le PIN administrateur
