-- =====================================================================
-- Appli sport local — schéma Supabase (PostgreSQL + PostGIS)
--
-- Utilisation : Supabase > SQL Editor > coller tout le fichier > Run
--               (ou supabase/migrations/0001_init.sql avec la CLI).
-- À exécuter une seule fois sur un projet vide.
--
-- Sommaire
--   0. Extensions et schéma privé
--   1. Types énumérés
--   2. Tables
--   3. Fonctions utilitaires et triggers
--   4. Sécurité : RLS + droits
--   5. Fonctions RPC (recherche géographique, messagerie)
--   6. Vues de lecture
--   7. Realtime
--   8. Storage (photos)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. EXTENSIONS ET SCHÉMA PRIVÉ
-- ---------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- Fonctions internes, non exposées par l'API REST.
create schema if not exists private;


-- ---------------------------------------------------------------------
-- 1. TYPES ÉNUMÉRÉS
-- ---------------------------------------------------------------------
create type public.skill_level as enum
  ('debutant', 'intermediaire', 'confirme', 'expert');

create type public.spot_category as enum
  ('stade_football', 'stade_rugby', 'court_tennis', 'salle_sport',
   'salle_boxe', 'street_workout', 'piste_athletisme', 'autre');

create type public.access_type as enum
  ('libre', 'payant', 'adherents', 'sur_reservation');

create type public.event_status as enum
  ('ouvert', 'complet', 'annule', 'termine');

create type public.conversation_kind as enum ('direct', 'event');


-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

-- 2.1 USERS ------------------------------------------------------------
-- Les comptes (email, mot de passe) vivent dans auth.users, géré par
-- Supabase Auth. public.profiles contient uniquement le profil public.
-- Pas de position précise du domicile ici : seulement la ville.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique
                  check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name  text check (char_length(display_name) <= 60),
  avatar_url    text,
  bio           text check (char_length(bio) <= 500),
  city          text,
  -- Exemple : {"lun": ["soir"], "sam": ["matin", "apres_midi"]}
  availability  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.sports (
  id    smallint generated always as identity primary key,
  slug  text not null unique,
  name  text not null
);

insert into public.sports (slug, name) values
  ('football', 'Football'),
  ('rugby', 'Rugby'),
  ('tennis', 'Tennis'),
  ('musculation', 'Musculation'),
  ('boxe', 'Boxe'),
  ('street_workout', 'Street workout'),
  ('athletisme', 'Athlétisme'),
  ('running', 'Running');

-- Sports pratiqués par un utilisateur, avec son niveau.
create table public.profile_sports (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  sport_id    smallint not null references public.sports (id) on delete cascade,
  level       public.skill_level not null default 'debutant',
  primary key (profile_id, sport_id)
);
create index profile_sports_sport_idx on public.profile_sports (sport_id);

