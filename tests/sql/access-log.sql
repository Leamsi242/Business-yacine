-- Vérifie les règles de sécurité du journal des connexions sur un vrai PostgreSQL (rôle anon simulé comme dans
-- Supabase, en-têtes HTTP passés par request.headers comme le fait PostgREST). Lancer avec tests/sql/run.sh.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
\i supabase/schema.sql
grant usage on schema public to anon;
grant all on all tables in schema public to anon;   -- comme Supabase : la sécurité repose sur les policies
update config set pin = 'pin-de-yacine-01', admin_pin = 'pin-admin-tres-long' where id = 1;

create or replace function pg_temp.as_anon(headers text) returns void language plpgsql as $$
begin perform set_config('request.headers', headers, false); end $$;
set role anon;

-- 1. Yacine (bon PIN) : la connexion est consignée avec IP, navigateur et position.
select pg_temp.as_anon('{"x-pin":"pin-de-yacine-01","x-forwarded-for":"203.0.113.7, 10.0.0.1","user-agent":"Mozilla/5.0 (iPhone)"}');
do $$ begin assert (select log_access('connexion', 'biometrie', 'iPhone · Safari', 45.88, -72.49, 12)) = true, 'bon PIN accepté'; end $$;
-- 2. Il ne peut ni lire, ni écrire, ni effacer le journal directement.
do $$ begin assert (select count(*) from access_log) = 0, 'Yacine ne voit aucune ligne'; end $$;
do $$ begin
  begin insert into access_log (ok, kind) values (true, 'connexion'); raise exception 'insertion directe acceptée';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin delete from access_log; end $$;   -- aucune policy : n'efface rien
-- 3. Mauvais PIN : consigné comme échec, sans position même si le site en envoie une.
select pg_temp.as_anon('{"x-pin":"mauvais","x-forwarded-for":"198.51.100.9"}');
do $$ begin assert (select log_access('connexion', 'pin', 'Inconnu', 1, 2, 3)) = false, 'mauvais PIN refusé'; end $$;
-- 4. Un faux PIN administrateur ne lit rien ; le bon lit tout.
select pg_temp.as_anon('{"x-admin-pin":"pin-de-yacine-01"}');
do $$ begin assert (select count(*) from access_log) = 0, 'PIN de Yacine refusé comme admin'; end $$;
do $$ begin assert check_admin() = false, 'check_admin refuse le PIN de Yacine'; end $$;
select pg_temp.as_anon('{"x-admin-pin":"pin-admin-tres-long"}');
do $$ begin
  assert check_admin(), 'check_admin accepte le PIN administrateur';
  assert (select count(*) from access_log) = 2, 'admin : 2 lignes';
  assert (select ip from access_log where ok) = '203.0.113.7', 'première adresse de x-forwarded-for';
  assert (select kind || '/' || method || '/' || lat from access_log where ok) = 'connexion/biometrie/45.88', 'connexion consignée';
  assert (select kind from access_log where not ok) = 'echec', 'échec consigné';
  assert (select lat from access_log where not ok) is null, 'pas de position pour un échec';
end $$;
-- 5. La table config (les deux PIN) reste illisible pour tous.
do $$ begin assert (select count(*) from config) = 0, 'config illisible'; end $$;
-- 6. Changer le PIN de Yacine : admin seulement, 10 caractères au moins, différent du PIN admin.
select pg_temp.as_anon('{"x-pin":"pin-de-yacine-01"}');
do $$ begin
  begin perform admin_set_pin('nouveau-pin-123'); raise exception 'Yacine a changé le PIN';
  exception when raise_exception then if sqlerrm <> 'accès administrateur refusé' then raise; end if; end;
end $$;
select pg_temp.as_anon('{"x-admin-pin":"pin-admin-tres-long"}');
do $$ begin
  begin perform admin_set_pin('court'); raise exception 'PIN court accepté';
  exception when check_violation then null; end;
  perform admin_set_pin('nouveau-pin-123');
end $$;
select pg_temp.as_anon('{"x-pin":"pin-de-yacine-01"}');
do $$ begin assert (select log_access('ouverture', 'session', 'iPhone · Safari')) = false, 'ancien PIN révoqué'; end $$;
select pg_temp.as_anon('{"x-pin":"nouveau-pin-123"}');
do $$ begin assert (select log_access('ouverture', 'session', 'iPhone · Safari')) = true, 'nouveau PIN accepté'; end $$;
-- 7. Relancer tout le schéma ne touche à aucun des deux PIN.
reset role;
\i supabase/schema.sql
set role anon;
select pg_temp.as_anon('{"x-pin":"nouveau-pin-123"}');
do $$ begin assert (select log_access('ouverture', 'session', 'x')) = true, 'PIN conservé après relance du schéma'; end $$;
-- 8. Une attaque par PIN faux ne doit pas faire taire la vraie connexion de Yacine (plafonds séparés).
select pg_temp.as_anon('{"x-pin":"mauvais"}');
do $$ begin for i in 1..100 loop perform log_access('connexion', 'pin', 'attaque', null, null, null); end loop; end $$;
select pg_temp.as_anon('{"x-pin":"nouveau-pin-123"}');
do $$ begin assert (select log_access('connexion', 'pin', 'connexion-apres-attaque')) = true, 'succès accepté pendant l’attaque'; end $$;
select pg_temp.as_anon('{"x-admin-pin":"pin-admin-tres-long"}');
do $$ begin
  assert (select count(*) from access_log where not ok) = 60, 'échecs plafonnés à 60 par 10 minutes';
  assert (select count(*) from access_log where ok and device = 'connexion-apres-attaque') = 1, 'connexion réelle consignée malgré l’attaque';
end $$;
\o
select 'OK : journal des connexions et accès administrateur' as resultat;
