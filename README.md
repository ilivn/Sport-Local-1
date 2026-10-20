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
- **Confidentialité GPS** : les 200 premiers et derniers mètres d'un tracé partagé sont masqués par défaut (le domicile n'apparaît pas), la distance et la durée restent exactes
- **Recherche de lieux rapide** : affichage instantané depuis les zones déjà chargées (même après un petit déplacement), démarrage sur la dernière position connue puis position approximative en attendant le GPS, réponse Supabase allégée et triée par distance (`mise-a-jour-4.sql`)
- **Hors connexion** : les lieux des 5 dernières zones consultées restent disponibles sans réseau

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page et chargement des fichiers |
| `css/style.css` | Styles de l'application |
| `js/00-base.js` … `js/14-demarrage.js` | Le code JavaScript, un fichier par partie : position, lieux, carte, assistant, fiche lieu, compte, sessions, amis et messagerie, profil, parcours, navigation, compléments des lieux, activités / groupes / notifications, démarrage. Ils sont chargés dans l'ordre des numéros. |
| `tests/tests-securite.sql` | Tests des règles d'accès de la base (à lancer dans le SQL Editor de Supabase) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Installation sur téléphone |
| `schema.sql` | Base de données Supabase (1ʳᵉ installation) |
| `amis.sql` | Mise à jour n° 1 : amis, messagerie, sports |
| `mise-a-jour-2.sql` | Mise à jour n° 2 : favoris, avis, photos, liste d'attente |
| `mise-a-jour-3.sql` | Mise à jour n° 3 : activités GPS, statistiques, groupes, notifications |
| `mise-a-jour-4.sql` | Mise à jour n° 4 : recherche de lieux plus rapide (facultative) |
| `import-lieux.mjs` + `.github/workflows/import-lieux.yml` | Import hebdomadaire des lieux OpenStreetMap dans Supabase |

## Tests de sécurité

`tests/tests-securite.sql` vérifie les règles d'accès (RLS) de la base avec trois comptes fictifs : un ami ne voit pas une activité privée, un inconnu ne voit rien, personne ne peut modifier le profil ou les activités d'un autre, un visiteur non connecté n'a accès à aucune activité.

Pour le lancer : Supabase → **SQL Editor** → **New query** → coller le fichier → **Run**. Chaque ligne du tableau doit afficher **OK**. Les comptes de test sont supprimés à la fin.

## Technologies

JavaScript, Leaflet, OpenStreetMap (Overpass, Nominatim), Open-Meteo, Supabase (PostgreSQL, PostGIS, Auth, Realtime, Storage), GitHub Pages et GitHub Actions.

---

© 2026 Ilian SEGHIRI. Tous droits réservés.
Données cartographiques © les contributeurs OpenStreetMap (ODbL).
