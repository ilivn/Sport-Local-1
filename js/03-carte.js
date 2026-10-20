'use strict';
// =====================================================================
// 3. CARTE
// =====================================================================
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
let map, map2, meMarker, me2, placeLayer, routeLayer, drawLayer;
function initMaps() {
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([46.6, 2.4], 6);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(map);
  placeLayer = (L.markerClusterGroup ? L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 48, disableClusteringAtZoom: 18, spiderfyOnMaxZoom: true,
    iconCreateFunction: c => L.divIcon({ html: '<div class="cluster">' + c.getChildCount() + '</div>', className: '', iconSize: [40, 40] })
  }) : L.layerGroup()).addTo(map);
  map.attributionControl.setPosition('topright');
}
function initMap2() {
  if (map2) { map2.invalidateSize(); return; }
  map2 = L.map('map2', { zoomControl: false }).setView(S.pos ? [S.pos.lat, S.pos.lon] : [46.6, 2.4], S.pos ? 14 : 6);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(map2);
  map2.attributionControl.setPosition('topright');
  routeLayer = L.layerGroup().addTo(map2); drawLayer = L.layerGroup().addTo(map2); trackLayer = L.layerGroup().addTo(map2);
  map2.on('click', e => { if (S.routeMode === 'draw') { S.drawPts.push({ lat: e.latlng.lat, lon: e.latlng.lng }); computeDrawn(); } });
  drawMe();
  if (S.track) drawTrack(true);
}
const meIcon = () => L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
function drawMe() {
  if (!S.pos) return;
  const ll = [S.pos.lat, S.pos.lon];
  if (map) { if (meMarker) meMarker.setLatLng(ll); else meMarker = L.marker(ll, { icon: meIcon(), zIndexOffset: 1000, interactive: false }).addTo(map); }
  if (map2) { if (me2) me2.setLatLng(ll); else me2 = L.marker(ll, { icon: meIcon(), zIndexOffset: 1000, interactive: false }).addTo(map2); }
}
const pinIcons = {};
const pinIcon = color => pinIcons[color] || (pinIcons[color] = L.divIcon({ className: '', html: '<div class="pin" style="background:' + color + '"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }));
function drawPlaces() {
  placeLayer.clearLayers();
  const markers = visiblePlaces().map(p => L.marker([p.lat, p.lon], { icon: pinIcon(groupColor(p.group)), title: p.name, alt: p.name, keyboard: true })
    .on('click', () => openPage('place', { id: p.id })));
  if (placeLayer.addLayers) placeLayer.addLayers(markers); else markers.forEach(m => m.addTo(placeLayer));
}
function renderChips() {
  const nf = activeFilters();
  $('#groupchips').innerHTML = `<button class="chip${nf ? ' on' : ''}" data-act="filters"><svg class="ico" viewBox="0 0 24 24" style="width:18px;height:18px" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtres${nf ? ' (' + nf + ')' : ''}</button>` + GROUPS.map(g => `<button class="chip${S.group === g[0] ? ' on' : ''}" data-act="group" data-id="${g[0]}">${g[0] === 'all' ? '' : `<span class="dot" style="background:${g[2]}"></span>`}${g[1]}</button>`).join('');
}
function renderSheet() {
  const list = visiblePlaces(), sh = $('#sheet');
  sh.className = S.sheetOpen ? '' : 'closed';
  $('#locate').style.bottom = S.sheetOpen ? 'calc(52% + 12px)' : '76px';
  const where = S.posSource === 'ville' ? 'Autour de ' + (S.city || 'la ville choisie') : 'Autour de vous' + (S.city ? ' · ' + S.city : '');
  let body;
  const updating = S.loading && list.length ? '<div class="note" style="padding:0 4px">Mise à jour des lieux…</div>' : '';
  if (S.loading && !list.length) body = `<div class="note" style="padding:8px 4px">Chargement des lieux de sport…${S.loadAttempt > 1 ? ' Serveurs chargés, nouvel essai (' + S.loadAttempt + ' sur 4).' : ' Cela peut prendre une quinzaine de secondes.'}</div>`;
  else if (S.loadError) body = `<div class="banner">${esc(S.loadError)}</div><button class="btn small" data-act="reload">Réessayer</button>`;
  else if (!list.length) body = `<div class="note" style="padding:8px 4px">Aucun lieu de ce type dans un rayon de ${fmtDist(db.settings.radius)}.</div><button class="btn small alt" data-act="widen">Élargir la recherche</button>`;
  else body = updating + list.slice(0, 60).map(p => placeItem(p)).join('');
  body += '<button class="btn alt small" data-act="propose">Proposer un lieu manquant</button>';
  sh.innerHTML = `<button class="sheethead" data-act="sheet" aria-expanded="${S.sheetOpen}"><span><h2>${list.length} ${S.group === 'all' ? 'lieu' + (list.length > 1 ? 'x' : '') + ' pour pratiquer' : esc((GROUPS.find(g => g[0] === S.group) || GROUPS[0])[1].toLowerCase())}</h2><span class="s">${esc(where)} · rayon ${fmtDist(db.settings.radius)}</span></span><span class="tag">${S.sheetOpen ? 'Réduire' : 'Voir la liste'}</span></button><div class="sheetlist">${body}</div>`;
}
