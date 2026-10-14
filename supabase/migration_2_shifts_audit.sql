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
