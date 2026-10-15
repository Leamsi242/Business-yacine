# Pilote Yacine

Site de pilotage pour Yacine, chauffeur-livreur sous-traitant Intelcom (station DRUM, Drummondville, Québec ;
habite Sherbrooke). Il roule pour un broker qui retient 25 % tout compris sur ses factures hebdomadaires ; en
indépendant il garderait 95 % (5 % CNESST). Objectifs : épargner pour une voiture personnelle, puis un van pour
devenir indépendant, puis recruter des chauffeurs. Le plan à cinq ans est dans le document Claude
« Masterplan 5 ans Yacine » (https://claude.ai/artifact/Hfo5xEj2XXMsYDYQGbFGtV).

Site publié : https://leamsi242.github.io/Business-yacine/ (dépôt GitHub Leamsi242/Business-yacine). Tout push
sur `main` déploie (`.github/workflows/pages.yml`) et lance les tests (`.github/workflows/test.yml`).

## Pile technique

- Page unique `index.html`, JavaScript vanille sans bundler, scripts chargés dans l'ordre : config, util, data, db,
  pdf-import, world, features, savings, app. Chaque script expose un objet global (`PYU`, `PYDB`, `PYPDF`,
  `PY_TARIFFS`, `PY_WORLD`, `PYF`, `PYS`, `PYAPP`).
- Données : Supabase (projet `uawvvuzwkfpdzlgxlpdg`) avec sécurité par PIN (RLS, fonction `check_pin()` qui lit
  l'en-tête `x-pin`). La clé anonyme dans `js/config.js` est publique par conception ; ne jamais mettre la clé
  `service_role` dans le site. Sans configuration, le site tourne en mode local (`localStorage`, clé `pilote-yacine-v2`).
- Schéma dans `supabase/schema.sql` (migrations 2 à 4 incluses ; la 4 impose un PIN de 10 caractères au moins). Toute nouvelle colonne demande une migration
  que l'utilisateur colle dans Supabase > SQL Editor ; le test « contrat de schéma » refuse un objet envoyé avec une
  colonne inconnue. Ce qui ne s'enregistre pas (ex. `meta.sig`, `meta.driver_code`) ne va pas dans `inv` ni `parcels`.
- Bibliothèques CDN (jsDelivr, fichiers npm tels quels, avec `integrity` sha384) : Leaflet 1.9.4, supabase-js 2.45.4
  (`dist/umd/supabase.js`), pdfjs-dist 3.11.174. Changer de version demande de recalculer l'empreinte
  (`openssl dgst -sha384 -binary fichier | openssl base64 -A` sur le fichier du paquet npm) et de mettre à jour le
  worker et `tests/e2e/fixtures.js`. Polices Google Overpass et Overpass Mono.
- Une base configurée mais injoignable affiche le bandeau `#netBanner` ; ne jamais retomber en local en silence.

## Règles du code

- Dates « du jour » toujours en heure locale via `window.PYU.today()` / `PYU.isoDate()`, jamais
  `toISOString().slice(0, 10)` (à 21 h au Québec, UTC est déjà le lendemain). Les horodatages (`started_at`,
  `audit.at`) restent en ISO complet.
- Montants affichés via `PYAPP.fmt` / `PYAPP.money` (fr-CA, espace insécable de milliers, `$` détaché).
- Clé de la grille tarifaire : `PYU.tariffKey(zone, poids)` donne `ZONE_G|2.0` (une décimale), comme la grille de la table `reference`.
- Part de Yacine : `PYAPP.share()` (0,75 chez le broker avec `cut` 0,25 ; 0,95 en indépendant).
- Semaines du lundi au dimanche comme les factures Intelcom (`PYU.weekStart`). `byWeek` montre les semaines sans
  travail ; les moyennes utilisent les semaines complètes (`PYAPP.recentWeeks`).
- Série de semaines : toujours `PYAPP.streak()` (semaines calendaires, la semaine en cours compte si elle est réussie).
- Moyenne de facturé par jour : toujours `PYU.avgInvoiced` (les journées saisies sans facturé en sont exclues).
- Van : une seule épargne, le projet « van » de l'épargne ; `goals.van` est la mise de fonds exigée par le plan.
  Dates d'atteinte par `PYS.project` (projection semaine par semaine) et `PYS.vanPlan`.
- Aucune donnée réelle de Yacine dans le dépôt (public) : les factures de test viennent de
  `tests/helpers/invoice.js`. `js/data.js` ne contient que les localités (noms et coordonnées). L'historique des
  factures, le revenu par localité et la grille tarifaire sont dans Supabase, table `reference` (migration 5), lus
  par `PYDB.getReference()` ; leur contenu se charge avec `reference_data.sql`, fichier privé jamais versionné
  (ignoré par git). Tests et mode local utilisent les données synthétiques de `tests/helpers/reference.js`.
- Style d'écriture (interface, documents, messages de commit) : français du Québec, guillemets « », apostrophes
  typographiques, jamais de tiret cadratin ni demi-cadratin comme ponctuation (virgule, deux-points ou parenthèses à
  la place), pas de flèches dans la prose.

## Direction artistique « panneau de route »

Jetons dans `css/app.css` : fond `--ground`, plaques `--paper` sans bordure ni ombre, vert de signalisation `--sign`
(aplat) et `--sign-text` (texte, plus clair en mode nuit), bleu de service `--service`, jaune `--warn` réservé à
la barre de shift et à la tuile voiture, rouge `--stop`. Bande d'odomètre noire `.tiles` pour les chiffres clés,
panneau vert `.rank` pour les destinations. Mobile : navigation basse à cinq onglets plus « Plus », cibles de 44 px,
aucun défilement horizontal. Mode nuit par `prefers-color-scheme` et `[data-theme="dark"]`. Avant de toucher au
design, lire la critique appliquée dans l'historique git (commit « Critique de design appliquée »).

## Commandes

```
npm ci                       # dépendances de test (jsdom, Playwright) ; le site n'a aucune dépendance d'exécution
node tests/e2e/serve.js      # sert le site sur http://localhost:8787/
npm run test:unit            # 120 tests, node:test + jsdom, 15 s
npm run test:unit:coverage   # idem avec la couverture des scripts du site (seuil CI 75 %)
npm run test:contract        # Supabase (réseau) ; PY_TEST_PIN=xxxx pour les cas avec PIN
npx playwright install chromium && npm run test:e2e   # Chromium ordinateur et téléphone
```

Le plan de tests, les helpers (`boot`, `enter`, `dropPdf`, `invoice.typicalWeek`) et les conventions pour écrire
un test sont dans `TESTING.md`. Toute correction de bug s'accompagne d'un test qui échouait avant.

## En attente côté utilisateur

- Ajouter le secret GitHub `PY_TEST_PIN` pour que la CI vérifie la connexion avec le bon PIN.
- Coller la migration 4 (fin de `supabase/schema.sql`) dans Supabase > SQL Editor, puis passer à un PIN long :
  `update config set pin = 'phrase de passe' where id = 1;` (10 caractères au moins).
- Coller la migration 5 (fin de `supabase/schema.sql`) puis `reference_data.sql` (fichier privé) dans Supabase.
- Les anciennes données réelles restent dans l'historique git du dépôt public (commits antérieurs à leur retrait) :
  réécrire l'historique si on veut les effacer complètement.
- Fonctionnalités proposées non retenues pour l'instant : rappel du soir, rapport du dimanche par courriel, veille
  Kijiji pour la voiture, jauge de colis en cours de shift, mode hors ligne, badges de série, comparateur de coût
  d'usage d'une voiture, export comptable annuel, espace multi-chauffeurs (phase 2 du plan).
