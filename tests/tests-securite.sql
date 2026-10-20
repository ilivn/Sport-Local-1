-- =====================================================================
-- Sport local — tests de sécurité des règles d'accès (RLS)
--
-- À lancer dans Supabase > SQL Editor > New query : coller ce fichier puis « Run ».
-- Les comptes et données de test sont supprimés à la fin du script.
-- Si un test plante en cours de route, la transaction est annulée : rien n'est conservé.
--
-- Résultat attendu : un tableau où chaque ligne affiche « OK ».
-- Une ligne « ÉCHEC » signale une faille à corriger.
-- =====================================================================
begin;

-- Trois comptes fictifs : A et B sont amis, C est un inconnu.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'test-a@example.invalid', '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'test-b@example.invalid', '{}'),
  ('cccccccc-0000-4000-8000-000000000003', 'test-c@example.invalid', '{}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'accepted');

-- Deux activités de A : une privée, une visible par ses amis.
insert into public.activities (user_id, sport, title, started_at, duration_s, distance_m, visibility) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'course', 'test-privee', now(), 600, 2000, 'prive'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'course', 'test-amis',   now(), 600, 2000, 'amis');

create temporary table resultats (num serial, test text, ok boolean);
grant insert, select on resultats to anon, authenticated;
grant usage on sequence resultats_num_seq to anon, authenticated;

-- Se mettre « dans la peau » d'un utilisateur connecté.
create function pg_temp.connecter(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;

-- ---------- Utilisateur A (propriétaire) ----------
set local role authenticated;
select pg_temp.connecter('aaaaaaaa-0000-4000-8000-000000000001');
insert into resultats (test, ok)
  select 'A voit ses 2 activités (privée et amis)', count(*) = 2
  from public.activities where title like 'test-%';

-- ---------- Utilisateur B (ami de A) ----------
select pg_temp.connecter('bbbbbbbb-0000-4000-8000-000000000002');
insert into resultats (test, ok)
  select 'B (ami) voit l''activité « amis » de A', count(*) = 1
  from public.activities where title = 'test-amis';
insert into resultats (test, ok)
  select 'B (ami) ne voit PAS l''activité privée de A', count(*) = 0
  from public.activities where title = 'test-privee';

with modif as (
  update public.profiles set bio = 'piraté' where id = 'aaaaaaaa-0000-4000-8000-000000000001' returning 1
)
insert into resultats (test, ok) select 'B ne peut pas modifier le profil de A', count(*) = 0 from modif;

with suppr as (
  delete from public.activities where title = 'test-amis' returning 1
)
insert into resultats (test, ok) select 'B ne peut pas supprimer l''activité de A', count(*) = 0 from suppr;

do $$
begin
  begin
    insert into public.activities (user_id, started_at, duration_s, distance_m)
    values ('aaaaaaaa-0000-4000-8000-000000000001', now(), 60, 100);
    insert into resultats (test, ok) values ('B ne peut pas créer une activité au nom de A', false);
  exception when insufficient_privilege or check_violation then
    insert into resultats (test, ok) values ('B ne peut pas créer une activité au nom de A', true);
  end;
end $$;

-- ---------- Utilisateur C (inconnu) ----------
select pg_temp.connecter('cccccccc-0000-4000-8000-000000000003');
insert into resultats (test, ok)
  select 'C (pas ami) ne voit aucune activité de A', count(*) = 0
  from public.activities where title like 'test-%';
insert into resultats (test, ok)
  select 'C ne voit pas l''amitié entre A et B', count(*) = 0
  from public.friendships;

do $$
begin
  begin
    insert into public.friendships (requester_id, addressee_id, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'accepted');
    insert into resultats (test, ok) values ('C ne peut pas créer une amitié au nom de A', false);
  exception when insufficient_privilege or check_violation then
    insert into resultats (test, ok) values ('C ne peut pas créer une amitié au nom de A', true);
  end;
end $$;

-- ---------- Visiteur non connecté ----------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare n integer;
begin
  begin
    select count(*) into n from public.activities;
    insert into resultats (test, ok) values ('Un visiteur non connecté ne voit aucune activité', n = 0);
  exception when insufficient_privilege then
    insert into resultats (test, ok) values ('Un visiteur non connecté ne voit aucune activité', true);
  end;
end $$;

reset role;

-- Nettoyage : supprimer les comptes de test supprime aussi leurs profils, amitiés et activités.
delete from auth.users where id in (
  'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003');
commit;

-- ---------- Bilan ----------
select num as "n°", test as "Test", case when ok then 'OK' else 'ÉCHEC' end as "Résultat"
from resultats order by num;
