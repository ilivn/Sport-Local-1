-- =====================================================================
-- Sport local — mise à jour n° 3 (lot 2)
-- Activités enregistrées au GPS, statistiques, groupes avec discussion,
-- notifications.
--
-- À exécuter UNE fois, après schema.sql, amis.sql et mise-a-jour-2.sql :
-- Supabase > SQL Editor > New query > coller tout le fichier > Run
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ACTIVITÉS (course, marche, vélo… enregistrées avec le GPS)
-- ---------------------------------------------------------------------
-- Le tracé est une liste de points [longitude, latitude], déjà allégée
-- par l'appli (5 000 points au maximum).
create table public.activities (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid()
                      references public.profiles (id) on delete cascade,
  sport             text not null default 'course'
                      check (sport in ('course', 'marche', 'velo', 'rando', 'autre')),
  title             text not null default 'Activité' check (char_length(title) between 1 and 120),
  started_at        timestamptz not null,
  duration_s        integer not null check (duration_s between 1 and 172800),
  distance_m        integer not null check (distance_m between 0 and 1000000),
  elevation_gain_m  integer check (elevation_gain_m between 0 and 20000),
  path              jsonb check (path is null or (jsonb_typeof(path) = 'array' and jsonb_array_length(path) <= 5000)),
  visibility        text not null default 'amis' check (visibility in ('prive', 'amis')),
  created_at        timestamptz not null default now()
);
create index activities_user_idx on public.activities (user_id, started_at desc);

-- Vrai si les deux comptes sont amis (demande acceptée).
create function private.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b) or (f.requester_id = b and f.addressee_id = a))
  );
$$;
grant execute on function private.are_friends(uuid, uuid) to authenticated;

alter table public.activities enable row level security;

create policy "Activités visibles par soi-même et ses amis"
  on public.activities for select to authenticated
  using (
    user_id = (select auth.uid())
    or (visibility = 'amis' and private.are_friends((select auth.uid()), user_id))
  );
create policy "Chacun enregistre ses activités"
  on public.activities for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Chacun modifie ses activités"
  on public.activities for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Chacun supprime ses activités"
  on public.activities for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.activities to authenticated;
grant update (title, sport, visibility) on public.activities to authenticated;