-- Blocage entre utilisateurs (exigé par les stores pour tout contenu
-- généré par les utilisateurs).
create table public.user_blocks (
  blocker_id  uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- 2.2 SPOTS ------------------------------------------------------------
create table public.spots (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 2 and 120),
  description    text check (char_length(description) <= 2000),
  category       public.spot_category not null,
  -- geography = coordonnées GPS (lng lat), distances en mètres.
  location       geography(Point, 4326) not null,
  address        text,
  city           text,
  access         public.access_type not null default 'libre',
  is_free        boolean,
  has_lighting   boolean,
  -- Exemple : {"lun": [["08:00", "22:00"]], "dim": []}
  opening_hours  jsonb,
  -- Exemple : {barres_traction, anneaux, point_eau}
  equipment      text[] not null default '{}',
  -- Origine de la fiche : 'user', 'osm', 'data_es'
  source         text not null default 'user',
  source_ref     text,
  is_verified    boolean not null default false,
  created_by     uuid default auth.uid()
                   references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index spots_location_idx  on public.spots using gist (location);
create index spots_category_idx  on public.spots (category);
create index spots_equipment_idx on public.spots using gin (equipment);
-- Évite les doublons lors des imports OpenStreetMap / Data ES.
create unique index spots_source_ref_key
  on public.spots (source, source_ref) where source_ref is not null;

-- Disciplines praticables sur un lieu (un stade peut servir au foot et au rugby).
create table public.spot_sports (
  spot_id   uuid not null references public.spots (id) on delete cascade,
  sport_id  smallint not null references public.sports (id) on delete cascade,
  primary key (spot_id, sport_id)
);
create index spot_sports_sport_idx on public.spot_sports (sport_id);

create table public.spot_photos (
  id            uuid primary key default gen_random_uuid(),
  spot_id       uuid not null references public.spots (id) on delete cascade,
  -- Chemin dans le bucket Storage "spot-photos".
  storage_path  text not null,
  uploaded_by   uuid default auth.uid()
                  references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index spot_photos_spot_idx on public.spot_photos (spot_id);

create table public.spot_reviews (
  id          uuid primary key default gen_random_uuid(),
  spot_id     uuid not null references public.spots (id) on delete cascade,
  author_id   uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (char_length(comment) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (spot_id, author_id)          -- un avis par personne et par lieu
);

-- 2.3 ROUTES -----------------------------------------------------------
create table public.routes (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid()
                      references public.profiles (id) on delete cascade,
  name              text not null check (char_length(name) between 2 and 120),
  description       text check (char_length(description) <= 1000),
  city              text,
  path              geography(LineString, 4326) not null,
  -- Les deux colonnes suivantes sont calculées par trigger à partir de path.
  start_point       geography(Point, 4326) not null,
  distance_m        integer not null,
  elevation_gain_m  integer,
  is_loop           boolean not null default false,
  is_public         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index routes_start_point_idx on public.routes using gist (start_point);
create index routes_owner_idx       on public.routes (owner_id);

-- 2.4 EVENTS -----------------------------------------------------------
create table public.events (
  id                uuid primary key default gen_random_uuid(),
  organizer_id      uuid not null default auth.uid()
                      references public.profiles (id) on delete cascade,
  sport_id          smallint not null references public.sports (id),
  spot_id           uuid references public.spots (id) on delete set null,
  route_id          uuid references public.routes (id) on delete set null,
  title             text not null check (char_length(title) between 3 and 120),
  description       text check (char_length(description) <= 2000),
  -- Recopiée depuis le spot par trigger si elle n'est pas fournie.
  location          geography(Point, 4326) not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  level             public.skill_level,
  max_participants  smallint not null default 2
                      check (max_participants between 2 and 100),
  status            public.event_status not null default 'ouvert',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index events_location_idx  on public.events using gist (location);
create index events_starts_at_idx on public.events (starts_at);
create index events_organizer_idx on public.events (organizer_id);
create index events_spot_idx      on public.events (spot_id);

create table public.event_participants (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_participants_user_idx on public.event_participants (user_id);

-- 2.5 MESSAGES ---------------------------------------------------------
-- Une conversation est soit privée entre deux personnes ('direct'),
-- soit le fil de discussion d'une session ('event').
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             public.conversation_kind not null,
  event_id         uuid unique references public.events (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  check ((kind = 'event') = (event_id is not null))
);

create table public.conversation_members (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null default auth.uid()
                     references public.profiles (id) on delete cascade,
  content          text not null check (char_length(content) between 1 and 2000),
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx
  on public.messages (conversation_id, created_at desc);

-- Signalements (lieu, avis, session, message ou profil).
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null default auth.uid()
                 references public.profiles (id) on delete cascade,
  target_type  text not null
                 check (target_type in ('profile', 'spot', 'review', 'event', 'message')),
  target_id    text not null,
  reason       text not null check (char_length(reason) between 3 and 1000),
  created_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. FONCTIONS UTILITAIRES ET TRIGGERS
-- ---------------------------------------------------------------------

-- 3.1 updated_at automatique ------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger spots_set_updated_at before update on public.spots
  for each row execute function private.set_updated_at();
create trigger spot_reviews_set_updated_at before update on public.spot_reviews
  for each row execute function private.set_updated_at();
create trigger events_set_updated_at before update on public.events
  for each row execute function private.set_updated_at();

-- 3.2 Création du profil à l'inscription ------------------------------
-- Le pseudo définitif est choisi par l'utilisateur à l'écran d'accueil.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'user_' || left(replace(new.id::text, '-', ''), 20),
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- 3.3 Appartenance à une conversation ---------------------------------
-- security definer : évite la récursion infinie des politiques RLS qui
-- liraient conversation_members depuis conversation_members.
create function private.is_conversation_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation
      and m.user_id = (select auth.uid())
  );
$$;

-- 3.4 Parcours : point de départ et distance calculés -----------------
create function private.routes_set_derived()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.start_point := st_startpoint(new.path::geometry)::geography;
  new.distance_m  := round(st_length(new.path))::integer;
  return new;
end;
$$;

create trigger routes_set_derived before insert or update of path on public.routes
  for each row execute function private.routes_set_derived();

-- 3.5 Session : position héritée du lieu ------------------------------
create function private.events_set_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location is null and new.spot_id is not null then
    select s.location into new.location
    from public.spots s
    where s.id = new.spot_id;
  end if;
  return new;
end;
$$;

create trigger events_set_location before insert on public.events
  for each row execute function private.events_set_location();

-- 3.6 Session créée : fil de discussion + organisateur inscrit --------
create function private.events_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversations (kind, event_id, created_by)
  values ('event', new.id, new.organizer_id);

  insert into public.event_participants (event_id, user_id)
  values (new.id, new.organizer_id);

  return new;
end;
$$;

create trigger events_after_insert after insert on public.events
  for each row execute function private.events_after_insert();

-- 3.7 Inscription : contrôle du nombre de places ----------------------
create function private.participants_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  public.events%rowtype;
  v_count  integer;
begin
  -- Verrou sur la session : deux inscriptions simultanées passent l'une
  -- après l'autre, la dernière place ne peut pas être prise deux fois.
  select * into v_event from public.events where id = new.event_id for update;

  if not found then
    raise exception 'Session introuvable';
  end if;
  if v_event.status <> 'ouvert' then
    raise exception 'Cette session n''accepte plus d''inscriptions';
  end if;

  select count(*) into v_count
  from public.event_participants
  where event_id = new.event_id;

  if v_count >= v_event.max_participants then
    raise exception 'Cette session est complète';
  end if;

  if v_count + 1 >= v_event.max_participants then
    update public.events set status = 'complet' where id = new.event_id;
  end if;

  return new;
end;
$$;

create trigger participants_before_insert before insert on public.event_participants
  for each row execute function private.participants_before_insert();

-- 3.8 Inscription / désinscription : synchronisation du fil -----------
create function private.participants_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
    from public.conversations c
    where c.event_id = new.event_id
    on conflict do nothing;
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

  return old;
end;
$$;

create trigger participants_after_change
  after insert or delete on public.event_participants
  for each row execute function private.participants_after_change();

-- 3.9 Message envoyé : date du dernier message ------------------------
create function private.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function private.messages_after_insert();


-- ---------------------------------------------------------------------
-- 4. SÉCURITÉ : ROW LEVEL SECURITY + DROITS
-- ---------------------------------------------------------------------
-- Règle générale : RLS activée partout. Sans politique, rien ne passe.
-- (select auth.uid()) est évalué une fois par requête, pas par ligne.

alter table public.profiles             enable row level security;
alter table public.sports               enable row level security;
alter table public.profile_sports       enable row level security;
alter table public.user_blocks          enable row level security;
alter table public.spots                enable row level security;
alter table public.spot_sports          enable row level security;
alter table public.spot_photos          enable row level security;
alter table public.spot_reviews         enable row level security;
alter table public.routes               enable row level security;
alter table public.events               enable row level security;
alter table public.event_participants   enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.reports              enable row level security;

-- 4.1 Profils ----------------------------------------------------------
create policy "Profils visibles par les membres connectés"
  on public.profiles for select to authenticated
  using (true);

create policy "Chacun modifie son profil"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- Pas de politique INSERT : le profil est créé par le trigger 3.2.
-- Pas de politique DELETE : supprimer le compte auth.users supprime tout.

create policy "Sports lisibles par tous"
  on public.sports for select to anon, authenticated
  using (true);

create policy "Sports pratiqués visibles par les membres"
  on public.profile_sports for select to authenticated
  using (true);

create policy "Chacun gère ses sports pratiqués"
  on public.profile_sports for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy "Chacun voit ses blocages"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy "Chacun bloque pour son compte"
  on public.user_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy "Chacun lève ses blocages"
  on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- 4.2 Spots ------------------------------------------------------------
create policy "Lieux lisibles par tous"
  on public.spots for select to anon, authenticated
  using (true);

-- Un membre ne peut pas se déclarer « vérifié » ni usurper une source d'import.
create policy "Un membre propose un lieu"
  on public.spots for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and is_verified = false
    and source = 'user'
  );

create policy "Le créateur corrige son lieu"
  on public.spots for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "Le créateur retire son lieu non vérifié"
  on public.spots for delete to authenticated
  using (created_by = (select auth.uid()) and is_verified = false);

create policy "Disciplines des lieux lisibles par tous"
  on public.spot_sports for select to anon, authenticated
  using (true);

create policy "Le créateur du lieu gère ses disciplines"
  on public.spot_sports for all to authenticated
  using (exists (
    select 1 from public.spots s
    where s.id = spot_id and s.created_by = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.spots s
    where s.id = spot_id and s.created_by = (select auth.uid())
  ));

create policy "Photos lisibles par tous"
  on public.spot_photos for select to anon, authenticated
  using (true);

create policy "Un membre ajoute une photo"
  on public.spot_photos for insert to authenticated
  with check (uploaded_by = (select auth.uid()));

create policy "Chacun retire ses photos"
  on public.spot_photos for delete to authenticated
  using (uploaded_by = (select auth.uid()));

create policy "Avis lisibles par tous"
  on public.spot_reviews for select to anon, authenticated
  using (true);

create policy "Un membre publie son avis"
  on public.spot_reviews for insert to authenticated
  with check (author_id = (select auth.uid()));

create policy "Chacun modifie son avis"
  on public.spot_reviews for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "Chacun supprime son avis"
  on public.spot_reviews for delete to authenticated
  using (author_id = (select auth.uid()));

-- 4.3 Routes -----------------------------------------------------------
create policy "Parcours publics ou personnels"
  on public.routes for select to authenticated
  using (is_public or owner_id = (select auth.uid()));

create policy "Chacun crée ses parcours"
  on public.routes for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Chacun modifie ses parcours"
  on public.routes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Chacun supprime ses parcours"
  on public.routes for delete to authenticated
  using (owner_id = (select auth.uid()));

-- 4.4 Events -----------------------------------------------------------
create policy "Sessions visibles par les membres"
  on public.events for select to authenticated
  using (true);

create policy "Un membre organise une session"
  on public.events for insert to authenticated
  with check (organizer_id = (select auth.uid()));

create policy "L'organisateur modifie sa session"
  on public.events for update to authenticated
  using (organizer_id = (select auth.uid()))
  with check (organizer_id = (select auth.uid()));

create policy "L'organisateur supprime sa session"
  on public.events for delete to authenticated
  using (organizer_id = (select auth.uid()));

create policy "Participants visibles par les membres"
  on public.event_participants for select to authenticated
  using (true);

create policy "Chacun s'inscrit soi-même"
  on public.event_participants for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Désinscription par soi-même ou par l'organisateur"
  on public.event_participants for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.organizer_id = (select auth.uid())
    )
  );

-- 4.5 Messagerie -------------------------------------------------------
-- Les conversations et leurs membres ne sont jamais créés directement
-- par le client : uniquement par start_direct_conversation() (5.4) et
-- par les triggers des sessions (3.6, 3.8).
create policy "Conversations visibles par leurs membres"
  on public.conversations for select to authenticated
  using (private.is_conversation_member(id));

create policy "Membres visibles par les membres de la conversation"
  on public.conversation_members for select to authenticated
  using (private.is_conversation_member(conversation_id));

create policy "Chacun met à jour son marqueur de lecture"
  on public.conversation_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Messages lisibles par les membres de la conversation"
  on public.messages for select to authenticated
  using (private.is_conversation_member(conversation_id));

create policy "Un membre écrit dans ses conversations"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_conversation_member(conversation_id)
  );

create policy "Chacun supprime ses messages"
  on public.messages for delete to authenticated
  using (sender_id = (select auth.uid()));

-- 4.6 Signalements -----------------------------------------------------
-- Écriture seule côté client ; lecture depuis le tableau de bord Supabase.
create policy "Un membre envoie un signalement"
  on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));

