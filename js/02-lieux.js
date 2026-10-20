'use strict';
// =====================================================================
// 2. LIEUX (OpenStreetMap via Overpass)
// =====================================================================
const GROUPS = [
  ['all', 'Tout', '#12201A'], ['terrain', 'Terrains', '#1B7F4C'], ['salle', 'Salles', '#0E4B38'], ['course', 'Course', '#B45309'],
  ['eau', 'Piscines', '#1F6FEB'], ['plein', 'Plein air', '#6D28D9'], ['shop', 'Magasins', '#BE185D'], ['club', 'Clubs', '#374151'], ['service', 'Services', '#0F766E']
];
const groupColor = g => (GROUPS.find(x => x[0] === g) || GROUPS[0])[2];
const SPORT_FR = { soccer: 'Football', football: 'Football', futsal: 'Futsal', basketball: 'Basket', tennis: 'Tennis', padel: 'Padel', badminton: 'Badminton', table_tennis: 'Tennis de table', rugby: 'Rugby', rugby_union: 'Rugby', rugby_league: 'Rugby à XIII', handball: 'Handball', volleyball: 'Volley', beachvolleyball: 'Beach-volley', boxing: 'Boxe', kickboxing: 'Kick-boxing', martial_arts: 'Arts martiaux', judo: 'Judo', karate: 'Karaté', taekwondo: 'Taekwondo', aikido: 'Aïkido', fitness: 'Fitness', calisthenics: 'Street workout', running: 'Course à pied', athletics: 'Athlétisme', swimming: 'Natation', climbing: 'Escalade', cycling: 'Vélo', bmx: 'BMX', skateboard: 'Skate', roller_skating: 'Roller', boules: 'Pétanque', golf: 'Golf', equestrian: 'Équitation', yoga: 'Yoga', pilates: 'Pilates', dance: 'Danse', gymnastics: 'Gymnastique', ice_skating: 'Patinage', ice_hockey: 'Hockey sur glace', archery: 'Tir à l\'arc', rowing: 'Aviron', canoe: 'Canoë-kayak', sailing: 'Voile', fencing: 'Escrime', multi: 'Multisport', squash: 'Squash', bowling: 'Bowling', '10pin': 'Bowling', table_soccer: 'Baby-foot', bowls: 'Boules', boules_lyonnaises: 'Boule lyonnaise', bocce: 'Pétanque', petanque: 'Pétanque', 'pétanque': 'Pétanque', padel_tennis: 'Padel', paddle_tennis: 'Padel', beach_volleyball: 'Beach-volley', beach_soccer: 'Beach soccer', field_hockey: 'Hockey sur gazon', roller_hockey: 'Roller hockey', netball: 'Netball', korfball: 'Korfball', shuffleboard: 'Palet', table_hockey: 'Air hockey', parkour: 'Parkour', free_flying: 'Parapente', kitesurfing: 'Kitesurf', windsurfing: 'Planche à voile', canoe_polo: 'Kayak-polo', water_ski: 'Ski nautique', diving: 'Plongeon', horse_racing: 'Courses hippiques', dog_racing: 'Courses de lévriers', model_aerodrome: 'Aéromodélisme', disc_golf: 'Disc golf', ultimate: 'Ultimate', frisbee: 'Frisbee', running_track: 'Course à pied', speed_skating: 'Patinage de vitesse', curling: 'Curling', sumo: 'Sumo', mma: 'MMA', krav_maga: 'Krav-maga', capoeira: 'Capoeira', gaelic_games: 'Sports gaéliques', pelota: 'Pelote basque', basque_pelota: 'Pelote basque', chess_board: 'Échecs', table_football: 'Baby-foot', fitness_station: 'Street workout', obstacle_course: 'Parcours d\'obstacles', skiing_nordic: 'Ski de fond', nordic_walking: 'Marche nordique', hiking: 'Randonnée', walking: 'Marche', mountain_biking: 'VTT', cycling_track: 'Cyclisme sur piste', motocross: 'Motocross', boxe: 'Boxe', 'sport_climbing': 'Escalade', shooting: 'Tir sportif', scuba_diving: 'Plongée', surfing: 'Surf', skiing: 'Ski', hockey: 'Hockey', baseball: 'Baseball', american_football: 'Football américain', cricket: 'Cricket', chess: 'Échecs', motor: 'Sports mécaniques', karting: 'Karting', paintball: 'Paintball', trampoline: 'Trampoline', billiards: 'Billard', darts: 'Fléchettes', orienteering: 'Course d\'orientation', triathlon: 'Triathlon', water_polo: 'Water-polo', wrestling: 'Lutte', crossfit: 'CrossFit', weightlifting: 'Haltérophilie' };
SPORT_FR.bowling = 'Bowling';
const KIND = {
  pitch: ['Terrain', 'terrain'], stadium: ['Stade', 'terrain'], sports_centre: ['Centre sportif', 'salle'], sports_hall: ['Gymnase', 'salle'],
  fitness_centre: ['Salle de sport', 'salle'], fitness_station: ['Aire de fitness en plein air', 'plein'], track: ['Piste', 'course'],
  swimming_pool: ['Piscine', 'eau'], water_park: ['Parc aquatique', 'eau'], ice_rink: ['Patinoire', 'salle'], golf_course: ['Golf', 'plein'],
  miniature_golf: ['Mini-golf', 'plein'], horse_riding: ['Centre équestre', 'plein'], dance: ['École de danse', 'salle'], bowling_alley: ['Bowling', 'salle'],
  dojo: ['Dojo', 'salle'], bicycle_rental: ['Location de vélos', 'service'], physiotherapist: ['Kinésithérapeute', 'service']
};
const SHOP = { sports: 'Magasin de sport', bicycle: 'Magasin de vélos', outdoor: 'Magasin outdoor', golf: 'Magasin de golf', fishing: 'Magasin de pêche', scuba_diving: 'Magasin de plongée', ski: 'Magasin de ski', surf: 'Surf shop' };

