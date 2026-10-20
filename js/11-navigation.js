'use strict';
// =====================================================================
// 11. NAVIGATION
// =====================================================================
const TABS = [['map', 'Carte', 'map'], ['routes', 'Parcours', 'route'], ['sessions', 'Sessions', 'cal'], ['social', 'Messages', 'chat'], ['profile', 'Profil', 'user']];
function renderTabbar() {
  const unread = S.convs.filter(c => c.unread).length, nn = typeof unreadNotifs === 'function' ? unreadNotifs() : 0;
  const badge = id => id === 'social' && unread ? `<span class="badge" aria-label="${unread} non lu${unread > 1 ? 's' : ''}">${unread}</span>` : id === 'profile' && nn ? `<span class="badge" aria-label="${nn} notification${nn > 1 ? 's' : ''}">${nn > 9 ? '9+' : nn}</span>` : '';
  $('#tabbar').innerHTML = TABS.map(t => `<button class="${t[0] === S.tab ? 'on' : ''}" data-act="tab" data-id="${t[0]}"${t[0] === S.tab ? ' aria-current="page"' : ''} style="position:relative">${ico(t[2])}${t[1]}${badge(t[0])}</button>`).join('');
}
function showTab(id) {
  S.tab = id; S.stack = []; renderPage();
  TABS.forEach(t => $('#tab-' + t[0]).classList.toggle('on', t[0] === id));
  renderTabbar();
  if (id === 'map') { map.invalidateSize(); renderSheet(); }
  if (id === 'routes') { initMap2(); renderRoutes(); if (S.routeMode === 'gen' && !S.route && S.pos) generateLoop(); }
  if (id === 'sessions') { renderSessions(); loadEvents(); }
  if (id === 'social') { renderSocial(); refreshConvs(); }
  if (id === 'profile') renderProfile();
}
const PAGES = { assistant: pageAssistant, place: pagePlace, 'new-session': pageNewSession, event: pageEvent, member: pageMember, chat: pageChat, 'edit-profile': pageEditProfile, settings: pageSettings, auth: pageAuth, newpass: pageNewPass, report: pageReport };
function openPage(type, args) { S.stack.push({ type, args: args || {} }); renderPage(); }
function back() { S.stack.pop(); renderPage(); refreshTab(); }
function refreshTab() { if (S.tab === 'sessions') renderSessions(); if (S.tab === 'social') renderSocial(); if (S.tab === 'profile') renderProfile(); if (S.tab === 'map') renderSheet(); if (S.tab === 'routes') renderRoutes(); }
function renderPage() {
  const el = $('#page'), top = S.stack[S.stack.length - 1];
  if (!top) { el.classList.remove('on'); el.innerHTML = ''; return; }
  const p = PAGES[top.type](top.args);
  el.classList.add('on');
  el.innerHTML = `<div class="pagehead"><button class="back" data-act="back" aria-label="Retour">${ico('back')}</button>${p.titleAct ? `<button ${p.titleAct} style="border:0;background:none;padding:0;min-height:44px;text-align:left;min-width:0"><h2>${esc(p.title)}</h2></button>` : `<h2>${esc(p.title)}</h2>`}</div><div class="pagebody">${p.body}</div>${p.foot ? `<div class="pagefoot">${p.foot}</div>` : ''}`;
  if (p.scrollEnd) { const b = $('.pagebody', el); b.scrollTop = b.scrollHeight; }
}
const topArgs = () => (S.stack[S.stack.length - 1] || {}).args || {};
const reloadTop = () => { const a = topArgs(); Object.keys(a).forEach(k => { if (!['id', 'mode', 'placeId', 'routeId', 'routeName', 'routeStart', 'type', 'at'].includes(k)) delete a[k]; }); renderPage(); };

