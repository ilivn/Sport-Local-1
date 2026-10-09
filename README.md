# Sport local

Application web pour trouver les lieux de sport autour de soi et rencontrer des sportifs près de chez soi.

**Site :** https://ilivn.github.io/Sport-Local-1/

## Fonctionnalités

- Carte de tous les lieux sportifs (OpenStreetMap), filtres, badge « Ouvert maintenant », météo
- Assistant de recherche qui utilise votre position
- Fiches lieux : horaires, avis, photos, sessions prévues, partage, signalement d'erreur
- Proposer un lieu manquant
- Sessions sportives (visibles sans compte), inscription, liste d'attente
- Amis, suggestions, recherche de profils, messagerie en temps réel
- Parcours de course, favoris synchronisés avec le compte
- Suivi d'activité au GPS (course, marche, rando, vélo), statistiques et 18 badges
- Groupes publics ou privés avec leur discussion
- Notifications (demandes d'ami, places libérées, sessions annulées, rappels)
- Mode sombre, version ordinateur, installable sur téléphone (PWA)

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | L'application (HTML, CSS, JavaScript) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Installation sur téléphone |
| `schema.sql` | Base de données Supabase (1ʳᵉ installation) |
| `amis.sql` | Mise à jour n° 1 : amis, messagerie, sports |
| `mise-a-jour-2.sql` | Mise à jour n° 2 : favoris, avis, photos, liste d'attente |
| `mise-a-jour-3.sql` | Mise à jour n° 3 : activités GPS, statistiques, groupes, notifications |
| `import-lieux.mjs` + `.github/workflows/import-lieux.yml` | Import hebdomadaire des lieux OpenStreetMap dans Supabase |

## Technologies

JavaScript, Leaflet, OpenStreetMap (Overpass, Nominatim), Open-Meteo, Supabase (PostgreSQL, PostGIS, Auth, Realtime, Storage), GitHub Pages et GitHub Actions.

---

© 2026 Ilian SEGHIRI. Tous droits réservés.
Données cartographiques © les contributeurs OpenStreetMap (ODbL).
