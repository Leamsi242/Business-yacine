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
  auth, pdf-import, world, features, savings, app. Chaque script expose un objet global (`PYU`, `PYDB`, `PYAUTH`, `PYPDF`,
  `PY_TARIFFS`, `PY_WORLD`, `PYF`, `PYS`, `PYAPP`).
- Données : Supabase (projet `uawvvuzwkfpdzlgxlpdg`) avec sécurité par PIN (RLS, fonction `check_pin()` qui lit
  l'en-tête `x-pin`). La clé anonyme dans `js/config.js` est publique par conception ; ne jamais mettre la clé
  `service_role` dans le site. Sans configuration, le site tourne en mode local (`localStorage`, clé `pilote-yacine-v2`).
- Schéma dans `supabase/schema.sql` (migrations 2 à 6 incluses ; la 4 impose un PIN de 10 caractères au moins, la 6
  ajoute le journal des connexions `access_log` et le PIN administrateur). Règles vérifiées sur un vrai PostgreSQL par
  `tests/sql/access-log.sql` (`PGURL=... sh tests/sql/run.sh`, base jetable uniquement). Toute nouvelle colonne demande une migration
  que l'utilisateur colle dans Supabase > SQL Editor ; le test « contrat de schéma » refuse un objet envoyé avec une
  colonne inconnue. Ce qui ne s'enregistre pas (ex. `meta.sig`, `meta.driver_code`) ne va pas dans `inv` ni `parcels`.
- Bibliothèques CDN (jsDelivr, fichiers npm tels quels, avec `integrity` sha384) : Leaflet 1.9.4, supabase-js 2.45.4
  (`dist/umd/supabase.js`), pdfjs-dist 3.11.174. Changer de version demande de recalculer l'empreinte
  (`openssl dgst -sha384 -binary fichier | openssl base64 -A` sur le fichier du paquet npm) et de mettre à jour le
  worker et `tests/e2e/fixtures.js`. Police Google Inter.
- Une base configurée mais injoignable affiche le bandeau `#netBanner` ; ne jamais retomber en local en silence.
- Connexion : PIN (sans accent, il voyage dans un en-tête HTTP) ou Touch ID / Face ID (`js/auth.js`, WebAuthn avec
  l'extension PRF qui chiffre le PIN sur l'appareil ; sans PRF, l'option n'est pas proposée, jamais de PIN en clair).
- Journal des connexions : chaque ouverture appelle `PYAUTH.record` puis la fonction SQL `log_access` (heure, IP et
  réussite fixées par la base ; appareil et position seulement si le téléphone l'autorise). Lecture réservée au
  back-office `admin.html` (non lié, `noindex`) avec le PIN administrateur (en-tête `x-admin-pin`, `check_admin()`),
  qui peut aussi changer le PIN de Yacine (`admin_set_pin`). Pas d'avis sur l'écran de connexion : l'administrateur
  (le frère de Yacine) l'en informe de vive voix.

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

## Direction artistique « institutionnelle sobre »

Esprit : beaucoup de blanc, une seule couleur d'action utilisée avec parcimonie, hiérarchie typographique nette,
cartes sans bordure, transitions de 200 ms, icônes au trait. Aucun emprunt à une marque existante (logo, nom, photos,
slogans, police propriétaire).

- Jetons dans `css/app.css` : `--bg`, `--surface`, `--surface-2` (sections alternées, fond des champs), `--ink`
  (titres), `--ink-body`, `--ink-2`, `--ink-3` (jamais pour du texte), `--rule`. Rouge d'action `--brand` (bouton
  principal, onglet actif, lien « texte › », focus) et `--brand-deep` au survol ; le bouton plein utilise `--btn`, qui
  reste #C7000B en mode nuit pour garder le texte blanc lisible. États : `--good`, `--warn` (pictos) et `--warn-text`
  (texte), `--bad`, chacun avec son fond `-bg` ; une pastille `.pill` ou un conseil porte toujours un symbole (✓, !, ×)
  en plus de la couleur. Bande des chiffres clés `.tiles` sur `--dark-band`, texte blanc et libellés gris.
- Les anciens noms (`--sign`, `--sign-text`, `--paper`, `--field`, `--ground`, `--asphalt`, `--stop`, `--seq1` à
  `--seq5`, `--mono`) restent définis et pointent vers les nouveaux jetons : le JS et les graphiques les lisent.
- Typographie : Inter (300 à 700) partout ; chiffres tabulaires seulement sur les nombres (Inter élargit aussi les
  traits d'union). Titres en casse normale ; capitales espacées réservées aux petites étiquettes `.eyebrow` (12 px).
  Grands chiffres en graisse 300 (40 à 56 px sur ordinateur, 28 à 32 px sur téléphone), corps 15 px, interlignage 1,6.
- Formes : cartes rayon 12 px sans bordure ni ombre, boutons en pilule (principal plein, `.sec` contour 1 px
  `--ink`), champs gris soulignés d'un filet `--ink-3` (contraste 3:1). Contenu de 1 200 px au plus, marges 24 px
  sur ordinateur et 16 px sur téléphone.
- En-tête blanc fixe sur ordinateur : logo, onglets texte soulignés de rouge pour l'actif, « Brief du jour » et
  « Ce soir » à droite ; entre 701 et 1 079 px les onglets passent sur une seconde ligne. Téléphone : en-tête non
  fixe, navigation basse claire à cinq onglets plus « Plus » (icônes au trait), cibles de 44 px au moins, aucun
  défilement horizontal à 360 px.
- Mode nuit par `prefers-color-scheme` et `[data-theme="dark"]`. Contrastes AA vérifiés par calcul dans les deux
  modes (texte 4,5:1, focus et grands chiffres 3:1).

## Commandes

```
npm ci                       # dépendances de test (jsdom, Playwright) ; le site n'a aucune dépendance d'exécution
node tests/e2e/serve.js      # sert le site sur http://localhost:8787/
npm run test:unit            # 148 tests, node:test + jsdom, 20 s
npm run test:unit:coverage   # idem avec la couverture des scripts du site (seuil CI 75 %)
npm run test:contract        # Supabase (réseau) ; PY_TEST_PIN=xxxx pour les cas avec PIN
npx playwright install chromium && npm run test:e2e   # Chromium ordinateur et téléphone
```

Le plan de tests, les helpers (`boot`, `enter`, `dropPdf`, `invoice.typicalWeek`) et les conventions pour écrire
un test sont dans `TESTING.md`. Toute correction de bug s'accompagne d'un test qui échouait avant.

## En attente côté utilisateur

- Coller la migration 6 (fin de `supabase/schema.sql`) et choisir le PIN administrateur :
  `update config set admin_pin = '...' where id = 1;` (12 caractères au moins), puis ouvrir `admin.html`.
- Ajouter le secret GitHub `PY_TEST_PIN` pour que la CI vérifie la connexion avec le bon PIN.
- Coller la migration 4 (fin de `supabase/schema.sql`) dans Supabase > SQL Editor, puis passer à un PIN long :
  `update config set pin = 'phrase de passe' where id = 1;` (10 caractères au moins).
- Coller la migration 5 (fin de `supabase/schema.sql`) puis `reference_data.sql` (fichier privé) dans Supabase.
- Les anciennes données réelles restent dans l'historique git du dépôt public (commits antérieurs à leur retrait) :
  réécrire l'historique si on veut les effacer complètement.
- Fonctionnalités proposées non retenues pour l'instant : rappel du soir, rapport du dimanche par courriel, veille
  Kijiji pour la voiture, jauge de colis en cours de shift, mode hors ligne, badges de série, comparateur de coût
  d'usage d'une voiture, export comptable annuel, espace multi-chauffeurs (phase 2 du plan).
