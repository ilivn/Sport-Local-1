-- =====================================================================
-- Sport local — mise à jour n° 2 (lot 1)
-- Favoris sur le compte, avis et photos des lieux, lieux proposés par
-- les membres, liste d'attente des sessions, sessions visibles sans compte.
--
-- À exécuter UNE fois, après schema.sql et amis.sql :
-- Supabase > SQL Editor > New query > coller tout le fichier > Run
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. FAVORIS (suivent le compte sur tous les appareils)
-- ---------------------------------------------------------------------
create table public.favorites (
  user_id     uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  place_ref   text not null check (char_length(place_ref) between 3 and 60),
  name        text not null check (char_length(name) between 1 and 160),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  created_at  timestamptz not null default now(),
  primary key (user_id, place_ref)
);

alter table public.favorites enable row level security;

create policy "Chacun voit ses favoris"
  on public.favorites for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Chacun ajoute ses favoris"
  on public.favorites for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Chacun retire ses favoris"
  on public.favorites for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.favorites to authenticated;


-- ---------------------------------------------------------------------
-- 2. FICHE EN BASE POUR UN LIEU OPENSTREETMAP
-- ---------------------------------------------------------------------
-- Un lieu affiché depuis OpenStreetMap n'a pas forcément de ligne dans
-- spots. Pour lui laisser un avis, une photo ou une session, l'appli
-- demande sa fiche : créée au besoin, sans étiquettes OSM (osm_tags)
-- pour qu'un membre ne puisse pas faire apparaître un faux lieu sur la
-- carte. L'import automatique complète ensuite la fiche.
create function public.ensure_osm_spot(
  p_ref   text,
  p_name  text,
  p_lat   double precision,
  p_lng   double precision
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_name text := left(trim(coalesce(p_name, '')), 120);
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  if p_ref is null or p_ref !~ '^(node|way|relation)/[0-9]{1,15}$' then
    raise exception 'Référence de lieu invalide';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Coordonnées invalides';
  end if;
  if char_length(v_name) < 2 then
    v_name := 'Lieu sportif';
  end if;

  select id into v_id from public.spots where source = 'osm' and source_ref = p_ref;
  if v_id is null then
    insert into public.spots (source, source_ref, name, category, location)
    values ('osm', p_ref, v_name, 'autre', st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
    on conflict (source, source_ref) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.spots where source = 'osm' and source_ref = p_ref;
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.ensure_osm_spot(text, text, double precision, double precision) from public, anon;
grant execute on function public.ensure_osm_spot(text, text, double precision, double precision) to authenticated;


-- ---------------------------------------------------------------------
-- 3. AVIS ET PHOTOS D'UN LIEU (lisibles sans compte)
-- ---------------------------------------------------------------------
-- Les profils ne sont visibles que des membres connectés : cette
-- fonction renvoie seulement le nom affiché de l'auteur de chaque avis.
create function public.spot_reviews_list(p_spot uuid)
returns table (
  id           uuid,
  rating       smallint,
  comment      text,
  created_at   timestamptz,
  author_id    uuid,
  author_name  text,
  is_mine      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.rating, r.comment, r.created_at, r.author_id,
         coalesce(p.display_name, p.username),
         r.author_id = (select auth.uid())
  from public.spot_reviews r
  join public.profiles p on p.id = r.author_id
  where r.spot_id = p_spot
  order by r.created_at desc
  limit 100;
$$;

grant execute on function public.spot_reviews_list(uuid) to anon, authenticated;

-- Fiche par référence OSM : identifiant, note moyenne, nombre d'avis et de photos.
create function public.spot_summary(p_ref text)
returns table (
  spot_id        uuid,
  avg_rating     numeric,
  reviews_count  bigint,
  photos_count   bigint
)
language sql
stable
set search_path = ''
as $$
  select s.id,
         (select round(avg(r.rating), 1) from public.spot_reviews r where r.spot_id = s.id),
         (select count(*) from public.spot_reviews r where r.spot_id = s.id),
         (select count(*) from public.spot_photos ph where ph.spot_id = s.id)
  from public.spots s
  where (s.source = 'osm' and s.source_ref = p_ref)
     or (s.source = 'user' and s.id::text = p_ref)
  limit 1;
$$;

grant execute on function public.spot_summary(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. LIEUX SUR LA CARTE : importés + proposés par les membres
-- ---------------------------------------------------------------------
-- Les lieux proposés (source 'user') portent aussi des étiquettes au
-- format OSM, écrites par l'appli au moment de la proposition.
create function public.places_near(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_m  integer default 2000
)
returns table (
  id          uuid,
  source      text,
  source_ref  text,
  lat         double precision,
  lng         double precision,
  tags        jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  select s.id, s.source, s.source_ref, st_y(s.location::geometry), st_x(s.location::geometry), s.osm_tags
  from public.spots s
  where s.osm_tags is not null
    and s.source in ('osm', 'user')
    and st_dwithin(s.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, least(p_radius_m, 20000))
  limit 3000;
$$;

grant execute on function public.places_near(double precision, double precision, integer) to anon, authenticated;

-- Signalements : un lieu peut être signalé (erreur, lieu fermé, doublon).
-- (target_type 'spot' est déjà accepté par la table reports.)


-- ---------------------------------------------------------------------
-- 5. LISTE D'ATTENTE DES SESSIONS
-- ---------------------------------------------------------------------
create table public.event_waitlist (
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_waitlist enable row level security;

create policy "Liste d'attente visible par soi-même et l'organisateur"
  on public.event_waitlist for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.events e where e.id = event_id and e.organizer_id = (select auth.uid()))
  );
create policy "Chacun s'inscrit soi-même en liste d'attente"
  on public.event_waitlist for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Chacun quitte la liste d'attente"
  on public.event_waitlist for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.event_waitlist to authenticated;

-- Quand quelqu'un quitte une session, la première personne en attente
-- prend automatiquement sa place.
create or replace function private.participants_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
    from public.conversations c
    where c.event_id = new.event_id
    on conflict do nothing;
    delete from public.event_waitlist w where w.event_id = new.event_id and w.user_id = new.user_id;
    return new;
  end if;

  -- DELETE : sortie du fil et place libérée.
  delete from public.conversation_members m
  using public.conversations c
  where c.id = m.conversation_id
    and c.event_id = old.event_id
    and m.user_id = old.user_id;

  update public.events
  set status = 'ouvert'
  where id = old.event_id and status = 'complet';

  -- Pas de remplacement si la session elle-même est en cours de suppression.
  if exists (select 1 from public.events e where e.id = old.event_id and e.status = 'ouvert' and e.starts_at > now()) then
    select w.user_id into v_next
    from public.event_waitlist w
    where w.event_id = old.event_id and w.user_id <> old.user_id
    order by w.created_at
    limit 1;
    if v_next is not null then
      insert into public.event_participants (event_id, user_id) values (old.event_id, v_next);
    end if;
  end if;

  return old;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. SESSIONS VISIBLES SANS COMPTE
-- ---------------------------------------------------------------------
-- events_nearby n'expose que des informations publiques (titre, date,
-- lieu, nom affiché de l'organisateur) : on l'ouvre aux visiteurs.
alter function public.events_nearby(double precision, double precision, integer, timestamptz, timestamptz, text[]) security definer;
grant execute on function public.events_nearby(double precision, double precision, integer, timestamptz, timestamptz, text[]) to anon;

-- Fiche publique d'une session (pour les visiteurs et les liens partagés).
create function public.event_public(p_id uuid)
returns table (
  id                  uuid,
  title               text,
  description         text,
  sport_name          text,
  starts_at           timestamptz,
  level               public.skill_level,
  status              public.event_status,
  max_participants    smallint,
  participants_count  bigint,
  waitlist_count      bigint,
  organizer_id        uuid,
  organizer_name      text,
  place_name          text,
  lat                 double precision,
  lng                 double precision,
  joined              boolean,
  waiting             boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id, e.title, e.description, sp.name, e.starts_at, e.level, e.status, e.max_participants,
         (select count(*) from public.event_participants ep where ep.event_id = e.id),
         (select count(*) from public.event_waitlist w where w.event_id = e.id),
         e.organizer_id, coalesce(p.display_name, p.username),
         coalesce(s.name, e.place_name),
         st_y(e.location::geometry), st_x(e.location::geometry),
         exists (select 1 from public.event_participants ep where ep.event_id = e.id and ep.user_id = (select auth.uid())),
         exists (select 1 from public.event_waitlist w where w.event_id = e.id and w.user_id = (select auth.uid()))
  from public.events e
  join public.sports sp on sp.id = e.sport_id
  join public.profiles p on p.id = e.organizer_id
  left join public.spots s on s.id = e.spot_id
  where e.id = p_id;
$$;

grant execute on function public.event_public(uuid) to anon, authenticated;
