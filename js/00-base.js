'use strict';
/* =====================================================================
   Sport local — prototype web fonctionnel
   Position GPS réelle · carte et lieux OpenStreetMap · itinéraires piétons
   Profil, amis, messages et sessions : enregistrés sur cet appareil
   (mode local) en attendant la connexion à Supabase.
   ===================================================================== */

// ---------- utilitaires ----------
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ICON = {
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  route: 'M4 18a2 2 0 104 0 2 2 0 10-4 0M16 6a2 2 0 104 0 2 2 0 10-4 0M8 18h7a3 3 0 000-6H9a3 3 0 010-6h7',
  cal: 'M4 7h16v13H4zM4 11h16M8 4v4M16 4v4',
  chat: 'M4 5h16v11H9l-5 4z',
  user: 'M8 8a4 4 0 108 0 4 4 0 10-8 0M4 20c1.500-4 5-5 8-5s6.500 1 8 5',
  back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', send: 'M12 19V5M5 12l7-7 7 7'
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;
const fmtDist = m => m == null ? '' : (m < 1000 ? Math.round(m / 10) * 10 + ' m' : (Math.round(m / 100) / 10).toString().replace('.', ',') + ' km');
const fmtKm = m => (Math.round(m / 100) / 10).toString().replace('.', ',');
const initials = n => String(n || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function destPoint(p, dist, bearingDeg) {
  const R = 6371000, r = Math.PI / 180, br = bearingDeg * r, la = p.lat * r, lo = p.lon * r, d = dist / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br));
  const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 / r, lon: lo2 / r };
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

// ---------- données enregistrées sur l'appareil ----------
const KEY = 'sportlocal.v1';
const LEVELS = ['Débutant', 'Intermédiaire', 'Confirmé', 'Expert'];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const SLOTS = ['–', 'matin', 'soir', 'journée'];
// Sur l'appareil : réglages et favoris. Le reste (profil, amis, messages,
// sessions, parcours) est enregistré sur le compte, dans Supabase.
const DEFAULTS = {
  favs: {},
  settings: { radius: 2000, apiKey: '', geoOk: false, manual: null }
};
let db;
try { db = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { db = JSON.parse(JSON.stringify(DEFAULTS)); }
db.settings = Object.assign({}, DEFAULTS.settings, db.settings);
let storageOk = true;
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { if (storageOk) toast('Enregistrement impossible sur ce navigateur'); storageOk = false; } }

// ---------- état en mémoire ----------
const S = {
  tab: 'map', pos: null, posSource: '', acc: null, city: '', country: '',
  places: [], fetchedAt: null, loading: false, loadError: '',
  group: 'all', sheetOpen: true, stack: [],
  chat: [], aiBusy: false, aiHistory: [],
  social: 'messages', search: '', myRoutes: null,
  routeMode: 'track', routeKm: 5, routeBearing: Math.random() * 360, route: null, drawPts: [], routeBusy: false, routeNote: ''
};
