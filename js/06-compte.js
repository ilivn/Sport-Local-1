'use strict';
// =====================================================================
// 6. COMPTE ET SERVEUR (Supabase)
// =====================================================================
const SUPABASE_URL = 'https://mbyxzdgaqelokwzqtokw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tIzxZkhecHTO-xiY3Q0VfQ_NpQTpHSy'; // clé publique : prévue pour être dans le code
const sb = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const LEVEL_KEYS = ['debutant', 'intermediaire', 'confirme', 'expert'];
const SITE_URL = location.origin + location.pathname;
Object.assign(S, { user: null, me: null, sports: [], convs: [], friends: null, suggestions: null, searchRes: null, events: null, eventsAt: 0, names: {} });

function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || '');
  if (/Invalid login credentials/i.test(m)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez d\'abord votre adresse avec le lien reçu par e-mail.';
  if (/already registered|already been registered/i.test(m)) return 'Un compte existe déjà avec cette adresse. Connectez-vous.';
  if (/Password should be at least|weak password/i.test(m)) return 'Mot de passe trop court : 6 caractères minimum.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Trop de tentatives. Patientez quelques minutes puis réessayez.';
  if (/profiles_username_key|duplicate key.*username/i.test(m)) return 'Ce pseudo est déjà pris. Choisissez-en un autre.';
  if (/friendships_pair_key|friendships_pkey/i.test(m)) return 'Une demande existe déjà entre vous.';
  if (/row-level security/i.test(m)) return 'Action impossible avec ce compte.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Serveur injoignable. Vérifiez votre connexion.';
  return m || 'Une erreur est survenue.';
}
async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }
async function act(fn) { try { return await fn(); } catch (e) { toast(errMsg(e)); return undefined; } }
const sportName = id => (S.sports.find(s => s.id === id) || {}).name || 'Sport';
const levelIndex = k => Math.max(0, LEVEL_KEYS.indexOf(k));
const personName = p => (p && (p.display_name || p.username)) || 'Membre';
const sportsLine = list => (list || []).map(s => s.name + (s.level != null ? ' · ' + LEVELS[typeof s.level === 'number' ? s.level : levelIndex(s.level)].toLowerCase() : '')).join(', ');
const point = p => `SRID=4326;POINT(${p.lon} ${p.lat})`;

