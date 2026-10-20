'use strict';
// =====================================================================
// 13. LOT 2 : suivi GPS, statistiques et badges, groupes, notifications
// =====================================================================

// ---------- suivi d'activité au GPS ----------
const ACT_SPORTS = [['course', 'Course', 8], ['marche', 'Marche', 3.5], ['rando', 'Rando', 3.5], ['velo', 'Vélo', 25]];
const actSportName = s => (ACT_SPORTS.find(x => x[0] === s) || [s, 'Activité'])[1];
const TRACK_KEY = 'sportlocal.track';
let trackLayer = null, trackWatch = null, trackTimer = null, wakeLock = null;
S.track = null;   // { state: 'run'|'pause'|'done', sport, pts: [[lat, lon, t]], dist, gain, movingMs, resumedAt, startedAt, weak }
try { const saved = JSON.parse(localStorage.getItem(TRACK_KEY) || 'null'); if (saved && saved.pts) { saved.state = saved.state === 'done' ? 'done' : 'pause'; saved.resumedAt = null; S.track = saved; } } catch (e) { /* rien */ }

const fmtDur = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtPace = (dist, sec) => dist < 50 ? '–' : fmtDur(sec / dist * 1000) + ' /km';
const fmtSpeed = (dist, sec) => sec < 1 ? '–' : (Math.round(dist / sec * 36) / 10).toString().replace('.', ',') + ' km/h';
const trackSeconds = t => (t.movingMs + (t.state === 'run' && t.resumedAt ? Date.now() - t.resumedAt : 0)) / 1000;
function persistTrack() { try { if (S.track) localStorage.setItem(TRACK_KEY, JSON.stringify(S.track)); else localStorage.removeItem(TRACK_KEY); } catch (e) { /* stockage plein ou bloqué */ } }

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* refusé par le navigateur */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.track && S.track.state === 'run') keepAwake(true); });

