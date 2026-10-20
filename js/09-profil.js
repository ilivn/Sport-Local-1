'use strict';
// =====================================================================
// 9. PROFIL ET RÉGLAGES
// =====================================================================
function renderProfile() {
  const el = $('#tab-profile');
  if (!S.user) { el.innerHTML = `<div class="pad"><h1>Profil</h1>${loginCard('Créez votre profil pour être trouvé par les sportifs de votre ville.')}${installCard()}<button class="btn alt" data-act="settings">Réglages</button></div>`; return; }
  const p = S.me;
  if (!p) { el.innerHTML = '<div class="pad"><div class="note">Chargement du profil…</div></div>'; return; }
  const fv = favs(), favIds = Object.keys(fv).filter(id => fv[id]);
  el.innerHTML = `<div style="padding:24px 16px;background:var(--green);color:#fff;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:16px">${avatarHtml(personName(p), p.avatar_url, true)}<div style="min-width:0"><h1>${esc(personName(p))}</h1><div>@${esc(p.username)}${p.city ? ' · ' + esc(p.city) : ''}</div></div></div>
      <div>${esc(p.bio || 'Présentez-vous en une phrase pour trouver des partenaires.')}</div>
      <button class="btn lime" data-act="edit-profile">Modifier le profil</button></div>
    <div class="pad">${profileStatsHtml()}<h3>Sports pratiqués</h3>
      ${p.sports.length ? p.sports.map(s => `<div class="item"><span class="grow t">${esc(s.name)}</span><span class="tag lime">${LEVELS[s.level]}</span></div>`).join('') : '<div class="note">Aucun sport renseigné.</div>'}
      <h3>Disponibilités</h3>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px">${DAYS.map((d, i) => `<div style="padding:8px 0;border-radius:12px;text-align:center;font-size:13px;font-weight:700;background:${p.dispo[i] ? 'var(--green)' : 'var(--surface)'};color:${p.dispo[i] ? '#fff' : 'var(--muted)'}">${d}<div style="font-size:11px;font-weight:500">${SLOTS[p.dispo[i]]}</div></div>`).join('')}</div>
      <h3>Lieux favoris</h3>
      ${favIds.length ? favIds.map(id => { const pl = placeById(id); return pl ? placeItem(pl) : `<button class="item" data-act="fav-show" data-id="${id}"><span class="grow"><div class="t">${esc(fv[id].name)}</div><div class="s">Hors de la zone affichée · voir sur la carte</div></span>${ico('next')}</button>`; }).join('') : '<div class="note">Aucun lieu en favori.</div>'}
      ${installCard()}
      <button class="btn alt" data-act="settings">Réglages et compte</button></div>`;
}
function openEditProfile() {
  if (!S.me) return;
  S.draft = { username: S.me.username, display_name: S.me.display_name || '', city: S.me.city || S.city || '', bio: S.me.bio || '', sports: S.me.sports.map(s => Object.assign({}, s)), dispo: S.me.dispo.slice() };
  openPage('edit-profile');
}
function pageEditProfile() {
  const p = S.draft;
  return {
    title: 'Modifier le profil',
    body: `<form class="pad" data-form="profile">
      <div style="display:flex;align-items:center;gap:14px">${avatarHtml(p.display_name || S.me.username, S.me.avatar_url, true)}<label class="btn alt small" style="cursor:pointer">Changer la photo<input type="file" accept="image/*" data-upload="avatar" hidden></label></div>
      <label class="field">Nom affiché<input id="pf-name" name="name" type="text" maxlength="60" required value="${esc(p.display_name)}" placeholder="Prénom et initiale"></label>
      <label class="field">Pseudo<input id="pf-user" name="user" type="text" maxlength="30" required pattern="[a-z0-9_]{3,30}" value="${esc(p.username)}"><span class="note" style="font-weight:400">3 à 30 caractères : lettres minuscules, chiffres ou _</span></label>
      <label class="field">Ville<input id="pf-city" name="city" type="text" maxlength="60" value="${esc(p.city)}"></label>
      <label class="field">Présentation<textarea id="pf-bio" name="bio" rows="3" maxlength="500" placeholder="Ce que vous cherchez, vos habitudes…">${esc(p.bio)}</textarea></label>
      <div class="field">Sports pratiqués<div class="note" style="font-weight:400">Touchez un sport pour l'ajouter, puis son niveau pour le changer.</div>
        <div class="chips wrap">${S.sports.map(s => `<button type="button" class="chip${p.sports.some(x => x.id === s.id) ? ' on' : ''}" data-act="pf-sport" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div></div>
      ${p.sports.map((s, i) => `<button type="button" class="item" data-act="pf-level" data-id="${i}"><span class="grow t">${esc(s.name)}</span><span class="tag lime">${LEVELS[s.level]}</span></button>`).join('')}
      <div class="field">Disponibilités<div class="note" style="font-weight:400">Touchez un jour pour changer le créneau.</div>
        <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px">${DAYS.map((d, i) => `<button type="button" data-act="pf-dispo" data-id="${i}" aria-label="${d} : ${SLOTS[p.dispo[i]]}" style="min-height:56px;padding:0;border:0;border-radius:12px;font-size:13px;font-weight:700;background:${p.dispo[i] ? 'var(--green)' : 'var(--surface)'};color:${p.dispo[i] ? '#fff' : 'var(--muted)'}">${d}<div style="font-size:11px;font-weight:500">${SLOTS[p.dispo[i]]}</div></button>`).join('')}</div></div>
      <button class="btn" type="submit">Enregistrer</button></form>`
  };
}
function keepDraft() { const f = $('[data-form="profile"]'); if (f) { S.draft.display_name = f.elements.name.value; S.draft.username = f.elements.user.value; S.draft.city = f.elements.city.value; S.draft.bio = f.elements.bio.value; } }
async function saveProfile() {
  keepDraft();
  const d = S.draft, username = d.username.trim().toLowerCase();
  if (!d.display_name.trim()) { toast('Indiquez un nom affiché'); return; }
  if (!/^[a-z0-9_]{3,30}$/.test(username)) { toast('Pseudo : 3 à 30 caractères, lettres minuscules, chiffres ou _'); return; }
  const ok = await act(async () => {
    await q(sb.from('profiles').update({ username, display_name: d.display_name.trim(), city: d.city.trim() || null, bio: d.bio.trim() || null, availability: { days: d.dispo } }).eq('id', S.user.id));
    await q(sb.from('profile_sports').delete().eq('profile_id', S.user.id));
    if (d.sports.length) await q(sb.from('profile_sports').insert(d.sports.map(s => ({ profile_id: S.user.id, sport_id: s.id, level: LEVEL_KEYS[s.level] }))));
    await loadMe(); return true;
  });
  if (ok) { S.suggestions = null; toast('Profil enregistré'); back(); }
}
function pageSettings(a) {
  const src = S.posSource === 'gps' ? 'GPS en temps réel' + (S.acc ? ' (précision ' + Math.round(S.acc) + ' m)' : '') : 'Ville choisie' + (S.city ? ' : ' + S.city : '');
  return {
    title: 'Réglages',
    body: `<div class="pad">
      ${S.user ? `<div class="card"><div class="label">Compte</div><div class="t">${esc(S.user.email || '')}</div><button class="btn small alt" data-act="logout" style="margin-top:6px">Se déconnecter</button></div>` : loginCard('Vous n\'êtes pas connecté.')}
      <div class="card"><div class="label">Position</div><div class="t">${esc(src)}</div><div class="row" style="margin-top:6px"><button class="btn small" data-act="geo-allow">Utiliser mon GPS</button><button class="btn small alt" data-act="geo-change">Choisir une ville</button></div></div>
      ${S.user ? `<div class="card"><div class="label">Notifications sur cet appareil</div><div class="note">${!('Notification' in window) ? 'Non disponibles sur ce navigateur (sur iPhone : installez d\'abord l\'appli sur l\'écran d\'accueil).' : Notification.permission === 'denied' ? 'Bloquées dans les réglages du navigateur.' : db.settings.sysNotif && Notification.permission === 'granted' ? 'Activées : vous êtes prévenu même quand l\'appli est en arrière-plan.' : 'Désactivées.'}</div>${'Notification' in window && Notification.permission !== 'denied' ? `<button class="btn small alt" data-act="${db.settings.sysNotif && Notification.permission === 'granted' ? 'notif-off' : 'notif-perm'}" style="margin-top:6px">${db.settings.sysNotif && Notification.permission === 'granted' ? 'Désactiver' : 'Activer'}</button>` : ''}</div>` : ''}
      <div class="card"><div class="label">Apparence</div><div class="chips wrap" style="margin-top:4px">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(o => `<button class="chip${(db.settings.theme || 'auto') === o[0] ? ' on' : ''}" data-act="theme" data-id="${o[0]}">${o[1]}</button>`).join('')}</div></div>
      <div class="card"><div class="label">Rayon de recherche des lieux</div><div class="chips wrap" style="margin-top:4px">${[1000, 2000, 5000, 10000].map(r => `<button class="chip${db.settings.radius === r ? ' on' : ''}" data-act="radius" data-id="${r}">${fmtDist(r)}</button>`).join('')}</div></div>
      <form class="card" data-form="apikey"><div class="label">Assistant : clé d'IA (facultatif)</div>
        <div class="note">Collez une clé API Anthropic pour que l'assistant rédige ses réponses et cherche sur Internet. La clé reste sur cet appareil. À n'utiliser que pour vos tests : dans l'appli finale, elle sera gardée côté serveur.</div>
        <input id="st-key" name="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(db.settings.apiKey)}" style="min-height:48px;padding:0 14px;border:1px solid var(--line);border-radius:14px;margin-top:6px">
        <button class="btn small" type="submit" style="margin-top:6px">Enregistrer la clé</button></form>
      ${S.user ? `<div class="card"><div class="label">Supprimer mon compte</div><div class="note">Efface définitivement votre profil, vos sessions, vos parcours, vos messages et vos amis.</div><button class="btn small alt" data-act="delete-account" style="margin-top:6px">${a.sureDelete ? 'Confirmer la suppression définitive' : 'Supprimer mon compte'}</button></div>` : ''}
      </div>`
  };
}
