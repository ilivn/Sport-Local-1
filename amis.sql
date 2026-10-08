-- =====================================================================
-- Appli sport local — complément n° 1
-- Amis, recherche de profils, suggestions, liste des conversations,
-- suppression de compte, lieux importés d'OpenStreetMap.
--
-- À exécuter UNE fois, APRÈS schema.sql :
-- Supabase > SQL Editor > New query > coller tout le fichier > Run
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SPORTS : liste complète utilisée par l'appli
-- ---------------------------------------------------------------------
update public.sports set name = 'Course à pied' where slug = 'running';

insert into public.sports (slug, name) values
  ('basket', 'Basket'),
  ('padel', 'Padel'),
  ('handball', 'Handball'),
  ('volley', 'Volley'),
  ('badminton', 'Badminton'),
  ('natation', 'Natation'),
  ('velo', 'Vélo'),
  ('arts_martiaux', 'Arts martiaux'),
  ('escalade', 'Escalade'),
  ('yoga', 'Yoga'),
  ('danse', 'Danse'),
  ('skate', 'Skate'),
  ('golf', 'Golf'),
  ('equitation', 'Équitation')
on conflict (slug) do nothing;


-- ---------------------------------------------------------------------
-- 2. AMIS
-- ---------------------------------------------------------------------
create type public.friend_status as enum ('pending', 'accepted');

create table public.friendships (
  requester_id  uuid not null default auth.uid()
                  references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        public.friend_status not null default 'pending',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
-- Une seule relation par paire, quel que soit celui qui a demandé.
create unique index friendships_pair_key on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id);

-- Fonctions internes utilisées par les règles et les recherches.
create function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = a and ub.blocked_id = b)
       or (ub.blocker_id = b and ub.blocked_id = a)
  );
$$;

create function private.profile_sports_json(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'level', ps.level) order by s.name), '[]'::jsonb)
  from public.profile_sports ps
  join public.sports s on s.id = ps.sport_id
  where ps.profile_id = p_profile;
$$;

-- 'ami', 'envoyee' (j'ai demandé), 'recue' (on m'a demandé) ou null.
create function private.friend_label(p_other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when f.status = 'accepted' then 'ami'
           when f.requester_id = (select auth.uid()) then 'envoyee'
           else 'recue'
         end
  from public.friendships f
  where (f.requester_id = (select auth.uid()) and f.addressee_id = p_other)
     or (f.addressee_id = (select auth.uid()) and f.requester_id = p_other)
  limit 1;
$$;

grant execute on function private.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function private.profile_sports_json(uuid) to authenticated;
grant execute on function private.friend_label(uuid) to authenticated;

create function private.friendships_set_responded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.responded_at := now();
  return new;
end;
$$;

create trigger friendships_set_responded before update on public.friendships
  for each row execute function private.friendships_set_responded();

alter table public.friendships enable row level security;

create policy "Chacun voit ses relations d'amitié"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- On ne demande que pour soi, et jamais à quelqu'un qui nous a bloqué (ou qu'on a bloqué).
create policy "Chacun envoie ses demandes d'ami"
  on public.friendships for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and not private.is_blocked_between(requester_id, addressee_id)
  );

-- Seul le destinataire accepte une demande.
create policy "Le destinataire accepte la demande"
  on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()))
  with check (addressee_id = (select auth.uid()) and status = 'accepted');

-- Refuser, annuler ou retirer un ami : l'un ou l'autre.
create policy "Chacun peut mettre fin à une relation"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

grant select, insert, delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

alter publication supabase_realtime add table public.friendships;


-- ---------------------------------------------------------------------
-- 3. SESSIONS : nom du lieu choisi sur la carte
-- ---------------------------------------------------------------------
alter table public.events add column place_name text
  check (char_length(place_name) <= 160);
grant update (place_name) on public.events to authenticated;

-- events_nearby renvoie aussi le nom du lieu et si je participe.
drop function public.events_nearby(double precision, double precision, integer, timestamptz, timestamptz, text[]);

create function public.events_nearby(
  p_lat          double precision,
  p_lng          double precision,
  p_radius_m     integer default 5000,
  p_from         timestamptz default now(),
  p_to           timestamptz default now() + interval '30 days',
  p_sport_slugs  text[] default null
)
returns table (
  id                  uuid,
  title               text,
  sport_name          text,
  starts_at           timestamptz,
  level               public.skill_level,
  status              public.event_status,
  max_participants    smallint,
  participants_count  bigint,
  organizer_id        uuid,
  organizer_name      text,
  place_name          text,
  lat                 double precision,
  lng                 double precision,
  distance_m          double precision,
  joined              boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    e.id, e.title, sp.name, e.starts_at, e.level, e.status,
    e.max_participants,
    (select count(*) from public.event_participants ep where ep.event_id = e.id),
    e.organizer_id,
    coalesce(p.display_name, p.username),
    coalesce(s.name, e.place_name),
    st_y(e.location::geometry),
    st_x(e.location::geometry),
    st_distance(e.location, me.g),
    exists (select 1 from public.event_participants ep
            where ep.event_id = e.id and ep.user_id = (select auth.uid()))
  from public.events e
  cross join me
  join public.sports sp on sp.id = e.sport_id
  join public.profiles p on p.id = e.organizer_id
  left join public.spots s on s.id = e.spot_id
  where st_dwithin(e.location, me.g, least(p_radius_m, 50000))
    and e.starts_at >= p_from - interval '3 hours'
    and e.starts_at < p_to
    and e.status in ('ouvert', 'complet')
    and (p_sport_slugs is null or sp.slug = any (p_sport_slugs))
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid()) and b.blocked_id = e.organizer_id
    )
  order by e.starts_at
  limit 200;
