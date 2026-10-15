# Pilote Yacine

Site de pilotage pour la livraison Intelcom de Yacine (station DRUM, Drummondville) : tableau de bord, carte des zones, journal quotidien, import automatique des factures PDF, objectifs, simulateur broker / indépendant et conseils d'optimisation.

Site statique (HTML, CSS, JavaScript), hébergé sur GitHub Pages. Données partagées dans Supabase (gratuit). Sans Supabase, le site fonctionne en mode local (données gardées dans le navigateur).

## Mise en route

### 1. GitHub Pages (déjà fait si tu lis ceci en ligne)

Dépôt > Settings > Pages > Source : « Deploy from a branch », branche `main`, dossier `/ (root)`. Le site est servi à `https://<compte>.github.io/Business-yacine/`.

### 2. Supabase (10 minutes, une seule fois)

1. Crée un compte sur https://supabase.com et un projet (région : Canada ou US East, mot de passe de base de données quelconque, note-le).
2. Dans le projet : **SQL Editor** > **New query**. Colle le contenu de `supabase/schema.sql`. Avant d'exécuter, remplace `'remplace-moi-par-un-long-pin'` par le PIN choisi : 10 caractères au moins (une courte phrase de passe est l'idéal ; un PIN de 4 chiffres se devine en quelques minutes). Clique **Run**.
3. Nouvelle query : colle `supabase/seed_localities.sql`, **Run** (coordonnées des localités livrées).
4. **Project Settings** > **API** : copie **Project URL** et la clé **anon public**.
5. Dans le dépôt GitHub, ouvre `js/config.js`, clique le crayon, colle les deux valeurs entre les guillemets, **Commit changes**. Deux minutes plus tard, le site demande le PIN à l'ouverture.

La clé « anon » est publique par conception : sans le bon PIN, la base refuse toute lecture et toute écriture (règles de sécurité du schéma). Ne jamais mettre la clé « service_role » dans le site.

### 3. Utilisation

- **Journal > Importer une facture** : déposer le PDF hebdomadaire « Delivery Invoice » Intelcom. Journées, facturé et chaque colis (code postal, zone, poids, montant) sont extraits dans le navigateur, puis enregistrés. Réimporter la même semaine met à jour sans doublon.
- **Journal > Ajouter une journée** : km et essence chaque soir. Choisir une date déjà importée préremplit le formulaire.
- **Carte** : cercles par localité (taille = volume, couleur = revenu par colis). Classement des zones à demander.
- **Objectifs** : jours par semaine, net mensuel, épargne van, statut, commission du broker.
- **Simulateur** : broker vs indépendant, remboursement du van.

### 4. Mise à jour (brief du jour, GPS, audit)

Si le projet Supabase a été créé avant cette version : SQL Editor > coller `supabase/migration_2_shifts_audit.sql` > Run. Ça ajoute la table `shifts` (objectif du matin, km GPS) et la colonne `audit` des factures.

### 5. Mise à jour (projets d'épargne : voiture, impôt, sécurité, van)

SQL Editor > coller `supabase/migration_3_savings.sql` > Run. Crée `savings_goals`, `savings_log`, `budget` et les quatre projets de départ.

## Structure

```
index.html              page unique
css/app.css             styles (thème clair et sombre)
js/config.js            URL et clé Supabase, station, domicile, prix de l'essence
js/data.js              historique avril à septembre 2026 (9 factures) et localités
js/db.js                accès aux données (Supabase ou local)
js/pdf-import.js        lecture des factures PDF Intelcom
js/app.js               application
js/util.js              dates en heure locale, clés de la grille tarifaire
tests/                  tests (voir TESTING.md)
supabase/schema.sql     tables, sécurité par PIN
supabase/seed_localities.sql  coordonnées des localités
```

## Ajouter une localité

Quand une facture contient un code postal inconnu, il apparaît dans le classement sous son code (ex. `J0C1A0`) sans position sur la carte. Dans Supabase > Table Editor > `localities`, ajouter une ligne : code, nom, latitude, longitude (chercher la municipalité sur OpenStreetMap, clic droit > « Afficher l'adresse » donne les coordonnées).

## Recruter un chauffeur (phase 2 du plan)

La table `drivers` et la colonne `driver` des tables `days`, `parcels`, `invoices` et `goals` sont prêtes. L'interface multi-chauffeurs (sélecteur, marge broker par van) est la prochaine étape du site.

## Tests

Trois couches : unitaires et parcours dans jsdom (`npm run test:unit`, 90 tests, 10 s), contrat Supabase (`npm run test:contract`, sécurité par PIN et tables des migrations), bout en bout dans Chromium ordinateur et téléphone (`npm run test:e2e`, import d'un vrai PDF compris). La CI GitHub Actions les lance à chaque push et refait un parcours de fumée sur le site publié après chaque déploiement. Le plan complet, les cas couverts et les lacunes sont dans `TESTING.md`.