// ---------- actions ----------
const ACT = {
  tab: id => showTab(id),
  back: () => back(),
  assistant: () => openPage('assistant'),
  recenter: () => { if (S.pos) map.setView([S.pos.lat, S.pos.lon], 16); },
  group: id => { S.group = id; renderChips(); drawPlaces(); renderSheet(); },
  sheet: () => { S.sheetOpen = !S.sheetOpen; renderSheet(); },
  reload: () => loadPlaces(),
  widen: () => { db.settings.radius = db.settings.radius < 5000 ? 5000 : 10000; save(); S.fetchedAt = null; loadPlaces(); },
  place: id => openPage('place', { id }),
  ask: (id, el) => ask(el.dataset.q),
  'widen-ask': async (id, el) => { db.settings.radius = 10000; save(); S.fetchedAt = null; await loadPlaces(); ask(el.dataset.q); },
  fav: id => toggleFav(id),
  'fav-show': id => { const f = favs()[id]; if (f && f.lat != null) { showTab('map'); map.setView([f.lat, f.lon], 17); toast('Le lieu est au centre de la carte'); } },
  filters: () => openPage('filters'),
  filter: id => { S.filters[id] = !S.filters[id]; renderChips(); drawPlaces(); renderSheet(); renderPage(); },
  'filters-clear': () => { Object.keys(S.filters).forEach(k => { S.filters[k] = false; }); renderChips(); drawPlaces(); renderSheet(); renderPage(); },
  explore: () => { db.settings.manual = { lat: 48.8566, lon: 2.3522 }; save(); $('#gate').hidden = true; setPosition(48.8566, 2.3522, 'ville', null, true); toast('Vous explorez Paris. Changez de ville dans Profil › Réglages.'); },
  'share-place': id => { const p = placeById(id); if (p) shareLink(p.name, `${p.name} sur Sport local`, placeHash(p)); },
  'share-event': id => { const ev = topArgs().ev; shareLink(ev && ev.title ? ev.title : 'Session', ev && ev.title ? `Rejoins la session « ${ev.title} » sur Sport local` : 'Session sur Sport local', 'session/' + id); },
  review: id => openPage('review', { placeId: id }),
  'review-star': id => { const a = topArgs(); const f = $('[data-form="review"]'); a.draft = f ? f.elements.comment.value : ''; a.rating = +id; renderPage(); const f2 = $('[data-form="review"]'); if (f2 && a.draft != null) f2.elements.comment.value = a.draft; },
  'review-del': async id => { const ok = await act(() => q(sb.from('spot_reviews').delete().eq('id', id))); if (ok !== undefined) { toast('Avis supprimé'); reloadTop(); } },
  propose: () => openPage('propose'),
  'report-spot': id => { const p = placeById(id); if (p) openPage('report', { id: p.userSpot ? p.dbId : p.osm, type: 'spot' }); },
  theme: id => { db.settings.theme = id; save(); applyTheme(); renderPage(); },
  install: async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; refreshTab(); },
  'waitlist-join': async id => { const ok = await act(() => q(sb.from('event_waitlist').insert({ event_id: id }))); if (ok !== undefined) toast('Vous êtes sur la liste d\'attente'); reloadTop(); },
  'waitlist-leave': async id => { await act(() => q(sb.from('event_waitlist').delete().eq('event_id', id).eq('user_id', S.user.id))); reloadTop(); },
  auth: id => openPage('auth', { mode: id }),
  'auth-switch': id => { const a = topArgs(); a.mode = id; a.msg = ''; renderPage(); },
  logout: async () => { await sb.auth.signOut(); S.stack = []; renderPage(); toast('Déconnecté'); },
  'delete-account': async () => {
    const a = topArgs();
    if (!a.sureDelete) { a.sureDelete = true; renderPage(); return; }
    const ok = await act(() => q(sb.rpc('delete_my_account')));
    if (ok !== undefined) { await sb.auth.signOut(); S.stack = []; renderPage(); toast('Compte supprimé'); }
  },
  'new-session': id => openPage('new-session', { placeId: id }),
  event: id => openPage('event', { id }),
  'event-join': async id => { const ok = await act(() => q(sb.from('event_participants').insert({ event_id: id }))); if (ok !== undefined) toast('Vous participez à la session'); S.events = null; reloadTop(); refreshConvs(); },
  'event-leave': async id => { await act(() => q(sb.from('event_participants').delete().eq('event_id', id).eq('user_id', S.user.id))); S.events = null; reloadTop(); refreshConvs(); },
  'event-cancel': async id => {
    const a = topArgs();
    if (!a.sure) { a.sure = true; renderPage(); return; }
    const ok = await act(() => q(sb.from('events').delete().eq('id', id)));
    if (ok !== undefined) { S.events = null; toast('Session annulée'); back(); refreshConvs(); }
  },
  'event-chat': async id => { const c = await act(() => q(sb.from('conversations').select('id').eq('event_id', id).maybeSingle())); if (c) openPage('chat', { id: c.id }); else toast('Discussion introuvable'); },
  invite: async (id, el) => {
    const ev = topArgs().ev; if (!ev) return;
    const conv = await act(() => q(sb.rpc('start_direct_conversation', { p_other: id })));
    if (conv && await sendMessage(conv, `Je t'invite à ma session « ${ev.title} », ${fmtWhen(ev.starts_at)}${ev.place_name ? ', ' + ev.place_name : ''} : ${SITE_URL}#session/${ev.id}`)) toast('Invitation envoyée');
  },
  social: id => { S.social = id; renderSocial(); if (id === 'messages') refreshConvs(); },
  member: id => openPage('member', { id }),
  chat: id => openPage('chat', { id }),
  dm: id => openDirect(id),
  'friend-add': async id => { const ok = await act(() => q(sb.from('friendships').insert({ addressee_id: id }))); if (ok !== undefined) toast('Demande d\'ami envoyée'); S.friends = null; S.suggestions = null; reloadTop(); refreshTab(); },
  'friend-accept': async id => { const ok = await act(() => q(sb.from('friendships').update({ status: 'accepted' }).eq('requester_id', id).eq('addressee_id', S.user.id))); if (ok !== undefined) toast('Vous êtes maintenant amis'); S.friends = null; reloadTop(); refreshTab(); },
  'friend-remove': async id => { await act(() => q(sb.from('friendships').delete().or(`and(requester_id.eq.${S.user.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${S.user.id})`))); S.friends = null; S.suggestions = null; reloadTop(); refreshTab(); },
  report: id => openPage('report', { id }),
  block: async id => {
    const a = topArgs();
    if (!a.sureBlock) { a.sureBlock = true; renderPage(); return; }
    const ok = await act(async () => { await q(sb.from('user_blocks').insert({ blocked_id: id })); await q(sb.from('friendships').delete().or(`and(requester_id.eq.${S.user.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${S.user.id})`)); return true; });
    if (ok) { S.friends = null; S.suggestions = null; S.searchRes = null; toast('Membre bloqué'); back(); }
  },
  'edit-profile': () => openEditProfile(),
  'pf-sport': id => { keepDraft(); const sid = +id, i = S.draft.sports.findIndex(s => s.id === sid); if (i >= 0) S.draft.sports.splice(i, 1); else S.draft.sports.push({ id: sid, name: sportName(sid), level: 0 }); renderPage(); },
  'pf-level': id => { keepDraft(); S.draft.sports[+id].level = (S.draft.sports[+id].level + 1) % 4; renderPage(); },
  'pf-dispo': id => { keepDraft(); S.draft.dispo[+id] = (S.draft.dispo[+id] + 1) % 4; renderPage(); },
  settings: () => openPage('settings'),
  'geo-allow': () => { startGeo(); if (S.stack.length) toast('Demande de position envoyée au navigateur'); },
  'geo-change': () => showGate(''),
  radius: id => { db.settings.radius = +id; save(); S.fetchedAt = null; S.events = null; loadPlaces(); renderPage(); },
  'route-mode': id => { S.routeMode = id; S.route = null; S.routeNote = ''; routeLayer.clearLayers(); drawLayer.clearLayers(); S.drawPts = []; renderRoutes(); if (id === 'gen') generateLoop(); },
  'route-km': id => { S.routeKm = +id; generateLoop(); },
  'route-gen': () => { S.routeBearing = Math.random() * 360; generateLoop(); },
  'draw-undo': () => { S.drawPts.pop(); computeDrawn(); },
  'draw-clear': () => { S.drawPts = []; computeDrawn(); },
  'route-show': id => { const x = (S.myRoutes || []).find(r => r.id === id); if (x) { S.route = { line: routeLine(x), dist: x.distance_m }; drawRoute(); renderRoutes(); } },
  'route-del': async id => { const ok = await act(() => q(sb.from('routes').delete().eq('id', id))); if (ok !== undefined) { toast('Parcours supprimé'); S.route = null; routeLayer.clearLayers(); loadMyRoutes(true); } },
  'route-session': id => { const x = (S.myRoutes || []).find(r => r.id === id); if (!x) return; const l = routeLine(x); openPage('new-session', { routeId: x.id, routeName: x.name, routeStart: l.length ? { lat: l[0][0], lon: l[0][1] } : S.pos }); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act]; if (fn) fn(el.dataset.id, el);
});
const FORMS = {
  'geo-city': f => { const v = f.elements.city.value.trim(); if (v) useCity(v); },
  ask: f => { const v = f.elements.q.value; f.reset(); ask(v); },
  auth: f => submitAuth(f),
  newpass: async f => { const ok = await act(async () => { const r = await sb.auth.updateUser({ password: f.elements.pass.value }); if (r.error) throw r.error; return true; }); if (ok) { toast('Mot de passe modifié'); back(); } },
  msg: async f => { const v = f.elements.msg.value.trim(); if (!v) return; f.elements.msg.value = ''; if (!await sendMessage(f.dataset.id, v)) f.elements.msg.value = v; },
  session: f => submitSession(f),
  report: async f => { const ok = await act(() => q(sb.from('reports').insert({ target_type: f.dataset.type || 'profile', target_id: f.dataset.id, reason: f.elements.reason.value.trim() }))); if (ok !== undefined) { toast('Signalement envoyé, merci'); back(); } },
  profile: () => saveProfile(),
  apikey: f => { db.settings.apiKey = f.elements.key.value.trim(); S.aiHistory = []; save(); toast(db.settings.apiKey ? 'Clé enregistrée : l\'assistant utilise l\'IA' : 'Clé retirée : assistant sans IA'); },
  'save-route': f => { if (S.route) saveRoute(f.elements.name.value.trim()); },
  review: f => submitReview(f),
  propose: f => submitPropose(f)
};
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault(); FORMS[f.dataset.form](f);
});
document.addEventListener('input', e => { if (e.target.id === 'social-search') onSearchInput(e.target.value); });
document.addEventListener('change', e => {
  const el = e.target.closest('[data-upload]'); if (!el || !el.files || !el.files[0]) return;
  const file = el.files[0]; el.value = '';
  if (!/^image\//.test(file.type)) { toast('Choisissez une image (photo JPEG ou PNG).'); return; }
  if (el.dataset.upload === 'avatar') uploadAvatar(file); else uploadSpotPhoto(file, el.dataset.id);
});
