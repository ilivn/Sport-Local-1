// =====================================================================
// Import des lieux de sport d'OpenStreetMap dans la base Supabase.
//
// Lancé automatiquement par GitHub (voir .github/workflows/import-lieux.yml).
// Variables nécessaires :
//   SUPABASE_URL               adresse du projet (https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY  clé secrète (sb_secret_… ou service_role) — dans les Secrets GitHub
//   ZONES                      zones à importer, séparées par des « ; » (ex. « Lyon; Villeurbanne »)
// Données © contributeurs OpenStreetMap, licence ODbL.
// =====================================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ZONES = (process.env.ZONES || '').split(/[;\n]/).map(z => z.trim()).filter(Boolean);
const OVERPASS = (process.env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(',');
const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SportLocal-import/1.0 (projet etudiant BTS SIO)';
const TILE_LAT = 0.05, TILE_LON = 0.07, MAX_TILES = 600, BATCH = 500;

const wait = ms => new Promise(r => setTimeout(r, ms));
function fail(msg) { console.error('ERREUR : ' + msg); process.exit(1); }

if (!SUPABASE_URL || !KEY) fail('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis dans les Secrets du dépôt.');
if (!ZONES.length) fail('Aucune zone à importer. Indiquez-en une au lancement, ou créez la variable IMPORT_ZONES (ex. « Lyon; Villeurbanne »).');

// ---------- 1. Délimiter chaque zone ----------
async function geocode(zone) {
  const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(zone)}`, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr' } });
  if (!r.ok) throw new Error(`recherche de « ${zone} » : HTTP ${r.status}`);
  const j = await r.json();
  if (!j.length) throw new Error(`zone introuvable : « ${zone} »`);
  const [s, n, w, e] = j[0].boundingbox.map(Number);
  return { name: j[0].display_name, s, n, w, e };
}
function tiles(b) {
  const out = [];
  for (let lat = b.s; lat < b.n; lat += TILE_LAT) {
    for (let lon = b.w; lon < b.e; lon += TILE_LON) {
      out.push([lat, lon, Math.min(lat + TILE_LAT, b.n), Math.min(lon + TILE_LON, b.e)]);
    }
  }
  return out;
}

// ---------- 2. Interroger OpenStreetMap, tuile par tuile ----------
// Mêmes critères que l'appli : tout ce qui touche au sport.
function query([s, w, n, e]) {
  const bb = `(${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)})`;
  return `[out:json][timeout:90];(
nwr${bb}[leisure~"^(pitch|stadium|sports_centre|sports_hall|fitness_centre|fitness_station|track|swimming_pool|water_park|ice_rink|golf_course|miniature_golf|horse_riding|dance|bowling_alley)$"];
nwr${bb}[sport];
nwr${bb}[shop~"^(sports|bicycle|outdoor|golf|fishing|scuba_diving|ski|surf)$"];
nwr${bb}[club=sport];
nwr${bb}[amenity=dojo];
nwr${bb}[healthcare=physiotherapist];
);out center tags;`;
}
async function overpass(q) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT }, body: 'data=' + encodeURIComponent(q) });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.elements)) return j.elements; }
      console.log(`  serveur ${new URL(url).host} : HTTP ${r.status}, nouvel essai`);
    } catch (e) { console.log(`  serveur ${new URL(url).host} : ${e.message}, nouvel essai`); }
    await wait(5000 * (attempt + 1));
  }
  throw new Error('les serveurs OpenStreetMap ne répondent pas, réessayez plus tard');
}

// ---------- 3. Transformer en lignes de la table spots ----------
const LABEL = { pitch: 'Terrain', stadium: 'Stade', sports_centre: 'Centre sportif', sports_hall: 'Gymnase', fitness_centre: 'Salle de sport', fitness_station: 'Aire de fitness', track: 'Piste', swimming_pool: 'Piscine', water_park: 'Parc aquatique', ice_rink: 'Patinoire', golf_course: 'Golf', miniature_golf: 'Mini-golf', horse_riding: 'Centre équestre', dance: 'École de danse', bowling_alley: 'Bowling' };
function category(t, sports) {
  if (sports.includes('soccer')) return 'stade_football';
  if (sports.some(s => s.startsWith('rugby'))) return 'stade_rugby';
  if (sports.includes('tennis')) return 'court_tennis';
  if (sports.includes('boxing') || sports.includes('kickboxing')) return 'salle_boxe';
  if (t.leisure === 'fitness_station' || sports.includes('calisthenics')) return 'street_workout';
  if (t.leisure === 'track' || sports.includes('athletics')) return 'piste_athletisme';
  if (t.leisure === 'fitness_centre' || sports.includes('fitness')) return 'salle_sport';
  return 'autre';
}
function toRow(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  if (t.access === 'private' || t.access === 'no') return null;
  const sports = (t.sport || '').split(';').map(s => s.trim()).filter(Boolean);
  let name = (t.name || LABEL[t.leisure] || (t.shop ? 'Magasin de sport' : t.healthcare ? 'Kinésithérapeute' : t.club ? 'Club de sport' : t.amenity === 'dojo' ? 'Dojo' : 'Lieu sportif')).trim().slice(0, 120);
  if (name.length < 2) name = 'Lieu sportif';
  return {
    source: 'osm',
    source_ref: `${el.type}/${el.id}`,
    name,
    category: category(t, sports),
    location: `SRID=4326;POINT(${lon} ${lat})`,
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
    city: t['addr:city'] || null,
    access: t.fee === 'yes' ? 'payant' : t.access === 'customers' || t.access === 'members' ? 'adherents' : 'libre',
    is_free: t.fee === 'no' ? true : t.fee === 'yes' ? false : null,
    has_lighting: t.lit === 'yes' ? true : t.lit === 'no' ? false : null,
    opening_hours: t.opening_hours ?? null,
    osm_tags: t
  };
}

// ---------- 4. Enregistrer dans Supabase (création ou mise à jour) ----------
async function upsert(rows) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;   // anciennes clés « service_role »
  for (let i = 0; i < rows.length; i += BATCH) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/spots?on_conflict=source,source_ref`, { method: 'POST', headers, body: JSON.stringify(rows.slice(i, i + BATCH)) });
    if (!r.ok) throw new Error(`enregistrement dans Supabase : HTTP ${r.status} ${await r.text()}`);
    console.log(`  ${Math.min(i + BATCH, rows.length)} / ${rows.length} lieux enregistrés`);
  }
}

// ---------- Programme ----------
let total = 0;
for (const zone of ZONES) {
  console.log(`\n=== ${zone} ===`);
  const box = await geocode(zone);
  const list = tiles(box);
  console.log(`Zone trouvée : ${box.name}`);
  console.log(`${list.length} carré(s) à interroger`);
  if (list.length > MAX_TILES) fail(`« ${zone} » est trop grande (${list.length} carrés). Découpez-la en villes ou en départements.`);
  const found = new Map();
  for (const [k, tile] of list.entries()) {
    const els = await overpass(query(tile));
    els.forEach(el => found.set(`${el.type}/${el.id}`, el));
    console.log(`  carré ${k + 1}/${list.length} : ${els.length} éléments`);
    await wait(1500);   // politesse envers les serveurs publics
  }
  const rows = [...found.values()].map(toRow).filter(Boolean);
  console.log(`${rows.length} lieux à enregistrer`);
  await upsert(rows);
  total += rows.length;
}
console.log(`\nTerminé : ${total} lieux à jour dans la base.`);