async function loadSports() { if (sb && !S.sports.length) S.sports = await q(sb.from('sports').select('id,slug,name').order('name')); }
async function loadMe() {
  if (!S.user) { S.me = null; return; }
  const [p, sp] = await Promise.all([
    q(sb.from('profiles').select('id,username,display_name,city,bio,availability,avatar_url').eq('id', S.user.id).single()),
    q(sb.from('profile_sports').select('sport_id,level').eq('profile_id', S.user.id))
  ]);
  const days = p.availability && Array.isArray(p.availability.days) ? p.availability.days : [0, 0, 0, 0, 0, 0, 0];
  S.me = Object.assign(p, { dispo: days, sports: sp.map(x => ({ id: x.sport_id, name: sportName(x.sport_id), level: levelIndex(x.level) })) });
}
async function namesFor(ids) {
  const missing = [...new Set(ids)].filter(id => id && !S.names[id]);
  if (missing.length) (await q(sb.from('profiles').select('id,username,display_name').in('id', missing))).forEach(p => { S.names[p.id] = personName(p); });
  return S.names;
}
let liveChannel = null;
function subscribeLive() {
  if (liveChannel) sb.removeChannel(liveChannel);
  liveChannel = sb.channel('live-' + S.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, m => onNewMessage(m.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => { S.friends = null; S.suggestions = null; if (S.tab === 'social') renderSocial(); refreshTopIf('member'); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participants' }, () => { S.events = null; refreshTopIf('event'); if (S.tab === 'sessions') renderSessions(); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + S.user.id }, m => onNotif(m.new))
    .subscribe();
}
async function setSession(session) {
  const uid = session && session.user ? session.user.id : null;
  if (uid === (S.user ? S.user.id : null) && (!uid || S.me)) return;
  S.user = session ? session.user : null;
  S.me = null; S.convs = []; S.friends = null; S.suggestions = null; S.events = null; S.searchRes = null;
  S.notifs = null; S.groups = null; S.stats = null;
  if (!S.user && liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (S.user) {
    await act(async () => { await loadSports(); await loadMe(); });
    subscribeLive(); refreshConvs(); loadAccountFavs(); loadNotifs();
    if (S.me && (!S.me.display_name || /^user_[0-9a-f]{20}$/.test(S.me.username))) { toast('Bienvenue ! Choisissez votre pseudo et vos sports.'); openEditProfile(); }
  }
  if (!S.user) S.accFavs = null;
  S.events = null; paintBell();
  renderTabbar(); refreshTab();
  if (S.stack.length) reloadTop();
}
async function refreshConvs() {
  if (!S.user) return;
  const r = await act(() => q(sb.rpc('my_conversations')));
  if (r) { S.convs = r; renderTabbar(); if (S.tab === 'social' && S.social === 'messages') renderSocial(); }
}
function onNewMessage(m) {
  const top = S.stack[S.stack.length - 1];
  if (top && top.type === 'chat' && top.args.id === m.conversation_id && Array.isArray(top.args.msgs)) {
    if (!top.args.msgs.some(x => x.id === m.id)) { top.args.msgs.push(m); paintChat(top.args); }
    if (m.sender_id !== S.user.id) markRead(m.conversation_id);
  } else if (m.sender_id !== S.user.id) {
    namesFor([m.sender_id]).then(n => { const who = n[m.sender_id] || 'un membre'; if (document.visibilityState === 'visible') toast('Nouveau message de ' + who); else systemNotify('Message de ' + who, m.content.slice(0, 120), 'c' + m.conversation_id); });
  }
  refreshConvs();
}
function markRead(convId) {
  if (S.user) sb.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', convId).eq('user_id', S.user.id).then(() => refreshConvs());
}
// Charge une donnée pour une page, puis la réaffiche si elle est toujours au premier plan.
function need(args, key, loader) {
  if (key in args) return args[key];
  if (!args['_' + key]) {
    args['_' + key] = true;
    loader().then(v => { args[key] = v; }, e => { args[key] = { error: errMsg(e) }; }).then(() => {
      const top = S.stack[S.stack.length - 1]; if (top && top.args === args) renderPage();
    });
  }
  return undefined;
}
function refreshTopIf(type) {
  const top = S.stack[S.stack.length - 1];
  if (top && top.type === type) { Object.keys(top.args).filter(k => !['id', 'mode', 'placeId', 'routeId'].includes(k)).forEach(k => delete top.args[k]); renderPage(); }
}
const LOADING = '<div class="pad"><div class="note">Chargement…</div></div>';
const failed = v => v && v.error ? `<div class="pad"><div class="banner">${esc(v.error)}</div></div>` : '';
function loginCard(why) {
  if (!sb) return '<div class="banner">Le serveur n\'a pas pu être chargé. Vérifiez votre connexion puis rechargez la page.</div>';
  return `<div class="card"><div class="t">${esc(why)}</div><div class="s">Un compte gratuit suffit : une adresse e-mail et un mot de passe.</div>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="auth" data-id="signup">Créer un compte</button><button class="btn alt" data-act="auth" data-id="login">Se connecter</button></div></div>`;
}

// ---------- connexion, inscription, mot de passe ----------
function pageAuth(a) {
  const m = a.mode;
  const title = m === 'signup' ? 'Créer un compte' : m === 'forgot' ? 'Mot de passe oublié' : 'Connexion';
  return {
    title,
    body: `<form class="pad" data-form="auth" data-mode="${m}">
      ${m === 'signup' ? '<label class="field">Nom affiché<input id="au-name" name="name" type="text" maxlength="60" required placeholder="Prénom et initiale" autocomplete="nickname"></label>' : ''}
      <label class="field">Adresse e-mail<input id="au-email" name="email" type="email" required autocomplete="email" placeholder="vous@exemple.fr"></label>
      ${m !== 'forgot' ? `<label class="field">Mot de passe<input id="au-pass" name="pass" type="password" required minlength="6" autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" placeholder="6 caractères minimum"></label>` : '<div class="note">Vous recevrez un lien pour choisir un nouveau mot de passe.</div>'}
      ${a.msg ? `<div class="banner">${esc(a.msg)}</div>` : ''}
      <button class="btn" type="submit"${a.busy ? ' disabled' : ''}>${m === 'signup' ? 'Créer mon compte' : m === 'forgot' ? 'Envoyer le lien' : 'Se connecter'}</button>
      ${m === 'login' ? '<button type="button" class="btn alt" data-act="auth-switch" data-id="signup">Je n\'ai pas de compte</button><button type="button" class="btn alt small" data-act="auth-switch" data-id="forgot">Mot de passe oublié ?</button>' : '<button type="button" class="btn alt" data-act="auth-switch" data-id="login">J\'ai déjà un compte</button>'}
    </form>`
  };
}
async function submitAuth(f) {
  const top = S.stack[S.stack.length - 1], m = f.dataset.mode;
  const email = f.elements.email.value.trim(), pass = f.elements.pass ? f.elements.pass.value : '';
  top.args.busy = true; top.args.msg = ''; renderPage();
  try {
    if (m === 'signup') {
      const r = await sb.auth.signUp({ email, password: pass, options: { data: { display_name: f.elements.name.value.trim() }, emailRedirectTo: SITE_URL } });
      if (r.error) throw r.error;
      if (!r.data.session) { top.args.msg = 'Compte créé. Ouvrez le lien de confirmation envoyé à ' + email + ', puis connectez-vous.'; top.args.mode = 'login'; }
      else { S.stack.pop(); renderPage(); toast('Compte créé, bienvenue !'); }
    } else if (m === 'forgot') {
      const r = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
      if (r.error) throw r.error;
      top.args.msg = 'Si un compte existe pour ' + email + ', un e-mail vient de partir. Ouvrez le lien qu\'il contient.';
    } else {
      const r = await sb.auth.signInWithPassword({ email, password: pass });
      if (r.error) throw r.error;
      S.stack.pop(); renderPage(); toast('Connecté');
    }
  } catch (e) { top.args.msg = errMsg(e); }
  top.args.busy = false; if (S.stack.includes(top)) renderPage();
}
function pageNewPass() {
  return { title: 'Nouveau mot de passe', body: `<form class="pad" data-form="newpass"><label class="field">Nouveau mot de passe<input id="np-pass" name="pass" type="password" required minlength="6" autocomplete="new-password"></label><button class="btn" type="submit">Enregistrer</button></form>` };
}