function overpassQuery(lat, lon, radius) {
  const a = `(around:${radius},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return `[out:json][timeout:40];(
nwr${a}[leisure~"^(pitch|stadium|sports_centre|sports_hall|fitness_centre|fitness_station|track|swimming_pool|water_park|ice_rink|golf_course|miniature_golf|horse_riding|dance|bowling_alley)$"];
nwr${a}[sport];
nwr${a}[shop~"^(sports|bicycle|outdoor|golf|fishing|scuba_diving|ski|surf)$"];
nwr${a}[club=sport];
nwr${a}[amenity=dojo];
nwr${a}[healthcare=physiotherapist];
);out center tags 600;`;
}
function parsePlace(el) {
  const t = el.tags || {}, lat = el.lat != null ? el.lat : (el.center || {}).lat, lon = el.lon != null ? el.lon : (el.center || {}).lon;
  if (lat == null) return null;
  if (t.access === 'private' || t.access === 'no') return null;          // piscines et terrains privés
  let kind = t.leisure || t.amenity || '', label, group;
  if (t.shop && SHOP[t.shop]) { label = SHOP[t.shop]; group = 'shop'; kind = 'shop'; }
  else if (KIND[t.leisure]) { [label, group] = KIND[t.leisure]; }
  else if (KIND[t.amenity]) { [label, group] = KIND[t.amenity]; }
  else if (t.healthcare === 'physiotherapist') { [label, group] = KIND.physiotherapist; kind = 'physiotherapist'; }
  else if (t.club === 'sport') { label = 'Club de sport'; group = 'club'; kind = 'club'; }
  else if (t.sport) { label = 'Lieu de pratique'; group = 'plein'; kind = 'sport'; }
  else return null;
  const sportKeys = (t.sport || '').split(';').map(s => s.trim()).filter(Boolean);
  const sports = [...new Set(sportKeys.map(s => SPORT_FR[s] || s.replace(/_/g, ' ')))];
  if (sportKeys.some(s => s === 'running' || s === 'athletics') && group === 'terrain') group = 'course';
  if (kind === 'pitch' && sports.length) label = 'Terrain de ' + sports[0].toLowerCase();
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return {
    id: (el.type === 'user' ? 'u' : el.type[0]) + el.id, osm: el.type + '/' + el.id, lat, lon, kind, group, label,
    name: t.name || label, named: !!t.name, sports, sportKeys,
    free: t.fee === 'no' ? true : (t.fee === 'yes' ? false : null),
    lit: t.lit === 'yes', indoor: t.indoor === 'yes' || t.covered === 'yes' || ['sports_hall', 'fitness_centre', 'dojo', 'bowling_alley', 'dance'].includes(kind),
    access: t.access || '', surface: t.surface || '', hours: t.opening_hours || '',
    website: t.website || t['contact:website'] || '', phone: t.phone || t['contact:phone'] || '',
    address: [street, t['addr:postcode'], t['addr:city']].filter(Boolean).join(', '),
    dist: S.pos ? haversine(S.pos, { lat, lon }) : null,
    dbId: el.dbId || null, userSpot: el.type === 'user',
    wheelchair: t.wheelchair === 'yes' || t.wheelchair === 'limited'
  };
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const CACHE_KEY = 'sportlocal.cache.v2';
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]') || []; } catch (e) { return []; } }
function writeCache(list) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* mémoire pleine : on s'en passe */ } }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function fetchOverpass(q) {
  // Les serveurs publics sont souvent saturés : on interroge les deux en même temps,
  // on garde la première réponse valable, et on réessaie jusqu'à 4 fois.
  for (let attempt = 0; attempt < 4; attempt++) {
    S.loadAttempt = attempt + 1; renderSheet();
    const ctls = OVERPASS.map(() => new AbortController());
    const timer = setTimeout(() => ctls.forEach(c => c.abort()), 50000);
    try {
      const j = await Promise.any(OVERPASS.map((url, i) => fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctls[i].signal })
        .then(async r => { if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (!d || !Array.isArray(d.elements)) throw new Error('réponse vide'); return d; })));
      clearTimeout(timer); ctls.forEach(c => c.abort());
      return j;
    } catch (e) { clearTimeout(timer); }
    await wait(2000 * (attempt + 1));
  }
  return null;
}
const HUB_KINDS = ['sports_centre', 'stadium', 'sports_hall', 'track', 'golf_course'];
function cleanPlaces(elements) {
  const seen = new Set();
  let ps = elements.map(parsePlace).filter(p => p && !seen.has(p.id) && seen.add(p.id));
  // Piscine sans nom, sans accès public ni tarif connu : presque toujours celle d'un hôtel ou d'une résidence.
  ps = ps.filter(p => !(p.kind === 'swimming_pool' && !p.named && !['yes', 'public', 'permissive'].includes(p.access) && p.free == null));
  // Un terrain sans nom prend le nom du complexe sportif où il se trouve.
  const hubs = ps.filter(p => p.named && HUB_KINDS.includes(p.kind));
  ps.forEach(p => {
    if (p.named) return;
    let best = null, bd = 160;
    hubs.forEach(h => {
      // seulement un complexe compatible : un terrain de foot ne prend pas le nom d'une piscine
      const fits = !h.sportKeys.length || h.sportKeys.includes('multi') || !p.sportKeys.length || p.sportKeys.some(k => h.sportKeys.includes(k));
      const d = haversine(p, h); if (fits && d < bd) { bd = d; best = h; }
    });
    if (best) p.name = p.label + ' · ' + best.name;
  });
  // Plusieurs terrains identiques côte à côte = une seule ligne.
  const out = [];
  ps.forEach(p => {
    if (!p.named) {
      const twin = out.find(o => !o.named && o.name === p.name && haversine(o, p) < 150);
      if (twin) { twin.count = (twin.count || 1) + 1; return; }
    }
    out.push(p);
  });
  return out;
}
function applyPlaces(places, center) {
  S.places = places.map(p => Object.assign({}, p, { dist: haversine(S.pos, p) })).sort((a, b) => a.dist - b.dist);
  S.fetchedAt = center;
  drawPlaces(); renderSheet();
}
async function loadPlaces() {
  if (!S.pos || S.loading) return;
  const center = { lat: S.pos.lat, lon: S.pos.lon }, radius = db.settings.radius;
  const cached = readCache().find(c => c.radius === radius && haversine(c, center) < 300 && Date.now() - c.at < 7 * 864e5);
  if (cached) {
    applyPlaces(cached.places, center);
    if (Date.now() - cached.at < 6 * 3600e3) return;          // assez récent : pas besoin de recharger
  }
  // Hors connexion : on affiche les derniers lieux enregistrés pour la zone, même anciens.
  if (navigator.onLine === false) {
    const any = readCache().filter(c => haversine(c, center) < 5000).sort((a, b) => b.at - a.at)[0];
    if (any) { applyPlaces(any.places, center); toast('Hors connexion : lieux enregistrés lors de votre dernière visite.'); }
    else { S.loadError = 'Hors connexion : aucun lieu enregistré pour cette zone. Reconnectez-vous pour charger la carte.'; renderSheet(); }
    return;
  }
  S.loading = true; S.loadError = ''; S.loadAttempt = 1; renderSheet();
  // 1) Lieux de la base de l'appli (importés + proposés par les membres).
  let rows = null;
  if (sb) {
    try { rows = await q(sb.rpc('places_near', { p_lat: center.lat, p_lng: center.lon, p_radius_m: radius })); }
    catch (e) { try { rows = await q(sb.rpc('osm_spots_near', { p_lat: center.lat, p_lng: center.lon, p_radius_m: radius })); } catch (e2) { rows = null; } }
  }
  const toEl = r => {
    if (r.source === 'user') return { type: 'user', id: r.id, lat: r.lat, lon: r.lng, tags: r.tags || {}, dbId: r.id };
    const ref = String(r.source_ref || '').split('/');
    return { type: ref[0] || 'node', id: ref[1] || r.id, lat: r.lat, lon: r.lng, tags: r.tags || {}, dbId: r.id };
  };
  const userEls = (rows || []).filter(r => r.source === 'user').map(toEl);
  const osmRows = (rows || []).filter(r => (r.source || 'osm') === 'osm');
  if (osmRows.length) {
    S.loading = false;
    const places = cleanPlaces(osmRows.map(toEl).concat(userEls));
    saveCache(center, radius, places);   // disponible ensuite hors connexion
    applyPlaces(places, center);
    return;
  }
  // 2) Sinon, recherche en direct sur OpenStreetMap (+ lieux proposés par les membres).
  const data = await fetchOverpass(overpassQuery(center.lat, center.lon, radius));
  S.loading = false;
  if (!data) {
    if (!S.places.length) S.loadError = 'Les serveurs de cartes sont saturés pour le moment. Réessayez dans une minute.';
    renderSheet(); return;
  }
  const places = cleanPlaces(data.elements.concat(userEls));
  saveCache(center, radius, places);
  applyPlaces(places, center);
}
// Garde les 3 dernières zones consultées sur l'appareil (utilisées aussi hors connexion).
function saveCache(center, radius, places) {
  const keep = readCache().filter(c => !(c.radius === radius && haversine(c, center) < 300)).slice(0, 2);
  writeCache([{ lat: center.lat, lon: center.lon, radius, at: Date.now(), places: places.map(p => Object.assign({}, p, { dist: null })) }].concat(keep));
}
window.addEventListener('online', () => { if (S.pos) loadPlaces(); });
function humanHours(h) {
  if (!h) return '';
  if (/^\s*24\/7\s*$/.test(h)) return 'Tous les jours, 24 h/24';
  const D = { Mo: 'lun', Tu: 'mar', We: 'mer', Th: 'jeu', Fr: 'ven', Sa: 'sam', Su: 'dim', PH: 'jours fériés', SH: 'vacances scolaires' };
  const M = { Jan: 'janv.', Feb: 'févr.', Mar: 'mars', Apr: 'avr.', May: 'mai', Jun: 'juin', Jul: 'juil.', Aug: 'août', Sep: 'sept.', Oct: 'oct.', Nov: 'nov.', Dec: 'déc.' };
  return h.split(/\s*;\s*/).filter(Boolean).map(part => part
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b/g, m => D[m])
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, m => M[m])
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (m, a, b) => (+a) + ' h' + (b === '00' ? '' : ' ' + b))
    .replace(/\s*-\s*/g, ' – ').replace(/\s*,\s*/g, ', ')
    .replace(/\b(off|closed)\b/g, 'fermé')
    .replace(/^./, c => c.toUpperCase())).join('\n');
}
const placeById = id => S.places.find(p => p.id === id);
const PRACTICE = new Set(['terrain', 'salle', 'course', 'eau', 'plein', 'club']);
const visiblePlaces = () => (S.group === 'all' ? S.places.filter(p => PRACTICE.has(p.group)) : S.places.filter(p => p.group === S.group)).filter(passFilters);
function placeMeta(p) {
  const bits = [p.named ? p.label : (p.sports.slice(0, 2).join(', ') || p.label)];
  if (p.named && p.sports.length) bits.push(p.sports.slice(0, 2).join(', '));
  if (p.count) bits.push(p.count + ' sur place');
  const o = openLabel(p); if (o) bits.push(o.toLowerCase());
  if (p.dist != null) bits.push(fmtDist(p.dist));
  return bits.join(' · ');
}
const placeItem = (p, extra) => `<button class="item" data-act="place" data-id="${p.id}"><span class="dot" style="background:${groupColor(p.group)}"></span><span class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(placeMeta(p))}</div>${extra ? `<div class="s" style="color:var(--link);font-weight:600">${esc(extra)}</div>` : ''}</span>${ico('next')}</button>`;
