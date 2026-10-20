'use strict';
// =====================================================================
// 10. PARCOURS (itinéraires piétons réels, enregistrés sur le compte)
// =====================================================================
async function routeThrough(pts) {
  const coords = pts.map(p => p.lon.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
  try {
    const r = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error(j.code);
    return { line: j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]), dist: j.routes[0].distance, approx: false };
  } catch (e) {
    let d = 0; for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
    return { line: pts.map(p => [p.lat, p.lon]), dist: d * 1.25, approx: true };
  }
}
async function generateLoop() {
  if (!S.pos || S.routeBusy) return;
  S.routeBusy = true; S.routeNote = ''; renderRoutes();
  const target = S.routeKm * 1000;
  let radius = target / (2 * Math.PI) * 0.78, best = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const center = destPoint(S.pos, radius, S.routeBearing);
    const pts = [S.pos, destPoint(center, radius, S.routeBearing + 60), destPoint(center, radius, S.routeBearing - 60), S.pos];
    const r = await routeThrough(pts);
    if (!best || Math.abs(r.dist - target) < Math.abs(best.dist - target)) best = r;
    if (r.approx || Math.abs(r.dist - target) / target < 0.12) break;
    radius *= target / r.dist;
  }
  S.route = best; S.routeBusy = false;
  S.routeNote = best.approx ? 'Service d\'itinéraires indisponible : tracé à vol d\'oiseau, distance estimée.' : '';
  drawRoute(); renderRoutes();
}
async function computeDrawn() {
  drawLayer.clearLayers();
  S.drawPts.forEach((p, i) => L.circleMarker([p.lat, p.lon], { radius: 7, color: '#12201A', weight: 3, fillColor: '#C8F03C', fillOpacity: 1 }).bindTooltip(String(i + 1)).addTo(drawLayer));
  if (S.drawPts.length < 2) { S.route = null; routeLayer.clearLayers(); renderRoutes(); return; }
  S.routeBusy = true; renderRoutes();
  S.route = await routeThrough(S.drawPts); S.routeBusy = false;
  S.routeNote = S.route.approx ? 'Service d\'itinéraires indisponible : tracé en ligne droite.' : '';
  drawRoute(false); renderRoutes();
}
function drawRoute(fit) {
  routeLayer.clearLayers();
  if (!S.route) return;
  L.polyline(S.route.line, { color: '#FFFFFF', weight: 9 }).addTo(routeLayer);
  const l = L.polyline(S.route.line, { color: '#0E4B38', weight: 5 }).addTo(routeLayer);
  if (fit !== false) map2.fitBounds(l.getBounds(), { paddingTopLeft: [30, 90], paddingBottomRight: [30, 260] });
}
async function loadMyRoutes(force) {
  if (!S.user || (S.myRoutes && !force)) return;
  const r = await act(() => q(sb.from('route_details').select('id,name,distance_m,is_loop,path_geojson,created_at').eq('owner_id', S.user.id).order('created_at', { ascending: false })));
  S.myRoutes = r || []; renderRoutes();
}
async function saveRoute(name) {
  if (!S.user) { openPage('auth', { mode: 'signup' }); toast('Créez un compte pour enregistrer vos parcours'); return; }
  const line = S.route.line, step = Math.max(1, Math.ceil(line.length / 800));
  const pts = line.filter((p, i) => i % step === 0 || i === line.length - 1);
  if (pts.length < 2) return;
  const ok = await act(() => q(sb.from('routes').insert({ name: name || 'Parcours', city: S.city || null, is_loop: S.routeMode === 'gen', path: 'SRID=4326;LINESTRING(' + pts.map(p => p[1].toFixed(6) + ' ' + p[0].toFixed(6)).join(', ') + ')' })));
  if (ok !== undefined) { toast('Parcours enregistré'); S.routeMode = 'mine'; drawLayer.clearLayers(); S.drawPts = []; S.myRoutes = null; loadMyRoutes(true); renderRoutes(); }
}
function renderRoutes() {
  $('#routeseg').innerHTML = [['track', 'Suivi GPS'], ['gen', 'Générer'], ['draw', 'Tracer'], ['mine', 'Mes parcours']].map(s => `<button class="${S.routeMode === s[0] ? 'on' : ''}" data-act="route-mode" data-id="${s[0]}">${s[1]}</button>`).join('');
  const r = S.route, stats = r ? `<div class="stats"><div><b>${fmtKm(r.dist)} km</b><span class="s">Distance</span></div><div><b>${Math.round(r.dist / 1000 * 6)} min</b><span class="s">À 6 min/km</span></div><div><b>${Math.round(r.dist / 1000 * 62)}</b><span class="s">kcal (estim.)</span></div></div>` : '';
  const saveForm = r && S.routeMode !== 'mine' ? (S.user ? `<form class="send" data-form="save-route"><input id="rt-name" name="name" type="text" maxlength="120" placeholder="Nom du parcours" aria-label="Nom du parcours" value="${S.routeMode === 'gen' ? 'Boucle de ' + fmtKm(r.dist) + ' km' : 'Mon tracé de ' + fmtKm(r.dist) + ' km'}"><button type="submit" class="btn small" style="width:auto;border-radius:12px;padding:0 14px">Enregistrer</button></form>` : '<button class="btn alt small" data-act="auth" data-id="signup">Créer un compte pour enregistrer ce parcours</button>') : '';
  const note = S.routeNote ? `<div class="banner">${esc(S.routeNote)}</div>` : '';
  let h;
  if (S.routeMode === 'track') {
    h = trackPanel();
  } else if (S.routeMode === 'gen') {
    h = `<h2>Boucle depuis ma position</h2><div class="chips">${[3, 5, 8, 10, 15, 21].map(k => `<button class="chip${S.routeKm === k ? ' on' : ''}" data-act="route-km" data-id="${k}">${k} km</button>`).join('')}</div>
      ${S.routeBusy ? '<div class="note">Calcul de l\'itinéraire sur les rues et chemins…</div>' : stats}${note}
      <div class="row"><button class="btn" data-act="route-gen"${S.routeBusy ? ' disabled' : ''}>${r ? 'Autre tracé' : 'Générer la boucle'}</button></div>${saveForm}`;
  } else if (S.routeMode === 'draw') {
    h = `<h2>Tracé manuel</h2><div class="note">Touchez la carte pour poser des points : ils sont reliés par les rues et chemins. ${S.drawPts.length} point${S.drawPts.length > 1 ? 's' : ''} posé${S.drawPts.length > 1 ? 's' : ''}.</div>
      ${S.routeBusy ? '<div class="note">Calcul…</div>' : stats}${note}
      <div class="row"><button class="btn alt small" data-act="draw-undo"${S.drawPts.length ? '' : ' disabled'}>Annuler le dernier</button><button class="btn alt small" data-act="draw-clear"${S.drawPts.length ? '' : ' disabled'}>Tout effacer</button></div>${saveForm}`;
  } else if (!S.user) {
    h = `<h2>Mes parcours</h2>${loginCard('Connectez-vous pour retrouver vos parcours sur tous vos appareils.')}`;
  } else {
    if (!S.myRoutes) loadMyRoutes();
    const list = S.myRoutes || [];
    h = `<h2>Mes parcours</h2>${!S.myRoutes ? '<div class="note">Chargement…</div>' : list.length ? list.map(x => `<div class="item" style="border:1px solid var(--line)"><button data-act="route-show" data-id="${x.id}" style="flex:1;min-width:0;border:0;background:none;text-align:left;min-height:44px"><div class="t">${esc(x.name)}</div><div class="s">${fmtKm(x.distance_m)} km · ${Math.round(x.distance_m / 1000 * 6)} min</div></button><button class="btn small alt" data-act="route-session" data-id="${x.id}">Session</button><button class="btn small alt" data-act="route-del" data-id="${x.id}" aria-label="Supprimer ${esc(x.name)}">✕</button></div>`).join('') : '<div class="note">Aucun parcours enregistré. Générez une boucle ou tracez la vôtre.</div>'}${stats}`;
  }
  $('#routepanel').innerHTML = h;
}
const routeLine = x => ((x.path_geojson && x.path_geojson.coordinates) || []).map(c => [c[1], c[0]]);