-- 4.7 Droits SQL -------------------------------------------------------
-- RLS filtre les lignes ; les GRANT décident des tables et des colonnes.
grant usage on schema public  to anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_conversation_member(uuid) to authenticated;

grant select on public.sports, public.spots, public.spot_sports,
                public.spot_photos, public.spot_reviews
  to anon;

grant select on all tables in schema public to authenticated;
revoke select on public.reports from authenticated;

grant insert, delete on public.profile_sports, public.user_blocks,
                        public.spots, public.spot_sports, public.spot_photos,
                        public.spot_reviews, public.routes, public.events,
                        public.event_participants, public.messages
  to authenticated;
grant insert on public.reports to authenticated;

-- Mises à jour limitées aux colonnes modifiables par l'utilisateur.
revoke update on all tables in schema public from anon, authenticated;

grant update (username, display_name, avatar_url, bio, city, availability)
  on public.profiles to authenticated;
grant update (level)
  on public.profile_sports to authenticated;
grant update (name, description, category, location, address, city, access,
              is_free, has_lighting, opening_hours, equipment)
  on public.spots to authenticated;          -- pas is_verified, pas source
grant update (rating, comment)
  on public.spot_reviews to authenticated;
grant update (name, description, city, path, elevation_gain_m, is_loop, is_public)
  on public.routes to authenticated;
