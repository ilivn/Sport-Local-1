'use strict';
// =====================================================================
// 7. SESSIONS (partagées entre membres)
// =====================================================================
const fmtWhen = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
async function loadEvents(force) {
  if (!sb || !S.pos) return;
  if (S.events && !force && Date.now() - S.eventsAt < 60000) return;
  try {
    S.events = await q(sb.rpc('events_nearby', { p_lat: S.pos.lat, p_lng: S.pos.lon, p_radius_m: Math.max(db.settings.radius, 10000) }));
  } catch (e) { S.events = []; S.eventsError = S.user ? errMsg(e) : 'Connectez-vous pour voir les sessions.'; }
  S.eventsAt = Date.now();
  if (S.tab === 'sessions') renderSessions();
  if (typeof checkReminders === 'function') checkReminders();
}
const eventItem = e => `<button class="item" data-act="event" data-id="${e.id}"><span class="grow"><div class="t">${esc(e.title)}</div><div class="s">${esc(fmtWhen(e.starts_at))}</div><div class="s">${esc(e.sport_name)} · ${esc(e.place_name || '')}${e.distance_m != null ? ' · ' + fmtDist(e.distance_m) : ''}</div><div class="s" style="font-weight:700;color:var(--link)">${e.participants_count} / ${e.max_participants} participants${e.joined ? ' · vous participez' : ''}</div></span>${ico('next')}</button>`;
function renderSessions() {
  const el = $('#tab-sessions');
  if (!S.pos) { el.innerHTML = '<div class="pad"><h1>Sessions</h1><div class="note">Choisissez d\'abord une position ou une ville sur la carte.</div></div>'; return; }
  if (!S.events) { loadEvents(); el.innerHTML = '<div class="pad"><h1>Sessions près de vous</h1><div class="note">Chargement…</div></div>'; return; }
  const mine = S.events.filter(e => e.joined), others = S.events.filter(e => !e.joined);
  el.innerHTML = `<div class="pad"><h1>Sessions près de vous</h1>
    <div class="s">Dans un rayon de ${fmtDist(Math.max(db.settings.radius, 10000))}, sur les 30 prochains jours.</div>
    ${!S.user ? loginCard('Créez un compte pour rejoindre une session ou proposer la vôtre.') : ''}
    ${S.eventsError && !S.events.length ? `<div class="note">${esc(S.eventsError)}</div>` : ''}
    ${mine.length ? '<h3>Mes sessions</h3>' + mine.map(eventItem).join('') : ''}
    <h3>${mine.length ? 'Autres sessions' : 'À rejoindre'}</h3>
    ${others.length ? others.map(eventItem).join('') : '<div class="card"><div class="t">Aucune autre session pour l\'instant</div><div class="s">Proposez la première : choisissez un lieu sur la carte, puis « Créer une session ici ».</div></div>'}
    <button class="btn" data-act="tab" data-id="map">Choisir un lieu sur la carte</button></div>`;
}
function pageNewSession(a) {
  if (!S.user) return { title: 'Nouvelle session', body: `<div class="pad">${loginCard('Connectez-vous pour proposer une session.')}</div>` };
  const p = a.placeId ? placeById(a.placeId) : null;
  const placeName = a.routeName ? 'Parcours « ' + a.routeName + ' »' : (p ? p.name : '');
  const d = new Date(Date.now() + 24 * 3600e3); d.setMinutes(0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const guess = a.routeName ? 'Course à pied' : (p && p.sports[0]) || '';
  const sel = S.sports.find(s => norm(s.name) === norm(guess)) || S.sports.find(s => p && p.sports.some(x => norm(x).includes(norm(s.name)))) || null;
  return {
    title: 'Nouvelle session',
    body: `<form class="pad" data-form="session">
      <div class="card"><div class="label">Lieu</div><div class="t">${esc(placeName)}</div></div>
      <label class="field">Titre<input id="ns-title" name="title" type="text" required minlength="3" maxlength="120" value="${esc(sel ? 'Session ' + sel.name.toLowerCase() : '')}" placeholder="Recherche partenaire de tennis"></label>
      <label class="field">Sport<select id="ns-sport" name="sport" required>${S.sports.map(s => `<option value="${s.id}"${sel && sel.id === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="field">Date et heure<input id="ns-when" name="when" type="datetime-local" required value="${local}"></label>
      <label class="field">Niveau attendu<select id="ns-level" name="level">${LEVELS.map((l, i) => `<option value="${i}">${l}</option>`).join('')}</select></label>
      <label class="field">Nombre de places (vous compris)<input id="ns-max" name="max" type="number" min="2" max="100" value="2" required></label>
      <label class="field">Détails (facultatif)<textarea id="ns-desc" name="desc" rows="3" maxlength="2000" placeholder="Matériel, point de rendez-vous…"></textarea></label>
      <button class="btn" type="submit">Publier la session</button></form>`
  };
}
async function submitSession(f) {
  const top = S.stack[S.stack.length - 1], a = top.args;
  const p = a.placeId ? placeById(a.placeId) : null;
  const at = a.routeStart || (p ? { lat: p.lat, lon: p.lon } : S.pos);
  const when = new Date(f.elements.when.value);
  if (isNaN(when) || when < Date.now() - 600000) { toast('Choisissez une date à venir'); return; }
  const row = {
    title: f.elements.title.value.trim(), sport_id: +f.elements.sport.value, starts_at: when.toISOString(),
    level: LEVEL_KEYS[+f.elements.level.value], max_participants: +f.elements.max.value,
    description: f.elements.desc.value.trim() || null, location: point(at),
    place_name: a.routeName ? 'Parcours « ' + a.routeName + ' »' : (p ? p.name : null),
    spot_id: p && p.dbId ? p.dbId : null, route_id: a.routeId || null
  };
  const ev = await act(() => q(sb.from('events').insert(row).select('id').single()));
  if (!ev) return;
  S.events = null; S.stack.pop(); openPage('event', { id: ev.id }); toast('Session publiée');
}
async function loadEvent(id) {
  let ev;
  try {
    const rows = await q(sb.rpc('event_public', { p_id: id }));
    ev = rows && rows[0];
    if (!ev) throw new Error('Cette session n\'existe plus ou a été annulée.');
  } catch (e) {
    if (!S.user || /n'existe plus/.test(e.message)) throw e;
    // Ancienne base (mise-a-jour-2.sql non exécuté) : lecture directe.
    ev = await q(sb.from('events').select('id,title,description,starts_at,level,max_participants,status,organizer_id,place_name,sport_id').eq('id', id).single());
    ev.sport_name = sportName(ev.sport_id);
  }
  let parts = [];
  if (S.user) {
    parts = (await q(sb.from('event_participants').select('user_id').eq('event_id', id))).map(x => x.user_id);
    await namesFor(parts.concat(ev.organizer_id));
    ev.joined = parts.includes(S.user.id);
    ev.participants_count = parts.length;
  }
  return Object.assign(ev, { parts });
}
function pageEvent(a) {
  if (!sb) return { title: 'Session', body: `<div class="pad">${loginCard('')}</div>` };
  const ev = need(a, 'ev', () => loadEvent(a.id));
  if (!ev) return { title: 'Session', body: LOADING };
  if (ev.error) return { title: 'Session', body: failed(ev) };
  const me = S.user ? S.user.id : null;
  const mine = me && ev.organizer_id === me, joined = !!ev.joined, count = ev.participants_count || ev.parts.length;
  const full = count >= ev.max_participants || ev.status === 'complet';
  const friends = (S.friends || []).filter(f => f.friend === 'ami');
  if (joined && !S.friends) loadFriends();
  const soon = new Date(ev.starts_at) - Date.now() < 6.5 * 864e5;
  const wx = ev.lat != null && soon ? need(a, 'wx', () => weather(ev.lat, ev.lng)) : null;
  const wxText = wx && !wx.error ? wxAtText(wx, ev.starts_at) : '';
  let main;
  if (!me) main = loginCard('Créez un compte pour rejoindre cette session.');
  else if (mine) main = `<button class="btn alt" data-act="event-cancel" data-id="${ev.id}">${a.sure ? 'Confirmer l\'annulation' : 'Annuler la session'}</button>`;
  else if (joined) main = `<button class="btn alt" data-act="event-leave" data-id="${ev.id}">Quitter la session</button>`;
  else if (ev.waiting) main = `<div class="note">Vous êtes sur la liste d'attente : vous prendrez automatiquement la première place libérée.</div><button class="btn alt" data-act="waitlist-leave" data-id="${ev.id}">Quitter la liste d'attente</button>`;
  else if (full) main = `<button class="btn" data-act="waitlist-join" data-id="${ev.id}">Session complète : rejoindre la liste d'attente${ev.waitlist_count ? ' (' + ev.waitlist_count + ' en attente)' : ''}</button>`;
  else main = `<button class="btn" data-act="event-join" data-id="${ev.id}">Rejoindre la session</button>`;
  const people = me ? ev.parts.map(uid => `<button class="item" data-act="${uid === me ? 'tab' : 'member'}" data-id="${uid === me ? 'profile' : uid}"><span class="avatar">${initials(S.names[uid])}</span><span class="grow"><div class="t">${esc(S.names[uid] || 'Membre')}${uid === me ? ' (vous)' : ''}</div><div class="s">${uid === ev.organizer_id ? 'Organise la session' : 'Participe'}</div></span>${ico('next')}</button>`).join('')
    : `<div class="note">Organisée par ${esc(ev.organizer_name || 'un membre')}.</div>`;
  return {
    title: 'Session',
    body: `<div class="pad">
      <div><div class="label" style="color:var(--link)">${esc(fmtWhen(ev.starts_at))}</div><h1 style="margin-top:6px">${esc(ev.title)}</h1>
      <div class="s">${esc(ev.sport_name || sportName(ev.sport_id))} · ${LEVELS[levelIndex(ev.level)]} · ${count} / ${ev.max_participants} participants</div></div>
      ${ev.place_name ? `<div class="card"><div class="label">Lieu</div><div class="t">${esc(ev.place_name)}</div>${ev.lat != null ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${ev.lat},${ev.lng}&travelmode=walking">Itinéraire</a>` : ''}</div>` : ''}
      ${wxText ? `<div class="card"><div class="label">Météo prévue à l'heure de la session</div><div class="t">${esc(wxText)}</div></div>` : ''}
      ${ev.description ? `<div class="card"><div class="label">Détails</div><div class="hours">${esc(ev.description)}</div></div>` : ''}
      <h3>Participants</h3>
      ${people}
      ${joined ? `<button class="btn lime" data-act="event-chat" data-id="${ev.id}">Ouvrir la discussion du groupe</button>` : ''}
      ${main}
      <button class="btn alt small" data-act="share-event" data-id="${ev.id}">Partager cette session</button>
      ${joined && friends.length ? '<h3>Inviter un ami</h3>' + friends.filter(f => !ev.parts.includes(f.id)).map(f => `<button class="item" data-act="invite" data-id="${f.id}" data-event="${ev.id}"><span class="avatar">${initials(personName(f))}</span><span class="grow"><div class="t">${esc(personName(f))}</div><div class="s">Envoyer l'invitation par message</div></span>${ico('next')}</button>`).join('') : ''}
    </div>`
  };
}
