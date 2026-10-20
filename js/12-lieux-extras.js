'use strict';
// =====================================================================
// 12. LOT 1 : ouvert maintenant, filtres, météo, partage, avis, photos,
//     lieux proposés, favoris sur le compte, thème, installation
// =====================================================================

// ---------- ouvert maintenant (horaires OpenStreetMap courants) ----------
const OH_DAYS = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const OH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Renvoie true (ouvert), false (fermé) ou null (horaires absents ou trop complexes).
function openState(h, now) {
  if (!h) return null;
  now = now || new Date();
  h = h.trim();
  if (/^24\/7$/.test(h)) return true;
  const today = now.getDay(), minutes = now.getHours() * 60 + now.getMinutes(), month = now.getMonth();
  let state = null, parsedAny = false;
  for (let rule of h.split(/\s*;\s*/)) {
    rule = rule.trim();
    if (!rule) continue;
    const mm = rule.match(/^([A-Z][a-z]{2})(?:\s*-\s*([A-Z][a-z]{2}))?\s+(.*)$/);
    if (mm && OH_MONTHS.includes(mm[1]) && (!mm[2] || OH_MONTHS.includes(mm[2]))) {
      const a = OH_MONTHS.indexOf(mm[1]), b = mm[2] ? OH_MONTHS.indexOf(mm[2]) : a;
      const inside = a <= b ? month >= a && month <= b : month >= a || month <= b;
      parsedAny = true;
      if (!inside) continue;
      rule = mm[3];
    }
    const dm = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su|PH))*)?\s*(.*)$/);
    if (!dm) return null;
    let days = null;
    if (dm[1]) {
      days = new Set();
      dm[1].split(/\s*,\s*/).forEach(part => {
        const [x, y] = part.split(/\s*-\s*/);
        if (!(x in OH_DAYS)) return;
        if (!y) { days.add(OH_DAYS[x]); return; }
        if (!(y in OH_DAYS)) return;
        for (let d = OH_DAYS[x], n = 0; n < 7; d = (d + 1) % 7, n++) { days.add(d); if (d === OH_DAYS[y]) break; }
      });
      if (!days.size) continue;                       // règle des seuls jours fériés : ignorée
    }
    const rest = dm[2].trim();
    const applies = !days || days.has(today);
    if (/^(off|closed)$/i.test(rest)) { parsedAny = true; if (applies) state = false; continue; }
    if (/^open$/i.test(rest)) { parsedAny = true; if (applies) state = true; continue; }
    const spans = rest.split(/\s*,\s*/).map(s => s.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/));
    if (!rest || spans.some(s => !s)) return null;    // « sunrise-sunset », semaines… : on ne devine pas
    parsedAny = true;
    if (!applies) continue;
    state = spans.some(s => {
      const from = +s[1] * 60 + +s[2], to = +s[3] * 60 + +s[4];
      return to > from ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    });
  }
  if (!parsedAny) return null;
  return state === null ? false : state;
}
const openLabel = p => { const o = openState(p.hours); return o === true ? 'Ouvert maintenant' : o === false ? 'Fermé' : ''; };

// ---------- traductions des informations OpenStreetMap ----------
const SURFACE_FR = { asphalt: 'Bitume', concrete: 'Béton', paved: 'Revêtu', unpaved: 'Non revêtu', grass: 'Gazon', artificial_turf: 'Gazon synthétique', clay: 'Terre battue', sand: 'Sable', tartan: 'Tartan (piste)', wood: 'Parquet', acrylic: 'Résine', decoturf: 'Résine', rubber: 'Sol souple', gravel: 'Gravier', fine_gravel: 'Gravillons', compacted: 'Stabilisé', dirt: 'Terre', ground: 'Terre', earth: 'Terre', paving_stones: 'Pavés', sett: 'Pavés', metal: 'Métal', carpet: 'Moquette', tiles: 'Carrelage', water: 'Eau', ice: 'Glace', synthetic: 'Synthétique', hard: 'Dur', grass_paver: 'Dalles gazon' };
const surfaceFr = s => s ? s.split(';').map(x => SURFACE_FR[x.trim()] || x.trim().replace(/_/g, ' ')).join(', ') : '';

