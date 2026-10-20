'use strict';
// =====================================================================
// 1. POSITION
// =====================================================================
const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0E4B38"/><path d="M32 10c-9.4 0-17 7.4-17 16.6C15 39 32 54 32 54s17-15 17-27.4C49 17.4 41.4 10 32 10z" fill="#C8F03C"/><circle cx="32" cy="27" r="7" fill="#0E4B38"/></svg>';
function showGate(msg) {
  const g = $('#gate');
  g.hidden = false;
  g.innerHTML = `<div class="welcome" role="dialog" aria-label="Bienvenue sur Sport local">
    <div class="brand">${LOGO}<span>Sport local</span></div>
    <h1>Trouvez où faire du sport, et avec qui.</h1>
    <ul class="perks"><li>Terrains, salles, piscines, pistes et magasins autour de vous</li><li>Des sessions pour jouer ou courir à plusieurs</li><li>Des parcours de course générés depuis votre position</li></ul>
    ${msg ? `<div class="banner">${esc(msg)}</div>` : ''}
    <button class="btn lime" data-act="geo-allow">Me localiser</button>
    <form data-form="geo-city" class="send"><input id="gate-city" name="city" type="text" placeholder="Ou tapez une ville : Lyon, Lille…" aria-label="Ville" autocomplete="off"><button type="submit" aria-label="Utiliser cette ville">${ico('next')}</button></form>
    <button class="btn alt small" data-act="explore">Explorer sans me localiser</button>
    <div class="note">Votre position sert seulement à chercher autour de vous. Elle n'est ni enregistrée ni partagée.</div>
  </div>`;
}
let watchId = null;
function startGeo() {
  if (!navigator.geolocation) { showGate('Ce navigateur ne donne pas accès à la position. Indiquez une ville.'); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  let first = true;
  watchId = navigator.geolocation.watchPosition(p => {
    db.settings.geoOk = true; db.settings.manual = null; save();
    $('#gate').hidden = true;
    setPosition(p.coords.latitude, p.coords.longitude, 'gps', p.coords.accuracy, first);
    first = false;
  }, err => {
    if (!S.pos) {
      db.settings.geoOk = false; save();
      showGate(err.code === 1 ? 'Autorisation refusée. Autorisez la position dans les réglages du navigateur, ou indiquez une ville.' : 'Position introuvable pour le moment. Réessayez ou indiquez une ville.');
    }
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
}
async function useCity(name) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&q=' + encodeURIComponent(name));
    const j = await r.json();
    if (!j.length) { showGate('Ville introuvable : « ' + name + ' ». Vérifiez l\'orthographe.'); return; }
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    db.settings.manual = { lat: +j[0].lat, lon: +j[0].lon }; save();
    $('#gate').hidden = true;
    setPosition(+j[0].lat, +j[0].lon, 'ville', null, true);
  } catch (e) { showGate('Recherche de la ville impossible. Vérifiez votre connexion.'); }
}
function setPosition(lat, lon, source, acc, recenter) {
  S.pos = { lat, lon }; S.posSource = source; S.acc = acc;
  S.places.forEach(p => { p.dist = haversine(S.pos, p); });
  S.places.sort((a, b) => a.dist - b.dist);
  drawMe();
  if (recenter) { map.setView([lat, lon], 15); if (map2) map2.setView([lat, lon], 14); }
  if (!S.fetchedAt || haversine(S.fetchedAt, S.pos) > 300) { loadPlaces(); reverseCity(); }
  else renderSheet();
}
async function reverseCity() {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=fr&lat=${S.pos.lat}&lon=${S.pos.lon}`);
    const a = (await r.json()).address || {};
    S.city = a.city || a.town || a.village || a.municipality || a.county || '';
    S.country = (a.country_code || '').toUpperCase();
    renderSheet();
  } catch (e) { /* le nom de la ville est un confort, pas une nécessité */ }
}
