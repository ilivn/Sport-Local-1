'use strict';
// =====================================================================
// 5. FICHE LIEU
// =====================================================================
function pagePlace(a) {
  const p = placeById(a.id);
  if (!p) return { title: 'Lieu', body: '<div class="pad"><div class="note">Ce lieu n\'est plus dans la zone chargée.</div></div>' };
  const tags = [p.label].concat(p.sports);
  if (p.free === true) tags.push('Gratuit'); if (p.free === false) tags.push('Payant');
  if (p.lit) tags.push('Éclairé'); if (p.indoor) tags.push('Couvert');
  if (p.wheelchair) tags.push('Accessible en fauteuil');
  if (p.access === 'customers') tags.push('Réservé aux clients'); if (['yes', 'public', 'permissive'].includes(p.access)) tags.push('Ouvert au public');
  const open = openState(p.hours);
  const walk = p.dist != null ? Math.max(1, Math.round(p.dist * 1.3 / 80)) : null;
  const rows = [['Adresse', p.address], ['Horaires', humanHours(p.hours)], ['Revêtement', surfaceFr(p.surface)], ['Téléphone', p.phone]].filter(r => r[1]).map(r => `<div class="card"><div class="label">${r[0]}</div><div class="hours">${esc(r[1])}</div></div>`).join('');
  const fav = !!favs()[p.id];
  const here = (S.events || []).filter(e => haversine(p, { lat: e.lat, lon: e.lng }) < 150);
  const wx = need(a, 'wx', () => weather(p.lat, p.lon));
  const sp = a.spot && !a.spot.error ? a.spot : null;
  const hero = sp && sp.photos.length ? `<img class="hero" src="${esc(publicUrl('spot-photos', sp.photos[0].storage_path))}" alt="Photo de ${esc(p.name)}">` : '';
  const dest = `${p.lat},${p.lon}`, origin = S.pos ? `&origin=${S.pos.lat},${S.pos.lon}` : '';
  return {
    title: p.label,
    body: `<div class="pad">
      ${hero}
      <div><div class="label" style="color:var(--link)">${p.dist != null ? esc(fmtDist(p.dist)) + ' · environ ' + walk + ' min à pied' : esc(p.label)}</div><h1 style="margin-top:6px">${esc(p.name)}</h1>${p.userSpot ? '<div class="s">Proposé par un membre</div>' : ''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${open === true ? '<span class="tag open">Ouvert maintenant</span>' : open === false ? '<span class="tag closed">Fermé actuellement</span>' : ''}${tags.map(t => `<span class="tag" style="background:var(--surface)">${esc(t)}</span>`).join('')}</div>
      <div class="row"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1${origin}&destination=${dest}&travelmode=walking">Itinéraire</a><button class="btn alt" data-act="fav" data-id="${p.id}">${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button></div>
      <button class="btn alt small" data-act="share-place" data-id="${p.id}">Partager ce lieu</button>
      ${wx && !wx.error ? `<div class="card wx"><div><div class="label">Météo maintenant</div><div class="t">${esc(wxNowText(wx))}</div></div></div>` : ''}
      ${rows || '<div class="note">OpenStreetMap ne donne pas encore d\'horaires ni d\'adresse pour ce lieu.</div>'}
      ${p.website ? `<a class="card" target="_blank" rel="noopener" href="${esc(/^https?:/.test(p.website) ? p.website : 'https://' + p.website)}"><div class="label">Site web</div><div style="color:var(--link);font-weight:600">${esc(p.website)}</div></a>` : ''}
      ${spotSection(p, a)}
      <h3>Sessions ici</h3>
      ${here.length ? here.map(eventItem).join('') : '<div class="note">Aucune session prévue à cet endroit.</div>'}
      <button class="btn lime" data-act="new-session" data-id="${p.id}">Créer une session ici</button>
      <div class="note">${p.userSpot ? '' : `Données : <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/${p.osm}">fiche OpenStreetMap</a> · `}<a target="_blank" rel="noopener" href="${esc(gmapsSearch(p.name))}">voir sur Google Maps</a> · <button class="linkbtn" data-act="report-spot" data-id="${p.id}">signaler une erreur</button></div>
    </div>`
  };
}