grant update (sport_id, spot_id, route_id, title, description, location,
              starts_at, ends_at, level, max_participants, status)
  on public.events to authenticated;
grant update (last_read_at)
  on public.conversation_members to authenticated;


-- ---------------------------------------------------------------------
-- 5. FONCTIONS RPC
-- ---------------------------------------------------------------------
-- Appel Flutter : supabase.rpc('spots_nearby', params: {...})
-- Elles s'exécutent avec les droits de l'appelant : RLS s'applique.

-- 5.1 Lieux autour d'un point -----------------------------------------
create function public.spots_nearby(
  p_lat          double precision,
  p_lng          double precision,
  p_radius_m     integer default 2000,
  p_categories   public.spot_category[] default null,
  p_sport_slugs  text[] default null,
  p_access       public.access_type[] default null,
  p_limit        integer default 100
)
returns table (
  id             uuid,
  name           text,
  category       public.spot_category,
  access         public.access_type,
  city           text,
  equipment      text[],
  lat            double precision,
  lng            double precision,
  distance_m     double precision,
  avg_rating     numeric,
  reviews_count  bigint
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    s.id, s.name, s.category, s.access, s.city, s.equipment,
    st_y(s.location::geometry),
    st_x(s.location::geometry),
    st_distance(s.location, me.g),
    r.avg_rating,
    coalesce(r.reviews_count, 0)
  from public.spots s
  cross join me
  left join lateral (
    select round(avg(sr.rating), 1) as avg_rating, count(*) as reviews_count
    from public.spot_reviews sr
    where sr.spot_id = s.id
  ) r on true
  where st_dwithin(s.location, me.g, least(p_radius_m, 50000))
    and (p_categories is null or s.category = any (p_categories))
    and (p_access is null or s.access = any (p_access))
    and (
      p_sport_slugs is null
      or exists (
        select 1
        from public.spot_sports ss
        join public.sports sp on sp.id = ss.sport_id
        where ss.spot_id = s.id and sp.slug = any (p_sport_slugs)
      )
    )
  order by st_distance(s.location, me.g)
  limit least(p_limit, 500);
$$;

-- 5.2 Lieux dans la zone visible de la carte --------------------------
create function public.spots_in_bounds(
  p_min_lat     double precision,
  p_min_lng     double precision,
  p_max_lat     double precision,
  p_max_lng     double precision,
  p_categories  public.spot_category[] default null,
  p_limit       integer default 300
)
returns table (
  id        uuid,
  name      text,
  category  public.spot_category,
  access    public.access_type,
  lat       double precision,
  lng       double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.category, s.access,
    st_y(s.location::geometry),
    st_x(s.location::geometry)
  from public.spots s
  where st_intersects(
          s.location,
          st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography
        )
    and (p_categories is null or s.category = any (p_categories))
  limit least(p_limit, 1000);
$$;

-- 5.3 Sessions à venir autour d'un point ------------------------------
create function public.events_nearby(
  p_lat          double precision,
  p_lng          double precision,
  p_radius_m     integer default 5000,
  p_from         timestamptz default now(),
  p_to           timestamptz default now() + interval '7 days',
  p_sport_slugs  text[] default null
)
returns table (
  id                  uuid,
  title               text,
  sport_slug          text,
  starts_at           timestamptz,
  level               public.skill_level,
  status              public.event_status,
  max_participants    smallint,
  participants_count  bigint,
  organizer_id        uuid,
  organizer_name      text,
  spot_id             uuid,
  spot_name           text,
  lat                 double precision,
  lng                 double precision,
  distance_m          double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    e.id, e.title, sp.slug, e.starts_at, e.level, e.status,
    e.max_participants,
    (select count(*) from public.event_participants ep where ep.event_id = e.id),
    e.organizer_id,
    coalesce(p.display_name, p.username),
    e.spot_id,
    s.name,
    st_y(e.location::geometry),
    st_x(e.location::geometry),
    st_distance(e.location, me.g)
  from public.events e
  cross join me
  join public.sports sp on sp.id = e.sport_id
  join public.profiles p on p.id = e.organizer_id
  left join public.spots s on s.id = e.spot_id
  where st_dwithin(e.location, me.g, least(p_radius_m, 50000))
    and e.starts_at >= p_from
    and e.starts_at < p_to
    and e.status in ('ouvert', 'complet')
    and (p_sport_slugs is null or sp.slug = any (p_sport_slugs))
    -- Masque les sessions des personnes que j'ai bloquées.
    and not exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid()) and b.blocked_id = e.organizer_id
    )
  order by e.starts_at
  limit 200;
$$;

-- 5.4 Ouvrir (ou retrouver) une conversation privée -------------------
-- security definer : seule porte d'entrée pour créer une conversation
-- à deux, avec vérification des blocages.
create function public.start_direct_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_id  uuid;
begin
  if v_me is null then
    raise exception 'Authentification requise';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'Destinataire invalide';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'Utilisateur introuvable';
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = v_me and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = v_me)
  ) then
    raise exception 'Conversation impossible avec cet utilisateur';
  end if;

  -- Verrou par paire d'utilisateurs : pas de doublon si les deux
  -- personnes ouvrent la conversation au même moment.
  perform pg_advisory_xact_lock(
    hashtextextended(least(v_me, p_other)::text || greatest(v_me, p_other)::text, 0)
  );

  select c.id into v_id
  from public.conversations c
  join public.conversation_members a
    on a.conversation_id = c.id and a.user_id = v_me
  join public.conversation_members b
    on b.conversation_id = c.id and b.user_id = p_other
  where c.kind = 'direct'
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (kind, created_by)
  values ('direct', v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other);

  return v_id;
