'use strict';
// =====================================================================
// 4. ASSISTANT
// =====================================================================
// Sans clé d'IA : compréhension par mots-clés, sur les vrais lieux chargés
// autour de la position. Avec une clé (Réglages) : vraie IA + recherche web.
const INTENTS = [
  ['Football', [/\bfoot(ball)?\b/, 'futsal'], ['soccer', 'futsal']], ['Basket', ['basket'], ['basketball']], ['Tennis', [/\btennis\b(?! de table)/], ['tennis']],
  ['Padel', ['padel'], ['padel']], ['Badminton', ['badminton', 'bad '], ['badminton']], ['Tennis de table', ['ping', 'tennis de table'], ['table_tennis']],
  ['Rugby', ['rugby'], ['rugby', 'rugby_union', 'rugby_league']], ['Handball', ['hand'], ['handball']], ['Volley', ['volley'], ['volleyball', 'beachvolleyball']],
  ['Boxe', ['boxe', 'boxing', 'sac de frappe'], ['boxing', 'kickboxing']],
  ['Arts martiaux', ['judo', 'karate', 'taekwondo', 'mma', 'arts martiaux', 'jiu', 'aikido', 'self defense', 'dojo'], ['martial_arts', 'judo', 'karate', 'taekwondo', 'aikido'], ['dojo']],
  ['Musculation et fitness', ['muscu', 'fitness', 'salle de sport', 'cardio', 'crossfit', 'halter'], ['fitness', 'crossfit', 'weightlifting'], ['fitness_centre']],
  ['Street workout', ['street', 'workout', 'traction', 'callisthenie', 'barres'], ['calisthenics'], ['fitness_station']],
  ['Course à pied', ['courir', 'course', 'running', 'footing', 'jogging', 'piste', 'athle', 'sprint'], ['running', 'athletics'], ['track']],
  ['Natation', ['natation', 'nager', 'piscine', 'aquagym', 'bassin'], ['swimming', 'water_polo'], ['swimming_pool', 'water_park']],
  ['Escalade', ['escalade', 'grimpe', 'bloc'], ['climbing']], ['Vélo', ['velo', 'cyclisme', 'vtt', 'bmx', 'cycliste'], ['cycling', 'bmx'], ['bicycle_rental']],
  ['Skate et roller', ['skate', 'roller', 'trottinette'], ['skateboard', 'roller_skating']], ['Pétanque', ['petanque', 'boules'], ['boules']],
  ['Golf', ['golf'], ['golf'], ['golf_course', 'miniature_golf']], ['Équitation', ['equitation', 'cheval', 'poney'], ['equestrian'], ['horse_riding']],
  ['Yoga et pilates', ['yoga', 'pilates'], ['yoga', 'pilates']], ['Danse', ['danse', 'zumba'], ['dance'], ['dance']],
  ['Gymnastique', ['gymnastique', 'trampoline'], ['gymnastics', 'trampoline']], ['Patinage', ['patin', 'hockey sur glace'], ['ice_skating', 'ice_hockey'], ['ice_rink']],
  ['Sports nautiques', ['aviron', 'kayak', 'canoe', 'voile', 'paddle'], ['rowing', 'canoe', 'sailing']], ['Tir à l\'arc', ['tir a l\'arc', 'archerie'], ['archery']],
  ['Squash', ['squash'], ['squash']], ['Bowling', ['bowling'], ['10pin', 'bowling'], ['bowling_alley']],
  ['Stades et complexes', ['stade', 'complexe', 'gymnase', 'centre sportif', 'terrain'], [], ['stadium', 'sports_centre', 'sports_hall', 'pitch']],
  ['Magasins de sport', ['magasin', 'boutique', 'acheter', 'equipement', 'chaussure', 'materiel', 'raquette', 'maillot'], [], ['shop']],
  ['Clubs', ['club', 'association', 'licence', 'inscription'], [], ['club']],
  ['Kinésithérapeutes', ['kine', 'blessure', 'physio'], [], ['physiotherapist']]
];
function localAnswer(q) {
  const n = ' ' + norm(q) + ' ';
  const has = ws => ws.some(w => w instanceof RegExp ? w.test(n) : n.includes(w));
  let wanted = INTENTS.filter(i => has(i[1]));
  // « terrain de foot », « club de boxe » : le sport précis prime sur le type de lieu.
  const precise = wanted.filter(i => i[2].length);
  const typeOnly = wanted.filter(i => !i[2].length);
  const free = has(['gratuit', 'pas cher', 'sans payer']), lit = has(['eclaire', 'soir', 'nuit', 'tard']);
  const indoor = has(['couvert', 'interieur', 'pluie', 'abri']), outdoor = has(['plein air', 'exterieur', 'dehors']);
  const near = has([/\bpres\b/, 'proche', 'pas loin', 'a cote', 'plus pres']);
  const tags = wanted.map(i => i[0]);
  if (free) tags.push('Gratuit'); if (lit) tags.push('Éclairé'); if (indoor) tags.push('Couvert'); if (outdoor) tags.push('Plein air'); if (near) tags.push('Au plus près');

  let pool = S.places;
  const typeKinds = new Set(typeOnly.flatMap(i => i[3]));
  const ofType = S.places.filter(p => typeKinds.has(p.kind));
  if (precise.length) {
    const sp = new Set(precise.flatMap(i => i[2])), kinds = new Set(precise.flatMap(i => i[3] || []));
    const nameKeys = precise.flatMap(i => i[1].filter(w => typeof w === 'string' && w.length > 3).concat(i[0].includes(' ') ? [] : [norm(i[0])]));
    const bySport = p => p.sportKeys.some(k => sp.has(k)) || kinds.has(p.kind) || (p.group !== 'service' && nameKeys.some(w => norm(p.name).includes(w)));
    pool = S.places.filter(bySport);
    if (typeOnly.length) {
      // « magasin de running », « club de judo » : le type de lieu demandé d'abord.
      const both = ofType.filter(bySport);
      if (both.length) pool = both;
      else if (typeKinds.has('shop') || typeKinds.has('physiotherapist')) pool = ofType;
    }
  } else if (typeOnly.length) {
    pool = ofType;
  } else {
    // aucun mot-clé connu : recherche dans les noms des lieux
    const words = norm(q).split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const byName = pool.filter(p => words.some(w => norm(p.name + ' ' + p.sports.join(' ')).includes(w)));
    if (byName.length) pool = byName; else if (!tags.length) pool = [];
  }
  const strict = pool.filter(p => (!free || p.free === true || (p.free == null && ['pitch', 'fitness_station', 'track'].includes(p.kind) && p.access !== 'customers')) && (!lit || p.lit) && (!indoor || p.indoor) && (!outdoor || !p.indoor));
  const relaxed = !strict.length && pool.length && (free || lit || indoor || outdoor);
  const list = (strict.length ? strict : pool).slice(0, 8);
  const zone = (S.posSource === 'ville' ? 'autour de ' + (S.city || 'la ville choisie') : 'autour de votre position' + (S.city ? ' (' + S.city + ')' : '')) + ', dans un rayon de ' + fmtDist(db.settings.radius);
  let text;
  if (!S.places.length) text = 'Les lieux autour de vous ne sont pas encore chargés. Réessayez dans un instant.';
  else if (!list.length) text = `Je ne trouve rien pour cette demande ${zone}. Élargissez le rayon, ou lancez la recherche sur le web.`;
  else if (relaxed) text = `Aucun lieu ne remplit tous vos critères ${zone}. Voici les plus proches qui correspondent au sport demandé.`;
  else text = `${list.length === 8 ? 'Voici les 8 lieux les plus proches' : 'J\'ai trouvé ' + list.length + ' lieu' + (list.length > 1 ? 'x' : '')} ${zone}.`;
  return {
    text, tags, empty: !list.length,
    results: list.map(p => ({ id: p.id, why: [p.free === true ? 'gratuit' : (p.free === false ? 'payant' : ''), p.lit ? 'éclairé' : '', p.indoor ? 'couvert' : ''].filter(Boolean).join(' · ') }))
  };
}
async function aiAnswer(q) {
  const nearby = S.places.filter(p => p.group !== 'service').slice(0, 80).map(p => `${p.id} | ${p.name} | ${p.label}${p.sports.length ? ' (' + p.sports.join(', ') + ')' : ''} | ${fmtDist(p.dist)}${p.free === true ? ' | gratuit' : ''}${p.lit ? ' | éclairé' : ''}${p.hours ? ' | ' + p.hours : ''}`).join('\n');
  const system = `Tu es l'assistant de « Sport local », une application qui aide à trouver où et avec quoi faire du sport près de soi.
Position de l'utilisateur : latitude ${S.pos.lat.toFixed(5)}, longitude ${S.pos.lon.toFixed(5)}${S.city ? ', ' + S.city : ''}${S.country ? ' (' + S.country + ')' : ''}. Rayon de recherche : ${fmtDist(db.settings.radius)}.
Réponds en français, de façon concise et concrète, toujours par rapport à cette position. Tout ce qui touche au sport est dans ton périmètre : lieux de pratique, clubs, cours, magasins, événements, courses, tarifs, horaires, conseils d'entraînement.
Utilise la recherche web pour compléter ou vérifier (horaires, tarifs, clubs, événements à venir) et cite ce que tu as trouvé.
Lieux connus de l'application autour de l'utilisateur (identifiant | nom | type | distance) :
${nearby || '(aucun lieu chargé)'}
Si certains de ces lieux répondent à la demande, termine ta réponse par une ligne exactement de la forme « LIEUX: id1,id2,id3 » (5 identifiants au plus).`;
  const tool = { type: 'web_search_20250305', name: 'web_search', max_uses: 4 };
  const loc = { type: 'approximate' };
  if (S.city) loc.city = S.city; if (S.country) loc.country = S.country;
  try { loc.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* facultatif */ }
  if (loc.city || loc.country || loc.timezone) tool.user_location = loc;
  const messages = S.aiHistory.concat([{ role: 'user', content: q }]);
  let content = [];
  for (let turn = 0; turn < 3; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': db.settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1500, system, tools: [tool], messages: content.length ? messages.concat([{ role: 'assistant', content }]) : messages })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Erreur ' + r.status));
    content = content.concat(j.content || []);
    if (j.stop_reason !== 'pause_turn') break;
  }
  S.aiHistory = messages.concat([{ role: 'assistant', content }]).slice(-8);
  let text = content.filter(b => b.type === 'text').map(b => b.text).join('');
  const sources = [];
  content.forEach(b => (b.citations || []).forEach(c => { if (c.url && !sources.some(s => s.url === c.url)) sources.push({ url: c.url, title: c.title || c.url }); }));
  let ids = [];
  text = text.replace(/\n?\s*LIEUX\s*:\s*([^\n]*)\s*$/i, (m, l) => { ids = l.split(',').map(x => x.trim()).filter(placeById); return ''; }).trim();
  return { text, tags: ['Réponse de l\'IA avec recherche web'], results: ids.slice(0, 5).map(id => ({ id, why: '' })), sources: sources.slice(0, 6), rich: true };
}
async function ask(q) {
  q = q.trim(); if (!q || S.aiBusy) return;
  S.chat.push({ me: true, text: q }); S.aiBusy = true; renderPage();
  let a;
  if (db.settings.apiKey) {
    try { a = await aiAnswer(q); }
    catch (e) { a = localAnswer(q); a.text = 'L\'IA n\'a pas répondu (' + e.message + '). Réponse à partir des lieux connus : ' + a.text; }
  } else { await new Promise(r => setTimeout(r, 350)); a = localAnswer(q); }
  a.q = q; S.chat.push(a); S.aiBusy = false; renderPage();
}
function richText(t) {
  return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^#+\s*(.+)$/gm, '<b>$1</b>').replace(/\n/g, '<br>');
}
const gmapsSearch = q => `https://www.google.com/maps/search/${encodeURIComponent(q)}` + (S.pos ? `/@${S.pos.lat},${S.pos.lon},14z` : '');
const webSearch = q => 'https://www.google.com/search?q=' + encodeURIComponent(q + (S.city ? ' ' + S.city : ''));
function pageAssistant() {
  const examples = ['Où faire de la boxe près d\'ici ?', 'Un terrain de foot gratuit', 'Une piscine couverte', 'Où courir ce soir sur une piste éclairée ?', 'Un magasin pour acheter des chaussures de running', 'Un club de judo'];
  const bubbles = S.chat.map(m => {
    if (m.me) return `<div class="bubble me">${esc(m.text)}</div>`;
    const tags = (m.tags || []).map(t => `<span class="tag lime">${esc(t)}</span>`).join(' ');
    const res = (m.results || []).map(r => { const p = placeById(r.id); return p ? placeItem(p, r.why) : ''; }).join('');
    const src = (m.sources || []).length ? `<div class="s" style="margin-top:8px">Sources : ${m.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ')}</div>` : '';
    const more = `<div class="row" style="margin-top:10px">${m.empty ? '<button class="btn small" data-act="widen-ask" data-q="' + esc(m.q) + '">Élargir à 10 km</button>' : ''}<a class="btn small alt" target="_blank" rel="noopener" href="${esc(gmapsSearch(m.q))}">Voir sur Google Maps</a><a class="btn small alt" target="_blank" rel="noopener" href="${esc(webSearch(m.q))}">Chercher sur le web</a></div>`;
    return `<div class="bubble" style="max-width:100%"><div>${m.rich ? richText(m.text) : esc(m.text)}</div>${tags ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">${tags}</div>` : ''}${res}${src}${more}</div>`;
  }).join('');
  const intro = S.chat.length ? '' : `<div>Décrivez ce que vous cherchez avec vos mots. Les réponses tiennent compte de votre position ${S.city ? 'à ' + esc(S.city) : 'actuelle'}.</div>
    <div class="label">Exemples</div>${examples.map(e => `<button class="item" data-act="ask" data-q="${esc(e)}"><span class="grow t" style="font-weight:600">${esc(e)}</span>${ico('next')}</button>`).join('')}`;
  const mode = db.settings.apiKey ? '' : `<div class="banner">Mode sans IA : l'assistant cherche par mots-clés dans les ${S.places.length} lieux réels autour de vous. Ajoutez une clé d'IA dans Profil › Réglages pour des réponses rédigées avec recherche sur Internet.</div>`;
  return {
    title: 'Assistant',
    body: `<div class="msgs">${mode}${intro}${bubbles}${S.aiBusy ? '<div class="bubble note">Recherche en cours…</div>' : ''}</div>`,
    foot: `<form class="send" data-form="ask"><input id="ask-input" name="q" type="text" placeholder="Votre demande…" autocomplete="off" aria-label="Votre demande"><button type="submit" aria-label="Envoyer">${ico('send')}</button></form>`,
    scrollEnd: true
  };
}
