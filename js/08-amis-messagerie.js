'use strict';
// =====================================================================
// 8. AMIS ET MESSAGERIE
// =====================================================================
async function loadFriends() {
  if (!S.user) return;
  const [f, s] = await Promise.all([act(() => q(sb.rpc('my_friends'))), act(() => q(sb.rpc('suggest_friends', { p_limit: 8 })))]);
  S.friends = f || []; S.suggestions = s || [];
  if (S.tab === 'social') renderSocial();
  const top = S.stack[S.stack.length - 1]; if (top && top.type === 'event') renderPage();
}
const memberItem = (p, sub) => `<button class="item" data-act="member" data-id="${p.id}"><span class="avatar">${initials(personName(p))}</span><span class="grow"><div class="t">${esc(personName(p))}</div><div class="s">${esc(sub || [p.city, sportsLine(p.sports)].filter(Boolean).join(' · ') || '@' + p.username)}</div></span>${ico('next')}</button>`;
function renderSocial() {
  const el = $('#tab-social');
  if (!S.user) { el.innerHTML = `<div class="pad"><h1>Messages et amis</h1>${loginCard('Connectez-vous pour discuter avec d\'autres sportifs et ajouter des amis.')}</div>`; return; }
  const seg = [['messages', 'Messages'], ['friends', 'Amis'], ['groups', 'Groupes'], ['search', 'Chercher']];
  let body = '';
  if (S.social === 'messages') {
    body = S.convs.length ? S.convs.map(c => `<button class="item" data-act="chat" data-id="${c.conversation_id}"><span class="avatar"${c.kind === 'event' ? ' style="background:var(--lime);color:#12201A"' : c.group_id ? ' style="background:var(--green);color:#fff"' : ''}>${c.kind === 'event' ? 'S' : initials(c.title)}</span><span class="grow"><div class="t">${esc(c.title || 'Discussion')}${c.unread ? ' <span class="tag lime">nouveau</span>' : ''}</div><div class="s" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last_message || (c.kind === 'event' ? 'Discussion de la session' : c.group_id ? 'Discussion du groupe' : 'Aucun message'))}</div></span>${ico('next')}</button>`).join('')
      : '<div class="card"><div class="t">Aucune conversation</div><div class="s">Trouvez un sportif dans « Rechercher » ou rejoignez une session pour discuter.</div></div>';
  } else if (S.social === 'friends') {
    if (!S.friends) { loadFriends(); body = '<div class="note">Chargement…</div>'; }
    else {
      const got = S.friends.filter(f => f.friend === 'recue'), fr = S.friends.filter(f => f.friend === 'ami'), sent = S.friends.filter(f => f.friend === 'envoyee');
      body = `${got.length ? '<h3>Demandes reçues</h3>' + got.map(p => `<div class="item"><span class="avatar">${initials(personName(p))}</span><button class="grow" data-act="member" data-id="${p.id}" style="border:0;background:none;text-align:left;min-height:44px"><div class="t">${esc(personName(p))}</div><div class="s">${esc(sportsLine(p.sports) || '@' + p.username)}</div></button><button class="btn small" data-act="friend-accept" data-id="${p.id}">Accepter</button><button class="btn small alt" data-act="friend-remove" data-id="${p.id}" aria-label="Refuser la demande de ${esc(personName(p))}">Refuser</button></div>`).join('') : ''}
        <h3>Mes amis (${fr.length})</h3>${fr.length ? fr.map(p => memberItem(p)).join('') : '<div class="note">Pas encore d\'amis. Les suggestions ci-dessous partagent vos sports ou votre ville.</div>'}
        ${sent.length ? '<h3>Demandes envoyées</h3>' + sent.map(p => memberItem(p, 'En attente de réponse')).join('') : ''}
        <h3>Suggestions</h3>${!S.me || !S.me.sports.length ? '<div class="note">Ajoutez vos sports à votre profil pour des suggestions plus justes.</div>' : ''}
        ${(S.suggestions || []).length ? S.suggestions.map(p => memberItem(p, p.shared && p.shared.length ? 'Pratique aussi : ' + p.shared.join(', ') : [p.city, sportsLine(p.sports)].filter(Boolean).join(' · '))).join('') : '<div class="note">Aucune suggestion pour le moment : invitez vos amis à créer un compte.</div>'}`;
    }
  } else if (S.social === 'groups') {
    body = groupsHtml();
  } else {
    body = `<label class="field">Rechercher un sportif<input id="social-search" type="search" placeholder="Nom, pseudo, ville ou sport" value="${esc(S.search)}" autocomplete="off"></label><div id="social-results" style="display:flex;flex-direction:column;gap:10px">${searchHtml()}</div>`;
  }
  el.innerHTML = `<div class="pad"><h1>Messages et amis</h1><div class="seg">${seg.map(s => `<button class="${S.social === s[0] ? 'on' : ''}" data-act="social" data-id="${s[0]}">${s[1]}</button>`).join('')}</div>${body}</div>`;
}
function searchHtml() {
  if (!S.search.trim()) return '<div class="note">Tapez au moins deux lettres.</div>';
  if (!S.searchRes) return '<div class="note">Recherche…</div>';
  return S.searchRes.length ? S.searchRes.map(p => memberItem(p, p.friend === 'ami' ? 'Ami · ' + sportsLine(p.sports) : null)).join('') : '<div class="note">Aucun membre ne correspond.</div>';
}
let searchT;
function onSearchInput(v) {
  S.search = v; S.searchRes = null; clearTimeout(searchT);
  const box = $('#social-results'); if (box) box.innerHTML = searchHtml();
  if (v.trim().length < 2) return;
  searchT = setTimeout(async () => {
    const r = await act(() => q(sb.rpc('search_profiles', { p_query: v.trim() })));
    if (S.search !== v) return;
    S.searchRes = r || []; const b = $('#social-results'); if (b) b.innerHTML = searchHtml();
  }, 300);
}
async function loadMember(id) {
  const [p, sp, fr] = await Promise.all([
    q(sb.from('profiles').select('id,username,display_name,city,bio,availability,avatar_url').eq('id', id).single()),
    q(sb.from('profile_sports').select('sport_id,level').eq('profile_id', id)),
    q(sb.from('friendships').select('requester_id,addressee_id,status').or(`and(requester_id.eq.${S.user.id},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${S.user.id})`))
  ]);
  const f = fr[0];
  return Object.assign(p, {
    sports: sp.map(x => ({ name: sportName(x.sport_id), level: levelIndex(x.level) })),
    dispo: p.availability && Array.isArray(p.availability.days) ? p.availability.days : null,
    friend: !f ? null : f.status === 'accepted' ? 'ami' : (f.requester_id === S.user.id ? 'envoyee' : 'recue')
  });
}
function pageMember(a) {
  if (!S.user) return { title: 'Profil', body: `<div class="pad">${loginCard('Connectez-vous pour voir les profils.')}</div>` };
  const p = need(a, 'p', () => loadMember(a.id));
  if (!p) return { title: 'Profil', body: LOADING };
  if (p.error) return { title: 'Profil', body: failed(p) };
  const btn = { ami: `<button class="btn alt" data-act="friend-remove" data-id="${p.id}">Retirer de mes amis</button>`, envoyee: `<button class="btn alt" data-act="friend-remove" data-id="${p.id}">Annuler ma demande</button>`, recue: `<div class="row"><button class="btn" data-act="friend-accept" data-id="${p.id}">Accepter la demande</button><button class="btn alt" data-act="friend-remove" data-id="${p.id}">Refuser</button></div>` }[p.friend] || `<button class="btn lime" data-act="friend-add" data-id="${p.id}">Ajouter en ami</button>`;
  const dispo = p.dispo && p.dispo.some(Boolean) ? DAYS.map((d, i) => p.dispo[i] ? d + ' ' + SLOTS[p.dispo[i]] : '').filter(Boolean).join(', ') : '';
  return {
    title: 'Profil',
    body: `<div class="pad"><div style="display:flex;align-items:center;gap:16px">${avatarHtml(personName(p), p.avatar_url, true)}<div style="min-width:0"><h1>${esc(personName(p))}</h1><div class="s">@${esc(p.username)}${p.city ? ' · ' + esc(p.city) : ''}${p.friend === 'ami' ? ' · ami' : ''}</div></div></div>
      ${p.bio ? `<div>${esc(p.bio)}</div>` : ''}
      <div class="card"><div class="label">Sports pratiqués</div>${p.sports.length ? p.sports.map(s => `<div><b>${esc(s.name)}</b> · ${LEVELS[s.level]}</div>`).join('') : '<div class="s">Non renseignés</div>'}</div>
      ${dispo ? `<div class="card"><div class="label">Disponibilités</div><div>${esc(dispo)}</div></div>` : ''}
      <button class="btn" data-act="dm" data-id="${p.id}">Envoyer un message</button>${btn}
      <div class="row"><button class="btn small alt" data-act="report" data-id="${p.id}">Signaler</button><button class="btn small alt" data-act="block" data-id="${p.id}">${a.sureBlock ? 'Confirmer le blocage' : 'Bloquer'}</button></div></div>`
  };
}
async function loadChat(id) {
  const [conv, members, msgs] = await Promise.all([
    q(sb.from('conversations').select('id,kind,event_id,group_id').eq('id', id).single()),
    q(sb.from('conversation_members').select('user_id').eq('conversation_id', id)),
    q(sb.from('messages').select('id,sender_id,content,created_at').eq('conversation_id', id).order('created_at', { ascending: false }).limit(150))
  ]);
  await namesFor(members.map(m => m.user_id));
  let title, other = null;
  if (conv.kind === 'event') { const e = await q(sb.from('events').select('title').eq('id', conv.event_id).maybeSingle()); title = e ? e.title : 'Session'; }
  else if (conv.group_id) { const g = await q(sb.from('groups').select('name').eq('id', conv.group_id).maybeSingle()); title = g ? g.name : 'Groupe'; }
  else { other = (members.find(m => m.user_id !== S.user.id) || {}).user_id; title = S.names[other] || 'Discussion'; }
  markRead(id);
  return { conv, title, other, msgs: msgs.reverse() };
}
function chatHtml(a) {
  return a.msgs.length ? a.msgs.map(m => { const me = m.sender_id === S.user.id; return `<div class="bubble${me ? ' me' : ''}">${!me && (a.meta.conv.kind === 'event' || a.meta.conv.group_id) ? `<div style="font-size:12px;font-weight:700;color:var(--link)">${esc(S.names[m.sender_id] || 'Membre')}</div>` : ''}${esc(m.content)}<div style="font-size:11px;opacity:.7;margin-top:4px">${new Date(m.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>`; }).join('')
    : '<div class="note" style="align-self:center">Écrivez le premier message.</div>';
}
function paintChat(a) {
  const box = $('#chat-msgs'); if (!box) return;
  box.innerHTML = chatHtml(a); const b = box.closest('.pagebody'); b.scrollTop = b.scrollHeight;
}
function pageChat(a) {
  if (!S.user) return { title: 'Discussion', body: `<div class="pad">${loginCard('Connectez-vous pour discuter.')}</div>` };
  const meta = need(a, 'meta', () => loadChat(a.id));
  if (!meta) return { title: 'Discussion', body: LOADING };
  if (meta.error) return { title: 'Discussion', body: failed(meta) };
  if (!a.msgs) a.msgs = meta.msgs;
  return {
    title: meta.title, titleAct: meta.other ? `data-act="member" data-id="${meta.other}"` : (meta.conv.event_id ? `data-act="event" data-id="${meta.conv.event_id}"` : meta.conv.group_id ? `data-act="group-open" data-id="${meta.conv.group_id}"` : ''),
    body: `<div class="msgs" id="chat-msgs">${chatHtml(a)}</div>`,
    foot: `<form class="send" data-form="msg" data-id="${a.id}"><input id="msg-input" name="msg" type="text" maxlength="2000" placeholder="Écrire un message…" autocomplete="off" aria-label="Écrire un message"><button type="submit" aria-label="Envoyer">${ico('send')}</button></form>`,
    scrollEnd: true
  };
}
async function sendMessage(convId, text) {
  const m = await act(() => q(sb.from('messages').insert({ conversation_id: convId, content: text }).select('id,sender_id,content,created_at,conversation_id').single()));
  if (m) onNewMessage(m);
  return !!m;
}
async function openDirect(userId) {
  const id = await act(() => q(sb.rpc('start_direct_conversation', { p_other: userId })));
  if (id) openPage('chat', { id });
  return id;
}
function pageReport(a) {
  if (!S.user) return { title: 'Signaler', body: `<div class="pad">${loginCard('Connectez-vous pour envoyer un signalement.')}</div>` };
  const spot = a.type === 'spot';
  return { title: spot ? 'Signaler une erreur' : 'Signaler', body: `<form class="pad" data-form="report" data-id="${esc(a.id)}" data-type="${spot ? 'spot' : 'profile'}"><div>${spot ? 'Lieu fermé, mauvais emplacement, informations fausses, doublon… Dites-nous ce qui ne va pas.' : 'Expliquez en quelques mots ce qui pose problème. Votre signalement reste anonyme pour la personne concernée.'}</div><label class="field">Motif<textarea id="rp-reason" name="reason" rows="5" required minlength="3" maxlength="1000"></textarea></label><button class="btn" type="submit">Envoyer le signalement</button></form>` };
}
