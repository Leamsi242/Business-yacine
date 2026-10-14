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