end;
$$;

revoke execute on function public.start_direct_conversation(uuid) from public, anon;
grant  execute on function public.start_direct_conversation(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. VUES DE LECTURE
-- ---------------------------------------------------------------------
-- security_invoker : la vue applique les politiques RLS de l'appelant.

-- Fiche détaillée d'un lieu, avec coordonnées et note moyenne.
create view public.spot_details
with (security_invoker = true)
as
select
  s.id, s.name, s.description, s.category, s.address, s.city, s.access,
  s.is_free, s.has_lighting, s.opening_hours, s.equipment, s.is_verified,
  s.created_by, s.created_at,
  st_y(s.location::geometry) as lat,
  st_x(s.location::geometry) as lng,
  (select round(avg(r.rating), 1) from public.spot_reviews r where r.spot_id = s.id)
    as avg_rating,
  (select count(*) from public.spot_reviews r where r.spot_id = s.id)
    as reviews_count,
  (select coalesce(array_agg(sp.slug order by sp.slug), '{}')
     from public.spot_sports ss
     join public.sports sp on sp.id = ss.sport_id
    where ss.spot_id = s.id)
    as sport_slugs
from public.spots s;

-- Parcours avec leur tracé en GeoJSON, directement affichable sur la carte.
create view public.route_details
with (security_invoker = true)
as
select
  r.id, r.owner_id, r.name, r.description, r.city, r.distance_m,
  r.elevation_gain_m, r.is_loop, r.is_public, r.created_at,
  st_asgeojson(r.path)::jsonb as path_geojson
from public.routes r;

grant select on public.spot_details to anon, authenticated;
grant select on public.route_details to authenticated;


-- ---------------------------------------------------------------------
-- 7. REALTIME
-- ---------------------------------------------------------------------
-- Les changements diffusés respectent les politiques SELECT ci-dessus :
-- un utilisateur ne reçoit que les messages de ses conversations.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.event_participants;
alter publication supabase_realtime add table public.events;


-- ---------------------------------------------------------------------
-- 8. STORAGE (PHOTOS)
-- ---------------------------------------------------------------------
-- Buckets publics en lecture ; chaque utilisateur écrit uniquement dans
-- le dossier qui porte son identifiant : <uid>/<fichier>.jpg
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('spot-photos', 'spot-photos', true)
on conflict (id) do nothing;

create policy "Envoi d'images dans son dossier"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'spot-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Remplacement de ses images"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars', 'spot-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Suppression de ses images"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars', 'spot-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
