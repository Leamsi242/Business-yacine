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

insert into config (id, pin) values (1, '1234')
  on conflict (id) do update set pin = excluded.pin;
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
