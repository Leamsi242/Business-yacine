# Stratégie de tests de Pilote Yacine

Le site calcule de l'argent (part de Yacine, audit des factures, épargne pour la voiture) et enregistre des journées
de travail. Une erreur silencieuse coûte des dollars ou fausse un objectif. Les tests protègent d'abord ça, puis la
persistance des données, puis l'ergonomie sur téléphone. Ils tournent sans données réelles : les factures de test
sont fabriquées par `tests/helpers/invoice.js` au format exact des PDF Intelcom, sans nom, numéro de suivi ni
montant réels.

## Ce qu'il faut protéger, par ordre de risque

| Risque | Où ça vit | Si ça casse |
|---|---|---|
| Lecture d'une facture PDF (en-tête, journées, 700 colis) | `js/pdf-import.js` | journées manquantes, revenus faux |
| Audit de la facture (somme, frais 2 %, total, grille tarifaire, journée oubliée) | `js/features.js` `auditInvoice` | une baisse de tarif passe inaperçue |
| Part de Yacine, semaines, formats | `js/app.js` `share`, `byWeek`, `fmt` | tout le tableau de bord est faux |
| Capacité d'épargne, répartition, date d'achat, suggestion du soir | `js/savings.js` | mauvais conseil, voiture repoussée |
| Dates « du jour » en heure locale | `js/util.js` | une journée saisie à 21 h tombe au lendemain |
| Import qui écrase une saisie (km, essence, note) | `js/db.js` | données perdues |
| Objets envoyés à Supabase avec des colonnes inconnues | `js/db.js` et appelants | l'import échoue en ligne |
| Sécurité par PIN (RLS), PIN jamais lisible | `supabase/schema.sql` | n'importe qui lit ou écrit |
| Navigation et cibles tactiles sur téléphone | `css/app.css`, `index.html` | inutilisable en tournée |

Hors périmètre volontaire : le rendu du monde en canvas (`js/world.js`), les tuiles de carte Leaflet, les
bibliothèques tierces, les fichiers de données (`data.js`, `tariffs.js`).

## Pyramide

```
          Fumée sur le site publié        1 parcours, après chaque déploiement
       Bout en bout (Playwright, Chromium)  17 tests, ordinateur et téléphone, ~30 s
    Contrat Supabase (PostgREST direct)       7 tests, réseau requis, ~1 s
 Unitaires et parcours jsdom (node:test)       90 tests, aucune dépendance réseau, ~10 s
```

| Couche | Outil | Fichiers | Ce qu'elle vérifie |
|---|---|---|---|
| Unitaire pur | `node:test` + `vm` (`tests/helpers/sandbox.js`) | `tests/unit/pdf-import`, `audit`, `db-local` | logique sans DOM : parseur, audit, couche de données locale |
| Composant et parcours | `node:test` + jsdom (`tests/helpers/dom.js`) | `tests/unit/core`, `savings`, `dates`, `flows` | `index.html` chargé avec les vrais scripts, horloge figée, GPS et pdf.js simulés |
| Contrat | `node:test` + `fetch` | `tests/contract/supabase` | RLS par PIN, table `config` illisible, écriture refusée, tables des migrations présentes |
| Bout en bout | `@playwright/test` | `tests/e2e/smoke`, `import` | vrai navigateur : brief, shift GPS émulé, saisie du soir, rechargement, import d'un vrai PDF, mobile |
| Post-déploiement | Playwright contre `PY_BASE_URL` | `tests/e2e/smoke` | le site publié sert les bons fichiers et fonctionne |

## Couverture visée et mesurée

`npm run test:unit:coverage` mesure les lignes des scripts du site réellement exécutées par la couche
unitaire et jsdom (Node ne les compte pas tout seul : ils sont évalués dans jsdom, pas chargés comme modules ;
`tests/coverage.js` lit la couverture V8 brute). Mesure au 15 octobre 2026 :