-- Dernières activités des amis (sans le tracé).
create function public.friends_activities(p_limit integer default 20)
returns table (
  id           uuid,
  user_id      uuid,
  author_name  text,
  avatar_url   text,
  sport        text,
  title        text,
  started_at   timestamptz,
  duration_s   integer,
  distance_m   integer
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.user_id, coalesce(p.display_name, p.username), p.avatar_url,
         a.sport, a.title, a.started_at, a.duration_s, a.distance_m
  from public.activities a
  join public.profiles p on p.id = a.user_id
  where a.user_id <> (select auth.uid())
  order by a.started_at desc
  limit least(greatest(p_limit, 1), 50);
$$;
grant execute on function public.friends_activities(integer) to authenticated;


-- ---------------------------------------------------------------------
-- 2. STATISTIQUES (servent aussi à calculer les badges dans l'appli)
-- ---------------------------------------------------------------------
create function public.my_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_res    jsonb;
  v_streak integer := 0;
  v_week   timestamptz := date_trunc('week', now());
begin
  if v_me is null then
    raise exception 'Authentification requise';
  end if;

  -- Semaines consécutives avec au moins une activité ou une session
  -- (la semaine en cours compte si elle en a déjà une).
  if not exists (select 1 from public.activities where user_id = v_me and started_at >= v_week) then
    v_week := v_week - interval '1 week';
  end if;
  while v_streak < 520 and (
    exists (select 1 from public.activities a
            where a.user_id = v_me and a.started_at >= v_week and a.started_at < v_week + interval '1 week')
    or exists (select 1 from public.event_participants ep join public.events e on e.id = ep.event_id
               where ep.user_id = v_me and e.starts_at >= v_week and e.starts_at < v_week + interval '1 week' and e.starts_at < now())
  ) loop
    v_streak := v_streak + 1;
    v_week := v_week - interval '1 week';
  end loop;

  select jsonb_build_object(
    'activities',        (select count(*) from public.activities where user_id = v_me),
    'total_m',           (select coalesce(sum(distance_m), 0) from public.activities where user_id = v_me),
    'total_s',           (select coalesce(sum(duration_s), 0) from public.activities where user_id = v_me),
    'week_m',            (select coalesce(sum(distance_m), 0) from public.activities where user_id = v_me and started_at >= date_trunc('week', now())),
    'month_m',           (select coalesce(sum(distance_m), 0) from public.activities where user_id = v_me and started_at >= date_trunc('month', now())),
    'year_m',            (select coalesce(sum(distance_m), 0) from public.activities where user_id = v_me and started_at >= date_trunc('year', now())),
    'longest_m',         (select coalesce(max(distance_m), 0) from public.activities where user_id = v_me),
    'run_m',             (select coalesce(sum(distance_m), 0) from public.activities where user_id = v_me and sport = 'course'),
    'bike_m',            (select coalesce(sum(distance_m), 0) from public.activities where user_id = v_me and sport = 'velo'),
    'best_pace_s',       (select min(duration_s * 1000.0 / distance_m)::integer from public.activities
                          where user_id = v_me and sport = 'course' and distance_m >= 1000),
    'early_birds',       (select count(*) from public.activities where user_id = v_me
                          and extract(hour from started_at at time zone 'Europe/Paris') < 7),
    'sessions_done',     (select count(*) from public.event_participants ep join public.events e on e.id = ep.event_id
                          where ep.user_id = v_me and e.starts_at < now()),
    'sessions_organized',(select count(*) from public.events where organizer_id = v_me),
    'friends',           (select count(*) from public.friendships where status = 'accepted' and v_me in (requester_id, addressee_id)),
    'groups',            (select count(*) from public.group_members where user_id = v_me),
    'reviews',           (select count(*) from public.spot_reviews where author_id = v_me),
    'photos',            (select count(*) from public.spot_photos where uploaded_by = v_me),
    'routes',            (select count(*) from public.routes where owner_id = v_me),
    'streak_weeks',      v_streak,
    'weeks',             (select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'm', w.m) order by w.week), '[]'::jsonb)
                          from (select gs.week, coalesce(sum(a.distance_m), 0) as m
                                from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') as gs(week)
                                left join public.activities a on a.user_id = v_me and a.started_at >= gs.week and a.started_at < gs.week + interval '1 week'
                                group by gs.week) w)
  ) into v_res;
  return v_res;
end;
$$;
grant execute on function public.my_stats() to authenticated;


-- ---------------------------------------------------------------------
-- 3. GROUPES (club, bande d'amis, équipe) avec leur discussion
-- ---------------------------------------------------------------------
-- Nouveau type de conversation. La valeur n'est utilisée qu'à
-- l'exécution des fonctions, donc ce fichier passe en une seule fois.
alter type public.conversation_kind add value if not exists 'group';

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 3 and 80),
  description  text check (char_length(description) <= 1000),
  sport_id     smallint references public.sports (id),
  city         text check (char_length(city) <= 80),
  is_public    boolean not null default true,
  owner_id     uuid not null default auth.uid()
                 references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index groups_owner_idx on public.groups (owner_id);

create table public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references public.profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

alter table public.conversations
  add column group_id uuid unique references public.groups (id) on delete cascade;

create function private.is_group_member(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = (select auth.uid()));
$$;
create function private.is_group_owner(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.groups g where g.id = p_group and g.owner_id = (select auth.uid()));
$$;
create function private.is_public_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.groups g where g.id = p_group and g.is_public);
$$;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.is_group_owner(uuid) to authenticated;
grant execute on function private.is_public_group(uuid) to authenticated;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

create policy "Groupes publics ou dont on est membre"
  on public.groups for select to authenticated
  using (is_public or owner_id = (select auth.uid()) or private.is_group_member(id));
create policy "Un membre crée un groupe"
  on public.groups for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Le créateur modifie son groupe"
  on public.groups for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Le créateur supprime son groupe"
  on public.groups for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, delete on public.groups to authenticated;
