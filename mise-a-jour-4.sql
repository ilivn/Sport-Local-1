-- =====================================================================
-- Sport local — mise à jour n° 4 : recherche de lieux plus rapide
-- À lancer une fois dans Supabase > SQL Editor > New query > Run.
-- L'appli fonctionne aussi sans cette mise à jour (elle utilise alors places_near).
-- =====================================================================

-- Même résultat que places_near, mais :
--  - seules les étiquettes OSM utiles à l'appli sont envoyées (réponse beaucoup plus légère) ;
--  - les lieux sont triés du plus proche au plus loin grâce à l'index spatial (opérateur <->) ;
--  - 1 500 lieux maximum au lieu de 3 000.
create or replace function public.places_near_light(
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
  with centre as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select s.id, s.source, s.source_ref,
         st_y(s.location::geometry), st_x(s.location::geometry),
         (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            from jsonb_each(s.osm_tags) as e(key, value)
           where e.key in ('name', 'leisure', 'amenity', 'shop', 'healthcare', 'club', 'sport',
                           'access', 'fee', 'lit', 'indoor', 'covered', 'surface', 'opening_hours',
                           'website', 'contact:website', 'phone', 'contact:phone', 'wheelchair',
                           'addr:housenumber', 'addr:street', 'addr:postcode', 'addr:city'))
  from public.spots s, centre c
  where s.osm_tags is not null
    and s.source in ('osm', 'user')
    and st_dwithin(s.location, c.g, least(p_radius_m, 20000))
  order by s.location <-> c.g
  limit 1500;
$$;

grant execute on function public.places_near_light(double precision, double precision, integer) to anon, authenticated;