function startTrack() {
  if (!('geolocation' in navigator)) { toast('Ce navigateur ne donne pas accès au GPS.'); return; }
  const sport = S.trackSport || 'course';
  S.track = { state: 'run', sport, pts: [], dist: 0, gain: 0, movingMs: 0, resumedAt: Date.now(), startedAt: new Date().toISOString(), weak: false, lastAlt: null };
  watchTrack(); keepAwake(true); persistTrack(); renderRoutes();
}
function watchTrack() {
  if (trackWatch != null) return;
  trackWatch = navigator.geolocation.watchPosition(onTrackPos, err => {
    if (err.code === 1) { toast('Autorisez la localisation pour enregistrer votre activité.'); pauseTrack(); }
    else if (S.track) { S.track.weak = true; updateTrackLive(); }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  clearInterval(trackTimer); trackTimer = setInterval(updateTrackLive, 1000);
}
function stopWatch() { if (trackWatch != null) navigator.geolocation.clearWatch(trackWatch); trackWatch = null; clearInterval(trackTimer); trackTimer = null; }
function onTrackPos(pos) {
  const t = S.track; if (!t) return;
  const c = pos.coords, here = { lat: c.latitude, lon: c.longitude };
  t.weak = c.accuracy > 30;
  if (t.state !== 'run' || t.weak) { updateTrackLive(); return; }
  const last = t.pts[t.pts.length - 1], now = pos.timestamp || Date.now();
  if (last) {
    const d = haversine({ lat: last[0], lon: last[1] }, here), dt = Math.max(1, (now - last[2]) / 1000);
    const maxSpeed = (ACT_SPORTS.find(x => x[0] === t.sport) || [0, 0, 10])[2] * 1.6;
    if (d < Math.max(3, c.accuracy * 0.4)) { updateTrackLive(); return; }   // immobile ou bruit du GPS
    if (d / dt > maxSpeed) { updateTrackLive(); return; }                  // saut aberrant
    t.dist += d;
  }
  if (c.altitude != null && (c.altitudeAccuracy == null || c.altitudeAccuracy < 15)) {
    if (t.lastAlt != null && c.altitude - t.lastAlt > 2) t.gain += c.altitude - t.lastAlt;
    if (t.lastAlt == null || Math.abs(c.altitude - t.lastAlt) > 2) t.lastAlt = c.altitude;
  }
  t.pts.push([+here.lat.toFixed(6), +here.lon.toFixed(6), now]);
  if (t.pts.length % 5 === 0) persistTrack();
  drawTrack(true); updateTrackLive();
}
function pauseTrack() {
  const t = S.track; if (!t || t.state !== 'run') return;
  t.movingMs += Date.now() - (t.resumedAt || Date.now()); t.resumedAt = null; t.state = 'pause';
  keepAwake(false); persistTrack(); renderRoutes();
}
function resumeTrack() {
  const t = S.track; if (!t) return;
  t.state = 'run'; t.resumedAt = Date.now();
  // Pas de distance comptée pendant la pause : le prochain point repart de zéro.
  if (t.pts.length && t.pts[t.pts.length - 1]) t.pts.push(null);
  watchTrack(); keepAwake(true); persistTrack(); renderRoutes();
}
function finishTrack() {
  const t = S.track; if (!t) return;
  if (t.state === 'run') { t.movingMs += Date.now() - (t.resumedAt || Date.now()); t.resumedAt = null; }
  t.state = 'done'; stopWatch(); keepAwake(false); persistTrack(); renderRoutes();
}
function discardTrack() { stopWatch(); keepAwake(false); S.track = null; S.trackSure = false; persistTrack(); if (trackLayer) trackLayer.clearLayers(); renderRoutes(); }
const trackSegments = t => { const segs = [[]]; t.pts.forEach(p => { if (p) segs[segs.length - 1].push([p[0], p[1]]); else if (segs[segs.length - 1].length) segs.push([]); }); return segs.filter(s => s.length); };
function drawTrack(follow) {
  if (!map2 || !trackLayer) return;
  trackLayer.clearLayers();
  const t = S.track; if (!t) return;
  trackSegments(t).forEach(seg => { L.polyline(seg, { color: '#FFFFFF', weight: 9 }).addTo(trackLayer); L.polyline(seg, { color: '#E8590C', weight: 5 }).addTo(trackLayer); });
  const pts = t.pts.filter(Boolean), last = pts[pts.length - 1];
  if (follow && last) map2.setView([last[0], last[1]], Math.max(map2.getZoom ? map2.getZoom() : 16, 16));
}
// Allège le tracé (Douglas-Peucker, tolérance en mètres) avant l'envoi.
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const k = Math.cos(pts[0][0] * Math.PI / 180) * 111320, xy = pts.map(p => [p[1] * k, p[0] * 110540]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0, idx = -1;
    const [x1, y1] = xy[a], [x2, y2] = xy[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * xy[i][0] - dx * xy[i][1] + x2 * y1 - y2 * x1) / len; if (d > best) { best = d; idx = i; } }
    if (best > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((p, i) => keep[i]);
}
// Confidentialité : retire les premiers et derniers mètres du tracé (souvent le domicile).
// La distance et la durée de l'activité ne changent pas : seul le dessin partagé est raccourci.
const PRIVACY_M = 200;
function trimPathEnds(path, meters) {
  const d = (a, b) => haversine({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] });
  let total = 0; for (let i = 1; i < path.length; i++) total += d(path[i - 1], path[i]);
  if (total < meters * 2 + 50) return null;           // tracé trop court : on ne le partage pas
  let start = 0, acc = 0;
  while (start < path.length - 1 && acc < meters) { acc += d(path[start], path[start + 1]); start++; }
  let end = path.length - 1; acc = 0;
  while (end > start && acc < meters) { acc += d(path[end - 1], path[end]); end--; }
  const out = path.slice(start, end + 1);
  return out.length >= 2 ? out : null;
}
function trackPath(t) {
  let flat = trackSegments(t).flat();
  let tol = 3; let out = simplify(flat, tol);
  while (out.length > 4000) { tol *= 1.6; out = simplify(flat, tol); }
  return out.map(p => [+p[1].toFixed(5), +p[0].toFixed(5)]);
}
const defaultTitle = (sport, iso) => { const h = new Date(iso).getHours(); return actSportName(sport) + (h < 12 ? ' du matin' : h < 18 ? ' de l\'après-midi' : ' du soir'); };
async function saveTrack(f) {
  const t = S.track; if (!t) return;
  if (!S.user) { toast('Créez un compte pour garder vos activités : celle-ci reste sur cet appareil en attendant.'); openPage('auth', { mode: 'signup' }); return; }
  const secs = Math.max(1, Math.round(trackSeconds(t)));
  const row = {
    sport: f.elements.sport.value, title: f.elements.title.value.trim() || defaultTitle(t.sport, t.startedAt),
    started_at: t.startedAt, duration_s: secs, distance_m: Math.round(t.dist),
    elevation_gain_m: t.gain ? Math.round(t.gain) : null, path: trackPath(t), visibility: f.elements.vis.value
  };
  if (f.elements.hideEnds && f.elements.hideEnds.checked) row.path = trimPathEnds(row.path, PRIVACY_M);
  const ok = await act(() => q(sb.from('activities').insert(row)));
  if (ok === undefined) return;
  toast('Activité enregistrée'); S.stats = null; S.myActs = null;
  discardTrack(); checkNewBadges();
}
function trackStatsHtml(t, live) {
  const secs = trackSeconds(t), bike = t.sport === 'velo', id = n => live ? ` id="tk-${n}"` : '';
  return `<div class="stats big"><div><b${id('time')}>${fmtDur(secs)}</b><span class="s">Durée</span></div><div><b${id('dist')}>${fmtKm(t.dist)} km</b><span class="s">Distance</span></div><div><b${id('pace')}>${bike ? fmtSpeed(t.dist, secs) : fmtPace(t.dist, secs)}</b><span class="s">${bike ? 'Vitesse moy.' : 'Allure moy.'}</span></div></div>`;
}
const gpsNote = t => t.weak ? 'Signal GPS faible : sortez à découvert, l\'enregistrement reprend tout seul.' : t.state === 'pause' ? 'En pause.' : 'Enregistrement en cours.';
const trackLiveHtml = t => trackStatsHtml(t, true) + `<div class="note" id="tk-gps">${gpsNote(t)}</div>`;
function updateTrackLive() {
  const t = S.track; if (!t || !$('#tk-time')) return;
  const secs = trackSeconds(t), bike = t.sport === 'velo';
  $('#tk-time').textContent = fmtDur(secs); $('#tk-dist').textContent = fmtKm(t.dist) + ' km';
  $('#tk-pace').textContent = bike ? fmtSpeed(t.dist, secs) : fmtPace(t.dist, secs);
  $('#tk-gps').textContent = gpsNote(t);
}
function trackPanel() {
  const t = S.track;
  if (!t) {
    const st = S.stats && !S.stats.error ? S.stats : null;
    if (S.user && !S.stats) loadStats();
    return `<h2>Enregistrer une activité</h2>
      <div class="chips">${ACT_SPORTS.map(s => `<button class="chip${(S.trackSport || 'course') === s[0] ? ' on' : ''}" data-act="track-sport" data-id="${s[0]}">${s[1]}</button>`).join('')}</div>
      <button class="btn lime" data-act="track-start">Démarrer</button>
      <div class="note">Gardez l'appli ouverte pendant l'effort : un site web ne peut pas suivre votre position quand l'écran est éteint ou l'appli fermée. L'écran reste allumé automatiquement quand le téléphone le permet.</div>
      ${st ? `<div class="stats"><div><b>${fmtKm(st.week_m)} km</b><span class="s">Cette semaine</span></div><div><b>${st.streak_weeks}</b><span class="s">Semaine${st.streak_weeks > 1 ? 's' : ''} d'affilée</span></div><div><b>${st.activities}</b><span class="s">Activités</span></div></div>` : ''}
      <button class="btn alt small" data-act="stats">${S.user ? 'Mes activités, statistiques et badges' : 'Statistiques et badges'}</button>`;
  }
  if (t.state === 'done') {
    const secs = trackSeconds(t);
    return `<h2>Activité terminée</h2>${trackStatsHtml(t, false)}
      ${t.dist < 50 ? '<div class="banner">Distance très courte : le GPS n\'a presque rien enregistré.</div>' : ''}
      <form class="col" data-form="track-save" style="display:flex;flex-direction:column;gap:10px">
        <label class="field">Titre<input name="title" type="text" maxlength="120" value="${esc(defaultTitle(t.sport, t.startedAt))}"></label>
        <label class="field">Sport<select name="sport">${ACT_SPORTS.map(s => `<option value="${s[0]}"${s[0] === t.sport ? ' selected' : ''}>${s[1]}</option>`).join('')}<option value="autre">Autre</option></select></label>
        <label class="field">Visible par<select name="vis"><option value="amis">Mes amis</option><option value="prive">Moi seulement</option></select></label>
        <label style="display:flex;flex-direction:row;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" name="hideEnds" checked style="margin-top:3px;flex:none;width:18px;height:18px"><span class="s">Masquer les ${PRIVACY_M} premiers et derniers mètres du tracé, pour ne pas révéler votre domicile. La distance et la durée restent exactes.</span></label>
        <button class="btn" type="submit">${S.user ? 'Enregistrer' : 'Créer un compte pour enregistrer'}</button>
      </form>
      <button class="btn alt small" data-act="track-discard">${S.trackSure ? 'Confirmer : supprimer cette activité' : 'Supprimer sans enregistrer'}</button>
      <div class="s">${fmtDur(secs)} en mouvement${t.gain ? ' · ' + Math.round(t.gain) + ' m de dénivelé positif' : ''}</div>`;
  }
  return `<h2>${esc(actSportName(t.sport))} · ${t.state === 'run' ? 'en cours' : 'en pause'}</h2>${trackLiveHtml(t)}
    <div class="row">${t.state === 'run' ? '<button class="btn alt" data-act="track-pause">Pause</button>' : '<button class="btn" data-act="track-resume">Reprendre</button>'}<button class="btn lime" data-act="track-finish">Terminer</button></div>`;
}

// ---------- statistiques et badges ----------
const BADGES = [
  ['first', '1', 'Premier pas', 'Enregistrer une première activité', s => s.activities / 1],
  ['k10', '10', '10 km', '10 km cumulés', s => s.total_m / 10000],
  ['k100', '100', '100 km', '100 km cumulés', s => s.total_m / 100000],
  ['k500', '500', '500 km', '500 km cumulés', s => s.total_m / 500000],
  ['semi', '21', 'Semi', 'Une sortie de 21,1 km ou plus', s => s.longest_m / 21097],
  ['marathon', '42', 'Marathon', 'Une sortie de 42,2 km ou plus', s => s.longest_m / 42195],
  ['fast', '5′', 'Rapide', 'Courir 1 km ou plus sous 5 min/km', s => s.best_pace_s ? 300 / s.best_pace_s : 0],
  ['bike', 'V', 'Rouleur', '100 km à vélo', s => s.bike_m / 100000],
  ['streak4', '4×', 'Régulier', '4 semaines d\'affilée', s => s.streak_weeks / 4],
  ['streak12', '12×', 'Inarrêtable', '12 semaines d\'affilée', s => s.streak_weeks / 12],
  ['early', '6h', 'Lève-tôt', 'Une activité avant 7 h', s => s.early_birds / 1],
  ['session', 'S', 'En groupe', 'Participer à une session', s => s.sessions_done / 1],
  ['session10', '10S', 'Habitué', 'Participer à 10 sessions', s => s.sessions_done / 10],
  ['organizer', 'O', 'Organisateur', 'Organiser une session', s => s.sessions_organized / 1],
  ['friends', '5', 'Sociable', 'Avoir 5 amis', s => s.friends / 5],
  ['team', 'G', 'Esprit d\'équipe', 'Rejoindre un groupe', s => s.groups / 1],
  ['critic', '★', 'Critique', 'Donner 3 avis sur des lieux', s => s.reviews / 3],
  ['photo', '◉', 'Photographe', 'Ajouter une photo de lieu', s => s.photos / 1]
];
const earned = st => BADGES.filter(b => b[4](st) >= 1).map(b => b[0]);
const badgeHtml = (b, st, small) => { const p = Math.min(1, b[4](st) || 0), on = p >= 1; return `<div class="medal${on ? ' on' : ''}${small ? ' sm' : ''}" title="${esc(b[3])}"><span class="disc">${esc(b[1])}</span><b>${esc(b[2])}</b>${small ? '' : `<span class="s">${on ? esc(b[3]) : esc(b[3]) + ' · ' + Math.floor(p * 100) + ' %'}</span>`}</div>`; };
async function loadStats() {
  if (!S.user || S.statsBusy) return;
  S.statsBusy = true;
  try { S.stats = await q(sb.rpc('my_stats')); } catch (e) { S.stats = { error: errMsg(e) }; }
  S.statsBusy = false;
  if (S.tab === 'profile') renderProfile();
  if (S.tab === 'routes') renderRoutes();
  refreshTopIf('stats');
}
async function checkNewBadges() {
  const before = S.stats && !S.stats.error ? earned(S.stats) : null;
  S.stats = null; await loadStats();
  if (!before || !S.stats || S.stats.error) return;
  const fresh = earned(S.stats).filter(id => !before.includes(id));
  if (fresh.length) toast('Nouveau badge : ' + fresh.map(id => BADGES.find(b => b[0] === id)[2]).join(', ') + ' !');
}
function weekBars(st) {
  const w = st.weeks || [], max = Math.max(1000, ...w.map(x => x.m));
  return `<div class="bars" role="img" aria-label="Distance des 8 dernières semaines">${w.map(x => `<div><em>${x.m ? fmtKm(x.m) : ''}</em><span style="height:${Math.round(x.m / max * 72)}%"></span><i>${new Date(x.week).toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' })}</i></div>`).join('')}</div>`;
}
const actItem = a => `<button class="item" data-act="activity" data-id="${a.id}"><span class="avatar" style="background:#E8590C;color:#fff">${esc(actSportName(a.sport).slice(0, 2))}</span><span class="grow"><div class="t">${esc(a.title)}</div><div class="s">${esc(new Date(a.started_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${fmtKm(a.distance_m)} km · ${fmtDur(a.duration_s)}${a.author_name ? ' · ' + esc(a.author_name) : ''}</div></span>${ico('next')}</button>`;
function pageStats(a) {
  if (!S.user) return { title: 'Statistiques', body: `<div class="pad">${loginCard('Connectez-vous pour suivre vos statistiques et gagner des badges.')}<div class="grid-medals">${BADGES.map(b => badgeHtml(b, {})).join('')}</div></div>` };
  if (!S.stats) { loadStats(); return { title: 'Statistiques', body: LOADING }; }
  if (S.stats.error) return { title: 'Statistiques', body: failed(S.stats) };
  const st = S.stats;
  const mine = need(a, 'mine', () => q(sb.from('activities').select('id,sport,title,started_at,duration_s,distance_m').eq('user_id', S.user.id).order('started_at', { ascending: false }).limit(50)));
  const feed = need(a, 'feed', () => q(sb.rpc('friends_activities', { p_limit: 15 })));
  const got = earned(st).length;
  return {
    title: 'Statistiques et badges',
    body: `<div class="pad">
      <div class="stats"><div><b>${fmtKm(st.week_m)} km</b><span class="s">Cette semaine</span></div><div><b>${fmtKm(st.month_m)} km</b><span class="s">Ce mois</span></div><div><b>${fmtKm(st.year_m)} km</b><span class="s">Cette année</span></div></div>
      <div class="stats"><div><b>${st.streak_weeks}</b><span class="s">Semaine${st.streak_weeks > 1 ? 's' : ''} d'affilée</span></div><div><b>${st.best_pace_s ? fmtDur(st.best_pace_s) : '–'}</b><span class="s">Meilleure allure /km</span></div><div><b>${fmtKm(st.longest_m)} km</b><span class="s">Plus longue sortie</span></div></div>
      <h3>8 dernières semaines</h3>${weekBars(st)}
      <div class="s">Total : ${st.activities} activité${st.activities > 1 ? 's' : ''}, ${fmtKm(st.total_m)} km, ${fmtDur(st.total_s)} · ${st.sessions_done} session${st.sessions_done > 1 ? 's' : ''} faite${st.sessions_done > 1 ? 's' : ''}</div>
      <h3>Badges (${got} / ${BADGES.length})</h3><div class="grid-medals">${BADGES.map(b => badgeHtml(b, st)).join('')}</div>
      <h3>Mes activités</h3>${!mine ? '<div class="note">Chargement…</div>' : mine.error ? failed(mine) : mine.length ? mine.map(actItem).join('') : '<div class="note">Aucune activité. Lancez-en une depuis l\'onglet Parcours, « Suivi GPS ».</div>'}
      <button class="btn alt small" data-act="track-go">Enregistrer une activité</button>
      <h3>Activités de mes amis</h3>${!feed ? '<div class="note">Chargement…</div>' : feed.error ? failed(feed) : feed.length ? feed.map(actItem).join('') : '<div class="note">Vos amis n\'ont encore rien partagé.</div>'}
    </div>`
  };
}
// Dessin du tracé en SVG (sans carte) pour la fiche d'une activité.
function pathSvg(path) {
  if (!path || path.length < 2) return '';
  const lat0 = path[0][1], k = Math.cos(lat0 * Math.PI / 180);
  const xs = path.map(p => p[0] * k), ys = path.map(p => -p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1e-6, h = maxY - minY || 1e-6, s = 280 / Math.max(w, h);
  const pts = xs.map((x, i) => ((x - minX) * s + 10 + (280 - w * s) / 2).toFixed(1) + ',' + ((ys[i] - minY) * s + 10 + (280 - h * s) / 2).toFixed(1)).join(' ');
  const [sx, sy] = pts.split(' ')[0].split(','), [ex, ey] = pts.split(' ').pop().split(',');
  return `<svg class="trace" viewBox="0 0 300 300" role="img" aria-label="Tracé de l'activité"><polyline points="${pts}" fill="none" stroke="var(--surface)" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${pts}" fill="none" stroke="#E8590C" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx}" cy="${sy}" r="6" fill="#2B8A3E" stroke="#fff" stroke-width="2"/><circle cx="${ex}" cy="${ey}" r="6" fill="#B42318" stroke="#fff" stroke-width="2"/></svg>`;
}
function pageActivity(a) {
  const x = need(a, 'act', () => q(sb.from('activities').select('*').eq('id', a.id).single()));
  if (!x) return { title: 'Activité', body: LOADING };
  if (x.error) return { title: 'Activité', body: failed(x) };
  const mine = S.user && x.user_id === S.user.id, bike = x.sport === 'velo';
  return {
    title: x.title,
    body: `<div class="pad">
      <div class="label">${esc(actSportName(x.sport))} · ${esc(fmtWhen(x.started_at))}</div>
      <div class="stats"><div><b>${fmtKm(x.distance_m)} km</b><span class="s">Distance</span></div><div><b>${fmtDur(x.duration_s)}</b><span class="s">Durée</span></div><div><b>${bike ? fmtSpeed(x.distance_m, x.duration_s) : fmtPace(x.distance_m, x.duration_s)}</b><span class="s">${bike ? 'Vitesse moy.' : 'Allure moy.'}</span></div></div>
      ${x.elevation_gain_m ? `<div class="s">${x.elevation_gain_m} m de dénivelé positif</div>` : ''}
      ${pathSvg(x.path)}
      ${x.path && x.path.length > 1 ? '<button class="btn alt small" data-act="activity-map">Voir sur la carte</button>' : ''}
      ${mine ? `${x.path && x.path.length > 1 ? '<button class="btn alt small" data-act="activity-route">Enregistrer comme parcours réutilisable</button>' : ''}
        <div class="card"><div class="label">Visible par</div><div class="chips wrap">${[['amis', 'Mes amis'], ['prive', 'Moi seulement']].map(o => `<button class="chip${x.visibility === o[0] ? ' on' : ''}" data-act="activity-vis" data-id="${o[0]}">${o[1]}</button>`).join('')}</div></div>
        <button class="btn alt small" data-act="activity-del">${a.sure ? 'Confirmer la suppression' : 'Supprimer cette activité'}</button>` : ''}
    </div>`
  };
}
function showActivityOnMap(x) {
  showTab('routes'); S.routeMode = 'track'; renderRoutes();
  routeLayer.clearLayers();
  const line = x.path.map(p => [p[1], p[0]]);
  L.polyline(line, { color: '#FFFFFF', weight: 9 }).addTo(routeLayer);
  const l = L.polyline(line, { color: '#E8590C', weight: 5 }).addTo(routeLayer);
  map2.fitBounds(l.getBounds(), { paddingTopLeft: [30, 90], paddingBottomRight: [30, 260] });
}

// ---------- groupes ----------
async function loadGroups() {
  if (!S.user) return;
  const r = await act(() => q(sb.rpc('groups_search', { p_query: S.groupQuery || '' })));
  S.groups = r || []; if (S.tab === 'social' && S.social === 'groups') renderSocial();
}
const groupItem = g => `<button class="item" data-act="group-open" data-id="${g.id}"><span class="avatar" style="background:var(--green);color:#fff">${esc(initials(g.name))}</span><span class="grow"><div class="t">${esc(g.name)}${g.is_member ? ' <span class="tag lime">membre</span>' : ''}${g.is_public ? '' : ' <span class="tag">privé</span>'}</div><div class="s">${esc([g.sport_name, g.city, g.members_count + ' membre' + (g.members_count > 1 ? 's' : '')].filter(Boolean).join(' · '))}</div></span>${ico('next')}</button>`;
function groupsHtml() {
  if (!S.groups) { loadGroups(); return '<div class="note">Chargement…</div>'; }
  const mine = S.groups.filter(g => g.is_member), other = S.groups.filter(g => !g.is_member);
  return `<button class="btn" data-act="group-new">Créer un groupe</button>
    <label class="field">Chercher un groupe<input id="group-search" type="search" placeholder="Nom, ville ou sport" value="${esc(S.groupQuery || '')}" autocomplete="off"></label>
    <div id="group-results" style="display:flex;flex-direction:column;gap:10px">${mine.length ? '<h3>Mes groupes</h3>' + mine.map(groupItem).join('') : ''}
    <h3>${S.groupQuery ? 'Résultats' : 'Groupes publics'}</h3>${other.length ? other.map(groupItem).join('') : '<div class="note">' + (S.groupQuery ? 'Aucun groupe ne correspond.' : 'Aucun autre groupe pour l\'instant : créez le premier de votre ville !') + '</div>'}</div>`;
}
let groupT;
document.addEventListener('input', e => { if (e.target.id === 'group-search') { clearTimeout(groupT); S.groupQuery = e.target.value; groupT = setTimeout(() => { S.groups = null; loadGroups().then(() => { const i = $('#group-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350); } });
function pageNewGroup() {
  return {
    title: 'Nouveau groupe',
    body: `<form class="pad" data-form="group">
      <label class="field">Nom du groupe<input name="name" type="text" required minlength="3" maxlength="80" placeholder="Runners du dimanche"></label>
      <label class="field">Sport principal<select name="sport"><option value="">Plusieurs sports</option>${S.sports.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="field">Ville<input name="city" type="text" maxlength="80" value="${esc(S.city || (S.me && S.me.city) || '')}"></label>
      <label class="field">Description (facultatif)<textarea name="desc" rows="3" maxlength="1000" placeholder="Niveau, rythme, lieux habituels…"></textarea></label>
      <label class="check"><input type="checkbox" name="pub" checked> Groupe public : tout le monde peut le trouver et le rejoindre</label>
      <div class="note">Un groupe privé n'est visible que de ses membres : vous y ajoutez vos amis vous-même.</div>
      <button class="btn" type="submit">Créer le groupe</button></form>`
  };
}
async function submitGroup(f) {
  const row = { name: f.elements.name.value.trim(), sport_id: f.elements.sport.value ? +f.elements.sport.value : null, city: f.elements.city.value.trim() || null, description: f.elements.desc.value.trim() || null, is_public: f.elements.pub.checked };
  const g = await act(() => q(sb.from('groups').insert(row).select('id').single()));
  if (!g) return;
  toast('Groupe créé'); S.groups = null; S.stats = null; back(); openPage('group', { id: g.id }); refreshConvs();
}
async function loadGroup(id) {
  const [rows, members] = await Promise.all([q(sb.rpc('groups_search', { p_query: '' })), q(sb.rpc('group_members_list', { p_group: id }))]);
  let g = rows.find(x => x.id === id);
  if (!g) { const one = await q(sb.from('groups').select('id,name,description,sport_id,city,is_public,owner_id').eq('id', id).maybeSingle()); if (!one) throw new Error('Ce groupe n\'existe plus ou il est privé.'); g = Object.assign(one, { sport_name: one.sport_id ? sportName(one.sport_id) : null, members_count: members.length, is_member: members.some(m => m.user_id === S.user.id) }); }
  return { g, members };
}
function pageGroup(a) {
  if (!S.user) return { title: 'Groupe', body: `<div class="pad">${loginCard('Connectez-vous pour voir et rejoindre les groupes.')}</div>` };
  const d = need(a, 'd', () => loadGroup(a.id));
  if (!d) return { title: 'Groupe', body: LOADING };
  if (d.error) return { title: 'Groupe', body: failed(d) };
  const { g, members } = d, owner = g.owner_id === S.user.id;
  return {
    title: g.name,
    body: `<div class="pad">
      <div class="label">${esc([g.sport_name || 'Plusieurs sports', g.city, g.is_public ? 'Groupe public' : 'Groupe privé'].filter(Boolean).join(' · '))}</div>
      ${g.description ? `<div>${esc(g.description)}</div>` : ''}
      ${g.is_member ? `<button class="btn" data-act="group-chat" data-id="${g.id}">Ouvrir la discussion du groupe</button>` : `<button class="btn lime" data-act="group-join" data-id="${g.id}">Rejoindre le groupe</button>`}
      <button class="btn alt small" data-act="share-group" data-id="${g.id}">Partager le groupe</button>
      ${owner ? `<button class="btn alt small" data-act="group-add" data-id="${g.id}">Ajouter des amis</button>` : ''}
      <h3>Membres (${members.length})</h3>
      ${members.map(m => `<div class="item">${avatarHtml(m.name, m.avatar_url)}<button class="grow" data-act="member" data-id="${m.user_id}" style="border:0;background:none;text-align:left;min-height:44px"><div class="t">${esc(m.name)}${m.user_id === S.user.id ? ' (vous)' : ''}</div><div class="s">${m.role === 'owner' ? 'Créateur du groupe' : '@' + esc(m.username)}</div></button>${owner && m.role !== 'owner' ? `<button class="btn small alt" data-act="group-kick" data-id="${m.user_id}" aria-label="Retirer ${esc(m.name)} du groupe">Retirer</button>` : ''}</div>`).join('')}
      ${owner ? `<button class="btn alt small" data-act="group-delete" data-id="${g.id}">${a.sure ? 'Confirmer : supprimer le groupe et sa discussion' : 'Supprimer le groupe'}</button>`
        : g.is_member ? `<button class="btn alt small" data-act="group-leave" data-id="${g.id}">Quitter le groupe</button>` : ''}
    </div>`
  };
}
function pageGroupAdd(a) {
  const all = need(a, 'friends', () => q(sb.rpc('my_friends')));
  const d = need(a, 'members', () => q(sb.rpc('group_members_list', { p_group: a.id })));
  if (!all || !d) return { title: 'Ajouter des amis', body: LOADING };
  if (all.error) return { title: 'Ajouter des amis', body: failed(all) };
  const ids = (d.error ? [] : d).map(m => m.user_id), fr = all.filter(f => f.friend === 'ami');
  return {
    title: 'Ajouter des amis',
    body: `<div class="pad">${fr.length ? fr.map(p => `<div class="item">${avatarHtml(personName(p), p.avatar_url)}<span class="grow"><div class="t">${esc(personName(p))}</div><div class="s">${esc(sportsLine(p.sports) || '@' + p.username)}</div></span>${ids.includes(p.id) ? '<span class="tag lime">membre</span>' : `<button class="btn small" data-act="group-add-one" data-id="${p.id}">Ajouter</button>`}</div>`).join('') : '<div class="note">Vous n\'avez pas encore d\'amis à ajouter. Seuls vos amis peuvent être ajoutés à un groupe.</div>'}</div>`
  };
}

// ---------- notifications ----------
S.notifs = null;
function unreadNotifs() { return (S.notifs || []).filter(n => !n.read_at).length; }
async function loadNotifs() {
  if (!S.user) { S.notifs = null; paintBell(); return; }
  const r = await act(() => q(sb.from('notifications').select('id,kind,title,body,link,created_at,read_at').order('created_at', { ascending: false }).limit(60)));
  S.notifs = r || []; paintBell(); refreshTopIf('notifs');
}
function paintBell() {
  const b = $('#bell'); if (!b) return;
  const n = unreadNotifs();
  b.hidden = !S.user;
  b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0"/></svg>${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}`;
  b.setAttribute('aria-label', n ? n + ' notification' + (n > 1 ? 's' : '') + ' non lue' + (n > 1 ? 's' : '') : 'Notifications');
  renderTabbar();
}
function systemNotify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !db.settings.sysNotif || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body: body || '', tag, icon: 'icon-192.png', badge: 'icon-192.png' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(r => r.showNotification(title, { body: body || '', tag, icon: 'icon-192.png' })).catch(() => {});
  }
}
function onNotif(n) {
  if (!S.notifs) S.notifs = [];
  if (S.notifs.some(x => x.id === n.id)) return;
  S.notifs.unshift(n); paintBell(); refreshTopIf('notifs');
  if (document.visibilityState === 'visible') toast(n.title); else systemNotify(n.title, n.body, 'n' + n.id);
  if (/^friend/.test(n.kind)) { S.friends = null; S.suggestions = null; }
  if (/^group/.test(n.kind)) { S.groups = null; refreshConvs(); }
  if (/^(event|waitlist)/.test(n.kind)) { S.events = null; refreshConvs(); }
  S.stats = null;
}
const notifIcon = k => /^friend/.test(k) ? 'user' : /^group/.test(k) ? 'chat' : 'cal';
function pageNotifs() {
  if (!S.notifs) { loadNotifs(); return { title: 'Notifications', body: LOADING }; }
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const ask = perm === 'default' || (perm === 'granted' && !db.settings.sysNotif) ? `<div class="card"><div class="t">Être prévenu même quand l'appli est en arrière-plan</div><div class="s">Demandes d'ami, places libérées, sessions annulées, messages.</div><button class="btn small" data-act="notif-perm" style="margin-top:6px">Activer sur cet appareil</button></div>` : '';
  return {
    title: 'Notifications',
    body: `<div class="pad">${ask}
      ${S.notifs.length ? `<button class="btn alt small" data-act="notif-all"${unreadNotifs() ? '' : ' disabled'}>Tout marquer comme lu</button>` + S.notifs.map(n => `<button class="item notif${n.read_at ? '' : ' unread'}" data-act="notif-open" data-id="${n.id}"><span class="avatar">${ico(notifIcon(n.kind))}</span><span class="grow"><div class="t">${esc(n.title)}</div>${n.body ? `<div class="s">${esc(n.body)}</div>` : ''}<div class="s">${esc(new Date(n.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div></span>${n.link ? ico('next') : ''}</button>`).join('')
        : '<div class="card"><div class="t">Rien de nouveau</div><div class="s">Vous verrez ici les demandes d\'ami, les inscriptions à vos sessions, les places libérées et les groupes.</div></div>'}
    </div>`
  };
}
function openLink(link) {
  const m = String(link || '').match(/^(member|event|group):([0-9a-f-]{36})$/);
  if (!m) return;
  openPage(m[1], { id: m[2] });
}
async function askNotifPermission() {
  if (!('Notification' in window)) { toast('Ce navigateur ne gère pas les notifications. Sur iPhone, installez d\'abord l\'appli sur l\'écran d\'accueil.'); return; }
  const r = await Notification.requestPermission();
  db.settings.sysNotif = r === 'granted'; save();
  toast(r === 'granted' ? 'Notifications activées sur cet appareil' : 'Notifications refusées : vous pourrez les autoriser dans les réglages du navigateur.');
  renderPage();
}

// Rappel des sessions : prévient une fois, 2 h avant (appli ouverte).
function checkReminders() {
  if (!S.user || !S.events) return;
  db.reminded = db.reminded || {};
  const now = Date.now();
  S.events.filter(e => e.joined).forEach(e => {
    const t = new Date(e.starts_at).getTime();
    if (t > now && t - now < 2 * 3600e3 && !db.reminded[e.id]) {
      db.reminded[e.id] = now;
      const msg = 'Rappel : « ' + e.title + ' » à ' + new Date(e.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (document.visibilityState === 'visible') toast(msg); else systemNotify(msg, e.place_name || '', 'r' + e.id);
    }
  });
  Object.keys(db.reminded).forEach(id => { if (now - db.reminded[id] > 3 * 864e5) delete db.reminded[id]; });
  save();
}
setInterval(() => { if (S.user && S.pos) loadEvents(true).then(checkReminders); }, 10 * 60e3);

// ---------- pages, actions et formulaires du lot 2 ----------
Object.assign(PAGES, { stats: pageStats, activity: pageActivity, 'new-group': pageNewGroup, group: pageGroup, 'group-add': pageGroupAdd, notifs: pageNotifs });
Object.assign(ACT, {
  'track-sport': id => { S.trackSport = id; renderRoutes(); },
  'track-start': () => startTrack(),
  'track-pause': () => pauseTrack(),
  'track-resume': () => resumeTrack(),
  'track-finish': () => finishTrack(),
  'track-discard': () => { if (!S.trackSure) { S.trackSure = true; renderRoutes(); return; } discardTrack(); },
  'track-go': () => { S.stack = []; renderPage(); S.routeMode = 'track'; showTab('routes'); },
  stats: () => openPage('stats'),
  activity: id => openPage('activity', { id }),
  'activity-map': () => { const x = topArgs().act; if (x && x.path) showActivityOnMap(x); },
  'activity-route': async () => {
    const x = topArgs().act; if (!x || !x.path) return;
    const pts = x.path.length > 800 ? x.path.filter((p, i) => i % Math.ceil(x.path.length / 800) === 0 || i === x.path.length - 1) : x.path;
    const ok = await act(() => q(sb.from('routes').insert({ name: x.title.slice(0, 120).padEnd(2, '.'), city: S.city || null, is_loop: haversine({ lat: pts[0][1], lon: pts[0][0] }, { lat: pts[pts.length - 1][1], lon: pts[pts.length - 1][0] }) < 150, path: 'SRID=4326;LINESTRING(' + pts.map(p => p[0] + ' ' + p[1]).join(', ') + ')' })));
    if (ok !== undefined) { toast('Parcours enregistré dans « Mes parcours »'); S.myRoutes = null; S.stats = null; }
  },
  'activity-vis': async id => { const a = topArgs(); const ok = await act(() => q(sb.from('activities').update({ visibility: id }).eq('id', a.id))); if (ok !== undefined) { a.act.visibility = id; renderPage(); } },
  'activity-del': async () => {
    const a = topArgs(); if (!a.sure) { a.sure = true; renderPage(); return; }
    const ok = await act(() => q(sb.from('activities').delete().eq('id', a.id)));
    if (ok !== undefined) { toast('Activité supprimée'); S.stats = null; back(); refreshTopIf('stats'); }
  },
  'group-new': () => { loadSports().catch(() => {}); openPage('new-group'); },
  'group-open': id => openPage('group', { id }),
  'group-join': async id => { const ok = await act(() => q(sb.from('group_members').insert({ group_id: id }))); if (ok !== undefined) { toast('Bienvenue dans le groupe !'); S.groups = null; S.stats = null; refreshTopIf('group'); refreshConvs(); } },
  'group-leave': async id => { const ok = await act(() => q(sb.from('group_members').delete().eq('group_id', id).eq('user_id', S.user.id))); if (ok !== undefined) { toast('Vous avez quitté le groupe'); S.groups = null; back(); refreshConvs(); } },
  'group-kick': async uid => { const a = topArgs(); const ok = await act(() => q(sb.from('group_members').delete().eq('group_id', a.id).eq('user_id', uid))); if (ok !== undefined) { toast('Membre retiré'); refreshTopIf('group'); } },
  'group-delete': async id => {
    const a = topArgs(); if (!a.sure) { a.sure = true; renderPage(); return; }
    const ok = await act(() => q(sb.from('groups').delete().eq('id', id)));
    if (ok !== undefined) { toast('Groupe supprimé'); S.groups = null; back(); refreshConvs(); }
  },
  'group-add': id => openPage('group-add', { id }),
  'group-add-one': async uid => { const a = topArgs(); const ok = await act(() => q(sb.from('group_members').insert({ group_id: a.id, user_id: uid }))); if (ok !== undefined) { toast('Ami ajouté au groupe'); delete a.members; delete a._members; renderPage(); } },
  'group-chat': async id => {
    let conv = (S.convs.find(c => c.group_id === id) || {}).conversation_id;
    if (!conv) { await refreshConvs(); conv = (S.convs.find(c => c.group_id === id) || {}).conversation_id; }
    if (conv) openPage('chat', { id: conv }); else toast('Discussion introuvable, réessayez dans un instant.');
  },
  'share-group': id => { const g = (topArgs().d || {}).g; shareLink(g ? g.name : 'Groupe', g ? `Rejoins le groupe « ${g.name} » sur Sport local` : 'Groupe sur Sport local', 'groupe/' + id); },
  notifs: () => { if (!S.user) { openPage('auth', { mode: 'login' }); return; } openPage('notifs'); loadNotifs(); },
  'notif-open': async id => {
    const n = (S.notifs || []).find(x => String(x.id) === String(id)); if (!n) return;
    if (!n.read_at) { n.read_at = new Date().toISOString(); paintBell(); sb.from('notifications').update({ read_at: n.read_at }).eq('id', n.id).then(() => {}); }
    if (n.link) openLink(n.link); else renderPage();
  },
  'notif-all': async () => {
    const now = new Date().toISOString();
    const ok = await act(() => q(sb.from('notifications').update({ read_at: now }).is('read_at', null)));
    if (ok !== undefined) { (S.notifs || []).forEach(n => { n.read_at = n.read_at || now; }); paintBell(); renderPage(); }
  },
  'notif-perm': () => askNotifPermission()
});
Object.assign(FORMS, {
  'track-save': f => saveTrack(f),
  group: f => submitGroup(f)
});

function profileStatsHtml() {
  if (!S.stats) { loadStats(); return ''; }
  if (S.stats.error) return '';
  const st = S.stats, got = BADGES.filter(b => b[4](st) >= 1);
  return `<button class="card" data-act="stats" style="text-align:left;width:100%;display:flex;flex-direction:column;gap:8px">
    <div class="label">Mon activité</div>
    <div class="stats"><div><b>${fmtKm(st.week_m)} km</b><span class="s">Cette semaine</span></div><div><b>${st.streak_weeks}</b><span class="s">Semaine${st.streak_weeks > 1 ? 's' : ''} d'affilée</span></div><div><b>${got.length}/${BADGES.length}</b><span class="s">Badges</span></div></div>
    ${got.length ? `<div class="medals-row">${got.slice(-5).reverse().map(b => badgeHtml(b, st, true)).join('')}</div>` : '<div class="s">Enregistrez une activité ou rejoignez une session pour gagner vos premiers badges.</div>'}
    <span class="s" style="font-weight:700;color:var(--link)">Statistiques, badges et activités ›</span></button>`;
}
ACT['notif-off'] = () => { db.settings.sysNotif = false; save(); renderPage(); };