grant update (name, description, sport_id, city, is_public) on public.groups to authenticated;

create policy "Membres visibles si le groupe l'est"
  on public.group_members for select to authenticated
  using (private.is_public_group(group_id) or private.is_group_member(group_id));
-- On rejoint seul un groupe public ; le créateur peut ajouter ses amis
-- dans n'importe lequel de ses groupes.
create policy "Rejoindre un groupe public ou ajouter un ami"
  on public.group_members for insert to authenticated
  with check (
    role = 'member'
    and (
      (user_id = (select auth.uid()) and private.is_public_group(group_id))
      or (private.is_group_owner(group_id) and private.are_friends((select auth.uid()), user_id))
    )
  );
create policy "Quitter un groupe ou en retirer un membre"
  on public.group_members for delete to authenticated
  using (role = 'member' and (user_id = (select auth.uid()) or private.is_group_owner(group_id)));

grant select, insert, delete on public.group_members to authenticated;

-- Création d'un groupe : sa discussion et son créateur comme membre.
create function private.groups_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversations (kind, group_id, created_by)
  values ('group', new.id, new.owner_id);
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger groups_after_insert after insert on public.groups
  for each row execute function private.groups_after_insert();

-- Les fonctions de notification sont définies plus bas (section 4).
create function private.group_members_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id from public.conversations c where c.group_id = new.group_id
    on conflict do nothing;

    select * into v_group from public.groups where id = new.group_id;
    if new.role = 'member' then
      if new.user_id = auth.uid() then
        perform private.notify(v_group.owner_id, 'group_join',
          private.display_name(new.user_id) || ' a rejoint « ' || v_group.name || ' »', null,
          'group:' || new.group_id, new.user_id);
      else
        perform private.notify(new.user_id, 'group_added',
          private.display_name(auth.uid()) || ' vous a ajouté au groupe « ' || v_group.name || ' »', null,
          'group:' || new.group_id, auth.uid());
      end if;
    end if;
    return new;
  end if;

  delete from public.conversation_members m
  using public.conversations c
  where c.id = m.conversation_id and c.group_id = old.group_id and m.user_id = old.user_id;
  return old;
end;
$$;
create trigger group_members_after_change after insert or delete on public.group_members
  for each row execute function private.group_members_after_change();

-- Liste et recherche des groupes (les miens d'abord).
create function public.groups_search(p_query text default '')
returns table (
  id               uuid,
  name             text,
  description      text,
  sport_id         smallint,
  sport_name       text,
  city             text,
  is_public        boolean,
  owner_id         uuid,
  members_count    bigint,
  is_member        boolean,
  conversation_id  uuid
)
language sql
stable
set search_path = ''
as $$
  select g.id, g.name, g.description, g.sport_id, sp.name, g.city, g.is_public, g.owner_id,
         (select count(*) from public.group_members m where m.group_id = g.id),
         private.is_group_member(g.id),
         (select c.id from public.conversations c where c.group_id = g.id)
  from public.groups g
  left join public.sports sp on sp.id = g.sport_id
  where coalesce(trim(p_query), '') = ''
     or g.name ilike '%' || trim(p_query) || '%'
     or g.city ilike '%' || trim(p_query) || '%'
     or sp.name ilike '%' || trim(p_query) || '%'
  order by private.is_group_member(g.id) desc,
           (select count(*) from public.group_members m where m.group_id = g.id) desc,
           g.created_at desc
  limit 50;
$$;
grant execute on function public.groups_search(text) to authenticated;

create function public.group_members_list(p_group uuid)
returns table (
  user_id     uuid,
  name        text,
  username    text,
  avatar_url  text,
  role        text
)
language sql
stable
set search_path = ''
as $$
  select m.user_id, coalesce(p.display_name, p.username), p.username, p.avatar_url, m.role
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
  order by m.role = 'owner' desc, m.joined_at;
$$;
grant execute on function public.group_members_list(uuid) to authenticated;

-- Liste des conversations : on ajoute les discussions de groupe.
drop function public.my_conversations();
create function public.my_conversations()
returns table (
  conversation_id  uuid,
  kind             public.conversation_kind,
  event_id         uuid,
  group_id         uuid,
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
    c.id, c.kind, c.event_id, c.group_id,
    case when c.event_id is not null then e.title
         when c.group_id is not null then g.name
         else coalesce(op.display_name, op.username) end,
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
  left join public.groups g on g.id = c.group_id
  left join lateral (
    select m.user_id from public.conversation_members m
    where m.conversation_id = c.id and m.user_id <> (select auth.uid())
    limit 1
  ) om on c.event_id is null and c.group_id is null
  left join public.profiles op on op.id = om.user_id
  left join lateral (
    select msg.content, msg.created_at, msg.sender_id from public.messages msg
    where msg.conversation_id = c.id
    order by msg.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.created_at) desc;
$$;
grant execute on function public.my_conversations() to authenticated;


-- ---------------------------------------------------------------------
-- 4. NOTIFICATIONS
-- ---------------------------------------------------------------------
-- Écrites uniquement par la base (triggers ci-dessous) ; chacun lit,
-- marque comme lues et supprime les siennes. « link » indique à l'appli
-- quoi ouvrir : member:<id>, event:<id>, group:<id>.
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "Chacun lit ses notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Chacun marque ses notifications comme lues"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Chacun supprime ses notifications"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

create function private.display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select coalesce(p.display_name, p.username) from public.profiles p where p.id = p_user), 'Un membre');
$$;