// ---------- filtres ----------
S.filters = { open: false, free: false, indoor: false, lit: false, wheel: false };
const FILTERS = [['open', 'Ouvert maintenant'], ['free', 'Gratuit'], ['indoor', 'Couvert'], ['lit', 'Éclairé'], ['wheel', 'Accessible en fauteuil']];
const activeFilters = () => FILTERS.filter(f => S.filters[f[0]]).length;
function passFilters(p) {
  const f = S.filters;
  if (f.open && openState(p.hours) !== true) return false;
  if (f.free && !(p.free === true || (p.free == null && ['pitch', 'fitness_station', 'track'].includes(p.kind) && p.access !== 'customers'))) return false;
  if (f.indoor && !p.indoor) return false;
  if (f.lit && !p.lit) return false;
  if (f.wheel && !p.wheelchair) return false;
  return true;
}
function pageFilters() {
  return {
    title: 'Filtres',
    body: `<div class="pad">
      <div class="label">Afficher seulement les lieux</div>
      <div class="chips wrap">${FILTERS.map(f => `<button class="chip${S.filters[f[0]] ? ' on' : ''}" data-act="filter" data-id="${f[0]}" aria-pressed="${!!S.filters[f[0]]}">${f[1]}</button>`).join('')}</div>
      <div class="note">« Ouvert maintenant » et « Accessible en fauteuil » ne retiennent que les lieux dont ces informations sont connues.</div>
      <div class="label">Rayon de recherche</div>
      <div class="chips wrap">${[1000, 2000, 5000, 10000].map(r => `<button class="chip${db.settings.radius === r ? ' on' : ''}" data-act="radius" data-id="${r}">${fmtDist(r)}</button>`).join('')}</div>
      <div class="row"><button class="btn alt" data-act="filters-clear">Tout effacer</button><button class="btn" data-act="back">Voir ${visiblePlaces().length} lieux</button></div>
    </div>`
  };
}

// ---------- météo (Open-Meteo, sans clé) ----------
const WX = { 0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant', 51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine forte', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante', 61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante', 71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grésil', 80: 'Averses', 81: 'Averses', 82: 'Fortes averses', 85: 'Averses de neige', 86: 'Averses de neige', 95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec grêle' };
const wxCache = {};
async function weather(lat, lon) {
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  if (wxCache[key] && Date.now() - wxCache[key].at < 15 * 60000) return wxCache[key].data;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=7&timezone=auto`);
  if (!r.ok) throw new Error('météo indisponible');
  const data = await r.json();
  wxCache[key] = { at: Date.now(), data };
  return data;
}
function wxNowText(w) {
  const c = w && w.current; if (!c) return '';
  return `${Math.round(c.temperature_2m)} °C · ${WX[c.weather_code] || 'Météo inconnue'} · vent ${Math.round(c.wind_speed_10m)} km/h`;
}
function wxAtText(w, iso) {
  const h = w && w.hourly; if (!h) return '';
  const d = new Date(iso), pad = n => String(n).padStart(2, '0');
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  const i = h.time.indexOf(key);
  if (i < 0) return '';
  return `${Math.round(h.temperature_2m[i])} °C · ${WX[h.weather_code[i]] || ''} · ${h.precipitation_probability[i] ?? 0} % de risque de pluie`;
}

// ---------- partage par lien ----------
const placeHash = p => 'lieu/' + (p.userSpot ? 'user/' + p.dbId : p.osm) + '@' + p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
async function shareLink(title, text, hash) {
  const url = SITE_URL + '#' + hash;
  try { if (navigator.share) { await navigator.share({ title, text, url }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('Lien copié : collez-le dans un message'); }
  catch (e) { openPage('info', { title: 'Lien à partager', text: url }); }
}
function pageInfo(a) { return { title: a.title, body: `<div class="pad"><div class="card"><div class="hours" style="user-select:all">${esc(a.text)}</div></div></div>` }; }
async function openFromHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return;
  history.replaceState(null, '', location.pathname + location.search);
  let m = h.match(/^session\/([0-9a-f-]{36})$/);
  if (m) { openPage('event', { id: m[1] }); return; }
  m = h.match(/^groupe\/([0-9a-f-]{36})$/);
  if (m) { openPage('group', { id: m[1] }); return; }
  m = h.match(/^lieu\/(node|way|relation|user)\/([0-9a-f-]+)@(-?[\d.]+),(-?[\d.]+)$/);
  if (!m) return;
  const lat = +m[3], lon = +m[4];
  map.setView([lat, lon], 17);
  let el = null;
  try {
    if (m[1] === 'user') {
      const row = await q(sb.from('spots').select('id,osm_tags,location').eq('id', m[2]).single());
      el = { type: 'user', id: row.id, lat, lon, tags: row.osm_tags || {}, dbId: row.id };
    } else {
      const j = await fetchOverpass(`[out:json][timeout:25];${m[1]}(${m[2]});out center tags;`);
      el = j && j.elements && j.elements[0];
    }
  } catch (e) { /* lien invalide ou lieu supprimé */ }
  const p = el && parsePlace(el);
  if (!p) { toast('Ce lieu est introuvable.'); return; }
  if (!placeById(p.id)) { p.dist = S.pos ? haversine(S.pos, p) : null; S.places.push(p); }
  openPage('place', { id: p.id });
}

// ---------- photos (réduites avant envoi) ----------
async function shrinkImage(file, max) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('image illisible')), 'image/jpeg', 0.85));
}
const publicUrl = (bucket, path) => sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
function avatarHtml(name, url, big) {
  const cls = 'avatar' + (big ? ' big' : '');
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" style="object-fit:cover">` : `<span class="${cls}">${initials(name)}</span>`;
}
async function uploadAvatar(file) {
  if (!S.user) return;
  toast('Envoi de la photo…');
  const ok = await act(async () => {
    const blob = await shrinkImage(file, 400);
    const path = `${S.user.id}/avatar-${Date.now()}.jpg`;
    const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    await q(sb.from('profiles').update({ avatar_url: publicUrl('avatars', path) }).eq('id', S.user.id));
    await loadMe(); return true;
  });
  if (ok) { toast('Photo de profil mise à jour'); renderPage(); refreshTab(); }
}

