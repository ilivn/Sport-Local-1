'use strict';
// ---------- démarrage ----------
if (typeof L === 'undefined') {
  $('#app').innerHTML = '<div class="pad"><h1>Connexion requise</h1><div>La carte n\'a pas pu être chargée. Vérifiez votre connexion Internet puis rechargez la page.</div></div>';
} else {
  applyTheme();
  initMaps(); renderChips(); showTab('map');
  if (db.settings.manual) setPosition(db.settings.manual.lat, db.settings.manual.lon, 'ville', null, true);
  else if (db.settings.geoOk) startGeo();
  else showGate('');
  if (sb) {
    // Le rappel de Supabase ne doit pas attendre d'autres appels Supabase : on les décale.
    sb.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        setSession(session);
        if (event === 'PASSWORD_RECOVERY') openPage('newpass');
      }, 0);
    });
    loadSports().catch(() => {});
  }
  if (location.hash.length > 1) openFromHash();
  if (S.track && S.track.state !== 'done') toast('Activité en pause retrouvée : ouvrez Parcours > Suivi GPS pour la reprendre.');
  window.addEventListener('hashchange', openFromHash);
}