$$;


-- ---------------------------------------------------------------------
-- 4. RECHERCHE, SUGGESTIONS, AMIS, CONVERSATIONS
-- ---------------------------------------------------------------------
-- Ces fonctions ne renvoient que des informations de profil public,
-- déjà visibles par tout membre connecté ; elles masquent en plus les
-- personnes bloquées dans un sens comme dans l'autre.

create function public.search_profiles(p_query text)
returns table (
  id            uuid,
  username      text,
  display_name  text,
  city          text,
  sports        jsonb,
  friend        text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  q as (
    select '%' || replace(replace(replace(trim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select
    p.id, p.username, p.display_name, p.city,
    private.profile_sports_json(p.id),
    private.friend_label(p.id)
  from public.profiles p, me, q
  where me.uid is not null
    and p.id <> me.uid
    and not private.is_blocked_between(me.uid, p.id)
    and (
      p.username ilike q.pat
      or p.display_name ilike q.pat
      or p.city ilike q.pat
      or exists (
        select 1 from public.profile_sports ps
        join public.sports s on s.id = ps.sport_id
        where ps.profile_id = p.id and s.name ilike q.pat
      )
    )
  order by p.display_name is null, coalesce(p.display_name, p.username)
  limit 30;
$$;

create function public.suggest_friends(p_limit integer default 10)
returns table (
  id            uuid,
  username      text,
  display_name  text,
  city          text,
  sports        jsonb,
  shared        text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  my_sports as (
    select ps.sport_id from public.profile_sports ps, me where ps.profile_id = me.uid
  ),
  my_city as (
    select lower(p.city) as city from public.profiles p, me where p.id = me.uid
  )
  select
    p.id, p.username, p.display_name, p.city,
    private.profile_sports_json(p.id),
    coalesce((
      select array_agg(s.name order by s.name)
      from public.profile_sports ps join public.sports s on s.id = ps.sport_id
      where ps.profile_id = p.id and ps.sport_id in (select sport_id from my_sports)
    ), '{}')
  from public.profiles p, me
  where me.uid is not null
    and p.id <> me.uid
    and p.display_name is not null
    and private.friend_label(p.id) is null
    and not private.is_blocked_between(me.uid, p.id)
  order by
    (select count(*) from public.profile_sports ps
      where ps.profile_id = p.id and ps.sport_id in (select sport_id from my_sports)) * 2
    + case when lower(p.city) = (select city from my_city) then 1 else 0 end desc,
    p.created_at desc
  limit least(coalesce(p_limit, 10), 30);
$$;

create function public.my_friends()
returns table (
  id            uuid,
  username      text,
  display_name  text,
  city          text,
  sports        jsonb,
  friend        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.username, p.display_name, p.city,
    private.profile_sports_json(p.id),
    private.friend_label(p.id)
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
  where (select auth.uid()) in (f.requester_id, f.addressee_id)
  order by f.status, coalesce(p.display_name, p.username);
$$;

-- Liste des conversations avec le dernier message et l'état « non lu ».
-- Droits de l'appelant : les règles de sécurité des messages s'appliquent.
create function public.my_conversations()
returns table (
  conversation_id  uuid,
  kind             public.conversation_kind,
  event_id         uuid,
  title            text,
  other_user_id    uuid,
  last_message     text,
  last_at          timestamptz,
  unread           boolean
)
language sql
stable
set search_path = ''
as $$
  select
    c.id, c.kind, c.event_id,
    case when c.kind = 'event' then e.title else coalesce(op.display_name, op.username) end,
    om.user_id,
    lm.content,
    coalesce(lm.created_at, c.created_at),
    (lm.created_at is not null
      and lm.sender_id <> (select auth.uid())
      and (me.last_read_at is null or lm.created_at > me.last_read_at))
  from public.conversations c
  join public.conversation_members me
    on me.conversation_id = c.id and me.user_id = (select auth.uid())
  left join public.events e on e.id = c.event_id
  left join lateral (
    select m.user_id from public.conversation_members m
    where m.conversation_id = c.id and m.user_id <> (select auth.uid())
    limit 1
  ) om on c.kind = 'direct'
  left join public.profiles op on op.id = om.user_id
  left join lateral (
    select msg.content, msg.created_at, msg.sender_id from public.messages msg
    where msg.conversation_id = c.id
    order by msg.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- Suppression de son propre compte (exigée par les stores).
-- Efface en cascade profil, sessions, parcours, messages et amitiés.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.search_profiles(text) from public, anon;
revoke execute on function public.suggest_friends(integer) from public, anon;
revoke execute on function public.my_friends() from public, anon;
revoke execute on function public.my_conversations() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.suggest_friends(integer) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.my_conversations() to authenticated;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------------
-- 5. LIEUX IMPORTÉS D'OPENSTREETMAP
-- ---------------------------------------------------------------------
-- Étiquettes OSM d'origine, lues directement par l'appli.
alter table public.spots add column osm_tags jsonb;

-- Clé d'unicité complète, nécessaire à la mise à jour automatique par l'import.
drop index public.spots_source_ref_key;
alter table public.spots add constraint spots_source_ref_unique unique (source, source_ref);

create function public.osm_spots_near(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  integer default 2000
)
returns table (
  id          uuid,
  source_ref  text,
  lat         double precision,
  lng         double precision,
  tags        jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  select s.id, s.source_ref, st_y(s.location::geometry), st_x(s.location::geometry), s.osm_tags
  from public.spots s
  where s.source = 'osm'
    and s.osm_tags is not null
    and st_dwithin(s.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, least(p_radius_m, 20000))
  limit 3000;
$$;

grant execute on function public.osm_spots_near(double precision, double precision, integer) to anon, authenticated;