// ---------- fiche en base : avis et photos ----------
const spotRef = p => p.userSpot ? p.dbId : p.osm;
async function loadSpot(p) {
  const rows = await q(sb.rpc('spot_summary', { p_ref: spotRef(p) }));
  const sum = rows && rows[0];
  if (!sum) return { spotId: null, avg: null, count: 0, reviews: [], photos: [] };
  p.dbId = sum.spot_id;
  const [reviews, photos] = await Promise.all([
    q(sb.rpc('spot_reviews_list', { p_spot: sum.spot_id })),
    q(sb.from('spot_photos').select('id,storage_path,uploaded_by').eq('spot_id', sum.spot_id).order('created_at', { ascending: false }).limit(24))
  ]);
  return { spotId: sum.spot_id, avg: sum.avg_rating, count: sum.reviews_count, reviews, photos };
}
async function ensureSpot(p) {
  if (p.dbId) return p.dbId;
  p.dbId = await q(sb.rpc('ensure_osm_spot', { p_ref: p.osm, p_name: p.name, p_lat: p.lat, p_lng: p.lon }));
  return p.dbId;
}
const stars = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
function spotSection(p, a) {
  if (!sb) return '';
  const sp = need(a, 'spot', () => loadSpot(p));
  if (!sp) return '<h3>Avis et photos</h3><div class="note">Chargement…</div>';
  if (sp.error) return '<h3>Avis et photos</h3><div class="note">Avis et photos indisponibles pour le moment.</div>';
  const mine = sp.reviews.find(r => r.is_mine);
  const photos = sp.photos.length ? `<div class="photos">${sp.photos.map(ph => `<a href="${esc(publicUrl('spot-photos', ph.storage_path))}" target="_blank" rel="noopener"><img src="${esc(publicUrl('spot-photos', ph.storage_path))}" alt="Photo de ${esc(p.name)}" loading="lazy"></a>`).join('')}</div>` : '<div class="note">Pas encore de photo.</div>';
  const upload = S.user ? `<label class="btn alt small" style="cursor:pointer">Ajouter une photo<input type="file" accept="image/*" data-upload="spot" data-id="${p.id}" hidden></label>` : '';
  const reviews = sp.reviews.length ? sp.reviews.slice(0, 20).map(r => `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.author_name || 'Membre')}</b><span aria-label="${r.rating} sur 5" style="color:var(--link);letter-spacing:1px">${stars(r.rating)}</span></div>${r.comment ? `<div class="hours">${esc(r.comment)}</div>` : ''}<div class="s">${new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${r.is_mine ? ` · <button class="linkbtn" data-act="review-del" data-id="${r.id}">supprimer mon avis</button>` : ''}</div></div>`).join('') : '<div class="note">Aucun avis pour l\'instant. Soyez le premier.</div>';
  return `<h3>Avis${sp.count ? ` · ${String(sp.avg).replace('.', ',')} / 5 (${sp.count})` : ''}</h3>
    ${reviews}
    <button class="btn alt small" data-act="${S.user ? 'review' : 'auth'}" data-id="${S.user ? p.id : 'signup'}">${mine ? 'Modifier mon avis' : 'Donner mon avis'}</button>
    <h3>Photos</h3>${photos}${upload}`;
}
function pageReview(a) {
  const p = placeById(a.placeId);
  if (!p) return { title: 'Avis', body: '<div class="pad"><div class="note">Lieu introuvable.</div></div>' };
  const top = S.stack.find(s => s.type === 'place' && s.args.id === a.placeId);
  const mine = top && top.args.spot && top.args.spot.reviews ? top.args.spot.reviews.find(r => r.is_mine) : null;
  if (a.rating == null) a.rating = mine ? mine.rating : 5;
  return {
    title: 'Mon avis',
    body: `<form class="pad" data-form="review" data-id="${p.id}" data-mine="${mine ? mine.id : ''}">
      <div><div class="label">Votre avis sur</div><div class="t">${esc(p.name)}</div></div>
      <div class="field">Note : ${a.rating} / 5<div class="row">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="chip${n <= a.rating ? ' on' : ''}" data-act="review-star" data-id="${n}" aria-label="${n} sur 5">${n} ★</button>`).join('')}</div></div>
      <label class="field">Commentaire (facultatif)<textarea id="rv-comment" name="comment" rows="4" maxlength="1000" placeholder="État du terrain, affluence, conseils…">${esc(mine ? mine.comment || '' : '')}</textarea></label>
      <button class="btn" type="submit">Publier mon avis</button></form>`
  };
}
async function submitReview(f) {
  const p = placeById(f.dataset.id), a = topArgs();
  const comment = f.elements.comment.value.trim() || null;
  const ok = await act(async () => {
    const spotId = await ensureSpot(p);
    if (f.dataset.mine) await q(sb.from('spot_reviews').update({ rating: a.rating, comment }).eq('id', f.dataset.mine));
    else await q(sb.from('spot_reviews').insert({ spot_id: spotId, rating: a.rating, comment }));
    return true;
  });
  if (ok) { toast('Avis publié, merci'); S.stack.pop(); reloadTop(); }
}
async function uploadSpotPhoto(file, placeId) {
  const p = placeById(placeId); if (!p || !S.user) return;
  toast('Envoi de la photo…');
  const ok = await act(async () => {
    const spotId = await ensureSpot(p);
    const blob = await shrinkImage(file, 1280);
    const path = `${S.user.id}/${spotId}-${Date.now()}.jpg`;
    const up = await sb.storage.from('spot-photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    await q(sb.from('spot_photos').insert({ spot_id: spotId, storage_path: path }));
    return true;
  });
  if (ok) { toast('Photo ajoutée, merci'); reloadTop(); }
}

// ---------- proposer un lieu manquant ----------
const SLUG_OSM = { football: 'soccer', basket: 'basketball', tennis: 'tennis', padel: 'padel', rugby: 'rugby', handball: 'handball', volley: 'volleyball', badminton: 'badminton', running: 'running', athletisme: 'athletics', natation: 'swimming', velo: 'cycling', musculation: 'fitness', street_workout: 'calisthenics', boxe: 'boxing', arts_martiaux: 'martial_arts', escalade: 'climbing', yoga: 'yoga', danse: 'dance', skate: 'skateboard', golf: 'golf', equitation: 'equestrian' };
const PLACE_TYPES = [['pitch', 'Terrain'], ['fitness_station', 'Aire de fitness / street workout'], ['sports_hall', 'Gymnase'], ['fitness_centre', 'Salle de sport'], ['track', 'Piste'], ['swimming_pool', 'Piscine'], ['', 'Autre lieu de pratique']];
function categoryOf(leisure, sport) {
  if (sport === 'soccer') return 'stade_football';
  if (sport === 'rugby') return 'stade_rugby';
  if (sport === 'tennis') return 'court_tennis';
  if (sport === 'boxing') return 'salle_boxe';
  if (leisure === 'fitness_station' || sport === 'calisthenics') return 'street_workout';
  if (leisure === 'track' || sport === 'athletics') return 'piste_athletisme';
  if (leisure === 'fitness_centre' || sport === 'fitness') return 'salle_sport';
  return 'autre';
}
function pagePropose(a) {
  if (!S.user) return { title: 'Proposer un lieu', body: `<div class="pad">${loginCard('Connectez-vous pour ajouter un lieu manquant.')}</div>` };
  if (!a.at) { const c = map.getCenter(); a.at = { lat: c.lat, lon: c.lng }; }
  return {
    title: 'Proposer un lieu',
    body: `<form class="pad" data-form="propose">
      <div class="banner">Le lieu sera placé au centre de la carte (${a.at.lat.toFixed(5)}, ${a.at.lon.toFixed(5)}). Pour le déplacer, revenez en arrière, centrez la carte sur le lieu, puis rouvrez ce formulaire.</div>
      <label class="field">Nom du lieu<input id="pp-name" name="name" type="text" required minlength="2" maxlength="120" placeholder="City stade du parc"></label>
      <label class="field">Type<select id="pp-type" name="type">${PLACE_TYPES.map(t => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select></label>
      <label class="field">Sport principal<select id="pp-sport" name="sport"><option value="">Plusieurs ou non précisé</option>${S.sports.map(s => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="free"> Gratuit</label>
      <label class="check"><input type="checkbox" name="lit"> Éclairé le soir</label>
      <label class="check"><input type="checkbox" name="wheel"> Accessible en fauteuil</label>
      <button class="btn" type="submit">Ajouter ce lieu</button>
      <div class="note">Votre proposition apparaît aussitôt sur la carte, avec la mention « Proposé par un membre ».</div></form>`
  };
}
async function submitPropose(f) {
  const a = topArgs(), name = f.elements.name.value.trim();
  const leisure = f.elements.type.value, sport = SLUG_OSM[f.elements.sport.value] || '';
  const tags = { name };
  if (leisure) tags.leisure = leisure; else tags.sport = sport || 'multi';
  if (sport) tags.sport = sport;
  if (f.elements.free.checked) tags.fee = 'no';
  if (f.elements.lit.checked) tags.lit = 'yes';
  if (f.elements.wheel.checked) tags.wheelchair = 'yes';
  const ok = await act(() => q(sb.from('spots').insert({ name, category: categoryOf(leisure, sport), location: point(a.at), osm_tags: tags, is_free: f.elements.free.checked || null, has_lighting: f.elements.lit.checked || null })));
  if (ok === undefined) return;
  toast('Lieu ajouté, merci !');
  writeCache([]); S.fetchedAt = null; back(); loadPlaces();
}

// ---------- favoris (sur le compte quand on est connecté) ----------
S.accFavs = null;
const favs = () => (S.user && S.accFavs) ? S.accFavs : db.favs;
async function loadAccountFavs() {
  if (!S.user) { S.accFavs = null; return; }
  const rows = await act(() => q(sb.from('favorites').select('place_ref,name,lat,lng')));
  if (!rows) return;
  S.accFavs = {};
  rows.forEach(r => { S.accFavs[r.place_ref] = { name: r.name, lat: r.lat, lon: r.lng }; });
  // Les favoris enregistrés sur l'appareil avant la connexion rejoignent le compte.
  const local = Object.keys(db.favs).filter(id => db.favs[id] && db.favs[id].lat != null && !S.accFavs[id]);
  if (local.length) {
    const ins = await act(() => q(sb.from('favorites').insert(local.map(id => ({ place_ref: id, name: db.favs[id].name.slice(0, 160), lat: db.favs[id].lat, lng: db.favs[id].lon })))));
    if (ins !== undefined) { local.forEach(id => { S.accFavs[id] = db.favs[id]; }); db.favs = {}; save(); }
  }
  if (S.tab === 'profile') renderProfile();
}
async function toggleFav(id) {
  const p = placeById(id); if (!p) return;
  const f = favs(), on = !!f[id];
  if (S.user && S.accFavs) {
    const ok = await act(() => on ? q(sb.from('favorites').delete().eq('place_ref', id)) : q(sb.from('favorites').insert({ place_ref: id, name: p.name.slice(0, 160), lat: p.lat, lng: p.lon })));
    if (ok === undefined) return;
    if (on) delete S.accFavs[id]; else S.accFavs[id] = { name: p.name, lat: p.lat, lon: p.lon };
  } else {
    if (on) delete db.favs[id]; else db.favs[id] = { name: p.name, lat: p.lat, lon: p.lon };
    save();
  }
  renderPage(); toast(on ? 'Retiré des favoris' : 'Ajouté aux favoris');
}

// ---------- thème clair / sombre ----------
function applyTheme() {
  const t = db.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}

// ---------- appli installable ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; if (S.tab === 'profile') renderProfile(); });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installCard() {
  if (isStandalone()) return '';
  if (installEvent) return '<button class="btn alt" data-act="install">Installer l\'appli sur cet appareil</button>';
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return '<div class="card"><div class="label">Installer l\'appli</div><div class="s">Dans Safari, touchez le bouton Partager, puis « Sur l\'écran d\'accueil ».</div></div>';
  return '';
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Pages définies dans ce fichier (la table PAGES est créée dans 11-navigation.js)
Object.assign(PAGES, { filters: pageFilters, review: pageReview, propose: pagePropose, info: pageInfo });