create function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  if p_actor is not null and private.is_blocked_between(p_user, p_actor) then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, link, actor_id)
  values (p_user, p_kind, left(p_title, 200), left(p_body, 500), p_link, p_actor);
end;
$$;

-- Demandes d'ami envoyées et acceptées.
create function private.friendships_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify(new.addressee_id, 'friend_request',
      private.display_name(new.requester_id) || ' vous demande en ami', null,
      'member:' || new.requester_id, new.requester_id);
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform private.notify(new.requester_id, 'friend_accept',
      private.display_name(new.addressee_id) || ' a accepté votre demande d''ami', null,
      'member:' || new.addressee_id, new.addressee_id);
  end if;
  return new;
end;
$$;
create trigger friendships_notify after insert or update of status on public.friendships
  for each row execute function private.friendships_notify();

-- Inscriptions aux sessions, liste d'attente (reprend la version de la
-- mise à jour n° 2 en ajoutant les notifications).
create or replace function private.participants_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next  uuid;
  v_event public.events%rowtype;
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
    from public.conversations c
    where c.event_id = new.event_id
    on conflict do nothing;
    delete from public.event_waitlist w where w.event_id = new.event_id and w.user_id = new.user_id;

    select * into v_event from public.events where id = new.event_id;
    if v_event.organizer_id is distinct from new.user_id then
      perform private.notify(v_event.organizer_id, 'event_join',
        private.display_name(new.user_id) || ' a rejoint « ' || v_event.title || ' »', null,
        'event:' || new.event_id, new.user_id);
    end if;
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
  select * into v_event from public.events e
  where e.id = old.event_id and e.status = 'ouvert' and e.starts_at > now();
  if found then
    select w.user_id into v_next
    from public.event_waitlist w
    where w.event_id = old.event_id and w.user_id <> old.user_id
    order by w.created_at
    limit 1;
    if v_next is not null then
      insert into public.event_participants (event_id, user_id) values (old.event_id, v_next);
      perform private.notify(v_next, 'waitlist_promoted',
        'Une place s''est libérée : vous participez à « ' || v_event.title || ' »', null,
        'event:' || old.event_id, null);
    end if;
  end if;

  return old;
end;
$$;

-- Session annulée par l'organisateur : on prévient les participants.
create function private.events_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify(ep.user_id, 'event_cancel',
    'Session annulée : « ' || old.title || ' »',
    'Prévue le ' || to_char(old.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI') || '.',
    null, old.organizer_id)
  from public.event_participants ep
  where ep.event_id = old.id;
  return old;
end;
$$;
create trigger events_before_delete before delete on public.events
  for each row execute function private.events_before_delete();

-- Les compteurs « non lus » restent dans l'appli : pas de notification
-- par message (la messagerie a déjà ses badges).