| Fichier | Cible | Mesuré | Reste non couvert (et par quelle couche) |
|---|---|---|---|
| `js/pdf-import.js` | 100 % | 100 % | lecture pdf.js réelle : bout en bout `import.spec.js` |
| `js/util.js` | 100 % | 100 % | |
| `js/savings.js` | 95 % | 100 % | |
| `js/features.js` | 90 % | 94,6 % | géolocalisation sur la carte et dans le monde : bout en bout |
| `js/app.js` | 85 % | 85,6 % | carte Leaflet, monde : bout en bout |
| `js/db.js` | local 100 %, Supabase par contrat | 74,3 % | les branches Supabase (lecture/écriture avec PIN) : contrat |
| `js/world.js` | fumée seulement | 20,5 % | canvas : `smoke.spec.js` (le monde s'affiche, la touche Entrée y mène) |
| Total | seuil CI 75 % | 80,5 % | |

Le seuil global de 75 % est appliqué en CI (`COVERAGE_MIN`) pour empêcher une régression, pas comme objectif :
une ligne couverte n'est pas une ligne vérifiée. Les chiffres qui comptent sont les cas ci-dessous.

## Cas de test par zone (implémentés)

Parseur (`pdf-import.test.js`, 13 cas) : semaine type (en-tête, cohérence base + carburant − admin − annulations
= total, 4 journées de 20 colis ou plus, la journée de 2 colis ignorée, 708 colis avec clés exactes, somme des
colis = base) ; localité dominante rurale (J0A1M0) ou urbaine (J2C) ; montants avec virgule de milliers ; en-tête
répété sur chaque page ; colis avec signature (*) ; annulations ; poids entiers et demi-livres ; note de crédit
et PDF vide rejetés.

Audit (`audit.test.js`, 13 cas) : facture conforme (aucune anomalie, quatre contrôles verts) ; frais à 3 % ;
total faux ; annulations ; somme des colis différente ; baisse de tarif sur un poids entier (2 lb) ; hausse sur
une demi-livre ; zone inconnue sans fausse alerte ; écart sous un demi-cent ignoré ; journée saisie absente de la
facture (et pas si elle vient d'une facture) ; résumé du jour différent des lignes.

Couche locale (`db-local.test.js`, 16 cas) : mode local sans Supabase ; une journée par date ; import
idempotent ; l'import garde km, essence, note, localité saisis et passe la journée en source `facture` ; audit
attaché ; shifts ; quatre projets d'épargne par défaut, voiture en priorité 1 ; versement daté du jour local ;
budget ; export et restauration, format inconnu refusé.

Cœur (`core.test.js`, 14 cas) : part 75 % / 70 % / 95 % ; lundi de la semaine y compris au changement
d'année ; regroupement par semaine ; formats fr-CA ; échappement HTML ; fusion historique embarqué + base ; colis
importés après le 27 septembre enrichissant les statistiques (G6P rangé sous Victoriaville) ; score de route
(codes ruraux éloignés « Accepter », urbain J2C, codes inconnus listés, champ vide) ; formulaire du journal.

Épargne (`savings.test.js`, 15 cas) : avec 8 semaines régulières, net 1 200 $, essence 200 $, impôt 240 $, loyer
et vie 1 050 / 4,33 ; un jour de plus ; la voiture prend tout, l'impôt jamais ; descente de priorité quand la
cible est presque atteinte ; partage égal à priorité égale ; suggestion du soir ; tuile voiture avec semaines
restantes ; budget en déficit ; aucune journée ; indépendant ; prévision de fin de mois ; mur des 26 semaines ;
formulaires projet, budget, versement.

Dates (`dates.test.js`, 7 cas) : à 21 h 30 heure de l'Est, formulaire, saisie du soir, clé du brief et versement
restent au 15 octobre ; dimanche soir la semaine en cours compte encore ; le 31 octobre au soir le mois est
encore octobre.

Parcours (`flows.test.js`, 12 cas) : accueil, onglets, bouton Plus ; brief en 4 étapes avec route « loin »,
200 colis (580 $ facturés, 435 $ net, 72 $ d'essence, 363 $), shift enregistré et GPS actif ; km accumulés
(1 km compté, position imprécise, saut de 50 km et dérive de 4 m ignorés) ; fin de shift, saisie pré-remplie,
verdict « Objectif atteint (105 %) », suggestion « Mets 229 $ de côté », versement ; import conforme ; facture
qui omet une journée saisie ; document étranger refusé ; formulaire d'objectifs ; contrat de schéma (chaque objet
enregistré n'a que des colonnes de `schema.sql`).

Contrat Supabase (`supabase.test.js`, 7 cas) : mauvais PIN ou sans PIN, aucune ligne sur neuf tables ; `config`
illisible même avec le bon PIN ; insertion refusée ; tables des migrations 2 et 3 présentes ; avec `PY_TEST_PIN`,
la lecture des objectifs renvoie une ligne, localités chargées, projets d'épargne présents.

Bout en bout (`smoke.spec.js`, `import.spec.js`) : chargement sans erreur JavaScript, cinq destinations ; Entrée
mène au monde ; journée complète (brief, 8 pas GPS de 30 m donnent 0,2 km, saisie, rechargement, journal et
stockage) ; tableau de bord, carte et localisation, objectifs, simulateur, conseils ; sur téléphone cinq onglets
plus « Plus », hauteur 44 px, aucun défilement horizontal ; import d'un PDF généré par Chromium (lecture pdf.js
réelle, 708 colis, audit conforme), baisse de tarif signalée, document étranger refusé.

## Ce que la mise en place des tests a révélé

Corrigé dans le même commit, chaque point ayant son test :

1. L'audit ne comparait jamais les poids entiers : la grille a des clés `ZONE_G|2.0`, l'audit cherchait
   `ZONE_G|2`. 296 des 329 tarifs de référence étaient ignorés, donc la quasi-totalité des colis. Clé normalisée
   par `PYU.tariffKey`.
2. Toutes les dates « du jour » étaient calculées en UTC : à partir de 20 h (heure avancée) ou 19 h (heure
   normale) au Québec, la saisie du soir, la date par défaut du journal, la clé du brief, les versements, le mur des
   semaines et le mois du tableau de bord passaient au lendemain. Remplacé par `js/util.js` (heure locale).
3. Le parseur mettait `driver_code` dans l'objet facture ; cette colonne n'existe pas dans `invoices`, l'import en
   ligne aurait été refusé par PostgREST. Déplacé dans `meta`, avec un test de contrat de schéma pour toute la
   chaîne d'enregistrement.
4. Dans le brief, la route choisie ne passait pas en surbrillance (écrans construits une seule fois). Écrans rendus
   à la demande.
5. Le montant suggéré le soir différait entre le message et le bouton « Verser » (recalculé après rechargement des
   données). Calculé une fois.
6. En mode local, une journée saisie puis couverte par une facture gardait la source « saisie » alors que Supabase
   la passait en « facture ». Aligné.
7. Le compteur de signatures ne pouvait jamais s'afficher (le parseur ne le renseignait pas). Compté dans `meta`.

## Lacunes et choix assumés

- Pas de captures de référence (régression visuelle) : les polices et le rendu varient entre machines, et le
  design évolue encore. À ajouter quand la direction artistique sera figée (`toHaveScreenshot` avec un seuil).
- Pas d'écriture sur la vraie base avec le bon PIN : les tests de contrat lisent seulement. Un test d'écriture
  demanderait un projet Supabase de préproduction.
- Le monde en canvas et la carte Leaflet ne sont vérifiés qu'en fumée (ils s'affichent, pas ce qu'ils dessinent).
- Pas de contrôle d'accessibilité automatisé (axe) ni de test de performance ; la critique de design a mesuré les
  contrastes à la main, un test `axe-core` serait la suite logique.
- Les factures réelles ne servent jamais de fixtures (données personnelles sur un dépôt public). Le générateur
  reproduit la structure observée sur les neuf factures ; si Intelcom change sa mise en page, le premier PDF
  réel importé le dira, et il faudra mettre le générateur à jour.
- Les tests hors ligne du bac à sable ne chargent pas les CDN (`PY_OFFLINE=1`) ; en CI tout est chargé.

## Lancer les tests

```
npm ci                      # une fois
npm run test:unit           # unitaires et parcours jsdom (10 s)
npm run test:unit:coverage  # idem avec la couverture des scripts du site
npm run test:contract       # Supabase ; PY_TEST_PIN=xxxx pour les cas avec PIN
npm run test:e2e            # Playwright, ordinateur et téléphone (npx playwright install chromium la première fois)
npm test                    # unitaires puis bout en bout
```

Variables : `PY_BASE_URL` pour viser un site déployé, `PY_OFFLINE=1` et `PY_PDFJS_DIR` pour tourner sans accès
aux CDN, `COVERAGE_MIN` pour faire échouer sous un seuil.

CI (`.github/workflows/test.yml`) : à chaque push et pull request, deux jobs (unitaires + contrat, Chromium) ;
après chaque déploiement réussi, la fumée contre le site publié. Pour activer les cas avec PIN, ajouter le secret
`PY_TEST_PIN` dans Settings > Secrets and variables > Actions.

## Écrire un nouveau test

- Logique pure : `load(['util', 'db'])` de `tests/helpers/sandbox.js` ; comparer avec `plain()` (autre realm).
- Rendu ou parcours : `boot({ now, noHistory, localState })` de `tests/helpers/dom.js`, puis `enter(ctx, 'dash')`,
  `dropPdf`, `ctx.geo.push(...)`, et `ctx.close()` à la fin. `localState()` de `tests/helpers/data.js` donne des
  semaines régulières aux attendus simples.
- Les montants affichés contiennent des espaces insécables (`1 320,66 $`) : normaliser avec
  `.replace(/ /g, ' ')` avant un `match`.
- Une facture de test : `inv.typicalWeek()` ou `inv.build({...})` ; `inv.day(date, n, zone, seed)` pour une journée.
- Toute nouvelle colonne envoyée à Supabase doit exister dans `supabase/schema.sql` (le contrat de schéma le
  vérifie) et être ajoutée par une migration que Yacine exécute.

## Prochaines étapes

1. Ajouter le secret `PY_TEST_PIN` pour que la CI confirme la connexion et les migrations en ligne.
2. Captures de référence des sept vues (ordinateur, téléphone, mode nuit) une fois le design stabilisé.
3. `axe-core` dans la fumée pour les contrastes et les libellés.
4. Un projet Supabase de préproduction pour tester les écritures avec le bon PIN.
